import type { ShirabeCandidate } from '~/utils/wordCard';
import type { WordRef } from '~/utils/tokenEnrichment';

export type { WordRef };

/**
 * Share lookups across component instances. Cache in-flight promises to deduplicate simultaneous hovers and
 * resolved missing entries to avoid repeated requests; failures remain retryable. Identify includes the card
 * fields, so no second detail cache is needed.
 */

/**
 * Keep missing entries separate from failed requests so the card can distinguish a dictionary answer from
 * service unavailability.
 */
export type WordLookup =
  | { candidates: ShirabeCandidate[]; nameOnly?: boolean; reason?: undefined }
  | { candidates: []; nameOnly?: undefined; reason: 'missing' | 'failed' };

const inFlight = new Map<string, Promise<WordLookup>>();

/**
 * Include locale in the cache key: field/dialect labels and full-wording tooltips still come localized from
 * Shirabe, even when other chips use local translations.
 */
function cacheKey(ref: WordRef, locale: string, stack: string): string {
  return `${ref.lemma}\u0000${ref.surface}\u0000${ref.reading}\u0000${ref.pos}:${locale}:${stack}:${readerProvider}`;
}

export type DictionaryProvider = 'shirabe' | 'nadeshiko';

/**
 * Which dictionary the reader wants on the card, or '' for the site default. Sent as `provider` so it is part of
 * the URL every cache (browser, Nitro, Cloudflare) keys on. Pushed from the auth store, like the stack below.
 */
let readerProvider: DictionaryProvider | '' = '';

export function setReaderProvider(provider: DictionaryProvider | null | undefined): void {
  readerProvider = provider ?? '';
}

/** The reader's provider: their explicit choice, else Shirabe for a reader who linked a Shirabe account (they
 *  linked it to use it), else none, which means the site default. */
export function chosenProvider(
  preference: 'SHIRABE' | 'NADESHIKO' | null | undefined,
  linkedShirabe: boolean,
): DictionaryProvider | null {
  if (preference === 'SHIRABE') return 'shirabe';
  if (preference === 'NADESHIKO') return 'nadeshiko';
  return linkedShirabe ? 'shirabe' : null;
}

/**
 * Stack fingerprint is a cache discriminator, not lookup authority; Shirabe resolves dictionaries from the
 * reader's key. It changes URLs when a linked stack changes. The auth store pushes it here to avoid importing
 * Pinia/Nuxt into these utilities.
 */
let readerStackFingerprint = '';

export function setReaderStack(fingerprint: string | null | undefined): void {
  readerStackFingerprint = fingerprint ?? '';
}

function readerStack(): string {
  return readerStackFingerprint;
}

/** The answers we already have. Separate from `inFlight` because a caller needs
 *  to distinguish "answered, and it was nothing" from "never asked"
 *  (undefined), which a promise map cannot express. */
const resolved = new Map<string, WordLookup>();

/**
 * Bound tab-lifetime cache growth. Evicted entries can still be served by the browser's day-long HTTP cache.
 */
const CACHE_LIMIT = 600;

/** Look up an answer and mark it as freshly used. A `Map` iterates in insertion
 *  order, so re-inserting moves an entry to the back and leaves the least
 *  recently used at the front, where `remember` evicts from. */
function recall<T>(store: Map<string, T>, key: string): T | undefined {
  const answer = store.get(key);
  if (answer === undefined) return undefined;
  store.delete(key);
  store.set(key, answer);
  return answer;
}

function remember<T>(store: Map<string, T>, key: string, answer: T): T {
  store.delete(key);
  store.set(key, answer);

  if (store.size > CACHE_LIMIT) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  return answer;
}

/** The answer if it is already here, so a card can open filled in rather than
 *  flashing a loading state for a word the page has seen. `undefined` means it
 *  has not been asked. */
export function peekWord(ref: WordRef, locale: string): WordLookup | undefined {
  return recall(resolved, cacheKey(ref, locale, readerStack()));
}

/**
 * Return ranked candidates without rejecting; both missing entries and failed requests have explicit reasons.
 */
export function fetchWord(ref: WordRef, locale: string): Promise<WordLookup> {
  const stack = readerStack();
  const key = cacheKey(ref, locale, stack);

  const answered = recall(resolved, key);
  if (answered) return Promise.resolve(answered);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = $fetch<{
    candidates: ShirabeCandidate[];
    nameOnly?: boolean;
    stackFingerprint?: string;
    pending?: boolean;
  }>(`/api/shirabe/words/candidates/${encodeURIComponent(ref.lemma)}`, {
    // `stack` is a cache key and nothing else: the route ignores it when
    // calling Shirabe, which resolves the stack from the reader's own key.
    // Sent only for a linked reader, so every other URL is unchanged.
    query: {
      locale,
      surface: ref.surface,
      reading: ref.reading,
      pos: ref.pos,
      ...(stack ? { stack } : {}),
      ...(readerProvider ? { provider: readerProvider } : {}),
    },
    // Bound the browser request beyond the server's shorter timeouts so a hung connection cannot leave the
    // card loading forever.
    timeout: 8000,
  })
    .then((answer): WordLookup => {
      // A changed response fingerprint identifies stack drift. Update the browser fingerprint, discard stale
      // resolved answers and store this response under its observed stack instead of waiting for session
      // reload.
      let answerKey = key;
      const observed = answer?.stackFingerprint;
      if (observed && observed !== stack) {
        setReaderStack(observed);
        resolved.clear();
        answerKey = cacheKey(ref, locale, observed);
      }

      const found = answer?.candidates ?? [];
      // An empty candidate list has the same missing-entry meaning as HTTP 404.
      const lookup: WordLookup =
        found.length === 0
          ? { candidates: [], reason: 'missing' }
          : { candidates: found, nameOnly: answer?.nameOnly === true };
      // Missing one of the reader's uploaded dictionaries (indexing, or the server still fetching it): show it, but
      // ask again on the next hover instead of keeping it for the tab's life.
      if (answer?.pending) return lookup;
      return remember(resolved, answerKey, lookup);
    })
    .catch((error: unknown): WordLookup => {
      // 404 means no entry; other failures describe the request. Support both status locations used by
      // ofetch.
      const failure = error as { response?: { status?: number }; statusCode?: number };
      const status = failure?.response?.status ?? failure?.statusCode;

      // A 404 is an answer and is worth keeping: this word has no entry today
      // and will have none on the next hover either.
      if (status === 404) return remember(resolved, key, { candidates: [], reason: 'missing' });

      // Do not cache transient failures: the next hover must be able to recover without a page reload.
      return { candidates: [], reason: 'failed' };
    })
    .finally(() => {
      // Only the in-flight entry is cleared; `resolved` keeps the answer.
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

// Expose cache identity and capacity for boundary tests without duplicating the configured limit.
export const __testing = { cacheKey, CACHE_LIMIT };
