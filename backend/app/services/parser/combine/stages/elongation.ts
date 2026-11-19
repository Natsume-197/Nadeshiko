import { append } from '../group';
import type { CombineContext, Group } from '../types';

/**
 * (ours) A vowel left over from a stretched last mora (わかるう, いきたああ, やるう) joins the word it stretches, so the
 * reader sees わかるう as one word read as わかる rather than a stray interjection う. Upstream drops the vowel from
 * the text instead; we keep the reader's text. Only at the end of a clause (before punctuation or the end).
 */

const VOWEL_ROWS = [
  'あかがさざただなはばぱまやらわゃぁアカガサザタダナハバパマヤラワャァ',
  'いきぎしじちぢにひびぴみりぃイキギシジチヂニヒビピミリィ',
  'うくぐすずつづぬふぶぷむゆるゅぅゔウクグスズツヅヌフブプムユルュゥヴ',
  'えけげせぜてでねへべぺめれぇエケゲセゼテデネヘベペメレェ',
  'おこごそぞとどのほぼぽもよろをょぉオコゴソゾトドノホボポモヨロヲョォ',
];
const VOWELS = ['あぁアァ', 'いぃイィ', 'うぅウゥ', 'えぇエェ', 'おぉオォ'];
const rowOf = (char: string | undefined) => (char ? VOWEL_ROWS.findIndex((row) => row.includes(char)) : -1);

const isClauseEnd = (next: Group | undefined) =>
  !next || next.cls === 'SupplementarySymbol' || next.cls === 'Symbol' || next.cls === 'BlankSpace';

/** Whether `text` is one vowel kana repeated, in the vowel row of `previous`'s last character. */
function stretches(previous: Group, text: string): boolean {
  const chars = [...text];
  const row = rowOf([...previous.s].at(-1));
  if (row < 0 || chars.length === 0) return false;
  return chars.every((char) => (VOWELS[row] as string).includes(char));
}

export function absorbStretchedVowel(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  groups.forEach((group, i) => {
    const previous = out.at(-1);
    if (
      previous &&
      (previous.cls === 'Verb' || previous.cls === 'IAdjective') &&
      (group.cls === 'Interjection' || group.cls === 'Filler' || group.cls === 'Particle') &&
      stretches(previous, group.s) &&
      isClauseEnd(groups[i + 1])
    ) {
      out[out.length - 1] = append(previous, group, { d: previous.d, n: previous.n });
      changed = true;
      return;
    }
    out.push(group);
  });
  return changed ? out : groups;
}
