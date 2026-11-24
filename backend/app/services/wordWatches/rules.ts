/**
 * The rules of word alerts (task 52), decided 2026-11-23. Kept here so the API, the sweeps and the tests read the same
 * numbers.
 */

/** Active alerts one account may have; patrons get more. Fulfilled and paused alerts do not count. */
export const WORD_WATCH_LIMIT = { free: 20, patron: 100 } as const;

/** New sentences (in the reader's own search) since the last notice before a word goes into the weekly digest. */
export const NEW_SENTENCES_THRESHOLD = 3;

/** Above this many sentences the site warns that following the word will bring a lot. Not enforced here. */
export const COMMON_WORD_SENTENCES = 5000;

/** NFKC and trimmed, so a full-width or padded spelling of the same word is one alert. */
export function normalizeWordQuery(query: string): string {
  return query.normalize('NFKC').trim();
}
