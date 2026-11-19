/**
 * The dictionary entry shown above a word search (`/search/食べる`): the word's page on this site, which the sitemap
 * already lists. Shared by the search page, which decides whether to ask, and the Nitro route, which picks the entry.
 */

/** Longest query that can be a single dictionary word; anything longer is a phrase. */
const MAX_WORD_LENGTH = 16;

const JAPANESE_WORD = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]+$/u;

/** Whether a search query can be one dictionary word: Japanese script only, no spaces or punctuation, short. */
export function isWordQuery(query: string): boolean {
  const text = query.trim();
  const length = [...text].length;
  return length > 0 && length <= MAX_WORD_LENGTH && JAPANESE_WORD.test(text);
}

/** Katakana to hiragana, so ヨム and よむ are the same spelling. */
export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

interface EntryCandidate {
  headword: string;
  name?: boolean;
  /** Found only as the dictionary form of the query (食べた → 食べる). */
  baseForm?: boolean;
  /** Rank in Nadeshiko's corpus, 1 the most frequent; null or absent when not counted. */
  frequency?: number | null;
  /** `{ text }` objects; typed loosely because the server's candidate type does not describe them. */
  forms?: readonly unknown[];
}

const formText = (form: unknown): string =>
  typeof form === 'object' && form !== null && typeof (form as { text?: unknown }).text === 'string'
    ? (form as { text: string }).text
    : '';

/** Most used in Nadeshiko first; words never counted last; otherwise the dictionary's own order (sort is stable). A
 * search has no sentence to tell homographs apart, so はし is the bridge, not the rarer edge. */
const byCorpusRank = <T extends EntryCandidate>(a: T, b: T) =>
  (a.frequency ?? Number.POSITIVE_INFINITY) - (b.frequency ?? Number.POSITIVE_INFINITY);

const spelledLike = <T extends EntryCandidate>(query: string) => {
  const wanted = toHiragana(query.trim());
  return (candidate: T) =>
    toHiragana(candidate.headword) === wanted ||
    (candidate.forms ?? []).some((form) => toHiragana(formText(form)) === wanted);
};

/**
 * The candidate that IS the searched word: of those spelled exactly like the query (by headword or any form, kana
 * compared across scripts), the one most used in Nadeshiko. Names only when no word fits. Null when the query is
 * not a dictionary form (食べた, 食べ): the entry would describe a word the reader did not search for.
 */
export function pickEntry<T extends EntryCandidate>(candidates: readonly T[], query: string): T | null {
  const matches = candidates.filter(spelledLike<T>(query));
  const words = matches.filter((candidate) => !candidate.name).sort(byCorpusRank);
  return words[0] ?? matches[0] ?? null;
}

/** Another word the query can be, as the entry lists it. */
export interface EntryBrief {
  headword: string;
  reading: string | null;
  /** Its first meaning in the page's language, else English. */
  gloss: string | null;
}

/** A candidate cut down to an `EntryBrief` (English gloss). */
export function brief(candidate: object, _locale: 'en' | 'es' = 'en'): EntryBrief {
  const word = candidate as {
    headword?: string;
    reading?: string | null;
    entries?: Array<{ senses?: Array<{ definitions?: Array<{ lang?: string; text?: string }> }> }>;
  };
  const definitions = (word.entries ?? [])
    .flatMap((entry) => entry.senses ?? [])
    .flatMap((sense) => sense.definitions ?? []);
  const gloss = definitions.find((definition) => definition.lang === 'en') ?? definitions[0];
  return { headword: word.headword ?? '', reading: word.reading ?? null, gloss: gloss?.text ?? null };
}

/** Other words a query can be, shown under the entry. More than this is a list, not a hint. */
const MAX_OTHERS = 4;

export interface PickedEntries<T> {
  entry: T | null;
  /** Other words spelled the same (はし: 箸, 端), or other dictionary forms of the same conjugation. */
  others: T[];
  /** The query is an inflected form (食べた) and the entry its dictionary form (食べる). */
  inflected: boolean;
}

/**
 * The entry for a search, and what else it could be. A query spelled like dictionary words gets the best of them,
 * the others as homographs (はし: 橋, then 箸 and 端); names never count as those. A query only found as a
 * conjugation (食べた) gets the word it is a form of, marked `inflected`. Exported for tests.
 */
export function pickEntries<T extends EntryCandidate>(candidates: readonly T[], query: string): PickedEntries<T> {
  const entry = pickEntry(candidates, query);
  const differs = (candidate: T) => candidate !== entry && candidate.headword !== entry?.headword;
  if (entry) {
    const spelled = spelledLike<T>(query);
    const others = candidates
      .filter((candidate) => !candidate.name && spelled(candidate) && differs(candidate))
      .sort(byCorpusRank);
    return { entry, others: others.slice(0, MAX_OTHERS), inflected: false };
  }
  const bases = candidates.filter((candidate) => candidate.baseForm && !candidate.name).sort(byCorpusRank);
  const base = bases[0] ?? null;
  return {
    entry: base,
    others: bases
      .filter((candidate) => candidate !== base && candidate.headword !== base?.headword)
      .slice(0, MAX_OTHERS),
    inflected: base !== null,
  };
}
