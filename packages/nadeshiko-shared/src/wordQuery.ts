/**
 * Whether a search query can be one dictionary word: Japanese script only, no spaces or punctuation, at most 16
 * characters. The site uses it to show a word's dictionary entry (task 47) and its alert buttons; the API uses it to
 * accept a word alert (task 52). Shared so the button never offers what the API refuses.
 */

/** Longest query that can be a single dictionary word; anything longer is a phrase. */
export const MAX_WORD_LENGTH = 16;

const JAPANESE_WORD = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]+$/u;

export function isWordQuery(query: string): boolean {
  const text = query.trim();
  const length = [...text].length;
  return length > 0 && length <= MAX_WORD_LENGTH && JAPANESE_WORD.test(text);
}

/** A word's search page; a `CONTAINS` search finds it inside longer words (`?match=contains`, task 43). Shared so the
 * site's links and the API's email links are the same URL. */
export function wordSearchPath(word: string, matchMode?: string | null): string {
  const path = `/search/${encodeURIComponent(word)}`;
  return matchMode === 'CONTAINS' ? `${path}?match=contains` : path;
}
