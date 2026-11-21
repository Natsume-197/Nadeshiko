/*
 * Reading disambiguation, ported from Apache-2.0 C# source (see ../../NOTICE):
 *   ApplyContextPins, FixReadingAmbiguity and their helpers
 *   ApplyCounterPins, FixNumeralReadings, AbsorbPreviousNumeral, IsNumeralToken (numeral disambiguation)
 *
 * Modified: only the rules that settle a reading are here, since our reading is the output; rules that only pin a
 * JMdict word, a lemma or a class for the upstream lookup are left out (listed at each function). Where upstream pins
 * a word (`PreMatchedWordId`), we set `flags.pin` and read the pinned form through the lexicon. Where upstream changes
 * a class so that its scorer picks another reading (人 after a numeral, suffix 家/山/色), we set that reading. Upstream
 * token splits (方 off a 連用形 compound, N|分 in N分のN) re-cut the group through ../recut.ts.
 */

import { HOUR_PINS, TEMPORAL_ANCHOR_TEXTS, TEMPORAL_DURATION_PINS } from '../data/numeralPins';
import { PIN } from '../data/pins';
import { deconj, hasSection, isNounClass, known, knownVerbOrAdjective, prepend } from '../group';
import { recut } from '../recut';
import { isNumeralChar, toKatakana, widenDigits } from '../kana';
import type { CombineContext, Group } from '../types';
import { isNumeralToken } from './rewrite';

const isNounLike = (group: Group | undefined) => !!group && isNounClass(group.cls);

/** The reading of a pinned JMdict form, in katakana. */
function pinnedReading(ctx: CombineContext, wordId: number, formIdx?: number): string | undefined {
  const reading = ctx.lexicon.formReading(wordId, formIdx);
  return reading ? toKatakana(reading) : undefined;
}

/** A pin: the word is settled and, when the lexicon knows it, so is its reading. */
function pin(group: Group, ctx: CombineContext, wordId: number, formIdx?: number, patch: Partial<Group> = {}): Group {
  return {
    ...group,
    r: pinnedReading(ctx, wordId, formIdx) ?? group.r,
    ...patch,
    flags: { ...group.flags, ...patch.flags, pin: wordId },
  };
}

/** `TryGetRenyoukeiVerb`: the verb a 連用形 stem belongs to. Upstream accepts `stem-ren` anywhere in the chain,
 * which also lets past forms through (避けた reads as the たい-stem of 避ける, so 避けた方がいい read かた); we require
 * the stem itself, one step from the verb. */
function renyoukeiVerb(ctx: CombineContext, stem: string): string | undefined {
  if (!stem) return undefined;
  for (const form of deconj(ctx, stem)) {
    if (
      form.tags[0] === 'stem-ren' &&
      form.process.length === 1 &&
      form.tags.some((tag) => tag.startsWith('v')) &&
      knownVerbOrAdjective(ctx, form.text)
    )
      return form.text;
  }
  return undefined;
}

/** `AdjacentWordScorer.IsNumericSurface`. */
function isNumericSurface(text: string | undefined): boolean {
  if (!text) return false;
  const chars = [...text];
  let i = chars[0] === '第' || chars[0] === '何' || chars[0] === '数' ? 1 : 0;
  if (i === chars.length) return chars[0] === '何' || chars[0] === '数';
  for (; i < chars.length; i++) if (!isNumeralChar(chars[i])) return false;
  return true;
}

/**
 * `ApplyCounterPins`, the parts that settle a reading: 人 after a numeral is にん, 度 after one is ど, suffix 色
 * is いろ except after a numeral, a counter 重 before a noun is the prefix じゅう, 目 after 〜つ is the ordinal め.
 * Left out: Suffix→Counter reclassing, いつ→Pronoun and the ordinal め pin, which change no reading.
 */
function applyCounterPins(groups: Group[], i: number, ctx: CombineContext): void {
  const word = groups[i] as Group;
  const prev = groups[i - 1];
  const next = groups[i + 1];
  const isCounter = word.cls === 'Suffix' && hasSection(word, '助数詞');

  // 人 after a numeral is にん; both じん and にん fit a Suffix tag (６５億人) and scoring picks じん.
  if (word.s === '人' && word.cls === 'Suffix' && prev && isNumeralToken(prev) && word.r === 'ジン')
    groups[i] = { ...word, r: 'ニン' };

  // 度 after a numeral is the counter ど (１０度), never たび.
  if (word.s === '度' && word.flags.pin === undefined && isNumericSurface(prev?.s))
    groups[i] = pin(word, ctx, PIN.do, 0);

  // Suffix 色 is いろ (空色) except after a numeral (三色); しょく compounds (特色) are matched whole.
  if (word.s === '色' && word.cls === 'Suffix' && !(prev && isNumeralToken(prev)) && word.r !== 'イロ')
    groups[i] = { ...word, cls: 'Noun', r: 'イロ' };

  // A lone counter 重 before a noun is the prefix じゅう "heavy" (重戦車); real counters stay compounds (二重).
  if (word.s === '重' && isCounter && isNounLike(next))
    groups[i] = pin(word, ctx, PIN.juu, undefined, { cls: 'Prefix', r: 'ジュウ', d: '重', n: '重' });

  // 目 after a 〜つ counter (三つ目) is ordinal "-th", not the compound noun "three-eyed being".
  if (
    word.s === '目' &&
    word.cls === 'Suffix' &&
    prev?.s.endsWith('つ') &&
    [...prev.s].length > 1 &&
    takesOrdinalMeAfterTsu([...prev.s][0])
  )
    groups[i] = pin(word, ctx, PIN.me, 0, { d: '目', n: '目' });
}

/** 一つ目/二つ目 have their own ordinal entries. */
const takesOrdinalMeAfterTsu = (c: string | undefined) =>
  c !== '一' && c !== '二' && c !== '１' && c !== '２' && isNumeralChar(c);

const MOVEMENT_VERBS = new Set(['歩く', '巡る', '旅する', '走る', '駆ける', '散る', '散らばる', '逃げる', '飛ぶ']);
const CASE_PARTICLES = new Set(['から', 'を', 'が', 'に', 'で', 'へ', 'の', 'は', 'も']);

/**
 * `ApplyContextPins`, the rules that settle a reading: 方 after a 連用形 is かた, 方々 is ほうぼう before a
 * movement verb and かたがた after の, the counter pins above, suffix 家 before a case particle is the noun いえ, suffix
 * 山 is the noun やま. Like upstream, it walks right to left. Left out: the pins that only choose a JMdict word, lemma or
 * class (つば, 張り, やしない, うら, あいた, さらう, や, し/した, くれ, ねえ, いった, いけ, ふう, フウ, へん, clipped
 * adjectives, 来やがる, 行け, 宛, ばっか, single-kanji lists, あう/あって, だい, もんか, おい, だろう, だあ, したり)
 * and the token re-cuts (stolen compound tails, ようは, って off an adjective).
 */
export function applyContextPins(groups: Group[], ctx: CombineContext): Group[] {
  const out = [...groups];
  for (let i = out.length - 1; i >= 0; i--) {
    let word = out[i] as Group;
    const prev = out[i - 1];

    // Verb 連用形 + 方 is かた "way of doing", never ほう.
    const chars = [...word.s];
    const stem = chars.slice(0, -1).join('');
    const stemVerb =
      chars.length >= 3 &&
      chars.at(-1) === '方' &&
      word.flags.pin === undefined &&
      isNounClass(word.cls) &&
      !known(ctx, word.s)
        ? renyoukeiVerb(ctx, stem)
        : undefined;
    if (stemVerb) {
      out.splice(
        i,
        1,
        ...recut(out, i, 1, [
          {
            s: stem,
            from: word,
            d: stemVerb,
            n: stemVerb,
            cls: 'Verb',
            r: word.r.length > 2 && word.r.endsWith('カタ') ? word.r.slice(0, -2) : '',
            sec: ['*', word.sec[1], word.sec[2]],
          },
          { s: '方', from: word, d: '方', n: '方', cls: 'Noun', r: 'カタ', flags: { ...word.flags, pin: PIN.kata } },
        ]),
      );
      word = out[i] as Group;
    } else if (word.s === '方' && word.flags.pin === undefined && prev?.cls === 'Verb' && renyoukeiVerb(ctx, prev.s))
      out[i] = word = pin(word, ctx, PIN.kata, 0);

    // 方々 + を/に + movement verb is ほうぼう, after の/adnominal かたがた (その方々); Sudachi's reading is unreliable.
    if (word.s === '方々') {
      const next = out[i + 1];
      const verb = out[i + 2];
      const movementFollows =
        !!verb &&
        (next?.s === 'を' || next?.s === 'に') &&
        (MOVEMENT_VERBS.has(verb.d) || verb.d.endsWith('回る') || verb.d.endsWith('散る'));
      if (movementFollows) out[i] = word = pin(word, ctx, PIN.houbou);
      else if (prev && (prev.s === 'の' || prev.cls === 'PrenounAdjectival'))
        out[i] = word = pin(word, ctx, PIN.katagata);
    }

    applyCounterPins(out, i, ctx);
    word = out[i] as Group;

    // 家 before a case particle is the noun いえ, not the suffix け. Unlike upstream, not after a noun or name it can
    // suffix (大野家の is おおのけ).
    const next = out[i + 1];
    if (
      word.s === '家' &&
      word.cls === 'Suffix' &&
      next?.cls === 'Particle' &&
      CASE_PARTICLES.has(next.s) &&
      !['Noun', 'CommonNoun', 'Name', 'Pronoun'].includes(out[i - 1]?.cls ?? '')
    )
      out[i] = word = { ...word, cls: 'Noun', r: 'イエ' };

    if (word.s === '山' && word.cls === 'Suffix') out[i] = word = { ...word, cls: 'Noun', r: 'ヤマ' };
  }
  return changedOrSame(groups, out);
}

function changedOrSame(before: Group[], after: Group[]): Group[] {
  return after.length === before.length && after.every((group, i) => group === before[i]) ? before : after;
}

/** `AbsorbPreviousNumeral`: the numeral before `i` joins it, which takes the pinned reading. The caller steps
 * back. */
function absorbPreviousNumeral(groups: Group[], i: number, reading: string, wordId: number): void {
  const word = groups[i] as Group;
  const numeral = groups[i - 1] as Group;
  const text = numeral.s + word.s;
  groups.splice(
    i - 1,
    2,
    prepend(numeral, word, { r: reading, cls: 'Noun', d: text, n: text, flags: { ...word.flags, pin: wordId } }),
  );
}

const ALL_NUMERALS = (text: string) => text.length > 0 && [...text].every((c) => isNumeralChar(c));

/**
 * `FixNumeralReadings`: 後 before a quantity is あと; 項 and 体 as counters; numeral + 分/日/月 before a time
 * anchor is a duration (十分後 = じっぷん); numeral + 時 is the clock hour (四時 = よじ); 分 in N分のN is ぶん. Returns
 * the index to continue from, which moves back when a numeral was absorbed.
 */
function fixNumeralReadings(groups: Group[], i: number, ctx: CombineContext): number {
  let word = groups[i] as Group;
  const next = groups[i + 1];

  // 後 before a numeral or quantity adverb is アト "more" (後何年, 後少し).
  if (
    word.s === '後' &&
    word.r === 'ゴ' &&
    next &&
    (isNumeralToken(next) || next.s.startsWith('もう') || ['少し', 'すこし', 'ちょっと', 'わずか'].includes(next.s))
  )
    groups[i] = word = { ...word, r: 'アト' };

  // 項 after a numeral is the counter こう (第２項), not うなじ "nape".
  const prev = groups[i - 1];
  if (word.s === '項' && word.r === 'コウ' && prev && isNumeralToken(prev))
    groups[i] = word = pin(word, ctx, PIN.kou, 0);

  // 体 between 何/a numeral and 目 is the counter たい (何体目), not からだ.
  if (
    word.s === '体' &&
    word.r === 'タイ' &&
    prev &&
    next &&
    (prev.s === '何' || isNumeralToken(prev)) &&
    next.s === '目'
  )
    groups[i] = word = pin(word, ctx, PIN.tai, 0);

  // Numeral+分/日/月 before a temporal anchor is a duration (十分後 = じっぷん); punctuation blocks it (十分、間を置いて).
  const key = widenDigits(word.s);
  if (word.flags.pin === undefined && (TEMPORAL_DURATION_PINS.has(key) || ['分', '日', '月'].includes(word.s))) {
    let anchorIdx = i + 1;
    while (anchorIdx < groups.length && groups[anchorIdx]?.cls === 'BlankSpace') anchorIdx++;
    const anchor = groups[anchorIdx];
    const anchored =
      !!anchor && (TEMPORAL_ANCHOR_TEXTS.has(anchor.s) || anchor.s.startsWith('待っ') || anchor.s.startsWith('経っ'));
    if (anchored) {
      const durationPin = TEMPORAL_DURATION_PINS.get(key);
      const pairPin = prev ? TEMPORAL_DURATION_PINS.get(widenDigits(prev.s) + word.s) : undefined;
      if (durationPin) {
        groups[i] = word = pin(word, ctx, durationPin.wordId, durationPin.readingIndex);
      } else if (pairPin && prev) {
        const reading = pinnedReading(ctx, pairPin.wordId, pairPin.readingIndex) ?? prev.r + word.r;
        absorbPreviousNumeral(groups, i, reading, pairPin.wordId);
        i--;
        word = groups[i] as Group;
      }
    }
  }

  // Numeral + 時 merges here; split, the recombiner steals digits (十二|時 → 十 + 二時) and 四+時 reads シジ.
  const hourPin = groups[i - 1] ? HOUR_PINS.get(`${(groups[i - 1] as Group).s}時`) : undefined;
  if (word.s === '時' && word.r === 'ジ' && word.flags.pin === undefined && i > 0 && hourPin) {
    absorbPreviousNumeral(groups, i, hourPin.reading, hourPin.wordId);
    i--;
    word = groups[i] as Group;
  }

  // In N分のN (四分の一) 分 is the part-noun ぶん, not minutes; frames that are entries (三分の一) stay whole.
  const after = groups[i + 1];
  const after2 = groups[i + 2];
  const chars = [...word.s];
  if (
    word.flags.pin === undefined &&
    chars.length >= 2 &&
    word.s.endsWith('分') &&
    ALL_NUMERALS(chars.slice(0, -1).join('')) &&
    after?.s === 'の' &&
    after2 &&
    isNumeralChar([...after2.s][0]) &&
    !ctx.lexicon.has(`${word.s}の${after2.s}`)
  ) {
    const numeralText = chars.slice(0, -1).join('');
    const numeralReading = /(ブン|プン|フン)$/.test(word.r) ? word.r.slice(0, -2) : '';
    groups.splice(
      i,
      1,
      ...recut(groups, i, 1, [
        { s: numeralText, from: word, d: numeralText, n: numeralText, cls: 'Noun', r: numeralReading },
        { s: '分', from: word, d: '分', n: '分', r: 'ブン', flags: { ...word.flags, pin: PIN.bun, hardPin: true } },
      ]),
    );
    i++;
    word = groups[i] as Group;
  }

  // Gated on the frame, not the reading: Sudachi reads a split 分 inconsistently (フン in 七|分|の|一).
  const before = groups[i - 1];
  if (
    word.s === '分' &&
    word.flags.pin === undefined &&
    before &&
    after2 &&
    ALL_NUMERALS(before.s) &&
    after?.s === 'の' &&
    isNumeralChar([...after2.s][0]) &&
    !ctx.lexicon.has(`${before.s}分の${after2.s}`)
  )
    groups[i] = pin(word, ctx, PIN.bun, undefined, { r: 'ブン', flags: { hardPin: true } });

  return i;
}

const SWING_WORDS = new Set([
  '竹刀',
  '木刀',
  '刀',
  '剣',
  '剣道',
  '野球',
  '打席',
  '練習',
  '稽古',
  '部活',
  'ゴルフ',
  'テニス',
]);
const CARD_VERBS = new Set(['出す', '出せる', '引く', '切る', '並べる', '配る', '見る']);
const CARD_GAMES = new Set(['麻雀', 'トランプ', 'カード', '手札', '切り札', 'カルタ']);
const HORN_VERBS = new Set(['生える', '生やす', '折れる', '折る', '研ぐ', '磨く']);
const FOREHEAD_VERBS = new Set(['キス', '触れる', '当てる', '押す', '押さえる', '叩く', '撫でる', '拭く']);
const FOREHEAD_NOUNS = new Set(['手', 'キス', '汗', '傷', '皺', 'シワ']);

/** `IsHornBearerWord`. */
const isHornBearerWord = (text: string) =>
  [
    '鬼',
    '牛',
    '鹿',
    '羊',
    '山羊',
    '馬',
    '竜',
    '龍',
    '悪魔',
    '怪物',
    '獣',
    '魔物',
    '魔族',
    '動物',
    'トナカイ',
    'ドラゴン',
    'モンスター',
    'ユニコーン',
    'サイ',
    'カブトムシ',
    'クワガタ',
    '虫',
    'デーモン',
  ].includes(text);

/** Whether some group in [from, to) satisfies `test`. */
function anyIn(groups: readonly Group[], from: number, to: number, test: (group: Group) => boolean): boolean {
  for (let k = Math.max(0, from); k < Math.min(groups.length, to); k++) if (test(groups[k] as Group)) return true;
  return false;
}

/**
 * `FixReadingAmbiguity`: fixes Sudachi readings of kanji homographs from context (directional 表へ → おもて,
 * not ひょう), with `FixNumeralReadings` inside it as upstream. Ported: 何, 張り, 寒気, the numeral readings, 素振り,
 * 札, 弄う, 角, 額, 抱く, 事, 露, 捩る, 大勢, 弾ける (the potential of 弾く, which LinkReadings would otherwise read
 * はじける) and 来 read キタ. Left out, as they choose a JMdict word or lemma without changing a reading: よう, たった, the
 * っ lemma fix, the ichidan-stem noun, あり, イキる, いける, ツイて and よって. Also left out: 弾く→はじく without a music word within a few
 * tokens, which misreads talk about an instrument named further away (ふだんは何弾くの?); Sudachi's ひく stands.
 */
export function fixReadingAmbiguity(groups: Group[], ctx: CombineContext): Group[] {
  const out = [...groups];
  for (let i = 0; i < out.length; i++) {
    let word = out[i] as Group;
    const set = (patch: Partial<Group>) => {
      word = { ...word, ...patch };
      out[i] = word;
    };

    if (word.s === '何' && word.r === 'ナン') {
      const next = out[i + 1];
      if (!next || ['を', 'が', 'も'].includes(next.s)) set({ r: 'ナニ' });
    }

    // Suffix ばり binds to an adjacent nominal (漱石張り); after a particle or clause start it is はり (声に張りがある).
    if (word.s === '張り' && word.r === 'バリ') {
      // A quoted host still binds (「漱石」張り), so skip closing brackets and inserted blanks, not punctuation.
      let h = i - 1;
      while (h >= 0 && (out[h]?.cls === 'BlankSpace' || ['」', '』', '）', '】', '》', '〉'].includes(out[h]?.s ?? '')))
        h--;
      const host = out[h];
      if (!host || !['Noun', 'CommonNoun', 'Name', 'Pronoun', 'Numeral', 'Suffix'].includes(host.cls))
        set({ r: 'ハリ' });
    }

    // 寒気 is サムケ "chills" when felt (寒気がする, 寒気を覚える); 寒気が南下する stays カンキ "cold air".
    if (word.s === '寒気' && word.r === 'カンキ') {
      const next = out[i + 1];
      const next2 = out[i + 2];
      if (
        next2 &&
        ((next?.s === 'が' && next2.d === 'する') ||
          (next?.s === 'を' && ['覚える', '感じる', '催す'].includes(next2.d)))
      )
        set({ r: 'サムケ' });
    }

    i = fixNumeralReadings(out, i, ctx);
    word = out[i] as Group;

    // Sudachi reads every 素振り スブリ; "practice swing" needs a swing word nearby, else the scorer keeps そぶり.
    if (word.s === '素振り' && word.r === 'スブリ') {
      const swing = anyIn(
        out,
        i - 6,
        i + 7,
        ({ s }) =>
          SWING_WORDS.has(s) ||
          s.includes('バット') ||
          s.includes('バッター') ||
          s.includes('ラケット') ||
          s.includes('スイング'),
      );
      if (swing) out[i] = word = pin(word, ctx, PIN.suburi);
      else set({ r: 'ソブリ' });
    }

    // 札 is ふだ only with a game word AND a card verb; money changes hands in game scenes (麻雀に負けて札を渡した).
    if (word.s === '札' && word.r === 'サツ') {
      const cardVerb = out[i + 1]?.s === 'を' && CARD_VERBS.has(out[i + 2]?.d ?? '');
      if (cardVerb && anyIn(out, i - 30, i + 5, (group) => CARD_GAMES.has(group.s))) set({ r: 'フダ' });
    }

    // Sudachi lemmatises 弄った to archaic 弄う (いらう); modern usage is 弄る (いじる).
    if (word.d === '弄う') set({ d: '弄る', n: '弄る', r: word.r.replace('イラ', 'イジ') });

    // Sudachi always reads 角 カド; context picks つの (鬼の角, 角が生える) or かく (三角形の角, 角が90度).
    if (word.s === '角' && word.r === 'カド') {
      const [prev2, prev, next, next2, next3] = [out[i - 2], out[i - 1], out[i + 1], out[i + 2], out[i + 3]];
      const isHornVerb = (next?.s === 'が' || next?.s === 'を') && !!next2 && HORN_VERBS.has(next2.d);
      const afterCreature = prev?.s === 'の' && !!prev2 && isHornBearerWord(prev2.s);
      const afterHead = (prev?.s === 'に' || prev?.s === 'の') && !!prev2 && ['頭', '額', 'おでこ'].includes(prev2.s);
      const afterGeometry = prev?.s === 'の' && !!prev2 && (prev2.s.endsWith('角形') || prev2.s.endsWith('多角'));
      const beforeDegree =
        ['が', 'は', 'も'].includes(next?.s ?? '') &&
        !!next2 &&
        (next2.s.includes('度') || next2.d === '等しい' || (isNumeralToken(next2) && next3?.s === '度'));
      if (isHornVerb || afterCreature || afterHead) set({ r: 'ツノ' });
      else if (afterGeometry || beforeDegree) set({ r: 'カク' });
    }

    // 額 is ヒタイ in body-contact context (額にキスをした, 額の傷).
    if (word.s === '額' && word.r === 'ガク') {
      const next = out[i + 1];
      const next2 = out[i + 2];
      if (
        ['に', 'を', 'の'].includes(next?.s ?? '') &&
        next2 &&
        (FOREHEAD_VERBS.has(next2.d) || FOREHEAD_NOUNS.has(next2.s))
      )
        set({ r: 'ヒタイ' });
    }

    // いだく is literary; modern standalone 抱く is overwhelmingly だく.
    if (word.d === '抱く' && word.r.startsWith('イダ')) set({ r: word.r.replace('イダ', 'ダ') });

    // ジ only occurs inside kango compounds (仕事); an orphaned 事 is the nominaliser こと.
    if (word.s === '事' && word.r === 'ジ' && word.flags.reclassifiedSuffix) set({ r: 'コト' });

    // 露 before になる is あらわ "exposed" (服が露になった); Sudachi's ロ reading drags scoring to dew/Russia.
    if (
      word.s === '露' &&
      word.cls === 'Noun' &&
      out[i + 1]?.s === 'に' &&
      ['なる', '成る'].includes(out[i + 2]?.d ?? '')
    )
      set({ r: 'アラワ', n: '露わ' });

    // Standalone 捩る is ねじる "twist"; もじる "parody" is rare and usually kana.
    if (word.d === '捩る' && word.r.startsWith('モジ')) set({ r: word.r.replace('モジ', 'ネジ') });

    // 大勢 is オオゼイ "many people"; タイセイ "trend" only in set phrases (大勢に影響がない).
    if (word.s === '大勢' && word.r === 'タイセイ') {
      const isTaiseiContext = out[i + 1]?.s === 'に' && out[i + 2]?.d === '影響';
      if (!isTaiseiContext) set({ r: 'オオゼイ' });
    }

    // Sudachi lemmatises 弾く's potential as 弾ける too; reading ヒケ* marks the potential.
    if (word.d === '弾ける' && word.r.startsWith('ヒケ')) set({ d: '弾く', n: '弾く' });

    // A キタ reading on 来 (Sudachi's 文語 来たる) makes ReadingMatchScore pick きたる; 来る/来 is くる. The other half
    // of this rule (来た read キタ) only steers the upstream scorer, so it lives in LinkReadings.
    if (word.n === '来たる' && (word.s === '来る' || word.s === '来'))
      set({ r: word.r.replace('キタ', 'ク'), n: '来る', d: '来る' });
  }
  return changedOrSame(groups, out);
}
