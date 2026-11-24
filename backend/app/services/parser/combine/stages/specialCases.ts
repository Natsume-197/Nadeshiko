import { CASE_PARTICLES, SPECIAL_2, SPECIAL_3 } from '../data/ruleData';
import {
  append,
  deconj,
  hasSection,
  isNominaliserBeforeCopula,
  isNounClass,
  isSymbolClass,
  knownVerbOrAdjective,
  SECTION,
  isNaAdjectiveToken,
} from '../group';
import {
  isAllHiragana,
  isAllKatakanaWord,
  isHiraganaChar,
  isKanji,
  isKatakanaWordChar,
  toHiragana,
  toKatakana,
  GODAN_RENYOU_TO_DICT_END,
  takesOrdinalMeAfterTsu,
} from '../kana';
import { type Piece, recut } from '../recut';
import { cpLength, dropLast, firstChar, lastChars, tail } from '../text';
import type { CombineContext, Group } from '../types';

/**
 * `ProcessSpecialCases`: the single-pass repair of Sudachi cuts that sits between the early rewrite rules and the
 * combine stages. Besides its own repairs (した|んだ, 四つ|目, 部下|達, そういう…) it applies the SpecialCases2/3
 * units early, reads な (だ) after a noun as the particle な (so 彼女|な|の can become なの later), forms explanatory
 * なん / なんだ, and attaches な to a na-adjective (大切な).
 *
 * Differences from upstream: our lexicon has no JMnedict names, so the "non-name" lookups are plain lookups; and it
 * has no frequency ranks, so the two rank gates (rank < 40000) use JMdict's common flag instead.
 */

const DA_COMPOUND_SUFFIXES = new Set(['が', 'けど', 'けれど', 'けれども', 'から', 'し', 'って', 'の']);
const KANA_TSU_NUMERALS = new Set([
  'ひとつ',
  'ふたつ',
  'みっつ',
  'よっつ',
  'いつつ',
  'むっつ',
  'ななつ',
  'やっつ',
  'ここのつ',
]);

/** `HasNonNameCompoundLookup` / `HasCompoundLookup`: our lexicon holds no names, so both are a plain lookup. */
const has = (ctx: CombineContext, text: string) => text.length > 0 && ctx.lexicon.has(text);
/** `GetNonNameCompoundFrequencyRank(text) is < 40000`, approximated by JMdict's common flag. */
const isFrequent = (ctx: CombineContext, text: string) => ctx.lexicon.hasClass(text, 'common');
/** `HasSuruVerbCompoundLookup`. */
const isSuruVerb = (ctx: CombineContext, text: string) => ctx.lexicon.hasClass(text, 'verb');

/** `RenyokeiSurfaceToVerb`. */
function renyokeiSurfaceToVerb(ctx: CombineContext, text: string): string | undefined {
  if (cpLength(text) < 2) return undefined;
  if (has(ctx, `${text}る`)) return `${text}る`;
  const base = GODAN_RENYOU_TO_DICT_END[lastChars(text)];
  if (base && has(ctx, dropLast(text) + base)) return dropLast(text) + base;
  return undefined;
}

/** `DeconjugatesToVerbInLookup`. */
const deconjugatesToVerb = (ctx: CombineContext, surface: string) =>
  deconj(ctx, toHiragana(surface)).some(
    (form) => form.tags.some((tag) => tag.startsWith('v')) && knownVerbOrAdjective(ctx, form.text),
  );

/** `DeconjugatesToCausativeOrPassiveVerb`: stricter, so plain ichidan negatives (聞こえない) stay split. */
const deconjugatesToCausativeOrPassive = (ctx: CombineContext, surface: string) =>
  deconj(ctx, toHiragana(surface)).some(
    (form) =>
      form.tags.some((tag) => tag.startsWith('v')) &&
      knownVerbOrAdjective(ctx, form.text) &&
      form.process.some((step) => step.includes('causative') || step.includes('passive')),
  );

/** `IsBoundAuxiliaryNegative`: なく after a て-form + bound auxiliary stem (出て+こ+なく) is not a なくなった head. */
function isBoundAuxiliaryNegative(w1: Group, emitted: readonly Group[]): boolean {
  if (w1.s !== 'なく' || emitted.length < 2) return false;
  const stem = emitted.at(-1) as Group;
  if (stem.cls !== 'Verb' || !hasSection(stem, SECTION.PossibleDependant)) return false;
  const teForm = emitted.at(-2) as Group;
  return teForm.s.endsWith('て') || teForm.s.endsWith('で');
}

const SECTIONS_NONE: Group['sec'] = ['*', '*', '*'];

/** One group re-cut into pieces. */
const cut = (group: Group, pieces: readonly Piece[]) => recut([group], 0, 1, pieces);
/** Two adjacent groups re-cut into pieces. */
const cut2 = (a: Group, b: Group, pieces: readonly Piece[]) => recut([a, b], 0, 2, pieces);
/** A copy of `group` with a new surface-preserving patch (`new WordInfo(w) { ... }` without a text change). */
const patched = (group: Group, patch: Partial<Group>): Group => ({
  ...group,
  ...patch,
  flags: { ...group.flags, ...patch.flags },
});

export function processSpecialCases(input: Group[], ctx: CombineContext): Group[] {
  if (input.length === 0) return input;
  // Rules rewrite the next input group in place (そ|れっぽく), as upstream mutates `wordInfos[i + 1]`.
  const words = [...input];
  const out: Group[] = [];
  let changed = false;

  for (let i = 0; i < words.length; ) {
    let w1 = words[i] as Group;
    const prev = out.at(-1);
    const next = words[i + 1];

    // し straight after a suru-noun is する's 連用中止 (蒸発し大気に); the particle し needs a predicate before it.
    if (w1.s === 'し' && w1.cls === 'Conjunction' && prev && isNounClass(prev.cls) && isSuruVerb(ctx, prev.s)) {
      w1 = patched(w1, { cls: 'Verb', sec: [SECTION.PossibleDependant, '*', '*'], d: 'する', n: '為る' });
      changed = true;
    }

    // Kana したんだ with dict form したむ is Sudachi's misread of した+んだ; the dated verb 湑む is written in kanji.
    if (w1.d === 'したむ' && w1.s.startsWith('した') && cpLength(w1.s) >= 3) {
      const rest = tail(w1.s, 2);
      out.push(
        ...cut(w1, [
          { s: 'した', d: 'する', n: '為る', cls: 'Verb', r: 'シタ', flags: { ...w1.flags, pin: 1157170 } },
          {
            s: rest,
            d: rest,
            n: rest,
            cls: 'Auxiliary',
            flags: rest === 'んだ' ? { ...w1.flags, pin: 2849387 } : { ...w1.flags, pin: undefined },
          },
        ]),
      );
      changed = true;
      i += 1;
      continue;
    }

    // それっぽく → そ|れっぽく… blob; the OOV gate spares real そ+れX.
    if (w1.s === 'そ' && next && cpLength(next.s) >= 3 && firstChar(next.s) === 'れ' && !has(ctx, next.s)) {
      const rest = tail(next.s, 1);
      const [sore, remainder] = cut2(w1, next, [
        { s: 'それ', from: w1, d: 'それ', n: '其れ', cls: 'Pronoun', r: 'ソレ', flags: { ...w1.flags, pin: 1006970 } },
        { s: rest, from: next, d: rest, n: rest },
      ]) as [Group, Group];
      out.push(sore);
      words[i + 1] = remainder;
      changed = true;
      i += 1;
      continue;
    }

    // 募|るってもんじゃねえ: a colloquial tail blobs the る; the OOV gate spares genuine 名詞+る words.
    if (
      cpLength(w1.s) === 1 &&
      isKanji(w1.s) &&
      isNounClass(w1.cls) &&
      next &&
      cpLength(next.s) >= 3 &&
      firstChar(next.s) === 'る' &&
      !has(ctx, next.s) &&
      has(ctx, `${w1.s}る`)
    ) {
      const rest = tail(next.s, 1);
      const [verb, remainder] = cut2(w1, next, [
        { s: `${w1.s}る`, from: w1, d: `${w1.s}る`, n: `${w1.s}る`, cls: 'Verb' },
        { s: rest, from: next, d: rest, n: rest },
      ]) as [Group, Group];
      out.push(verb);
      words[i + 1] = remainder;
      changed = true;
      i += 1;
      continue;
    }

    // 四つ目 / みっつめ is numeral + ordinal 目, not "four-eyed" or 見詰める; kana numerals are a closed set.
    {
      const kanjiTsuMe = cpLength(w1.s) >= 3 && w1.s.endsWith('つ目') && takesOrdinalMeAfterTsu(firstChar(w1.s));
      const kanaTsuMe = w1.s.endsWith('つめ') && KANA_TSU_NUMERALS.has(dropLast(w1.s));
      if ((isNounClass(w1.cls) || w1.cls === 'Verb') && (kanjiTsuMe || kanaTsuMe)) {
        const numPart = dropLast(w1.s);
        out.push(
          ...cut(w1, [
            { s: numPart, d: numPart, n: numPart, cls: 'Noun' },
            {
              s: lastChars(w1.s),
              fresh: true,
              d: '目',
              n: '目',
              cls: 'Suffix',
              r: 'メ',
              flags: { pin: 1604890, hardPin: true },
            },
          ]),
        );
        changed = true;
        i += 1;
        continue;
      }
    }

    // 部|下達 → 部下|達 needs a 1-char X (事実|上達 stays) and a common compound, not a coincidental lookup key.
    if (
      isNounClass(w1.cls) &&
      cpLength(w1.s) === 1 &&
      next &&
      isNounClass(next.cls) &&
      cpLength(next.s) >= 2 &&
      next.s.endsWith('達') &&
      has(ctx, w1.s + dropLast(next.s)) &&
      isFrequent(ctx, w1.s + dropLast(next.s))
    ) {
      const compound = w1.s + dropLast(next.s);
      out.push(
        ...cut2(w1, next, [
          { s: compound, from: w1, d: compound, n: compound },
          { s: '達', from: next, d: '達', n: '達', cls: 'Suffix', r: 'タチ' },
        ]),
      );
      changed = true;
      i += 2;
      continue;
    }

    // お|前山 → お前|山; ゼン compounds (前後), common ones (この|前髪) and 前+連用形 (前掛け) stay whole.
    if (
      cpLength(w1.s) >= 2 &&
      firstChar(w1.s) === '前' &&
      isNounClass(w1.cls) &&
      !w1.r.startsWith('ゼン') &&
      !isFrequent(ctx, w1.s) &&
      prev &&
      has(ctx, `${prev.s}前`) &&
      has(ctx, tail(w1.s, 1)) &&
      renyokeiSurfaceToVerb(ctx, tail(w1.s, 1)) === undefined
    ) {
      const rest = tail(w1.s, 1);
      const [withMae, remainder] = cut2(prev, w1, [
        { s: `${prev.s}前`, from: prev, d: `${prev.s}前`, n: `${prev.s}前` },
        { s: rest, from: w1, d: rest, n: rest },
      ]) as [Group, Group];
      out[out.length - 1] = withMae;
      out.push(remainder);
      changed = true;
      i += 1;
      continue;
    }

    // OOV 親X: a 1-char rest is the "pro-" prefix (親ソ, 親米); a longer rest means parent (親ギツネ).
    if (
      cpLength(w1.s) >= 2 &&
      firstChar(w1.s) === '親' &&
      isNounClass(w1.cls) &&
      !has(ctx, w1.s) &&
      has(ctx, tail(w1.s, 1))
    ) {
      const rest = tail(w1.s, 1);
      // A hiragana rest is a colloquial fragment where 親 means parent.
      const isProPrefix = cpLength(rest) === 1 && !isHiraganaChar(rest);
      out.push(
        ...cut(w1, [
          {
            s: '親',
            d: '親',
            n: '親',
            cls: isProPrefix ? 'Prefix' : 'Noun',
            r: isProPrefix ? 'シン' : 'オヤ',
            flags: { ...w1.flags, pin: isProPrefix ? 2256340 : undefined },
          },
          // Generic nouns come first in ソ's lookup, so the Soviet Union abbreviation needs a pin.
          { s: rest, d: rest, n: rest, flags: { ...w1.flags, pin: rest === 'ソ' ? 2853158 : undefined } },
        ]),
      );
      changed = true;
      i += 1;
      continue;
    }

    // A single OOV 〜くも token (美しくも) is adverbial 〜く + も.
    if (
      cpLength(w1.s) >= 4 &&
      w1.s.endsWith('くも') &&
      !has(ctx, w1.s) &&
      deconj(ctx, toHiragana(dropLast(w1.s))).some((form) => form.tags.includes('adj-i') && has(ctx, form.text))
    ) {
      const kuPart = dropLast(w1.s);
      out.push(
        ...cut(w1, [
          { s: kuPart, d: kuPart, n: kuPart, cls: 'IAdjective' },
          { s: 'も', fresh: true, d: 'も', n: 'も', cls: 'Particle', r: 'モ' },
        ]),
      );
      changed = true;
      i += 1;
      continue;
    }

    // 当たれ → あ|たれ(垂れ); must run before CombineVerbDependant steals the あ (持って+あ).
    if (
      w1.s === 'あ' &&
      w1.cls === 'Interjection' &&
      next &&
      next.cls === 'Noun' &&
      cpLength(next.s) >= 2 &&
      deconjugatesToVerb(ctx, `あ${next.s}`)
    ) {
      const text = `あ${next.s}`;
      out.push(append(w1, next, { d: text, n: text, cls: 'Verb' }));
      changed = true;
      i += 2;
      continue;
    }

    // Causative stem tagged a noun before ない (やらせ|ない); plain 仕方|ない stays split.
    if (isNounClass(w1.cls) && next?.s === 'ない' && deconjugatesToCausativeOrPassive(ctx, `${w1.s}ない`)) {
      const text = `${w1.s}ない`;
      out.push(append(w1, next, { d: text, n: text, cls: 'Verb' }));
      changed = true;
      i += 2;
      continue;
    }

    // A following ね re-cuts 静か into 静|か(終助詞); the lookup gate spares real noun + question か.
    if (
      w1.cls === 'Noun' &&
      hasSection(w1, SECTION.PossibleNaAdjective) &&
      next &&
      next.d === 'か' &&
      next.cls === 'Particle' &&
      has(ctx, `${w1.s}か`)
    ) {
      const text = `${w1.s}か`;
      out.push(append(w1, next, { d: text, n: text, cls: 'NaAdjective' }));
      changed = true;
      i += 2;
      continue;
    }

    // A hiragana-dict token steals a katakana name's last mora (カティア|の → カティ|アの, アの read as あの).
    if (
      (w1.cls === 'PrenounAdjectival' || w1.cls === 'Noun') &&
      cpLength(w1.s) >= 2 &&
      isKatakanaWordChar(firstChar(w1.s)) &&
      firstChar(w1.s) !== 'ー' &&
      isAllHiragana(tail(w1.s, 1)) &&
      CASE_PARTICLES.has(tail(w1.s, 1)) &&
      toHiragana(w1.s) === w1.d &&
      prev &&
      (prev.cls === 'Noun' || prev.cls === 'Name') &&
      isAllKatakanaWord(prev.s)
    ) {
      const stolen = firstChar(w1.s) as string;
      const remainder = tail(w1.s, 1);
      const merged = prev.s + stolen;
      const [name, particle] = cut2(prev, w1, [
        { s: merged, from: prev, d: merged, n: merged, r: prev.r + stolen },
        { s: remainder, fresh: true, d: remainder, n: remainder, cls: 'Particle', r: toKatakana(remainder) },
      ]) as [Group, Group];
      out[out.length - 1] = name;
      out.push(particle);
      changed = true;
      i += 1;
      continue;
    }

    // Case が can't follow conjunctive から, so it is がなる "to yell" (頼むからがなるな).
    if (
      w1.s === 'が' &&
      w1.cls === 'Particle' &&
      next &&
      (next.d === '成る' || next.d === 'なる') &&
      next.cls === 'Verb' &&
      prev?.s.endsWith('から')
    ) {
      out.push({
        ...next,
        s: w1.s + next.s,
        b: w1.b,
        r: w1.r + next.r,
        members: [...w1.members, ...next.members],
        d: 'がなる',
        n: 'がなる',
        deconjugation: null,
      });
      changed = true;
      i += 2;
      continue;
    }

    // 太鼓持|ちかい(近い) → 太鼓持ち|かい.
    if (
      w1.s === 'ちかい' &&
      w1.cls === 'IAdjective' &&
      w1.n === '近い' &&
      prev?.cls === 'Noun' &&
      has(ctx, `${prev.s}ち`)
    ) {
      const [noun, kai] = cut2(prev, w1, [
        { s: `${prev.s}ち`, from: prev, d: `${prev.s}ち`, n: `${prev.s}ち` },
        { s: 'かい', fresh: true, d: 'かい', n: 'かい', cls: 'Particle', r: 'カイ' },
      ]) as [Group, Group];
      out[out.length - 1] = noun;
      out.push(kai);
      changed = true;
      i += 1;
      continue;
    }

    // Sudachi picks 私大 "private university" over 私|大X (私大好き).
    if (w1.s === '私大' && next && (next.cls === 'Noun' || next.cls === 'NaAdjective') && has(ctx, `大${next.s}`)) {
      out.push(
        ...cut2(w1, next, [
          { s: '私', fresh: true, d: '私', n: '私', cls: 'Pronoun', r: 'ワタシ' },
          { s: `大${next.s}`, from: next, d: `大${next.d}`, n: `大${next.n}`, r: `ダイ${next.r}` },
        ]),
      );
      changed = true;
      i += 2;
      continue;
    }

    // X史|上 → X|史上: 史上 binds tighter than the 史 suffix (人類史上初).
    if (
      w1.cls === 'Noun' &&
      cpLength(w1.s) >= 3 &&
      w1.s.endsWith('史') &&
      next?.s === '上' &&
      next.cls === 'Suffix' &&
      has(ctx, dropLast(w1.s))
    ) {
      const stem = dropLast(w1.s);
      out.push(
        ...cut2(w1, next, [
          { s: stem, from: w1, d: stem, n: stem },
          { s: '史上', fresh: true, d: '史上', n: '史上', cls: 'Noun', r: 'シジョウ' },
        ]),
      );
      changed = true;
      i += 2;
      continue;
    }

    // 使いで "usability" steals the で: 魔法|使いで|も|ない → 魔法使い|でもない.
    if (
      w1.cls === 'Noun' &&
      cpLength(w1.s) >= 3 &&
      w1.s.endsWith('で') &&
      next?.s === 'も' &&
      prev?.cls === 'Noun' &&
      has(ctx, prev.s + dropLast(w1.s))
    ) {
      const naiFollows = words[i + 2]?.s === 'ない';
      const compound = prev.s + dropLast(w1.s);
      const tailText = naiFollows ? 'でもない' : 'でも';
      const span = naiFollows ? [prev, w1, next, words[i + 2] as Group] : [prev, w1, next];
      const pieces = recut(span, 0, span.length, [
        { s: compound, from: prev, d: compound, n: compound },
        {
          s: tailText,
          fresh: true,
          d: tailText,
          n: tailText,
          cls: naiFollows ? 'Expression' : 'Conjunction',
          r: naiFollows ? 'デモナイ' : 'デモ',
        },
      ]);
      out[out.length - 1] = pieces[0] as Group;
      out.push(pieces[1] as Group);
      changed = true;
      i += naiFollows ? 3 : 2;
      continue;
    }

    // Classical attributive 詮|無き → 詮無き (詮無い via the attributive-き deconj rule).
    if (w1.cls === 'Noun' && next?.s === '無き' && has(ctx, `${w1.s}無い`)) {
      out.push(append(w1, next, { d: `${w1.s}無い`, n: `${w1.s}無い`, cls: 'IAdjective' }));
      changed = true;
      i += 2;
      continue;
    }

    // とこかも → と|こか(こく)|も; redistribute to とこ|かも.
    if (w1.s === 'こか' && w1.d === 'こく' && w1.cls === 'Verb' && prev && next) {
      const prevPlusKo = `${prev.s}こ`;
      const kaPlusNext = `か${next.s}`;
      // Overwrites prev's POS/reading, so a coincidental name homograph of prev+こ must not qualify.
      if (has(ctx, prevPlusKo) && has(ctx, kaPlusNext)) {
        const [noun, particle] = recut([prev, w1, next], 0, 3, [
          { s: prevPlusKo, from: prev, d: prevPlusKo, n: prevPlusKo, cls: 'CommonNoun', r: `${prev.r}コ` },
          { s: kaPlusNext, fresh: true, d: kaPlusNext, n: kaPlusNext, cls: 'Particle', r: `カ${next.r}` },
        ]) as [Group, Group];
        out[out.length - 1] = noun;
        out.push(particle);
        changed = true;
        i += 2;
        continue;
      }
    }

    // なん|て… read as an adjective (なん|てひどい): the て is the quotative particle.
    if (
      w1.cls === 'IAdjective' &&
      cpLength(w1.s) > 1 &&
      firstChar(w1.s) === 'て' &&
      prev?.s === 'なん' &&
      prev.cls === 'Pronoun'
    ) {
      const remainder = tail(w1.s, 1);
      out.push(
        ...cut(w1, [
          { s: 'て', fresh: true, d: 'て', n: 'て', cls: 'Particle', r: 'テ' },
          { s: remainder, fresh: true, d: remainder, n: remainder, cls: 'IAdjective' },
        ]),
      );
      changed = true;
      i += 1;
      continue;
    }

    // で as copula or conjunction is the particle で, except in でも.
    if ((w1.cls === 'Conjunction' || w1.cls === 'Auxiliary') && w1.s === 'で' && next?.s !== 'も') {
      out.push(patched(w1, { cls: 'Particle' }));
      changed = true;
      i += 1;
      continue;
    }

    // Sudachi tags んで/んだ te-forms 表現 when an expression entry exists (飛んで → 2248530 "zero; flying").
    if (w1.cls === 'Expression' && cpLength(w1.s) >= 3 && (w1.s.endsWith('んで') || w1.s.endsWith('んだ'))) {
      const verbForm = deconj(ctx, toHiragana(w1.s)).find(
        (form) =>
          form.tags.some((tag) => ['v5b', 'v5m', 'v5n', 'v5g'].includes(tag)) &&
          ['ぶ', 'む', 'ぬ', 'ぐ'].includes(lastChars(form.text)),
      );
      if (verbForm) {
        w1 = patched(w1, { cls: 'Verb', d: dropLast(w1.s, 2) + lastChars(verbForm.text) });
        changed = true;
      }
    }

    // Suffix 着(ギ) before a particle is the verb 着る, unless it forms a compound (部屋着) for CombineNounCompounds.
    if (
      w1.s === '着' &&
      w1.cls === 'Suffix' &&
      w1.r === 'ギ' &&
      next &&
      (next.cls === 'Particle' || next.cls === 'Auxiliary') &&
      !(prev && isNounClass(prev.cls) && has(ctx, `${prev.s}着`))
    ) {
      w1 = patched(w1, { cls: 'Verb', d: '着る', n: '着る', r: 'キ' });
      changed = true;
    }

    // 殺し続ける → 殺(Prefix)|し続ける; split to 殺し|続ける.
    if (
      w1.cls === 'Prefix' &&
      cpLength(w1.s) === 1 &&
      isKanji(w1.s) &&
      next &&
      next.cls === 'Verb' &&
      cpLength(next.s) >= 2 &&
      firstChar(next.s) === 'し' &&
      has(ctx, `${w1.s}す`) &&
      has(ctx, tail(next.s, 1))
    ) {
      const rest = tail(next.s, 1);
      out.push(
        ...cut2(w1, next, [
          { s: `${w1.s}し`, fresh: true, d: `${w1.s}す`, n: `${w1.s}す`, cls: 'Verb' },
          {
            s: rest,
            fresh: true,
            d: next.d.startsWith('し') ? tail(next.d, 1) : rest,
            n: next.n.startsWith('し') ? tail(next.n, 1) : rest,
            cls: 'Verb',
          },
        ]),
      );
      changed = true;
      i += 2;
      continue;
    }

    // 幼|げ → 幼げ; stays IAdjective so the な handler leaves 的な/がちな alone.
    if (
      w1.cls === 'Suffix' &&
      hasSection(w1, SECTION.NaAdjectiveLike) &&
      prev?.cls === 'IAdjective' &&
      !prev.s.endsWith('い')
    ) {
      out[out.length - 1] = append(prev, w1);
      changed = true;
      i += 1;
      continue;
    }

    // のでは is の+では, never ので+は; CombineParticles then forms ではない(か).
    if (w1.s === 'の' && words[i + 2] && next?.s === 'で' && words[i + 2]?.s === 'は') {
      out.push(w1);
      i += 1;
      continue;
    }

    if (i < words.length - 2) {
      const w2 = words[i + 1] as Group;
      const w3 = words[i + 2] as Group;

      // Contracted 〜ておこう split as stem|と|こう (ためとこう).
      if (
        w1.cls === 'Noun' &&
        isAllHiragana(w1.s) &&
        w2.s === 'と' &&
        w2.cls === 'Particle' &&
        w3.s === 'こう' &&
        w3.cls === 'Adverb'
      ) {
        const combined = `${w1.s}とこう`;
        const verbForm = deconj(ctx, combined).find(
          (form) =>
            form.tags.length > 0 &&
            form.tags.length <= 6 &&
            form.tags.some((tag) => tag.startsWith('v')) &&
            has(ctx, form.text),
        );
        if (verbForm) {
          out.push({
            ...append(append(w1, w2), w3),
            d: verbForm.text,
            n: verbForm.text,
            cls: 'Verb',
          });
          changed = true;
          i += 3;
          continue;
        }
      }

      let found = false;
      const triples = SPECIAL_3.get(w1.s);
      if (triples && !isBoundAuxiliaryNegative(w1, out)) {
        for (const triple of triples) {
          // RepairVowelElongation may have stripped the particle's trailing ー.
          const thirdMatch =
            w3.s === triple.third ||
            (cpLength(triple.third) > 1 && triple.third.endsWith('ー') && w3.s === dropLast(triple.third));
          if (
            w2.s === triple.second &&
            thirdMatch &&
            !(w2.s === 'の' && isNominaliserBeforeCopula(words, i + 2, false))
          ) {
            const last = out.at(-1);
            if (last && w2.cls === 'Verb') {
              const compoundDictForm = last.s + w1.s + w2.d;
              if (has(ctx, compoundDictForm)) {
                const text = last.s + w1.s + w2.s + triple.third;
                out[out.length - 1] = {
                  ...append(append(append(last, w1), w2), w3),
                  s: text,
                  d: compoundDictForm,
                  cls: 'Verb',
                };
                changed = true;
                i += 3;
                found = true;
                break;
              }
            }
            const text = w1.s + w2.s + triple.third;
            out.push({ ...append(append(w1, w2), w3), s: text, d: text, cls: triple.cls });
            changed = true;
            i += 3;
            found = true;
            break;
          }
        }
      }
      if (found) continue;

      const prevIsAuxVerbStem = i > 0 && hasSection(words[i - 1] as Group, SECTION.AuxiliaryVerbStem);
      const prevIsNaAdjective = i > 0 && (words[i - 1] as Group).cls === 'NaAdjective';

      // Explanatory なんだ, except after an aux stem (泣きそうな) or na-adjective (好きなんだ).
      if (w1.s === 'な' && w2.s === 'ん' && w3.s === 'だ' && !prevIsAuxVerbStem && !prevIsNaAdjective) {
        out.push({ ...append(append(w1, w2), w3), d: 'なんだ', n: 'なんだ', cls: 'Auxiliary' });
        changed = true;
        i += 3;
        continue;
      }

      // そうなんじゃない → そう|なん|じゃない.
      if (
        w1.s === 'な' &&
        w2.s === 'ん' &&
        w3.s !== 'だ' &&
        w2.sec.includes('準体助詞') &&
        !prevIsAuxVerbStem &&
        !prevIsNaAdjective
      ) {
        out.push({ ...append(w1, w2), d: 'なん', n: 'なん', cls: 'Auxiliary' });
        changed = true;
        i += 2;
        continue;
      }
    }

    if (i < words.length - 1) {
      const w2 = words[i + 1] as Group;

      // ぶち|キレ → ぶちキレる.
      if (w1.s === 'ぶち' && w1.cls === 'Adverb' && w2.cls === 'Verb' && has(ctx, `ぶち${w2.d}`)) {
        const dict = `ぶち${w2.d}`;
        out.push({
          ...w2,
          s: `ぶち${w2.s}`,
          b: w1.b,
          r: `ブチ${w2.r}`,
          members: [...w1.members, ...w2.members],
          d: dict,
          n: dict,
          deconjugation: null,
        });
        changed = true;
        i += 2;
        continue;
      }

      // Verb ん: 飲ん|だけど; explanatory ん stays そう|なんだ|けど.
      const isExplanatoryN = w1.cls === 'Particle' && w1.sec.includes('準体助詞');
      const w3 = words[i + 2];
      if (w1.s === 'ん' && w2.s === 'だ' && w3 && DA_COMPOUND_SUFFIXES.has(w3.s) && !isExplanatoryN) {
        out.push(w1);
        out.push(append(w2, w3, { cls: 'Conjunction' }));
        changed = true;
        i += 3;
        continue;
      }

      // Sudachi splits はぐれる as は|ぐれる after で.
      if (w1.s === 'は' && w1.cls === 'Particle' && w2.cls === 'Verb' && w2.d === 'ぐれる') {
        out.push({
          ...w2,
          s: `は${w2.s}`,
          b: w1.b,
          r: `ハ${w2.r}`,
          members: [...w1.members, ...w2.members],
          d: 'はぐれる',
          n: 'はぐれる',
          deconjugation: null,
        });
        changed = true;
        i += 2;
        continue;
      }

      // 言いたそう → 言|いたそう(いたす); only godan ワ行 verbs (kanji + う) hit this.
      if (w1.cls === 'Noun' && w2.s === 'いたそう' && w2.d === 'いたす' && w2.cls === 'Verb') {
        out.push(append(w1, w2, { cls: 'Verb', d: `${w1.s}う`, n: `${w1.s}う` }));
        changed = true;
        i += 2;
        continue;
      }

      // 来|なすった → 来なさる.
      if (w1.s === '来' && w1.cls === 'Verb' && w1.d === '来る' && w2.d === 'なさる') {
        out.push(append(w1, w2, { d: '来なさる', cls: 'Verb', r: 'キナスッタ' }));
        changed = true;
        i += 2;
        continue;
      }

      // そう|いう → そういう (verb dict form kept for そういった); kanji 言う is literal "say" (そう言って).
      if (
        (w1.cls === 'Adverb' || (w1.cls === 'Interjection' && (w1.s === 'ああ' || w1.s === 'あー'))) &&
        ['そう', 'こう', 'ああ', 'どう', 'そー', 'こー', 'あー', 'どー'].includes(w1.s) &&
        (w2.d === 'いう' || w2.d === '言う') &&
        firstChar(w2.s) === 'い'
      ) {
        out.push(append(w1, w2, { d: w1.s + w2.d, cls: 'Verb' }));
        changed = true;
        i += 2;
        continue;
      }

      let found = false;
      const pairs = SPECIAL_2.get(w1.s);
      if (pairs) {
        // か|い stays split when い is a 居る stem with an auxiliary (聞こえているのか|いない).
        const kaIBlocked =
          (w1.s === 'か' || w1.s === 'だ') &&
          !!w3 &&
          (w2.d === '居る' || w2.d === 'いる') &&
          ['ない', 'なかった', 'ます', 'た', 'て'].includes(w3.s);
        // ところで only sentence-initially or after a past (〜たところで); else locative (静かなところで).
        const before = words[i - 1];
        const tokoroDeBlocked =
          w1.s === 'ところ' && i > 0 && !((before as Group).s.endsWith('た') || (before as Group).s.endsWith('だ'));
        // それじゃない is それ|じゃない, not the conjunction それじゃ.
        const soreJaBlocked =
          ['それ', 'そん', 'そい'].includes(w1.s) &&
          w2.s === 'じゃ' &&
          !!w3 &&
          ['ない', 'なかっ', 'なかった'].includes(w3.s);
        // 度に "each time" only after a verb (行う度に); after a numeral it is the counter (二度に分けて).
        const doNiBlocked = w1.s === '度' && w2.s === 'に' && !(i > 0 && (before as Group).cls === 'Verb');
        // つか must not steal the counter つ after a numeral (三つ|か四つ).
        const tsuKaBlocked =
          w1.s === 'つ' &&
          w2.s === 'か' &&
          i > 0 &&
          ((before as Group).cls === 'Numeral' ||
            ((before as Group).n.length > 0 && /^[0-9]+$/.test((before as Group).n)));

        for (const pair of pairs) {
          if (pair.second === 'い' && kaIBlocked) continue;
          if (pair.second === 'で' && tokoroDeBlocked) continue;
          if (pair.second === 'じゃ' && soreJaBlocked) continue;
          if (pair.second === 'に' && doNiBlocked) continue;
          if (pair.second === 'か' && tsuKaBlocked) continue;
          if (w1.s === 'の' && isNominaliserBeforeCopula(words, i + 1)) continue;
          if (w2.s === pair.second && !(pair.cls === 'Verb' && w1.cls === 'Conjunction')) {
            const text = w1.s + w2.s;
            const keepsDict = pair.cls === 'Verb' && w1.d && w1.d !== w1.s;
            out.push(append(w1, w2, { d: keepsDict ? w1.d : text, cls: pair.cls }));
            changed = true;
            i += 2;
            found = true;
            break;
          }
        }
      }
      if (found) continue;
    }

    // だし (not the verb 出し) is だ + し.
    if (w1.s === 'だし' && w1.cls !== 'Verb' && out.length > 0) {
      out.push(
        ...cut(w1, [
          { s: 'だ', fresh: true, d: 'だ', cls: 'Auxiliary', r: 'ダ', sec: SECTIONS_NONE },
          { s: 'し', fresh: true, d: 'し', cls: 'Conjunction', r: 'シ', sec: SECTIONS_NONE },
        ]),
      );
      changed = true;
      i += 1;
      continue;
    }

    if (w1.s === 'な' && w1.d === 'だ') {
      const last = out.at(-1);
      const followedByN = words[i + 1]?.s === 'ん';

      // (ours) 内緒|な|の → 内緒|なの. Upstream's pruned Sudachi dictionary hands over なの as one token, which its
      // tests show sentence-finally or before punctuation (内緒なの, 張り方なの、), and before で/に so that
      // SpecialCases2 makes なので/なのに; before か it stays な|の|か, and a na-adjective keeps 嫌いな|の.
      const no = words[i + 1];
      const afterNo = words[i + 2];
      if (
        no &&
        no.s === 'の' &&
        no.cls === 'Particle' &&
        !(last && isNaAdjectiveToken(last)) &&
        (!afterNo ||
          isSymbolClass(afterNo.cls) ||
          ((afterNo.s === 'で' || afterNo.s === 'に') && !isNominaliserBeforeCopula(words, i + 2)))
      ) {
        out.push({ ...append(w1, no), d: 'なの', n: 'なの', cls: 'Expression' });
        changed = true;
        i += 2;
        continue;
      }

      // 好き|な|ん|だ|と → 好き|なんだと. Plain だ only; conjectural だろ/だろう is a separate grammar point.
      if (last && isNaAdjectiveToken(last) && followedByN) {
        let merged = append(w1, words[i + 1] as Group);
        let j = i + 2;
        const da = words[j];
        if (da && da.s === 'だ' && da.cls === 'Auxiliary') {
          merged = append(merged, da);
          j++;
        }
        const to = words[j];
        if (to && to.s === 'と' && to.cls === 'Particle') {
          merged = append(merged, to);
          j++;
        }
        out.push({ ...merged, d: merged.s, cls: 'Auxiliary' });
        changed = true;
        i = j;
        continue;
      }

      // な|し after a na-adjective is なし; otherwise noun+な merges and orphans し.
      const shi = words[i + 1];
      if (shi && shi.s === 'し' && shi.cls === 'Conjunction' && last && isNaAdjectiveToken(last)) {
        out.push({ ...append(w1, shi), d: 'なし', n: '無し', cls: 'Noun', r: 'ナシ' });
        changed = true;
        i += 2;
        continue;
      }

      // 大切|な → 大切な; な stays separate after an aux stem (降りそうな) for learners.
      if (last && isNaAdjectiveToken(last) && !followedByN && !hasSection(last, SECTION.AuxiliaryVerbStem)) {
        out[out.length - 1] = append(last, w1);
        changed = true;
        i += 1;
        continue;
      }

      // Not the vegetable 菜.
      w1 = patched(w1, { cls: 'Particle' });
      changed = true;
    } else if (w1.s === 'に' && w1.cls !== 'Particle') {
      // Not the baggage 荷.
      w1 = patched(w1, { cls: 'Particle' });
      changed = true;
    }

    out.push(w1);
    i += 1;
  }

  return changed ? out : input;
}
