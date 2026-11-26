import { apiErrorStatus } from '~/utils/apiError';
import { lruRecall, lruRemember } from '~/utils/lruMap';
import type { DictionaryCandidate } from '~/utils/wordCard';
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
  | { candidates: DictionaryCandidate[]; nameOnly?: boolean; reason?: undefined }
  | { candidates: []; nameOnly?: undefined; reason: 'missing' | 'failed' };

const inFlight = new Map<string, Promise<WordLookup>>();

/**
 * Include locale in the cache key so language-specific labels do not collide across switches.
 */
function cacheKey(ref: WordRef, locale: string, stack: string): string {
  return `${ref.lemma}\u0000${ref.surface}\u0000${ref.reading}\u0000${ref.pos}:${locale}:${stack}`;
}

/**
 * Stack fingerprint is a cache discriminator, not lookup authority; the backend resolves custom dictionaries
 * from the reader's session. It changes URLs when the reader's custom dictionary stack changes. The auth store
 * pushes it here to avoid importing Pinia/Nuxt into these utilities.
 */
let readerStackFingerprint = '';

export function setReaderStack(fingerprint: string | null | undefined): void {
  readerStackFingerprint = fingerprint ?? '';
}

/** The reader's custom dictionary stack fingerprint, '' without one. Also keys the kanji card's custom part. */
export function readerStack(): string {
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

const recall = (key: string) => lruRecall(resolved, key);
const remember = (key: string, answer: WordLookup) => lruRemember(resolved, key, answer, CACHE_LIMIT);

/** The answer if it is already here, so a card can open filled in rather than
 *  flashing a loading state for a word the page has seen. `undefined` means it
 *  has not been asked. */
export function peekWord(ref: WordRef, locale: string): WordLookup | undefined {
  return recall(cacheKey(ref, locale, readerStack()));
}

/**
 * Return ranked candidates without rejecting; both missing entries and failed requests have explicit reasons.
 */
export function fetchWord(ref: WordRef, locale: string): Promise<WordLookup> {
  const stack = readerStack();
  const key = cacheKey(ref, locale, stack);

  const answered = recall(key);
  if (answered) return Promise.resolve(answered);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = $fetch<{
    candidates: DictionaryCandidate[];
    nameOnly?: boolean;
    stackFingerprint?: string;
    pending?: boolean;
  }>(`/api/dictionary/words/candidates/${encodeURIComponent(ref.lemma)}`, {
    // `stack` is a cache key and nothing else: the route ignores it when calling the backend,
    // which resolves the stack from the reader's session. Sent only when a custom stack is active.
    query: {
      locale,
      surface: ref.surface,
      reading: ref.reading,
      pos: ref.pos,
      ...(stack ? { stack } : {}),
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
      return remember(answerKey, lookup);
    })
    .catch((error: unknown): WordLookup => {
      // A 404 is an answer and is worth keeping: this word has no entry today
      // and will have none on the next hover either.
      if (apiErrorStatus(error) === 404) return remember(key, { candidates: [], reason: 'missing' });

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
