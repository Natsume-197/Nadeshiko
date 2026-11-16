import { createError, getQuery, getRouterParam, type H3Event, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { logger } from '~~/server/utils/logger';
import {
  type DictionaryAnswer,
  DictionaryError,
  defaultProvider,
  dictionaryFor,
  failoverFor,
  isProviderName,
  type ProviderName,
  type WordQuery,
} from '~~/server/utils/dictionary';
import { readerStack, readerToken, reportShirabeRefusal, reportStackFingerprint } from '~~/server/utils/shirabeReader';
import { distinctNameAnswers, withoutNameEntries } from '~~/server/utils/shirabeNames';

// Identify with reading/POS hints: bare-lemma lookup ignores homograph context. Return ranked alternatives because
// the reader may need to choose. Which dictionary answers is the reader's choice (`provider`, Shirabe or ours) and
// `server/utils/dictionary`'s business; this route owns caching, reader linking, failover and statuses.

const CACHE_SECONDS = 60 * 60 * 24;
const RETRY_AFTER_SECONDS = 5;

// Clamp label locales to supported values; definitions include all languages and callers select their own.
const LABEL_LOCALES = new Set<WordQuery['locale']>(['en', 'es']);

interface LookupInput {
  query: WordQuery;
  provider: ProviderName;
}

// Everything the answer depends on. The cache key is built from this alone, so parameters the handler never
// reads (including the browser's `stack` key) cannot split shared entries.
function lookupInput(event: H3Event): LookupInput | null {
  const lemma = getRouterParam(event, 'lemma');
  if (!lemma) return null;

  const params = getQuery(event);
  const requested = String(params.locale ?? '') as WordQuery['locale'];
  const locale = LABEL_LOCALES.has(requested) ? requested : 'en';

  // Omit blank hints; unknown differs from an explicit empty value. pos must use Shirabe's short tag, not UniDic:
  // unrecognized categories can return no candidates.
  const query: WordQuery = { lemma, locale };
  for (const key of ['surface', 'reading', 'pos'] as const) {
    const value = String(params[key] ?? '').trim();
    if (value) query[key] = value;
  }

  // The reader's choice, sent by the browser so it is part of the URL every cache keys on; absent or unknown means
  // the site default.
  const provider = isProviderName(params.provider) ? params.provider : defaultProvider();
  return { query, provider };
}

function lookupCacheKey(event: H3Event): string {
  const input = lookupInput(event);
  if (!input) return 'missing-lemma';
  const { query, provider } = input;
  // The default provider keeps the key it had before providers existed, so switching this in cost no cache.
  const keyed = provider === 'shirabe' ? [] : [provider];
  return stableCacheKey(query.locale, query.lemma, query.surface ?? '', query.reading ?? '', query.pos ?? '', ...keyed);
}

/** A linked reader's own Shirabe stack only matters when Shirabe is the one answering. */
async function usesReaderStack(event: H3Event): Promise<boolean> {
  const input = lookupInput(event);
  if (input?.provider !== 'shirabe') return false;
  return (await readerStack(event)).linked;
}

/** Ranked candidates as the card wants them; a 404 when the dictionary has no entry. */
function shape(answer: DictionaryAnswer, answeredAsReader: boolean) {
  // Prefer ordinary words when present; preserve name candidates when they are the only answer.
  const all = answer.candidates;
  const words = withoutNameEntries(all);
  const candidates = words.length > 0 ? words : all;
  if (!candidates.length) throw createError({ statusCode: 404, statusMessage: 'No entry for this word' });

  // Collapse multiple distinct name glosses, not repeated copies of one useful definition.
  const nameOnly = words.length === 0 && distinctNameAnswers(all) > 1;

  // Expose a fingerprint only for actual reader answers; service fingerprints must not re-key shared browser caches.
  return {
    candidates,
    nameOnly,
    ...(answeredAsReader && answer.stackFingerprint ? { stackFingerprint: answer.stackFingerprint } : {}),
  };
}

const handler = defineEventHandler(async (event) => {
  const input = lookupInput(event);
  if (!input) throw createError({ statusCode: 400, statusMessage: 'lemma is required' });
  const { query, provider } = input;
  const { lemma } = query;
  const dictionary = dictionaryFor(provider);

  // Fetch a linked reader's key only on a cache miss, and only for Shirabe, which is where their stack lives.
  const reader = provider === 'shirabe' ? await readerStack(event) : { linked: false, fingerprint: null };
  const hasOwnStack = reader.linked;
  const readerKey = hasOwnStack ? ((await readerToken(event)) ?? undefined) : undefined;

  try {
    let answer: DictionaryAnswer;
    // A service fallback must never be reported as the reader's dictionary stack.
    let answeredAsReader = Boolean(readerKey);
    try {
      answer = await dictionary.identify(query, { readerKey });
    } catch (readerError: unknown) {
      // Only reader-key refusals/rate limits fall back to service dictionaries, not arbitrary upstream failures.
      if (!(readerError instanceof DictionaryError) || readerError.kind !== 'refused') throw readerError;
      const { status } = readerError;

      logger.warn({ lemma, status }, 'A reader Shirabe key was refused; answering with the default dictionaries');

      // 401/403 describe the link; 429 only describes usage. Report refusals asynchronously for the next lookup.
      if (status === 401 || status === 403) void reportShirabeRefusal(event, status);

      answeredAsReader = false;
      answer = await dictionary.identify(query);
    }

    // Report changed reader stacks without delaying this fresh answer; the next request uses the updated cache key.
    if (answeredAsReader && answer.stackFingerprint && answer.stackFingerprint !== reader.fingerprint) {
      void reportStackFingerprint(event, answer.stackFingerprint);
    }

    const body = shape(answer, answeredAsReader);
    // Linked stacks may include private uploads; only unlinked default answers can be shared-cached.
    setResponseHeader(
      event,
      'cache-control',
      hasOwnStack ? `private, max-age=${CACHE_SECONDS}` : `public, max-age=${CACHE_SECONDS}`,
    );
    return body;
  } catch (error: unknown) {
    // Keep our no-entry 404 separate from upstream failure classification.
    if ((error as { statusCode?: number })?.statusCode === 404) throw error;

    const failure = error instanceof DictionaryError ? error : undefined;

    if (failure?.kind === 'misconfigured') {
      logger.error(
        { lemma, dictionary: provider },
        'The dictionary answered with an HTML 404 -- the API path is wrong, not the word missing',
      );
      throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
    }

    logger.warn(
      { lemma, dictionary: provider, status: failure?.status, err: failure?.upstream ?? error },
      'Dictionary identify failed',
    );
    // Optional enrichment failures are retryable 503s, not missing words. no-store prevents caching an outage for a day.
    setResponseHeader(event, 'cache-control', 'no-store');
    setResponseHeader(event, 'retry-after', RETRY_AFTER_SECONDS);
    throw createError({ statusCode: 503, statusMessage: 'Dictionary temporarily unavailable' });
  }
});

// Cache only shared answers; linked Shirabe readers bypass server caching, including on service fallback.
// Browser-private caching covers repeated linked lookups without risking cross-reader dictionary leakage.
const cachedLookup = defineCachedEventHandler(handler, {
  swr: true,
  maxAge: CACHE_SECONDS,
  shouldBypassCache: usesReaderStack,
  getKey: lookupCacheKey,
});

/**
 * When the reader's dictionary is down or misconfigured, answer from the other one rather than fail the card: the
 * Honzuki upload (2026-11-08) left every reader with 503s for half an hour while Shirabe parsed. The failover answer
 * runs outside the cache and is marked no-store, so a passing outage is never remembered as the reader's answer.
 */
export default defineEventHandler(async (event) => {
  try {
    return await cachedLookup(event);
  } catch (error: unknown) {
    const status = (error as { statusCode?: number })?.statusCode;
    const input = lookupInput(event);
    const other = input && (status === 502 || status === 503) ? failoverFor(input.provider) : null;
    if (!input || !other) throw error;

    try {
      const body = shape(await dictionaryFor(other).identify(input.query), false);
      logger.info({ lemma: input.query.lemma, from: input.provider, to: other }, 'Word card answered by the failover');
      setResponseHeader(event, 'cache-control', 'no-store');
      setResponseHeader(event, 'x-dictionary-failover', other);
      return body;
    } catch (failoverError: unknown) {
      // The other one has no entry: say so. Both down: the reader's own dictionary's failure stands.
      if ((failoverError as { statusCode?: number })?.statusCode === 404) throw failoverError;
      throw error;
    }
  }
});
