import { isClauseBoundary, mergeAdjacentWhere } from '../group';
import { vowelRow } from '../kana';
import type { CombineContext, Group } from '../types';

/**
 * (ours) A vowel left over from a stretched last mora (わかるう, いきたああ, やるう) joins the word it stretches, so the
 * reader sees わかるう as one word read as わかる rather than a stray interjection う. Upstream drops the vowel from
 * the text instead; we keep the reader's text. Only at the end of a clause (before punctuation or the end).
 */

const VOWELS = ['あぁアァ', 'いぃイィ', 'うぅウゥ', 'えぇエェ', 'おぉオォ'];

/** Whether `text` is one vowel kana repeated, in the vowel row of `previous`'s last character. */
function stretches(previous: Group, text: string): boolean {
  const chars = [...text];
  const row = vowelRow([...previous.s].at(-1));
  if (row < 0 || chars.length === 0) return false;
  return chars.every((char) => (VOWELS[row] as string).includes(char));
}

export function absorbStretchedVowel(groups: Group[], _ctx: CombineContext): Group[] {
  return mergeAdjacentWhere(
    groups,
    (previous, group, i, list) =>
      (previous.cls === 'Verb' || previous.cls === 'IAdjective') &&
      (group.cls === 'Interjection' || group.cls === 'Filler' || group.cls === 'Particle') &&
      stretches(previous, group.s) &&
      isClauseBoundary(list[i + 1]),
  );
}
