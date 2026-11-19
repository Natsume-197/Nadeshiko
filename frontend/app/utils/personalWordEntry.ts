import { brief, type EntryBrief, pickEntries } from '#shared/utils/wordEntry';
import type { ShirabeWord } from '~/utils/wordCard';

/** What `/api/dictionary/word-entry/:word` answers, and what the personal version below builds. */
export interface WordEntryAnswer {
  entry: ShirabeWord | null;
  /** Other words the search can be, each with its whole entry so the box can show it in place. */
  others: Array<EntryBrief & { entry?: ShirabeWord }>;
  inflected: boolean;
  /** Each kanji's first reading and meaning, by character; the shared entry's, which the personal one reuses. */
  kanji?: Record<string, { reading: string | null; meaning: string | null }>;
}

/** Whether the reader's uploaded dictionaries (task 48) add anything to this word: an entry or a frequency badge. */
export function hasOwnDictionaries(word: ShirabeWord): boolean {
  return (
    (word.entries ?? []).some((entry) => entry.dictionary.startsWith('custom:')) ||
    (word.customFrequencies?.length ?? 0) > 0
  );
}

/**
 * The entry above a word search built from the reader's own word-card answer: the same pick as the server's
 * (`pickEntries`), over candidates that carry the reader's dictionaries. Null when those dictionaries add nothing,
 * so the shared, server-rendered entry stays on screen.
 */
export function personalEntryFrom(
  candidates: readonly ShirabeWord[],
  word: string,
  locale: 'en' | 'es',
): WordEntryAnswer | null {
  if (!candidates.some(hasOwnDictionaries)) return null;
  const { entry, others, inflected } = pickEntries(candidates, word);
  if (!entry) return null;
  return { entry, inflected, others: others.map((other) => ({ ...brief(other, locale), entry: other })) };
}

/**
 * Asks the word-card route (private to the reader, never shared-cached) for `word` with the reader's dictionaries.
 * `stack` is their dictionary fingerprint, there to key the browser's cache. Null on any failure: the shared entry
 * stays, as it would for a reader without uploads.
 */
export async function personalEntryFor(
  word: string,
  locale: 'en' | 'es',
  stack: string,
): Promise<WordEntryAnswer | null> {
  try {
    const answer = await $fetch<{ candidates?: ShirabeWord[] }>(
      `/api/shirabe/words/candidates/${encodeURIComponent(word)}`,
      { query: { locale, provider: 'nadeshiko', stack } },
    );
    return personalEntryFrom(answer?.candidates ?? [], word, locale);
  } catch {
    return null;
  }
}
