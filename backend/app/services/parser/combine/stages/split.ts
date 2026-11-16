/*
 * The split stages, ported from Apache-2.0 C# source (see ../../NOTICE):
 * SplitCompoundAuxiliaryVerbs, SplitTatteParticle, SplitUnattestedToAdverbs, SplitTanSuffix, SplitTawakeNoun,
 * SplitLexicalisedKaratte, SplitDoushiteContraction, SplitEmphaticMoSuru and SplitUnresolvableSuruCompounds. Comments
 * are the upstream ones.
 *
 * Modified: pieces are re-cut through ../recut.ts, so a piece cut out of a Sudachi morpheme is a synthetic morpheme
 * and its reading is the slice of the morpheme's reading (upstream reads the piece's own kana, or leaves it to lookup).
 * Upstream lookups are our lexicon: its "non-name" lookups are plain ones (our lexicon has no names), and
 * HasSuruVerbCompoundLookup is a verb sense under the key (JMdict's vs tags count as verbs there).
 */

import { AUXILIARY_VERB_STEMS, COMPOUND_VERB_SPLIT_SUFFIXES } from '../data/ruleData';
import { deconj, hasSection, known, SECTION } from '../group';
import { deconjugationKey, hasKanji } from '../kana';
import { cpLength, recut, scanRewrite } from '../recut';
import type { CombineContext, Group } from '../types';

const SAHEN_SURU = 1157170;
const chars = (text: string) => [...text];
const head = (text: string, n: number) => chars(text).slice(0, n).join('');
const tail = (text: string, n: number) => chars(text).slice(n).join('');
const lastChar = (text: string) => chars(text).at(-1) ?? '';

/** Splits Sudachi aux-verb compounds absent from JMDict into their parts (し終わっ → し + 終わっ). */
export function splitCompoundAuxiliaryVerbs(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    if (word.cls !== 'Verb' || cpLength(word.d) < 3) return 0;
    const aux = COMPOUND_VERB_SPLIT_SUFFIXES.find(
      (suffix) => word.d.endsWith(suffix) && cpLength(word.d) > cpLength(suffix),
    );
    if (!aux) return 0;
    // Attested compounds stay whole so form scoring can use Sudachi's reading (滲み出す: にじみだす vs しみだす).
    if (known(ctx, word.d)) return 0;
    const mainLength = cpLength(word.d) - cpLength(aux);
    const mainDict = head(word.d, mainLength);
    // Main verb surface is assumed to share the dict-form prefix length (し終わっ → し + 終わっ).
    if (cpLength(word.s) <= mainLength) return 0;
    const mainSurface = head(word.s, mainLength);
    const auxSurface = tail(word.s, mainLength);
    const stem = AUXILIARY_VERB_STEMS.get(aux);
    if (!stem || !auxSurface.startsWith(stem)) return 0;
    emit().push(
      ...recut(list, i, 1, [
        {
          s: mainSurface,
          fresh: true,
          d: mainDict,
          n: mainDict,
          cls: 'Verb',
          pos: [word.pos[0], word.pos[1], '*', '*', '*', '連用形-一般'],
        },
        { s: auxSurface, fresh: true, d: aux, n: aux, cls: 'Verb', sec: [SECTION.PossibleDependant, '*', '*'] },
      ]),
    );
    return 1;
  });
}

const PAST_TAGGED = (ctx: CombineContext, text: string) =>
  deconj(ctx, text).some((form) => form.tags.some((tag) => tag.startsWith('v')) && form.process.includes('past'));

/** SplitTatteParticle: だな read as 棚, かって and いたって read as adverbs, and the 接続助詞 たって/だって after a
 * 連用形, re-cut so the past た/だ reaches the deconjugator. */
export function splitTatteParticle(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    const prev = list[i - 1];

    // だな misparsed as 棚 → だ + な.
    if (word.s === 'だな' && word.cls === 'Noun' && word.n === '棚') {
      emit().push(
        ...recut(list, i, 1, [
          { s: 'だ', fresh: true, cls: 'Auxiliary', r: 'ダ' },
          { s: 'な', fresh: true, cls: 'Particle', sec: ['終助詞', '*', '*'], r: 'ナ' },
        ]),
      );
      return 1;
    }

    // かって after a predicate is か + って (飲むかってこと), not かつて; after a noun or clause-initially it stays かつて.
    if (
      prev &&
      word.s === 'かって' &&
      word.cls === 'Adverb' &&
      word.r === 'カツテ' &&
      ['Verb', 'IAdjective', 'Auxiliary', 'Expression'].includes(prev.cls)
    ) {
      emit().push(
        ...recut(list, i, 1, [
          { s: 'か', fresh: true, cls: 'Particle', sec: ['終助詞', '*', '*'], r: 'カ' },
          { s: 'って', fresh: true, cls: 'Particle', sec: [SECTION.ConjunctionParticle, '*', '*'], r: 'ッテ' },
        ]),
      );
      return 1;
    }

    // いたって after a て/で 接続助詞 is い + た + って (見ていたって); elsewhere (clause-initial, after は) it stays 至って.
    if (
      prev &&
      word.s === 'いたって' &&
      word.cls === 'Adverb' &&
      word.r === 'イタッテ' &&
      prev.cls === 'Particle' &&
      (prev.s === 'て' || prev.s === 'で') &&
      hasSection(prev, SECTION.ConjunctionParticle)
    ) {
      emit().push(
        ...recut(list, i, 1, [
          { s: 'い', fresh: true, d: 'いる', n: '居る', cls: 'Verb', r: 'イ' },
          { s: 'た', fresh: true, cls: 'Auxiliary', r: 'タ' },
          { s: 'って', fresh: true, cls: 'Particle', sec: [SECTION.ConjunctionParticle, '*', '*'], r: 'ッテ' },
        ]),
      );
      return 1;
    }

    if (
      prev &&
      word.cls === 'Particle' &&
      hasSection(word, SECTION.ConjunctionParticle) &&
      (word.s === 'たって' || word.s === 'だって') &&
      (prev.cls === 'Verb' || prev.cls === 'IAdjective' || prev.cls === 'Auxiliary')
    ) {
      const past = word.s === 'たって' ? 'た' : 'だ';
      emit().push(
        ...recut(list, i, 1, [
          { s: past, fresh: true, cls: 'Auxiliary' },
          { s: 'って', fresh: true, cls: 'Particle', sec: [SECTION.ConjunctionParticle, '*', '*'], r: 'ッテ' },
        ]),
      );
      return 1;
    }
    return 0;
  });
}

/** Splits OOV adverb Xと into X + と (JMDict lists 凛 bare); hiragana Xと is a deformed mimetic (ひっしと), kept. */
export function splitUnattestedToAdverbs(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    if (
      word.cls !== 'Adverb' ||
      word.flags.pin !== undefined ||
      cpLength(word.s) < 2 ||
      lastChar(word.s) !== 'と' ||
      /^[ぁ-ゟ]/.test(word.s) ||
      cpLength(word.r) < 2 ||
      (lastChar(word.r) !== 'ト' && lastChar(word.r) !== 'と')
    )
      return 0;
    const lead = head(word.s, cpLength(word.s) - 1);
    if (known(ctx, word.s) || !known(ctx, lead)) return 0;
    emit().push(
      ...recut(list, i, 1, [
        { s: lead, d: lead, n: lead, r: head(word.r, cpLength(word.r) - 1) },
        { s: 'と', fresh: true, cls: 'Particle', sec: ['格助詞', '*', '*'], r: 'ト' },
      ]),
    );
    return 1;
  });
}

/** Re-cuts Sudachi's イッ + たん(suffix) + だ as イッた + ん + だ; ProcessSpecialCases then merges ん + だ. */
export function splitTanSuffix(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    const next = list[i + 1];
    if (
      word.s !== 'たん' ||
      word.cls !== 'Suffix' ||
      !next ||
      next.cls !== 'Auxiliary' ||
      (next.d !== 'だ' && next.d !== 'です') ||
      i === 0
    )
      return 0;
    const prev = list[i - 1] as Group;
    // Departure: a blank or symbol is no verb stem, though the deconjugator reads " た" as a past.
    if (['Symbol', 'SupplementarySymbol', 'BlankSpace'].includes(prev.cls)) return 0;
    const ending = lastChar(prev.s);
    if (ending !== 'て' && ending !== 'で' && !PAST_TAGGED(ctx, `${prev.s}た`)) return 0;
    const out = emit();
    out.splice(
      -1,
      1,
      ...recut([prev, word], 0, 2, [
        { s: `${prev.s}た`, from: prev },
        { s: 'ん', fresh: true, d: 'の', n: 'ん', cls: 'Particle', sec: ['準体助詞', '*', '*'], r: 'ン' },
      ]),
    );
    return 1;
  });
}

/** Splits たわけ after a verb-like token into た + わけ (してたわけ); 戯け "fool" after a noun stays whole. */
export function splitTawakeNoun(groups: Group[], _ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    const prev = list[i - 1];
    if (word.s !== 'たわけ' || (word.d !== 'たわけ' && word.d !== 'たわける') || !prev) return 0;
    const afterVerbContext =
      ['Verb', 'Auxiliary', 'IAdjective', 'Particle', 'Adverb'].includes(prev.cls) ||
      (prev.cls === 'SupplementarySymbol' && prev.s === 'っ');
    if (!afterVerbContext) return 0;
    emit().push(
      ...recut(list, i, 1, [
        { s: 'た', fresh: true, cls: 'Auxiliary', r: 'タ' },
        { s: 'わけ', fresh: true, cls: 'Noun', r: 'ワケ' },
      ]),
    );
    return 1;
  });
}

/** Splits からって when から ends an expression entry (病は気から|って); any-entry lookups hit homographs (た+から = 宝). */
export function splitLexicalisedKaratte(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    if (word.s !== 'からって' || word.flags.pin !== undefined || i === 0) return 0;
    // Widest span first; three tokens covers the target expressions (病+は+気).
    let lexicalised = false;
    for (let span = Math.min(3, i); span >= 1 && !lexicalised; span--) {
      const left = list
        .slice(i - span, i)
        .map((group) => group.s)
        .join('');
      lexicalised = left.length > 0 && ctx.lexicon.hasClass(`${left}から`, 'exp');
    }
    if (!lexicalised) return 0;
    emit().push(
      ...recut(list, i, 1, [
        { s: 'から', d: 'から', n: 'から', cls: 'Particle', r: 'カラ' },
        { s: 'って', d: 'って', n: 'って', cls: 'Particle', r: 'ッテ' },
      ]),
    );
    return 1;
  });
}

/** Re-cuts どうして directly before た as どう + し + て (どうしてた contraction); どうして来たの stays whole. */
export function splitDoushiteContraction(groups: Group[], _ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    const next = list[i + 1];
    if (word.s !== 'どうして' || word.cls !== 'Adverb' || next?.s !== 'た' || next.cls !== 'Auxiliary') return 0;
    emit().push(
      ...recut(list, i, 1, [
        { s: 'どう', fresh: true, cls: 'Adverb', r: 'ドウ' },
        { s: 'し', fresh: true, d: 'する', n: '為る', cls: 'Verb', r: 'シ' },
        { s: 'て', fresh: true, d: 'てる', n: 'てる', cls: 'Auxiliary', r: 'テ' },
      ]),
    );
    return 1;
  });
}

const isSuruNegationOrPoliteContinuation = (text: string) =>
  ['ませ', 'まし', 'ます', 'ない', 'なかっ', 'なく', 'ねえ', 'ねぇ'].some((start) => text.startsWith(start));

/** Re-cuts adverb もし after a 連用形 and before a negation/polite tail as も + し (かすりもしない). */
export function splitEmphaticMoSuru(groups: Group[], _ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    const prev = list[i - 1];
    const next = list[i + 1];
    if (
      word.s !== 'もし' ||
      word.cls !== 'Adverb' ||
      prev?.cls !== 'Verb' ||
      prev.s === prev.d ||
      !next ||
      !isSuruNegationOrPoliteContinuation(next.s)
    )
      return 0;
    emit().push(
      ...recut(list, i, 1, [
        { s: 'も', fresh: true, cls: 'Particle', sec: ['係助詞', '*', '*'], r: 'モ' },
        // Pinned to する: free scoring picks the homograph 四 (し).
        { s: 'し', fresh: true, d: 'する', n: '為る', cls: 'Verb', r: 'シ', flags: { pin: SAHEN_SURU } },
      ]),
    );
    return 1;
  });
}

/** SplitUnresolvableSuruCompounds: a kanji verb or noun Sudachi fused with a form of する that JMdict does not
 * list whole (見学し → 見学 + し) is split before the する, unless the noun is a suru verb itself or the token
 * deconjugates to a word. */
export function splitUnresolvableSuruCompounds(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    const text = word.s;
    const cs = chars(text);
    if ((word.cls !== 'Verb' && word.cls !== 'Noun') || cs.length < 3 || !hasKanji(text)) return 0;
    if (known(ctx, text)) return 0;

    let splitAt = -1;
    for (let p = cs.length - 1; p >= 2 && splitAt < 0; p--) {
      if (!['し', 'さ', 'す', 'せ'].includes(cs[p] as string)) continue;
      const prefix = cs.slice(0, p).join('');
      if (!known(ctx, prefix)) continue;
      if (ctx.lexicon.hasClass(prefix, 'verb')) break;
      // Resolvable dictForm (思い出して → 思い出す) means deconjugation handles it; keep merged.
      if (word.d !== prefix && word.d !== text && known(ctx, word.d)) break;
      // A NormalizedForm base (思い出せる → 思い出す) counts only if reachable; 話ししません claims 話す but can't.
      if (
        word.n &&
        word.n !== prefix &&
        word.n !== text &&
        known(ctx, word.n) &&
        deconj(ctx, text).some((form) => form.text === deconjugationKey(word.n))
      )
        break;
      if (ctx.deconjugate(cs.slice(p).join('')).some((form) => form.text === 'する')) splitAt = p;
    }
    if (splitAt < 0) return 0;

    const noun = cs.slice(0, splitAt).join('');
    const suru = cs.slice(splitAt).join('');
    emit().push(
      ...recut(list, i, 1, [
        { s: noun, fresh: true, cls: 'Noun', pos: ['名詞', '普通名詞', 'サ変可能', '*', '*', '*'] },
        {
          s: suru,
          fresh: true,
          d: 'する',
          n: 'する',
          cls: 'Verb',
          pos: ['動詞', '非自立可能', '*', '*', 'サ行変格', '*'],
        },
      ]),
    );
    return 1;
  });
}
