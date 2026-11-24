import { createError, getQuery, getRouterParam, type H3Event, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { logger } from '~~/server/utils/logger';
import {
  type DictionaryAnswer,
  DictionaryError,
  nadeshikoDictionary,
  type WordQuery,
} from '~~/server/utils/dictionary';
import { customDictionaryStack, readerCookie } from '~~/server/utils/dictionaryReader';
import { distinctNameAnswers, withoutNameEntries } from '~~/server/utils/dictionaryNames';
import { DICTIONARY_CACHE_SECONDS, dictionaryLocale, dictionaryUnavailable } from '~~/server/utils/dictionaryRoute';

// Identify with reading/POS hints: bare-lemma lookup ignores homograph context. Return ranked alternatives because
// the reader may need to choose. This route owns caching, custom-dictionary bypass and HTTP statuses.

// Everything the answer depends on. The cache key is built from this alone, so parameters the handler never
// reads (including the browser's `stack` key) cannot split shared entries.
function lookupQuery(event: H3Event): WordQuery | null {
  const lemma = getRouterParam(event, 'lemma');
  if (!lemma) return null;

  const params = getQuery(event);
  // Clamp label locales to supported values; definitions include all languages and callers select their own.
  const locale = dictionaryLocale(params.locale);

  // Omit blank hints; unknown differs from an explicit empty value.
  const query: WordQuery = { lemma, locale };
  for (const key of ['surface', 'reading', 'pos'] as const) {
    const value = String(params[key] ?? '').trim();
    if (value) query[key] = value;
  }

  return query;
}

function lookupCacheKey(event: H3Event): string {
  const query = lookupQuery(event);
  if (!query) return 'missing-lemma';
  return stableCacheKey(query.locale, query.lemma, query.surface ?? '', query.reading ?? '', query.pos ?? '');
}

/** A reader's own uploaded Yomitan dictionaries bypass the shared cache. */
async function usesReaderStack(event: H3Event): Promise<boolean> {
  return (await customDictionaryStack(event)).hasStack;
}

/** Ranked candidates as the card wants them; a 404 when the dictionary has no entry. */
function shape(answer: DictionaryAnswer, answeredAsReader: boolean) {
  // Prefer ordinary words when present; preserve name candidates when they are the only answer.
  const all = answer.candidates;
  const words = withoutNameEntries(all);
  const candidates = words.length > 0 ? words : all;
  // A pending answer may only lack the entry because the dictionary that has it is not ready: an empty 200 the
  // browser does not keep, rather than a 404 it remembers as "no entry".
  if (!candidates.length && answer.pending) return { candidates: [], nameOnly: false, pending: true };
  if (!candidates.length) throw createError({ statusCode: 404, statusMessage: 'No entry for this word' });

  // Collapse multiple distinct name glosses, not repeated copies of one useful definition.
  const nameOnly = words.length === 0 && distinctNameAnswers(all) > 1;

  // Expose a fingerprint only for actual reader answers; shared answers must not re-key browser caches.
  return {
    candidates,
    nameOnly,
    ...(answeredAsReader && answer.stackFingerprint ? { stackFingerprint: answer.stackFingerprint } : {}),
    // Tells the browser not to keep this answer either (see `fetchWord`).
    ...(answer.pending ? { pending: true } : {}),
  };
}

const handler = defineEventHandler(async (event) => {
  const query = lookupQuery(event);
  if (!query) throw createError({ statusCode: 400, statusMessage: 'lemma is required' });
  const { lemma } = query;

  // Resolve reader-specific stack only on a cache miss.
  const custom = await customDictionaryStack(event);
  const forwardedCookie = custom.hasStack ? readerCookie(event) || undefined : undefined;
  const answeredAsReader = Boolean(forwardedCookie);

  try {
    const answer = await nadeshikoDictionary.identify(query, {
      ...(forwardedCookie ? { readerCookie: forwardedCookie } : {}),
    });

    const body = shape(answer, answeredAsReader);
    // Custom stacks include private uploads; only default answers can be shared-cached. An answer still missing one
    // of the reader's dictionaries is cached nowhere.
    setResponseHeader(
      event,
      'cache-control',
      answer.pending
        ? 'no-store'
        : custom.hasStack
          ? `private, max-age=${DICTIONARY_CACHE_SECONDS}`
          : `public, max-age=${DICTIONARY_CACHE_SECONDS}`,
    );
    return body;
  } catch (error: unknown) {
    // Keep our no-entry 404 separate from upstream failure classification.
    if ((error as { statusCode?: number })?.statusCode === 404) throw error;

    const failure = error instanceof DictionaryError ? error : undefined;

    if (failure?.kind === 'misconfigured') {
      logger.error({ lemma }, 'The dictionary answered with a configuration error -- check the internal proxy secret');
      throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
    }

    logger.warn({ lemma, status: failure?.status, err: failure?.upstream ?? error }, 'Dictionary identify failed');
    // Optional enrichment failures are retryable 503s, not missing words. no-store prevents caching an outage for a day.
    throw dictionaryUnavailable(event, 'Dictionary temporarily unavailable');
  }
});

// Cache only shared answers; readers with custom dictionaries bypass server caching.
// Browser-private caching covers repeated custom-stack lookups without risking cross-reader dictionary leakage.
export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: DICTIONARY_CACHE_SECONDS,
  shouldBypassCache: usesReaderStack,
  getKey: lookupCacheKey,
});
