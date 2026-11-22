import { toHiragana, toKatakana } from '../import/entries';

/**
 * Kana helpers for the pitch-audio clips (task 40): splitting a reading into morae, the accent VOICEVOX expects, and
 * how は and へ inside a word must sound.
 */

/** Small kana that join the mora before them (きょ, ファ, ティ). っ, ん and ー are morae of their own. */
const JOINING = new Set([...'ぁぃぅぇぉゃゅょゎゕゖァィゥェォャュョヮヵヶ']);

/** Small vowels, and the katakana rows by vowel, to tell ファ (one mora) from まぁ (ma-a, a long vowel). */
const SMALL_VOWEL: Record<string, string> = { ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o' };
const ROWS: Record<string, string> = {
  a: 'アカガサザタダナハバパマヤラワャヮ',
  i: 'イキギシジチヂニヒビピミリ',
  u: 'ウクグスズツヅヌフブプムユルュヴ',
  e: 'エケゲセゼテデネヘベペメレ',
  o: 'オコゴソゾトドノホボポモヨロヲョ',
};
function vowelOf(mora: string): string | undefined {
  const last = mora[mora.length - 1] ?? '';
  return SMALL_VOWEL[last] ?? Object.keys(ROWS).find((vowel) => ROWS[vowel]?.includes(last));
}

/** A reading's morae, in katakana: きょう → キョ, ウ. A small vowel lengthens the vowel before it when it repeats
 * it (まぁ → マ, ァ; そぅ → ソ, ゥ, as VOICEVOX says them) and joins it otherwise (ファ). */
export function splitMorae(reading: string): string[] {
  const morae: string[] = [];
  for (const char of toKatakana(reading)) {
    const previous = morae[morae.length - 1];
    const small = SMALL_VOWEL[char];
    const before = previous ? vowelOf(previous) : undefined;
    const lengthens = small !== undefined && (small === before || (small === 'u' && before === 'o'));
    if (JOINING.has(char) && previous !== undefined && !lengthens) morae[morae.length - 1] = previous + char;
    else morae.push(char);
  }
  return morae;
}

/** The `accent` VOICEVOX takes for one of our downsteps: it has no 0 and writes flat as the number of morae. */
export function accentFor(downstep: number, moraCount: number): number {
  return downstep <= 0 ? moraCount : Math.min(downstep, moraCount);
}

/**
 * How a は or へ of the reading must sound. VOICEVOX reads は as "wa" and へ as "e" wherever it takes them for
 * particles, and in a word they usually are not (はは, 母, came out "wawa").
 * - `literal`: part of the word (inside a kanji's reading, or the word's first mora): "ha", "he".
 * - `particle`: a kana particle in a set phrase (今日は read こんにちは): "wa", "e".
 * - `either`: a kana-only word that gives no clue; the engine's reading is kept.
 */
export type HaSound = 'literal' | 'particle' | 'either';

/** Mora index → how that は/へ must sound, for every は and へ of the reading. */
export type HaPlan = Map<number, HaSound>;

/**
 * Decide each は/へ of `reading` from the ruby of its kanji spellings: one inside a kanji's reading is literal, one
 * left as kana after a kanji is a particle, and the first mora is always literal. `segments` is every ruby alignment
 * of a kanji spelling with this reading (`dict.furigana.segments`).
 */
export function haPlan(reading: string, segments: Array<Array<{ text: string; ruby?: string }>>): HaPlan {
  const morae = splitMorae(reading);
  const plan: HaPlan = new Map();
  morae.forEach((mora, index) => {
    if (mora !== 'ハ' && mora !== 'ヘ') return;
    if (index === 0) {
      plan.set(0, 'literal');
      return;
    }
    let literal = false;
    let particle = false;
    for (const alignment of segments) {
      const where = moraSource(alignment, index);
      if (where === 'ruby') literal = true;
      else if (where === 'kana') particle = true;
    }
    plan.set(index, literal ? 'literal' : particle ? 'particle' : 'either');
  });
  return plan;
}

/** Whether mora `index` of an alignment's reading falls inside a ruby or in kana written as is. */
function moraSource(alignment: Array<{ text: string; ruby?: string }>, index: number): 'ruby' | 'kana' | null {
  let at = 0;
  for (const segment of alignment) {
    const count = splitMorae(segment.ruby ?? segment.text).length;
    if (index < at + count) return segment.ruby ? 'ruby' : 'kana';
    at += count;
  }
  return null;
}

const VOWEL_KANA: Record<string, string> = { a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ', N: 'ン' };

/** Spellings that sound the same: ヂ/ジ, ヅ/ズ, ヲ/オ, ヱ/エ, ヰ/イ. */
function sound(mora: string): string {
  const big = mora.length === 1 ? { ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ' }[mora] : undefined;
  return (big ?? mora)
    .replace(/ヂ/g, 'ジ')
    .replace(/ヅ/g, 'ズ')
    .replace(/ヲ/g, 'オ')
    .replace(/ヱ/g, 'エ')
    .replace(/ヰ/g, 'イ');
}

/**
 * Whether the mora VOICEVOX made is the one the reading asks for. VOICEVOX writes a long vowel as its vowel (ウ of
 * こう → オ, ー → the vowel before it) and reads えい either way, so those count as the same. `previousVowel` is the
 * vowel of VOICEVOX's previous mora (`a`, `i`, `u`, `e`, `o`, `N`, `cl`, capitals when devoiced).
 */
export function sameMora(expected: string, got: string, previousVowel: string | null, ha?: HaSound): boolean {
  if (ha) {
    const literal = expected === 'ハ' ? 'ハ' : 'ヘ';
    const particle = expected === 'ハ' ? 'ワ' : 'エ';
    if (ha === 'literal') return got === literal;
    if (ha === 'particle') return got === particle;
    return got === literal || got === particle;
  }
  const want = sound(expected);
  const made = sound(got);
  if (want === made) return true;
  // A devoiced vowel comes in capitals (す of です: U).
  const vowel = previousVowel === 'N' ? 'N' : previousVowel?.toLowerCase();
  const lengthened = vowel ? VOWEL_KANA[vowel] : undefined;
  if (want === 'ー') return made === lengthened;
  if (want === 'ウ' && vowel === 'o') return made === 'オ';
  if (want === 'イ' && vowel === 'e') return made === 'エ';
  return false;
}

/** The hiragana VOICEVOX is given: it reads long vowels right in hiragana (きょう) and splits some in katakana
 * (キョ・ウ). Katakana loanwords keep their ー. */
export function synthesisText(reading: string): string {
  return toHiragana(reading);
}
