/*
 * Furigana alignment (Build, Align, VerbFinalReading and their helpers, GuessRubyText, IsKanji), ported from
 * Apache-2.0 C# source. This file is a modified version of the C# original; see ./NOTICE.
 *
 * The algorithm is unchanged. Only the I/O differs: our dictionary ruby comes as segments ([{text, ruby?}]) and is
 * turned into bracketed ruby text (食[た]べる) at the boundary; the result is one token's `SlimToken.f` instead of
 * sentence-wide FuriganaGroups; and when no dictionary spelling aligns, the token's own Sudachi reading goes through
 * GuessRubyText as a last resort (the original runs GuessRubyText over dictionary forms when it imports them instead).
 */

/** One piece of dictionary ruby as stored in `dict.furigana.segments`: 食べる is [{text:'食', ruby:'た'}, {text:'べる'}]. */
export interface RubySegment {
  text: string;
  ruby?: string;
}

/** One piece of `SlimToken.f`, aligned to the token's surface; `r` (hiragana) only over kanji. */
export interface FuriganaPiece {
  t: string;
  r?: string;
}

/** One aligned group inside a surface (an `(Offset, Length, Reading)` tuple). */
export interface AlignedGroup {
  offset: number;
  length: number;
  reading: string;
}

export interface SurfaceFuriganaOptions {
  /** Candidate dictionary rubies, in the order to try them: the token's own form first, then the word's other
   * spellings (sibling forms). Entries without ruby are tried too and simply never align. */
  rubies?: ReadonlyArray<ReadonlyArray<RubySegment> | null | undefined>;
  /** The token's reading (Sudachi gives katakana), the last resort through GuessRubyText. */
  reading?: string | null;
  /** The text after the token in its sentence, read only to pick 来 and 得's readings (来 + ます). */
  trailing?: string;
}

/** Ruby for one token, aligned to its surface; undefined when the surface has no kanji or nothing aligns. */
export function surfaceFurigana(surface: string, options: SurfaceFuriganaOptions = {}): FuriganaPiece[] | undefined {
  if (!containsKanji(surface)) return undefined;

  const trailing = options.trailing ?? '';
  let aligned: AlignedGroup[] = [];
  for (const segments of options.rubies ?? []) {
    if (!segments) continue;
    aligned = align(surface, toRubyText(segments), trailing);
    if (aligned.length > 0) break;
  }

  if (aligned.length === 0 && options.reading) {
    const guess = guessRubyText(surface, toHiragana(options.reading));
    if (guess !== null) aligned = align(surface, guess, trailing);
  }

  const groups = mergeTouching(aligned);
  if (groups.length === 0) return undefined;
  return toPieces(surface, groups);
}

/** Our segments as bracketed ruby text: [{text:'食', ruby:'た'}, {text:'べる'}] becomes 食[た]べる. */
export function toRubyText(segments: ReadonlyArray<RubySegment>): string {
  return segments.map((segment) => (segment.ruby ? `${segment.text}[${segment.ruby}]` : segment.text)).join('');
}

/** The `Build` merge: JMdict ruby is per kanji (忘[ぼう]却[きゃく]); touching groups of one word become one ruby
 * box, or each wide reading pushes its kanji apart. */
export function mergeTouching(aligned: ReadonlyArray<AlignedGroup>): AlignedGroup[] {
  const groups: AlignedGroup[] = [];
  for (const { offset, length, reading } of aligned) {
    const last = groups.at(-1);
    if (last && last.offset + last.length === offset) {
      groups[groups.length - 1] = {
        offset: last.offset,
        length: last.length + length,
        reading: last.reading + reading,
      };
    } else {
      groups.push({ offset, length, reading });
    }
  }
  return groups;
}

function toPieces(surface: string, groups: ReadonlyArray<AlignedGroup>): FuriganaPiece[] {
  const pieces: FuriganaPiece[] = [];
  let at = 0;
  for (const { offset, length, reading } of groups) {
    if (offset > at) pieces.push({ t: surface.slice(at, offset) });
    pieces.push({ t: surface.slice(offset, offset + length), r: toHiragana(reading) });
    at = offset + length;
  }
  if (at < surface.length) pieces.push({ t: surface.slice(at) });
  return pieces;
}

/** Walks dictionary ruby (食[た]べる) along the inflected surface (食べた) and stops at the first differing kana, where
 * inflection starts; trailing is the text after the surface, read only to pick 来 and 得's readings. */
export function align(surface: string, rubyText: string | null | undefined, trailing = ''): AlignedGroup[] {
  const result: AlignedGroup[] = [];
  if (!rubyText) return result;

  let s = 0;
  let i = 0;
  while (i < rubyText.length && s <= surface.length) {
    let baseEnd = i;
    while (baseEnd < rubyText.length && isBaseChar(rubyText.charAt(baseEnd))) baseEnd++;

    if (baseEnd > i && baseEnd < rubyText.length && rubyText[baseEnd] === '[') {
      const close = rubyText.indexOf(']', baseEnd + 1);
      if (close < 0) break;

      const rubyBase = rubyText.slice(i, baseEnd);
      if (!surface.slice(s).startsWith(rubyBase)) break;

      let reading = rubyText.slice(baseEnd + 1, close);
      if (rubyText.slice(close + 1) === 'る') {
        reading = verbFinalReading(rubyBase, reading, surface.slice(s + rubyBase.length), trailing);
      }

      if (reading.length > 0) result.push({ offset: s, length: rubyBase.length, reading });

      s += rubyBase.length;
      i = close + 1;
      continue;
    }

    if (s >= surface.length || !kanaEqual(surface.charAt(s), rubyText.charAt(i))) break;
    s++;
    i++;
  }

  return result;
}

// First prefix match wins, so longer prefixes come first.
const KURU_READINGS: ReadonlyArray<readonly [string, string]> = [
  ['ない', 'こ'],
  ['なか', 'こ'],
  ['なく', 'こ'],
  ['なけ', 'こ'],
  ['なきゃ', 'こ'],
  ['れば', 'く'],
  ['りゃ', 'く'],
  ['る', 'く'],
  ['な', 'き'],
  ['た', 'き'],
  ['て', 'き'],
  ['ま', 'き'],
  ['ち', 'き'],
  ['そう', 'き'],
  ['と', 'き'],
  ['や', 'き'],
  ['つ', 'き'],
  ['っ', 'き'],
  ['れ', 'こ'],
  ['ら', 'こ'],
  ['さ', 'こ'],
  ['よ', 'こ'],
  ['い', 'こ'],
  ['ず', 'こ'],
  ['ぬ', 'こ'],
  ['ね', 'こ'],
  ['ん', 'こ'],
];

// うる survives only in the plain and べき forms; every other conjugation of 得る reads え (あり得ない, あり得ます).
const URU_READINGS: ReadonlyArray<readonly [string, string]> = [
  ['る', 'う'],
  ['べ', 'う'],
];

const FOLLOWING_PREFIX_MAX_LENGTH = 3;

/** The kanji's reading in a verb ending in ruby + る (やって来[く]る, あり得[う]る), where 来 and 得 change reading with
 * the conjugation; empty when it can't be told. */
function verbFinalReading(rubyBase: string, reading: string, surfaceTail: string, trailing: string): string {
  if ((rubyBase === '来' || rubyBase === '來') && reading === 'く') {
    return matchFollowing(KURU_READINGS, surfaceTail, trailing) ?? '';
  }
  if (rubyBase === '得' && reading === 'う') return matchFollowing(URU_READINGS, surfaceTail, trailing) ?? 'え';
  return reading;
}

function matchFollowing(
  table: ReadonlyArray<readonly [string, string]>,
  surfaceTail: string,
  trailing: string,
): string | null {
  // UTF-16 units, like the C# char loop.
  let next = '';
  for (const text of [surfaceTail, trailing]) {
    for (let k = 0; k < text.length && next.length < FOLLOWING_PREFIX_MAX_LENGTH; k++)
      next += toHiraganaChar(text.charAt(k));
  }

  for (const [prefix, reading] of table) if (next.startsWith(prefix)) return reading;
  return null;
}

/** Ruby text for a kanji spelling from its kana reading: (東京都, とうきょうと) gives 東京都[とうきょうと] and
 * (引き出す, ひきだす) gives 引[ひ]き出[だ]す; null when the kana can't be split along the spelling. */
export function guessRubyText(kanjiText: string, kanaText: string): string | null {
  const chars = kanjiText;
  const kana = kanaText;

  let prefixKana = 0;
  while (
    prefixKana < chars.length &&
    prefixKana < kana.length &&
    isKana(chars.charAt(prefixKana)) &&
    kanaEqualStrict(chars.charAt(prefixKana), kana.charAt(prefixKana))
  ) {
    prefixKana++;
  }

  let suffixKana = 0;
  while (
    suffixKana < chars.length - prefixKana &&
    suffixKana < kana.length - prefixKana &&
    isKana(chars.charAt(chars.length - 1 - suffixKana)) &&
    kanaEqualStrict(chars.charAt(chars.length - 1 - suffixKana), kana.charAt(kana.length - 1 - suffixKana))
  ) {
    suffixKana++;
  }

  const midKanji = chars.slice(prefixKana, chars.length - suffixKana);
  const midKana = kana.slice(prefixKana, kana.length - suffixKana);

  if (midKanji.length === 0 || midKana.length === 0) return null;

  const kanjiRuns: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < midKanji.length) {
    if (!isKana(midKanji.charAt(i))) {
      const start = i;
      while (i < midKanji.length && !isKana(midKanji.charAt(i))) i++;
      kanjiRuns.push({ start, end: i });
    } else {
      i++;
    }
  }

  if (kanjiRuns.length === 0) return null;

  if (kanjiRuns.length === 1 && ![...midKanji].some(isKana)) {
    const prefix = chars.slice(0, prefixKana);
    const suffix = suffixKana > 0 ? chars.slice(chars.length - suffixKana) : '';
    return `${prefix}${midKanji}[${midKana}]${suffix}`;
  }

  const kanaSegments: string[] = [];
  for (let j = 0; j < midKanji.length; j++) {
    if (isKana(midKanji.charAt(j))) {
      if (kanaSegments.length === 0 || !isKana(midKanji.charAt(j - 1))) kanaSegments.push(midKanji.charAt(j));
      else kanaSegments[kanaSegments.length - 1] = `${kanaSegments.at(-1)}${midKanji[j]}`;
    }
  }

  const midKanaStr = [...midKana].map(toHiraganaChar).join('');
  const parts: string[] = [];
  let remaining = midKanaStr;
  let valid = true;
  for (const sep of kanaSegments) {
    const normalizedSep = [...sep].map(toHiraganaChar).join('');
    const idx = remaining.indexOf(normalizedSep);
    if (idx === -1) {
      valid = false;
      break;
    }
    parts.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx + normalizedSep.length);
  }
  if (valid) parts.push(remaining);

  if (!valid || parts.length !== kanjiRuns.length) return null;
  if (parts.some((p) => p.length === 0)) return null;

  let sb = chars.slice(0, prefixKana);
  let runIdx = 0;
  for (let j = 0; j < midKanji.length; j++) {
    if (!isKana(midKanji.charAt(j))) {
      const run = kanjiRuns[runIdx];
      if (run && j === run.start) {
        sb += `${midKanji.slice(run.start, run.end)}[${parts[runIdx]}]`;
        j = run.end - 1;
        runIdx++;
      }
    } else {
      sb += midKanji[j];
    }
  }
  if (suffixKana > 0) sb += chars.slice(chars.length - suffixKana);
  return sb;
}

function isKana(c: string): boolean {
  return (c >= '぀' && c <= 'ゟ') || (c >= '゠' && c <= 'ヿ');
}

// ヵ and ヶ sit in the katakana block but act as counters inside kanji runs (一ヶ月), matching convertToRuby.ts.
function isBaseChar(c: string): boolean {
  return c !== '[' && c !== ']' && (!isKana(c) || c === 'ヵ' || c === 'ヶ');
}

/** JapaneseTextHelper.IsKanji(char): CJK Unified, Extension A and Compatibility Ideographs, per UTF-16 unit. */
function isKanji(c: string): boolean {
  return (c >= '一' && c <= '鿿') || (c >= '㐀' && c <= '䶿') || (c >= '豈' && c <= '﫿');
}

function containsKanji(surface: string): boolean {
  for (let k = 0; k < surface.length; k++) if (isKanji(surface.charAt(k))) return true;
  return false;
}

function toHiraganaChar(c: string): string {
  return c >= 'ァ' && c <= 'ヶ' ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c;
}

function toHiragana(text: string): string {
  let out = '';
  for (let k = 0; k < text.length; k++) out += toHiraganaChar(text.charAt(k));
  return out;
}

/** SentenceFurigana.KanaEqual. */
function kanaEqual(a: string, b: string): boolean {
  return a === b || toHiraganaChar(a) === toHiraganaChar(b);
}

/** RubyTextHelper.KanaEqual (no identity shortcut; same result). */
function kanaEqualStrict(a: string, b: string): boolean {
  return toHiraganaChar(a) === toHiraganaChar(b);
}
