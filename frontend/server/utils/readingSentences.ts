import { getQuery, type H3Event } from 'h3';

// Helpers for the kanji page's per-reading sentences (`/api/dictionary/word-sentences`, task 44).

const MAX_WORDS = 3;
const MAX_WORD_LENGTH = 20;
/** Sentences asked per word, and kept in all. */
export const PER_WORD = 4;
export const SENTENCES = 8;

/** How many words the reading counts take at once: every example word of every reading of a kanji. */
export const MAX_COUNTED_WORDS = 40;

/** The words to search, from `?words=食事,給食`: one to `max` (three by default), none empty or long. Null when the
 * list is unusable. */
export function wordsOf(event: H3Event, max = MAX_WORDS): string[] | null {
  const raw = getQuery(event).words;
  if (typeof raw !== 'string') return null;
  const words = [...new Set(raw.split(',').map((word) => word.trim()))];
  if (words.length === 0 || words.length > max) return null;
  if (words.some((word) => word.length === 0 || [...word].length > MAX_WORD_LENGTH)) return null;
  return words;
}

type Segment = { publicId: string };
export type SearchAnswer = {
  segments: Segment[];
  includes?: { media?: Record<string, unknown> };
};

/** One word at a time, in turn, without repeating a sentence two words share. */
export function interleave(answers: SearchAnswer[], limit: number): SearchAnswer {
  const segments: Segment[] = [];
  const seen = new Set<string>();
  const media: Record<string, unknown> = {};
  for (const answer of answers) Object.assign(media, answer.includes?.media ?? {});
  for (let round = 0; segments.length < limit; round += 1) {
    let any = false;
    for (const answer of answers) {
      const segment = answer.segments[round];
      if (!segment) continue;
      any = true;
      if (seen.has(segment.publicId)) continue;
      seen.add(segment.publicId);
      segments.push(segment);
      if (segments.length >= limit) break;
    }
    if (!any) break;
  }
  return { segments, includes: { media } };
}
