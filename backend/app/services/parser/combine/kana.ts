/** Kana helpers the combine stages share. */

/** Katakana ァ-ヶ to hiragana; everything else unchanged (`KanaConverter.ToHiragana` on these inputs). */
export function toHiragana(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
  }
  return out;
}

const VOWEL_OF = new Map<string, string>();
for (const [vowel, row] of [
  ['う', 'おこそとのほもよろをごぞどぼぽょオコソトノホモヨロヲゴゾドボポョ'],
  ['う', 'うくすつぬふむゆるぐずづぶぷゅウクスツヌフムユルグズヅブプュ'],
  ['え', 'えけせてねへめれげぜでべぺエケセテネヘメレゲゼデベペ'],
  ['い', 'いきしちにひみりぎじぢびぴイキシチニヒミリギジヂビピ'],
  ['あ', 'あかさたなはまやらわがざだばぱゃアカサタナハマヤラワガザダバパャ'],
] as const) {
  for (const kana of row) VOWEL_OF.set(kana, vowel);
}

/** Every ー after a kana becomes that kana's vowel; a leading ー or one after a non-kana stays. Ported from
 * `KanaNormalizer.Normalize`. */
export function normalizeLongVowels(text: string): string {
  if (!text.includes('ー')) return text;
  const chars = [...text];
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] === 'ー') chars[i] = VOWEL_OF.get(chars[i - 1] as string) ?? 'ー';
  }
  return chars.join('');
}

/** The text the deconjugator is given, as `PipelineCachedDeconjugateConcat` builds it: hiragana, with long
 * vowel marks spelt out. */
export function deconjugationKey(text: string): string {
  return normalizeLongVowels(toHiragana(text));
}

export function isKanji(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || char === '々';
}

export function isKana(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x3041 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff);
}

export function hasKanji(text: string): boolean {
  for (const char of text) if (isKanji(char)) return true;
  return false;
}

/** ASCII digits to full-width, the form the AmountCombinations table is written in. */
export function widenDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0));
}

/** Hiragana ぁ-ゖ to katakana; everything else unchanged. Sudachi readings are katakana, so ours stay katakana too. */
export function toKatakana(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : char;
  }
  return out;
}

/** Whether a reading is all katakana (and ー). Sudachi copies the surface as the reading of an unknown word, so a
 * reading with anything else in it (チョッと, セン手) is not one. */
export function isKatakanaReading(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (!(code >= 0x30a1 && code <= 0x30fa) && char !== 'ー' && char !== 'ヽ' && char !== 'ヾ') return false;
  }
  return text.length > 0;
}

/** Whether a text is all kana (either script, with ー). */
export function isAllKana(text: string): boolean {
  for (const char of text) if (!isKana(char)) return false;
  return text.length > 0;
}

/** A character of the hiragana block (ぁ-ゟ). */
export const isHiraganaChar = (char: string | undefined) => !!char && char >= 'ぁ' && char <= 'ゟ';
/** A character of the katakana block (゠-ヿ, so also ・ ヽ ヾ ー). */
export const isKatakanaChar = (char: string | undefined) => !!char && char >= '゠' && char <= 'ヿ';
/** `JapaneseTextHelper.IsKatakanaWordChar`: a katakana letter (ァ-ヺ) or the long-vowel mark. */
export const isKatakanaWordChar = (char: string | undefined) =>
  !!char && ((char >= 'ァ' && char <= 'ヺ') || char === 'ー');

function allOf(text: string, test: (char: string) => boolean): boolean {
  for (const char of text) if (!test(char)) return false;
  return text.length > 0;
}

/** Whether a text is all hiragana-block characters. */
export const isAllHiragana = (text: string) => allOf(text, isHiraganaChar);
/** Whether a text is all katakana-block characters ({@link isKatakanaChar}, punctuation like ・ included). */
export const isAllKatakana = (text: string) => allOf(text, isKatakanaChar);
/** Whether a text is all katakana letters and ー ({@link isKatakanaWordChar}). */
export const isAllKatakanaWord = (text: string) => allOf(text, isKatakanaWordChar);

const VOWEL_ROW = new Map<string, number>();
for (const [row, kana] of [
  'あかがさざただなはばぱまやらわゃぁアカガサザタダナハバパマヤラワャァ',
  'いきぎしじちぢにひびぴみりぃイキギシジチヂニヒビピミリィ',
  'うくぐすずつづぬふぶぷむゆるゅぅゔウクグスズツヅヌフブプムユルュゥヴ',
  'えけげせぜてでねへべぺめれぇエケゲセゼテデネヘベペメレェ',
  'おこごそぞとどのほぼぽもよろをょぉオコゴソゾトドノホボポモヨロヲョォ',
].entries()) {
  for (const char of kana) VOWEL_ROW.set(char, row);
}

/** The vowel row of a kana (0 あ, 1 い, 2 う, 3 え, 4 お; small kana and both scripts included), or -1. */
export function vowelRow(char: string | undefined): number {
  return (char === undefined ? undefined : VOWEL_ROW.get(char)) ?? -1;
}

/** `JapaneseTextHelper.IsNumeralChar`. */
export function isNumeralChar(char: string | undefined): boolean {
  return char !== undefined && /^[0-9０-９一二三四五六七八九十百千万億兆〇零]$/.test(char);
}
