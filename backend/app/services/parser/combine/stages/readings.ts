import { align, guessRubyText } from '../../furigana';
import { HOUR_PINS } from '../data/numeralPins';
import type { WordReadings } from '../lexicon';
import { hasKanji, isAllKana, isKana, isKanji, isKatakanaReading, toHiragana, toKatakana, widenDigits } from '../kana';
import type { CombineContext, Group } from '../types';

/*
 * Readings from the dictionary, after grouping. Not upstream stages: upstream reads a token as the JMdict form it
 * links to (`FormReading`: a kanji form reads as its ruby, which is its first kana
 * reading) and shows numbers without a reading, while our reading is Sudachi's until these settle it.
 */

const SYMBOL_CLASSES = new Set(['SupplementarySymbol', 'BlankSpace', 'Symbol']);

/** Up to three characters of the text after group `i`, which the alignment reads to pick 来 and 得's readings. */
function trailingText(groups: readonly Group[], i: number): string {
  let text = '';
  for (let k = i + 1; k < groups.length && [...text].length < 3; k++) text += (groups[k] as Group).s;
  return [...text].slice(0, 3).join('');
}

/**
 * The reading (hiragana) of `surface` when it is the dictionary spelling `spelling` read `kana`: the dictionary ruby
 * walked along the surface the way furigana is (`SentenceFurigana.Align`), so an inflected surface keeps its
 * own tail (気に入った, 気に入る/きにいる → きにいった) and 来 reads by what follows. Undefined unless every kanji of
 * the surface is read.
 */
export function readAs(surface: string, spelling: string, kana: string, trailing = ''): string | undefined {
  if (surface === spelling) return kana;
  const ruby = guessRubyText(spelling, kana);
  if (ruby === null) return undefined;
  const groups = align(surface, ruby, trailing);
  let reading = '';
  let at = 0;
  for (const { offset, length, reading: piece } of groups) {
    const between = surface.slice(at, offset);
    if (!isAllKana(between) && between !== '') return undefined;
    reading += toHiragana(between) + piece;
    at = offset + length;
  }
  const rest = surface.slice(at);
  if (rest !== '' && !isAllKana(rest)) return undefined;
  return reading + toHiragana(rest);
}

const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** The word a group links to among those spelled like it, as ReadingScorer ranks them: one with a reading
 * Sudachi agrees with, else the one sharing the longest start with Sudachi's reading, else (as upstream links its best
 * candidate whatever the score) the first; common words first on a tie. */
function pickWord(
  words: readonly WordReadings[],
  read: (kana: string) => string | undefined,
  sudachi: string | undefined,
): WordReadings | undefined {
  const ordered = [...words].sort((a, b) => Number(b.common) - Number(a.common) || a.id - b.id);
  if (!sudachi) return ordered[0];
  const agreeing = ordered.find((word) => word.kana.some((kana) => read(kana) === sudachi));
  if (agreeing) return agreeing;
  let best = ordered[0];
  let bestLength = 0;
  for (const word of ordered) {
    const length = Math.max(...word.kana.map((kana) => commonPrefix(read(kana) ?? '', sudachi)));
    if (length > bestLength) {
      best = word;
      bestLength = length;
    }
  }
  return best;
}

/** The part of a Sudachi reading we can trust: katakana up to its first copied surface character (セン手 → せん). */
const trustedReading = (reading: string) => {
  const chars = [...reading];
  const end = chars.findIndex((char) => !isKatakanaReading(char));
  return toHiragana((end < 0 ? chars : chars.slice(0, end)).join(''));
};

/** The reading a group's candidates are scored by. FixReadingAmbiguity rewrites a キタ
 * on 来 to ク (来た, 来させて), or ReadingMatchScore picks きたる; 来り is genuinely きたる. */
function steeringReading(group: Group): string {
  const chars = [...group.s];
  if (chars.length >= 2 && chars[0] === '来' && chars[1] !== 'り' && group.d === '来る' && group.r.startsWith('キタ'))
    return `ク${group.r.slice(2)}`;
  return group.r;
}

/**
 * The form reading for groups our stages built or Sudachi could not read: a group merged from several morphemes
 * (気に入った, 何も, 負けず嫌い), or one whose reading Sudachi copied from an unknown surface (選手 read セン手), reads
 * as the JMdict word it spells, the word chosen by Sudachi's reading. Its reading is the word's first reading for the
 * spelling, with the surface's own inflected tail. A kana group Sudachi could not read reads as itself.
 */
export function linkReadings(groups: Group[], ctx: CombineContext): Group[] {
  let out: Group[] | undefined;
  const replace = (i: number, group: Group) => {
    out ??= [...groups];
    out[i] = group;
  };
  groups.forEach((group, i) => {
    if (SYMBOL_CLASSES.has(group.cls) || group.flags.pin !== undefined || /^[0-9０-９]/.test(group.s)) return;
    const unread = !isKatakanaReading(group.r);
    if (!hasKanji(group.s)) {
      if (unread && isAllKana(group.s)) replace(i, { ...group, r: toKatakana(group.s) });
      return;
    }
    if (group.members.length < 2 && !unread) return;

    const words = ctx.lexicon.readingsOf(group.d);
    if (words.length === 0) return;
    const trailing = trailingText(groups, i);
    const read = (kana: string) => readAs(group.s, group.d, kana, trailing);
    const sudachi = unread ? trustedReading(group.r) || undefined : toHiragana(steeringReading(group));
    const word = pickWord(words, read, sudachi);
    if (!word) return;
    let reading: string | undefined;
    for (const kana of word.kana) {
      reading = read(kana);
      if (reading) break;
    }
    if (!reading) return;
    const r = toKatakana(reading);
    if (r !== group.r) replace(i, { ...group, r });
  });
  return out ?? groups;
}

const DIGIT_KANA = ['ゼロ', 'イチ', 'ニ', 'サン', 'ヨン', 'ゴ', 'ロク', 'ナナ', 'ハチ', 'キュウ'] as const;
const DIGIT_KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
const BIG_UNITS = ['', 'マン', 'オク', 'チョウ'] as const;
const BIG_UNIT_KANJI = ['', '万', '億', '兆'] as const;

const narrowDigits = (text: string) =>
  text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));

/** One group of four digits (1-9999) read aloud; `inner` when a 万/億/兆 follows (一千万 is いっせんまん). */
function readFour(value: number, inner: boolean): string {
  const [thousands, hundreds, tens, ones] = [
    Math.floor(value / 1000),
    Math.floor(value / 100) % 10,
    Math.floor(value / 10) % 10,
    value % 10,
  ];
  let out = '';
  if (thousands === 1) out += inner ? 'イッセン' : 'セン';
  else if (thousands === 3) out += 'サンゼン';
  else if (thousands === 8) out += 'ハッセン';
  else if (thousands > 0) out += `${DIGIT_KANA[thousands]}セン`;
  if (hundreds === 1) out += 'ヒャク';
  else if (hundreds === 3) out += 'サンビャク';
  else if (hundreds === 6) out += 'ロッピャク';
  else if (hundreds === 8) out += 'ハッピャク';
  else if (hundreds > 0) out += `${DIGIT_KANA[hundreds]}ヒャク`;
  if (tens === 1) out += 'ジュウ';
  else if (tens > 0) out += `${DIGIT_KANA[tens]}ジュウ`;
  if (ones > 0) out += DIGIT_KANA[ones];
  return out;
}

/** A string of Arabic digits read as a number in katakana (1946 → センキュウヒャクヨンジュウロク); digit by digit when
 * it has a leading zero or more than 16 digits, as a code is read. */
export function numberReading(digits: string): string {
  const plain = narrowDigits(digits);
  if ((plain.length > 1 && plain.startsWith('0')) || plain.length > 16)
    return [...plain].map((digit) => DIGIT_KANA[Number(digit)]).join('');
  let rest = BigInt(plain);
  if (rest === 0n) return 'ゼロ';
  const groups: number[] = [];
  while (rest > 0n) {
    groups.push(Number(rest % 10000n));
    rest /= 10000n;
  }
  let out = '';
  for (let unit = groups.length - 1; unit >= 0; unit--) {
    const value = groups[unit] as number;
    if (value === 0) continue;
    const head = unit === 3 && value === 1 ? 'イッ' : readFour(value, unit > 0);
    out += head + BIG_UNITS[unit];
  }
  return out;
}

/** The number in kanji numerals (14 → 十四, 1500 → 千五百), for looking a counted amount up in JMdict. */
export function kanjiNumeral(value: bigint): string {
  if (value === 0n) return '〇';
  const groups: number[] = [];
  for (let rest = value; rest > 0n; rest /= 10000n) groups.push(Number(rest % 10000n));
  let out = '';
  for (let unit = groups.length - 1; unit >= 0; unit--) {
    const group = groups[unit] as number;
    if (group === 0) continue;
    const digits = [Math.floor(group / 1000), Math.floor(group / 100) % 10, Math.floor(group / 10) % 10, group % 10];
    ['千', '百', '十', ''].forEach((place, k) => {
      const digit = digits[k] as number;
      if (digit === 0) return;
      out += (digit === 1 && place !== '' ? '' : DIGIT_KANJI[digit]) + place;
    });
    out += BIG_UNIT_KANJI[unit];
  }
  return out;
}

const VOWELS: Record<string, string> = {};
for (const [vowel, row] of [
  ['a', 'あかさたなはまやらわがざだばぱぁゃ'],
  ['i', 'いきしちにひみりぎじぢびぴぃ'],
  ['u', 'うくすつぬふむゆるぐずづぶぷぅゅ'],
  ['e', 'えけせてねへめれげぜでべぺぇ'],
  ['o', 'おこそとのほもよろをごぞどぼぽぉょ'],
] as const) {
  for (const kana of row) VOWELS[kana] = vowel;
}

/** Whether a dictionary reading of a counted amount ends in the counter Sudachi read, allowing only the sound change
 * of the counter's first kana (ほん → ぽん, さい → さい): 三戦 is さんせん, not the karate kata さんちん. */
function endsInCounter(reading: string, counter: string): boolean {
  const chars = [...reading];
  const [first = '', ...rest] = [...toHiragana(counter)];
  const tail = rest.join('');
  if (!reading.endsWith(tail)) return false;
  const changed = chars[chars.length - rest.length - 1];
  return !!changed && VOWELS[changed] !== undefined && VOWELS[changed] === VOWELS[first];
}

/** The reading (katakana) JMdict gives a spelling of an amount: the first reading of its most common word, which
 * must end in the counter Sudachi read unless the word is common. */
function dictionaryReading(ctx: CombineContext, spelling: string, counter: string | undefined): string | undefined {
  const words = [...ctx.lexicon.readingsOf(spelling)].sort(
    (a, b) => Number(b.common) - Number(a.common) || a.id - b.id,
  );
  for (const word of words) {
    const kana = word.kana[0];
    if (kana && (word.common || (counter && endsInCounter(kana, counter)))) return toKatakana(kana);
  }
  return undefined;
}

/** The reading of an amount written in Arabic digits with what it counts (14日, 1本, 4時), or undefined to fall
 * back on the number's reading plus Sudachi's reading of the counter. */
function countedReading(ctx: CombineContext, value: bigint, counter: string, sudachiCounter?: string) {
  // JMdict writes some amounts in full-width digits (４時, １０分) and most in kanji (一本, 十四日, 二つ).
  const whole =
    dictionaryReading(ctx, widenDigits(String(value)) + counter, sudachiCounter) ??
    dictionaryReading(ctx, kanjiNumeral(value) + counter, sudachiCounter);
  if (whole) return whole;
  const hour = HOUR_PINS.get(kanjiNumeral(value) + counter);
  if (hour) return hour.reading;
  // 一人/二人 and 〜つ only count alone (二十一人 is にじゅういちにん, 十一つ is not said).
  if (counter === 'つ' || value <= 10n) return undefined;
  const ones = value % 10n;
  const low = ones !== 0n ? ones : value % 100n === 10n ? 10n : 0n;
  if (low === 0n || (counter.startsWith('人') && low <= 2n)) return undefined;
  const tail = dictionaryReading(ctx, kanjiNumeral(low) + counter, sudachiCounter);
  return tail ? numberReading(String(value - low)) + tail : undefined;
}

const BIG_UNIT_VALUE: Record<string, bigint> = { 万: 10_000n, 億: 100_000_000n, 兆: 1_000_000_000_000n };
const NUMBER_PART = /^[0-9０-９万億兆]+$/;

/**
 * Amounts in Arabic digits, which Sudachi reads digit by digit (10 → イチレイ, 1500 → イチゴレイレイ): the number
 * reads as one (ジュウ, センゴヒャク, 3万 サンマン), and with a counter as JMdict reads that amount (1本 → イッポン,
 * 14日 → ジュウヨッカ), else as the number plus Sudachi's reading of the counter. Ours: upstream gives digits no
 * reading.
 */
export function readAmounts(groups: Group[], ctx: CombineContext): Group[] {
  let out: Group[] | undefined;
  const replace = (i: number, group: Group) => {
    out ??= [...groups];
    out[i] = group;
  };
  groups.forEach((group, i) => {
    const match = /^([0-9０-９]+)([万億兆]?)(.*)$/u.exec(group.s);
    if (!match || SYMBOL_CLASSES.has(group.cls)) return;
    const [, digits = '', unit = '', counter = ''] = match;
    if (/[0-9０-９]/.test(counter) || ![...counter].every((char) => isKanji(char) || isKana(char))) return;
    const plain = narrowDigits(digits);
    // A code (007) or a long digit string reads digit by digit and counts nothing.
    const code = (plain.length > 1 && plain.startsWith('0')) || plain.length > 16;
    const value = BigInt(plain) * (BIG_UNIT_VALUE[unit] ?? 1n);
    const number = code ? numberReading(plain) : numberReading(String(value));
    let reading: string | undefined;
    if (counter === '') reading = number;
    else {
      // Sudachi's reading of the counter: its morphemes after the number's.
      const counterMembers = group.members.filter((member) => !NUMBER_PART.test(member.s));
      const sudachiCounter =
        counterMembers.map((member) => member.s).join('') === counter &&
        counterMembers.every((member) => isKatakanaReading(member.r))
          ? counterMembers.map((member) => member.r).join('')
          : undefined;
      reading = code ? undefined : countedReading(ctx, value, counter, sudachiCounter);
      if (!reading && sudachiCounter) reading = number + sudachiCounter;
    }
    if (reading && reading !== group.r) replace(i, { ...group, r: reading });
  });
  return out ?? groups;
}
