/*
 * The repair stages for colloquial speech, ported from Apache-2.0 C# source (see
 * ../../NOTICE): RepairHasaNoun, RepairVowelElongation, RepairColloquialNegativeNee, RepairColloquialRanNai,
 * RepairIntensifierKaeru, RepairNounReadAsTeForm, RepairQuotativeTte, RepairStolenUBeforeSsu,
 * RecombineHiraganaTokens, RepairSakkiMoraTheft, CollapseReduplicatedMimetic, RepairClippedAdjective,
 * RepairFusedInterjectionParticle, RepairOrphanedAuxiliary, RepairTankaToTaNKa, RepairTteNani and RepairDanTobashi.
 * Comments are the upstream ones.
 *
 * Modified:
 *  - Every rebuilt token goes through ../recut.ts, so it keeps its Sudachi morphemes (cut where a boundary falls inside
 *    one) and, unless the stage names one, reads as them.
 *  - Our groups tile the sentence, so where upstream drops characters from a token's text (an elongating ー or small
 *    vowel, ケドー's ー) the surface keeps them and only the dictionary form loses them; where upstream drops a token
 *    outright (the small-vowel run after やがれ) it stays inside the token it trails.
 *  - Upstream lookups are our lexicon: "non-name" lookups are plain ones (it has no names); the prioritised lookup is
 *    JMdict's common flag; the kana-appropriate lookup is a kana spelling of a word that has no kanji or is usually
 *    written in kana; there are no frequency ranks or word ids, so CollapseReduplicatedMimetic sets the 2× entry as
 *    the dictionary form without pinning it, and InflectedLemmaOf takes the first candidate instead of the most
 *    frequent.
 *  - RepairQuotativeTte leaves out TryPeelParticleBeforeTte, the rare-verb rank rule and the counter rule (they need
 *    frequency ranks or counter senses we do not have) and TokenizeGrammarRemainder's tail re-tokenising (an OCR blob
 *    repair).
 */

import {
  CASE_PARTICLES,
  GODAN_VERB_ENDINGS,
  GODAN_VOLITIONAL_O_KANA,
  VERB_INDICATING_AUXILIARIES,
} from '../data/ruleData';
import { deconj, isNonWordToken, isNounClass, isSymbolClass, known, knownVerbOrAdjective } from '../group';
import {
  deconjugationKey,
  hasKanji,
  isAllHiragana,
  isAllKana,
  isAllKatakana,
  isHiraganaChar,
  isKana,
  isKanji,
  isKatakanaWordChar,
  isNumeralChar,
  toHiragana,
  toKatakana,
  vowelRow,
  GODAN_RENYOU_TO_DICT_END,
} from '../kana';
import { type Piece, recut, scanRewrite } from '../recut';
import { chars, cpLength, dropLast, lastChar } from '../text';
import type { CombineContext, Group, WordClass } from '../types';
import { pinnedDeconjugation } from './rewrite';

/** `HasPrioritizedNonNameCompoundLookup`, as JMdict's common flag. */
const prioritized = (ctx: CombineContext, text: string) =>
  ctx.lexicon.hasClass(text, 'common') || ctx.lexicon.hasClass(deconjugationKey(text), 'common');
/** `HasKanaAppropriateCompoundLookup`: a kana word, or one usually written in kana. */
const kanaAppropriate = (ctx: CombineContext, text: string) =>
  ctx.lexicon.hasClass(text, 'kana') || ctx.lexicon.hasClass(deconjugationKey(text), 'kana');
const verbTagged = (tags: readonly string[]) => tags.some((tag) => tag.startsWith('v'));
const isVerbPast = (ctx: CombineContext, text: string) =>
  deconj(ctx, text).some((form) => verbTagged(form.tags) && form.process.includes('past'));
/** `DeconjugatesToVerb`. */
const deconjugatesToVerb = (ctx: CombineContext, text: string) =>
  deconj(ctx, text).some((form) => verbTagged(form.tags));

/** `out`'s last `k` groups and then `inputs`, re-cut into `pieces` in their place. */
function rebuild(out: Group[], k: number, inputs: readonly Group[], pieces: readonly Piece[]): void {
  const span = [...out.slice(out.length - k), ...inputs];
  out.splice(out.length - k, k, ...recut(span, 0, span.length, pieces));
}

/** `RepairHasaNoun`: はさ read as a noun is は + さ. */
export function repairHasaNoun(groups: Group[], _ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    if (word.s !== 'はさ' || word.cls !== 'Noun') return 0;
    emit().push(
      ...recut(list, i, 1, [
        { s: 'は', fresh: true, cls: 'Particle' },
        { s: 'さ', fresh: true, cls: 'Particle' },
      ]),
    );
    return 1;
  });
}

const SMALL_VOWELS = 'ぁぃぅぇぉァィゥェォ';

/** `TryStripTrailingSmallVowel`: a colloquial small-vowel stretch (ちょっとぉ, そんなぁ) reads as its dictionary
 * surface. We keep the surface and change only the dictionary form. */
function stripTrailingSmallVowel(w: Group, ctx: CombineContext): Group | undefined {
  const cs = chars(w.s);
  if (cs.length < 3 || !SMALL_VOWELS.includes(cs.at(-1) as string)) return undefined;
  // A small vowel from a different row is a digraph (ファ, ティ), not a stretch.
  const row = vowelRow(cs.at(-1));
  if (row < 0 || vowelRow(cs.at(-2)) !== row) return undefined;
  if (cs.some((char) => !isKana(char) || char === 'ー')) return undefined;
  const stripped = cs.slice(0, -1).join('');
  // An attested surface is lexical (ねぇ, もぉ, すげぇ), however same-vowel it looks.
  if (known(ctx, w.s) || !known(ctx, stripped)) return undefined;
  return { ...w, d: w.d === w.s ? stripped : w.d };
}

const KNOWN_PARTICLES_AND_CONJUNCTIONS = new Set([
  'けど',
  'けども',
  'けれど',
  'けれども',
  'ので',
  'のに',
  'から',
  'まで',
]);

/** A trailing run of ≥2 identical small vowels (ぇぇぇ) is expressive elongation, not part of a word. Returns the
 * core length, or -1. */
function trailingSmallVowelRun(text: string): number {
  const cs = chars(text);
  let i = cs.length - 1;
  let run = '';
  let count = 0;
  while (i >= 0 && 'ぁぃぅぇぉ'.includes(cs[i] as string) && (count === 0 || cs[i] === run)) {
    run = cs[i] as string;
    count++;
    i--;
  }
  return count >= 2 && i + 1 >= 1 ? i + 1 : -1;
}

/** The volitional of a kanji stem + お-row kana (+ う), when the deconjugator reads it as one: its dictionary form. */
function volitionalDictForm(ctx: CombineContext, stem: Group, oKana: string): string | undefined {
  const stemKana = toHiragana(stem.r);
  const form = deconj(ctx, `${stemKana}${oKana}う`).find(
    (candidate) => verbTagged(candidate.tags) && candidate.process.some((step) => step.includes('volitional')),
  );
  if (!form?.text.startsWith(stemKana)) return undefined;
  return stem.s + form.text.slice(stemKana.length);
}

/** `RepairVowelElongation`: long-vowel marks and small vowels that Sudachi split or swallowed. */
export function repairVowelElongation(groups: Group[], ctx: CombineContext): Group[] {
  let changed = false;
  const words = [...groups];

  for (let i = 0; i < words.length; i++) {
    let w = words[i] as Group;
    const deElongated = stripTrailingSmallVowel(w, ctx);
    if (deElongated) {
      words[i] = w = deElongated;
      changed = true;
    }

    if (cpLength(w.s) >= 2 && lastChar(w.s) === 'ー' && (w.cls === 'Particle' || w.cls === 'Conjunction')) {
      const stripped = dropLast(w.s);
      if (isAllHiragana(stripped)) {
        if (w.d === w.s) {
          words[i] = { ...w, d: stripped };
          changed = true;
        }
        continue;
      }
    }

    // An emphatic ー before a geminate (パワーアーップ) stretches the word; the lemma drops it when that attests (パワーアップ).
    if (w.s.includes('ーッ') && w.flags.pin === undefined && isAllKatakana(w.s)) {
      const unstretched = w.s.replaceAll('ーッ', 'ッ');
      if (!known(ctx, w.s) && known(ctx, unstretched)) {
        words[i] = w = { ...w, d: unstretched, n: unstretched };
        changed = true;
      }
    }

    // A doubled first mora before と is emphasis on a と-adverb (ググンと = ぐんと), not another word (ググる).
    const next = words[i + 1];
    const cs = chars(w.s);
    if (
      next?.s === 'と' &&
      cs.length >= 3 &&
      cs[0] === cs[1] &&
      w.flags.pin === undefined &&
      lastChar(w.s) !== 'っ' &&
      lastChar(w.s) !== 'ッ' &&
      isAllKana(w.s) &&
      !known(ctx, w.s)
    ) {
      const adverb = `${cs.slice(1).join('')}と`;
      if (known(ctx, adverb) && !known(ctx, `${w.s}と`)) {
        words.splice(i, 2, ...recut(words, i, 2, [{ s: `${w.s}と`, from: w, d: adverb, n: adverb, cls: 'Adverb' }]));
        changed = true;
        continue;
      }
    }

    // ケドー otherwise matches the KEDO organisation instead of けど.
    if (cpLength(w.s) >= 2 && lastChar(w.s) === 'ー' && isNounClass(w.cls)) {
      const body = dropLast(w.s);
      if (isAllKatakana(body) && KNOWN_PARTICLES_AND_CONJUNCTIONS.has(toHiragana(body))) {
        const hiragana = toHiragana(body);
        words[i] = { ...w, d: hiragana, n: hiragana, cls: 'Conjunction' };
        changed = true;
        continue;
      }
    }

    if (!w.s.includes('ー') || lastChar(w.s) === 'ー' || w.cls === 'Interjection') continue;
    if (!chars(w.s).every((char) => char === 'ー' || isHiraganaChar(char))) continue;
    const stripped = w.s.replaceAll('ー', '');
    if (stripped.length === 0 || stripped === w.s) continue;
    if (!hasKanji(w.n) && stripped !== w.n) continue;
    words[i] = { ...w, d: w.d.replaceAll('ー', '') };
    changed = true;
  }

  if (words.length < 2) return changed ? words : groups;

  const result: Group[] = [];
  for (const current of words) {
    const prev = result.at(-1);
    if (!prev || isNonWordToken(prev)) {
      result.push(current);
      continue;
    }
    const before = result.at(-2);
    const cs = chars(current.s);

    // A trailing ー makes Sudachi read んー as a filler (総|ちゃ|んー → 総|ちゃん); ー is discarded.
    if (
      (current.cls === 'Interjection' || current.cls === 'Filler') &&
      cs.length >= 2 &&
      cs[0] === 'ん' &&
      cs.slice(1).every((char) => char === 'ー') &&
      isNounClass(prev.cls) &&
      cpLength(prev.s) <= 2 &&
      !prev.s.endsWith('ん')
    ) {
      rebuild(
        result,
        1,
        [current],
        [{ s: prev.s + current.s, from: prev, d: `${prev.s}ん`, n: `${prev.s}ん`, cls: 'Suffix' }],
      );
      changed = true;
      continue;
    }

    // Sudachi shreds kana reciprocal 〜あう into interjections (微笑み|あ|う).
    if (
      current.cls === 'Interjection' &&
      current.s === 'う' &&
      prev.cls === 'Interjection' &&
      prev.s === 'あ' &&
      before?.cls === 'Verb'
    ) {
      rebuild(
        result,
        1,
        [current],
        [
          {
            s: 'あう',
            from: prev,
            d: 'あう',
            n: '合う',
            cls: 'Verb',
            r: 'アウ',
            sec: ['非自立可能', '*', '*'],
            pos: ['動詞', '非自立可能', '*', '*', '五段-ワア行', '終止形-一般'],
          },
        ],
      );
      changed = true;
      continue;
    }

    // Intensifying っ-prefix verb (すっ|とぼける → すっとぼける).
    const pcs = chars(prev.s);
    if (
      current.cls === 'Verb' &&
      (prev.cls === 'Adverb' || prev.cls === 'Prefix') &&
      pcs.length === 2 &&
      pcs[1] === 'っ' &&
      isHiraganaChar(pcs[0]) &&
      current.d.length > 0 &&
      kanaAppropriate(ctx, prev.s + current.d)
    ) {
      rebuild(
        result,
        1,
        [current],
        [{ s: prev.s + current.s, from: current, d: prev.s + current.d, n: prev.s + current.d }],
      );
      changed = true;
      continue;
    }

    // An elongating ー splits る-verbs (来るー → 来|る|ー, おいしすぎるー → おいし|すぎ|る|ー).
    if (
      current.cls === 'SupplementarySymbol' &&
      current.s === 'ー' &&
      before &&
      prev.s === 'る' &&
      prev.cls === 'Noun' &&
      (before.cls === 'Prefix' || before.cls === 'Suffix')
    ) {
      const verb = `${before.s}る`;
      rebuild(
        result,
        2,
        [current],
        [
          {
            s: before.s + prev.s + current.s,
            from: before,
            d: verb,
            n: verb,
            cls: 'Verb',
            sec: [before.cls === 'Suffix' ? '非自立可能' : '*', '*', '*'],
          },
        ],
      );
      changed = true;
      continue;
    }

    // Godan volitional with う lengthened to ー (泳|ご|ー → 泳ごう).
    if (
      current.cls === 'SupplementarySymbol' &&
      current.s === 'ー' &&
      before &&
      pcs.length === 1 &&
      GODAN_VOLITIONAL_O_KANA.has(prev.s) &&
      isNounClass(prev.cls) &&
      before.s.length >= 1 &&
      chars(before.s).every(isKanji)
    ) {
      const dict = volitionalDictForm(ctx, before, prev.s);
      if (dict) {
        rebuild(
          result,
          2,
          [current],
          [
            {
              s: before.s + prev.s + current.s,
              from: before,
              d: dict,
              n: dict,
              cls: 'Verb',
              r: `${toKatakana(before.r + prev.s)}ー`,
            },
          ],
        );
        changed = true;
        continue;
      }
    }

    // Same volitional with ー fused into the kana token (遊|ぼー → 遊ぼう).
    if (
      cs.length === 2 &&
      cs[1] === 'ー' &&
      GODAN_VOLITIONAL_O_KANA.has(cs[0] as string) &&
      pcs.length >= 1 &&
      pcs.every(isKanji)
    ) {
      const dict = volitionalDictForm(ctx, prev, cs[0] as string);
      if (dict) {
        rebuild(result, 1, [current], [{ s: prev.s + current.s, from: prev, d: dict, n: dict, cls: 'Verb' }]);
        changed = true;
        continue;
      }
    }

    // An elongating ー splits i-adjective forms (早くー → 早|くー).
    if (
      current.cls === 'Interjection' &&
      cs.length >= 2 &&
      cs.at(-1) === 'ー' &&
      cs.slice(0, -1).every(isHiraganaChar) &&
      (prev.cls === 'Prefix' || prev.cls === 'IAdjective') &&
      prev.d.endsWith('い')
    ) {
      rebuild(result, 1, [current], [{ s: prev.s + current.s, from: prev, d: prev.d, cls: 'IAdjective' }]);
      changed = true;
      continue;
    }

    // る-verb plus elongating う (ぶつ|かるう → ぶつかる|う).
    // (Departure, here and for たあ: a blank or symbol is no verb stem, though the deconjugator reads one.)
    if (current.s.endsWith('るう') && cs.length >= 2 && !isSymbolClass(prev.cls)) {
      const verb = prev.s + dropLast(current.s);
      const hira = deconjugationKey(verb);
      const isRuVerb = (probe: string) =>
        deconj(ctx, probe).some((form) => form.text === hira && form.tags.some((tag) => tag === 'v1' || tag === 'v5r'));
      if (hira.endsWith('る') && (isRuVerb(`${dropLast(hira)}ない`) || isRuVerb(`${dropLast(hira)}らない`))) {
        rebuild(
          result,
          1,
          [current],
          [
            { s: verb, from: prev, d: verb, n: verb, cls: 'Verb' },
            { s: 'う', fresh: true, cls: 'Interjection', r: 'ウ' },
          ],
        );
        changed = true;
        continue;
      }
    }

    // たあ is misread as the particle と (おき|たあ → おきた|あ).
    if (current.s === 'たあ' && !isSymbolClass(prev.cls) && isVerbPast(ctx, `${prev.s}た`)) {
      rebuild(
        result,
        1,
        [current],
        [
          { s: `${prev.s}た`, from: prev, cls: 'Verb' },
          { s: 'あ', fresh: true, cls: 'Interjection', r: 'ア' },
        ],
      );
      changed = true;
      continue;
    }

    // A past tense before ああ gets misread as a na-adjective (いきた|ああ).
    if (current.s === 'ああ') {
      const hira = deconjugationKey(prev.s);
      if ((hira.endsWith('た') || hira.endsWith('だ')) && isVerbPast(ctx, hira) && prev.cls !== 'Verb') {
        result[result.length - 1] = { ...prev, cls: 'Verb' };
        changed = true;
      }
    }

    // Small-vowel run fused onto a conjugation ending (来|やが|れぇぇぇ → やがれ); a noun stem (移|れぇぇぇ) is left.
    if (
      (prev.cls === 'Verb' || prev.cls === 'Auxiliary') &&
      (isNounClass(current.cls) || current.cls === 'Interjection')
    ) {
      const coreLength = trailingSmallVowelRun(current.s);
      if (coreLength > 0) {
        const candidate = deconjugationKey(prev.s + cs.slice(0, coreLength).join(''));
        const prevDict = deconjugationKey(prev.d);
        const valid =
          candidate !== prevDict &&
          deconj(ctx, candidate).some((form) => form.text === prevDict && verbTagged(form.tags));
        if (valid) {
          rebuild(result, 1, [current], [{ s: prev.s + current.s, from: prev }]);
          changed = true;
          continue;
        }
      }
    }

    result.push(current);
  }

  return changed ? result : groups;
}

/** `RepairColloquialNegativeNee`: Sudachi splits negative ねえ into ね|え after a te-form (入って|ね|え|のに). */
export function repairColloquialNegativeNee(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 3) return groups;
  return scanRewrite(groups, (list, i, emit) => {
    const current = list[i] as Group;
    if (current.s !== 'え' || current.cls !== 'Interjection' || i < 2) return 0;
    const out = emit();
    const ne = out.at(-1);
    const te = out.at(-2);
    if (
      ne?.s !== 'ね' ||
      ne.cls !== 'Particle' ||
      !te ||
      !(
        (te.cls === 'Particle' && (te.s === 'て' || te.s === 'で')) ||
        (te.cls === 'Verb' && (te.s.endsWith('て') || te.s.endsWith('で')))
      )
    )
      return 0;
    rebuild(out, 1, [current], [{ s: 'ねえ', from: ne, cls: 'Auxiliary', d: 'ない', n: 'ない', r: 'ネエ' }]);
    return 1;
  });
}

/** Sudachi tags らん an adverb, blocking CombineInflections; らんない as an auxiliary reaches the deconjugator. */
export function repairColloquialRanNai(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 3) return groups;
  return scanRewrite(groups, (list, i, emit, last) => {
    const current = list[i] as Group;
    const next = list[i + 1];
    const prev = last();
    if (
      current.s !== 'らん' ||
      !next ||
      !['ない', 'ねえ', 'ねぇ', 'ねー'].includes(next.s) ||
      !prev ||
      !(prev.s.endsWith('て') || prev.s.endsWith('で'))
    )
      return 0;
    emit().push(
      ...recut(list, i, 2, [
        { s: current.s + next.s, fresh: true, cls: 'Auxiliary', d: 'られない', n: 'られない', r: `ラン${next.r}` },
      ]),
    );
    return 2;
  });
}

/** `RepairIntensifierKaeru`: a verb fused with intensifying 返る that JMdict does not list
 * (のさばりかえっ) is the head verb + 返る. */
export function repairIntensifierKaeru(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const w = list[i] as Group;
    if (
      w.cls !== 'Verb' ||
      w.flags.pin !== undefined ||
      cpLength(w.n) < 4 ||
      cpLength(w.s) < 3 ||
      !w.n.endsWith('返る') ||
      known(ctx, w.n)
    )
      return 0;
    // The head is the normalised form minus 返る, a kana-stable renyoukei (のさばり → のさばる).
    const headStem = chars(w.n).slice(0, -2).join('');
    const headDict = ctx.deconjugate(headStem).find((form) => verbTagged(form.tags) && known(ctx, form.text))?.text;
    // Surface must open with the same kana head (のさばりかえっ).
    if (!headDict || !w.s.startsWith(headStem) || cpLength(w.s) <= cpLength(headStem)) return 0;
    const suffix = chars(w.s).slice(cpLength(headStem)).join('');
    const kaeru = (s: string): Piece => ({
      s,
      from: w,
      d: '返る',
      n: '返る',
      cls: 'Verb',
      r: '',
      flags: { ...w.flags, pin: 1512150 },
    });
    const head: Piece = { s: headStem, from: w, d: headDict, n: headDict, cls: 'Verb', r: '' };
    const next = list[i + 1];
    // Folds て/た into 返って so it is read neither as quotative って nor as 却って.
    const withTe = suffix.endsWith('っ') && (next?.s === 'て' || next?.s === 'た');
    const out = recut(list, i, withTe ? 2 : 1, [head, kaeru(withTe ? suffix + (next as Group).s : suffix)]);
    const tailGroup = out[1] as Group;
    // Deconjugation is kana-side, so the chain is recovered against かえる, not 返る.
    out[1] = { ...tailGroup, deconjugation: pinnedDeconjugation(ctx, tailGroup.s, 'かえる') };
    emit().push(...out);
    return withTe ? 2 : 1;
  });
}

const COPULA_HEADS = new Set([
  'なの',
  'なん',
  'だ',
  'だっ',
  'です',
  'でし',
  'じゃ',
  'でしょ',
  'だろ',
  'だろう',
  'なら',
]);

/** A te-form never takes a copula, so あさっ[漁る]|て|なの is the prioritised noun あさって. */
export function repairNounReadAsTeForm(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const stem = list[i] as Group;
    const te = list[i + 1];
    const after = list[i + 2];
    if (
      !te ||
      !after ||
      stem.cls !== 'Verb' ||
      stem.flags.pin !== undefined ||
      !stem.s.endsWith('っ') ||
      te.s !== 'て' ||
      !COPULA_HEADS.has(after.s)
    )
      return 0;
    const noun = stem.s + te.s;
    if (!prioritized(ctx, noun) || knownVerbOrAdjective(ctx, noun)) return 0;
    emit().push(
      ...recut(list, i, 2, [
        { s: noun, from: stem, d: noun, n: noun, cls: 'Noun', sec: ['*', stem.sec[1], stem.sec[2]] },
      ]),
    );
    return 2;
  });
}

const COMMON_TE_FORM_VERBS = new Set([
  'なる',
  'する',
  'やる',
  'いる',
  'ある',
  'くる',
  'できる',
  'おる',
  'みる',
  'しまう',
  'よる',
]);
// Te-form いって: the い reattaches only when that attests (悪|いっ|て → 悪い; ギシギシい does not).
const IU_IKU_DICT_FORMS = new Set(['いう', '言う', 'いく', '行く']);
// Sudachi prefers the exclamation homograph (それっ!) before って; re-tagged Pronoun so lookup picks the everyday word.
const QUOTATIVE_STRIPPED_PRONOUNS = new Set(['それ', 'これ', 'あれ', 'どれ']);
const QUOTE_VERB_HEADS = new Set(['言', '思', '聞', '考', '感']);
const COMPOUND_VERB_SECOND_HALVES = new Set([
  'あう',
  '合う',
  'だす',
  '出す',
  'こむ',
  '込む',
  'きる',
  '切る',
  'かける',
  '掛ける',
  'あげる',
  '上げる',
  'つける',
  '付ける',
  'かえす',
  '返す',
  'なおす',
  '直す',
  'はじめる',
  '始める',
  'つづける',
  '続ける',
  'おわる',
  '終わる',
  'まわる',
  '回る',
  'とる',
  '取る',
  'あがる',
  '上がる',
  'かかる',
  '掛かる',
]);

// Nouns and に/と are excluded so どうにかなって/夢かなって keep their なる/かなう te-form reading.
const isClauseFinalBeforeKana = (w: Group) =>
  (w.cls === 'Particle' && w.s === 'の') ||
  w.cls === 'IAdjective' ||
  (w.cls === 'Verb' && w.s === w.d) ||
  (w.cls === 'Auxiliary' && ['ない', 'た', 'だ', 'です', 'ます', 'てる', 'でる'].includes(w.s));

/** `OneStepFinalFormBase`: the word a one-step imperative (or volitional) comes from. */
function oneStepFinalFormBase(ctx: CombineContext, text: string, includeVolitional: boolean): string | undefined {
  for (const form of deconj(ctx, text)) {
    if (form.process.length !== 1 || !form.text) continue;
    const step = form.process[0] as string;
    if ((step.includes('imperative') || (includeVolitional && step.includes('volitional'))) && known(ctx, form.text))
      return form.text;
  }
  return undefined;
}

const hasOneStepVolitional = (ctx: CombineContext, text: string) =>
  deconj(ctx, text).some((form) => form.process.length === 1 && (form.process[0] as string).includes('volitional'));

/** `InflectedLemmaOf`: the verb or adjective a surface inflects from in one step. Upstream keeps the most
 * frequent candidate; we have no ranks and keep the first. */
function inflectedLemmaOf(
  ctx: CombineContext,
  surface: string,
  head: Group,
): { lemma: string; cls: WordClass } | undefined {
  if (knownVerbOrAdjective(ctx, surface)) return undefined;
  const headLemma = head.cls === 'Verb' || head.cls === 'IAdjective' ? deconjugationKey(head.d) : undefined;
  for (const form of deconj(ctx, surface)) {
    // One inflection, optionally over a stem step (しない = negative + mizenkei of する).
    if (form.tags.length === 0 || form.process.length === 0 || form.process.length > 2) continue;
    if (form.process.length === 2 && !(form.process[1] as string).startsWith('(')) continue;
    if (form.text === headLemma) return undefined;
    // Stems and imperatives collide with renyokei nouns (待ち合わせ is neither 待ち合わす's imperative nor 待ち合わせる's stem).
    const step = form.process[0] as string;
    if (
      ['imperative', 'volitional', 'stem', 'infinitive', 'kei)'].some((word) => step.includes(word)) ||
      step === 'noun form'
    )
      continue;
    if (!knownVerbOrAdjective(ctx, form.text)) continue;
    const tag = form.tags.at(-1) as string;
    if (tag === 'adj-i') return { lemma: form.text, cls: 'IAdjective' };
    if (tag.length > 1 && tag[0] === 'v') return { lemma: form.text, cls: 'Verb' };
  }
  return undefined;
}

/** `AddTte`: the thief's っ and the て after it as quotative って (a copy of the て token). */
const tte = (te: Group): Piece => ({ s: 'って', from: te, d: 'って', n: 'って', cls: 'Particle', r: 'ッテ' });

const QUOTATIVE_NOMINAL = new Set<WordClass>(['Noun', 'CommonNoun', 'Pronoun', 'Name', 'Suffix']);

/**
 * `RepairQuotativeTte`: quotative って after a word Sudachi cut wrongly. The っ of って rides on the token
 * before it (寒|さっ|て, 読|むっ|て, それっ|て), which Sudachi then reads as some verb's te-form; the stolen mora goes
 * back to the word it completes and っ + て become って.
 */
export function repairQuotativeTte(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const result: Group[] = [];
  let changed = false;

  // って steals a noun's tail mora (寒|さって); returns the LONGEST attested run (繋|が|り → 繋がり, not がり), 0 if none.
  const wordReattachRunLength = (add: string): number => {
    let acc = add;
    let best = 0;
    for (let k = 1; k <= 3 && k <= result.length; k++) {
      const piece = result[result.length - k] as Group;
      // Stops at auxiliaries (ませ+ん), verbs (生き|て|い|こうっ|て) and が/と/を/に/か (と+いって attests 問い).
      // っ-final and bare す "verbs" are shreds (いっ|しょっ|て, びびり|す|ぎっ); the lookup gate still applies.
      if (
        (piece.cls === 'Verb' && !piece.s.endsWith('っ') && piece.s !== 'す') ||
        piece.cls === 'Auxiliary' ||
        (piece.cls === 'Particle' && ['が', 'と', 'を', 'に', 'か'].includes(piece.s))
      )
        break;
      // Topic は stops too, except clause-initially where it can only be a word head (は|ずっ|て = はず).
      if (piece.cls === 'Particle' && piece.s === 'は') {
        const before = result[result.length - k - 1];
        if (before && !isSymbolClass(before.cls)) break;
      }
      const t = piece.s;
      if (t.length === 0) break;
      // で heads only the shred です (で|すっ|て); anything else is two real tokens (で+すく=デスク).
      if (piece.cls === 'Particle' && t === 'で' && t + acc !== 'です') break;
      if (!chars(t).every((char) => /[ぁ-ゖ゠-ヿ一-鿿]/.test(char))) break;
      acc = t + acc;
      if (known(ctx, acc)) {
        // All-word kana pieces (どう+こう) are two words meeting; っ-final pieces (いっ) count as shreds regardless.
        // A lone stolen mora completing a common word (し|ばら|く → しばらく, おば|あさ|ん → おばあさん) is a shred.
        let allPiecesAreWords =
          cpLength(acc) >= 4 && /^[ぁ-ゖ]+$/.test(acc) && !(cpLength(add) === 1 && prioritized(ctx, acc));
        for (let m = 1; m <= k && allPiecesAreWords; m++) {
          const other = result[result.length - m] as Group;
          allPiecesAreWords = !other.s.endsWith('っ') && known(ctx, other.s);
        }
        if (!allPiecesAreWords) best = k;
      }
    }
    // A stranded lone kana before the run would be deleted by FilterOrphanedMisparses; range must match its set.
    if (best > 0 && result.length > best) {
      const lead = result[result.length - best - 1] as Group;
      if (cpLength(lead.s) === 1 && /[ぁ-ゟ゠-ヿ]/.test(lead.s) && (lead.cls === 'Noun' || lead.cls === 'Symbol'))
        return 0;
    }
    return best;
  };

  /** The run's last `runLen` groups + `add` (the start of `thief`) as one noun or adjective, then `rest` pieces. */
  const mergeRunInto = (runLen: number, add: string, inputs: Group[], rest: Piece[]) => {
    const run = result.slice(result.length - runLen);
    const merged = run.map((group) => group.s).join('') + add;
    // An adverbial く reattached to its adjective stem (堅|くっ|て) is that adjective, not a noun.
    const adjective = cpLength(merged) >= 2 && lastChar(merged) === 'く' ? `${dropLast(merged)}い` : undefined;
    const isAdjective = adjective !== undefined && knownVerbOrAdjective(ctx, adjective);
    rebuild(result, runLen, inputs, [
      {
        s: merged,
        from: run[0],
        d: isAdjective ? adjective : merged,
        n: isAdjective ? adjective : merged,
        cls: isAdjective ? 'IAdjective' : 'Noun',
        sec: ['*', '*', '*'],
        flags: {},
      },
      ...rest,
    ]);
  };

  // The う-row check rejects fragments the deconjugator over-tags as verb pasts (はだ, んだ).
  const isVerbReattachment = (s: string) =>
    (cpLength(s) >= 2 &&
      ['う', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'ぶ', 'む', 'る'].includes(lastChar(s)) &&
      known(ctx, s) &&
      deconjugatesToVerb(ctx, s)) ||
    oneStepFinalFormBase(ctx, s, true) !== undefined;

  for (let i = 0; i < groups.length; i++) {
    const word = groups[i] as Group;
    const next = groups[i + 1];
    // Departure: a blank or symbol before the thief is no word to reattach to (the deconjugator reads " た" as a
    // past, so 2-3日じゃ もって would become " も|って"). Upstream also judges it on the text, since Sudachi tags
    // some punctuation as a noun.
    const last = result.at(-1);
    const prev = last && !isSymbolClass(last.cls) && !isNonWordToken(last) ? last : undefined;

    // Nominal + だって|ば is copula だ + emphatic ってば (ダルマザメだってば), not the conjunction だって.
    if (
      next &&
      word.s === 'だって' &&
      (word.cls === 'Conjunction' || word.cls === 'Particle') &&
      next.s === 'ば' &&
      prev &&
      QUOTATIVE_NOMINAL.has(prev.cls)
    ) {
      result.push(
        ...recut(groups, i, 2, [
          { s: 'だ', fresh: true, cls: 'Auxiliary', r: 'ダ' },
          { s: 'ってば', fresh: true, cls: 'Particle', r: 'ッテバ', flags: { pin: 2130420 } },
        ]),
      );
      i++;
      changed = true;
      continue;
    }

    // 将校|だっ(だつ)|て is particle だって; SplitTatteParticle already ran, and the mora-theft block would fake 将校だ.
    if (next && word.s === 'だっ' && word.d === 'だつ' && next.s === 'て' && prev && QUOTATIVE_NOMINAL.has(prev.cls)) {
      result.push(
        ...recut(groups, i, 2, [
          { s: 'だって', fresh: true, cls: 'Particle', r: 'ダッテ', sec: ['接続助詞', '*', '*'] },
        ]),
      );
      i++;
      changed = true;
      continue;
    }

    // Adverb いたって before 言う after a て-form or particle (部署に|いたって言う) is いた + quotative って.
    if (
      prev &&
      next &&
      word.s === 'いたって' &&
      word.cls === 'Adverb' &&
      (next.d === 'いう' || next.d === '言う') &&
      (prev.s.endsWith('て') ||
        prev.s.endsWith('で') ||
        (prev.cls === 'Particle' && ['が', 'に', 'は', 'も'].includes(prev.s)))
    ) {
      result.push(
        ...recut(groups, i, 1, [{ s: 'いた', from: word, d: 'いる', n: 'いる', cls: 'Verb', r: 'イタ' }, tte(word)]),
      );
      changed = true;
      continue;
    }

    // って steals a katakana noun's tail (サナダ|ムシっ|て, エリ|アっての); the lookup gate spares サボってる.
    if (prev && isAllKatakana(prev.s)) {
      const cur = chars(word.s);
      let kl = 0;
      while (kl < cur.length && isKatakanaWordChar(cur[kl])) kl++;
      const kana = cur.slice(0, kl).join('');
      if (kl >= 1 && kl < cur.length && cur[kl] === 'っ' && known(ctx, prev.s + kana)) {
        const rest = cur.slice(kl).join('');
        const kataWord = prev.s + kana;
        const katakanaNoun: Piece = { s: kataWord, from: prev, d: kataWord, n: kataWord, cls: 'Noun' };
        if (rest === 'っ' && next?.s === 'て') {
          rebuild(result, 1, [word, next], [katakanaNoun, tte(next)]);
          i++;
          changed = true;
          continue;
        }
        if (rest === 'って') {
          rebuild(result, 1, [word], [katakanaNoun, tte(word)]);
          changed = true;
          continue;
        }
      }
    }

    // それっ|て → それ|って, vouched by Sudachi's NormalizedForm; else CombineTte builds a bogus exclamation te-form.
    if (
      next &&
      word.cls === 'Interjection' &&
      cpLength(word.s) >= 2 &&
      lastChar(word.s) === 'っ' &&
      next.s === 'て' &&
      word.n === dropLast(word.s)
    ) {
      const stripped = dropLast(word.s);
      result.push(
        ...recut(groups, i, 2, [
          {
            s: stripped,
            from: word,
            d: stripped,
            n: stripped,
            cls: QUOTATIVE_STRIPPED_PRONOUNS.has(stripped) ? 'Pronoun' : word.cls,
          },
          tte(next as Group),
        ]),
      );
      i++;
      changed = true;
      continue;
    }

    // がる never follows a pronoun, so 何|がっ|て is 何|が|って.
    if (
      next &&
      word.s === 'がっ' &&
      word.cls === 'Suffix' &&
      word.d === 'がる' &&
      next.s === 'て' &&
      prev?.cls === 'Pronoun'
    ) {
      result.push(...recut(groups, i, 2, [{ s: 'が', fresh: true, cls: 'Particle', r: 'ガ' }, tte(next as Group)]));
      i++;
      changed = true;
      continue;
    }

    // 読|むっ|て: the thief's POS is noise; the signal is the mora rebuilding a verb. あっ|て rebuilds none.
    const wc = chars(word.s);
    if (
      next &&
      prev &&
      wc.length === 2 &&
      wc[1] === 'っ' &&
      /[ぁ-ゖ]/.test(wc[0] as string) &&
      wc[0] !== 'だ' &&
      next.s === 'て' &&
      word.cls !== 'Particle' &&
      word.cls !== 'Pronoun'
    ) {
      const mora = wc[0] as string;
      const before = result.at(-2);
      let stemBack = 0;
      if (before && prev.cls === 'Suffix' && isVerbReattachment(before.s + prev.s + mora)) stemBack = 2;
      else if (
        ['Noun', 'CommonNoun', 'Verb', 'Prefix', 'Suffix'].includes(prev.cls) &&
        isVerbReattachment(prev.s + mora)
      )
        stemBack = 1;
      if (stemBack > 0) {
        const stemHead = result[result.length - stemBack] as Group;
        const verbText =
          result
            .slice(result.length - stemBack)
            .map((group) => group.s)
            .join('') + mora;
        // An imperative Sudachi agrees on keeps its verb lemma (来い → 来る, not the interjection); 待ち合わせ is no 待ち合わす imperative.
        let imperativeBase = oneStepFinalFormBase(ctx, verbText, false);
        if (imperativeBase && toHiragana(imperativeBase) !== toHiragana(stemHead.d)) imperativeBase = undefined;
        const lemma = imperativeBase ?? inflectedLemmaOf(ctx, verbText, stemHead)?.lemma ?? verbText;
        rebuild(
          result,
          stemBack,
          [word, next],
          [{ s: verbText, from: stemHead, d: lemma, n: lemma, cls: 'Verb' }, tte(next as Group)],
        );
        i++;
        changed = true;
        continue;
      }
    }

    // Non-verb reattachment ありがと|うっ|て → ありがとう; only interjection うっ (verb うつ reforms above).
    if (
      next &&
      prev &&
      word.s === 'うっ' &&
      word.d === 'うっ' &&
      next.s === 'て' &&
      ['Interjection', 'Noun', 'CommonNoun', 'Filler'].includes(prev.cls) &&
      /[ぁ-ゖ]/.test(lastChar(prev.s)) &&
      known(ctx, `${prev.s}う`)
    ) {
      const reattached = `${prev.s}う`;
      rebuild(
        result,
        1,
        [word, next],
        [{ s: reattached, from: prev, d: reattached, n: reattached }, tte(next as Group)],
      );
      i++;
      changed = true;
      continue;
    }

    // A noun's final kanji takes って's or っと's っ as a verb (自|意|識っ[識る]|て, 終|了っ[了う]|と), blocking compound matching.
    // Adj/verb predecessors are safe only as bare kanji; a genuine 若い/識って carries okurigana.
    if (
      next &&
      prev &&
      word.cls === 'Verb' &&
      wc.length === 2 &&
      wc[1] === 'っ' &&
      isKanji(wc[0]) &&
      (next.s === 'て' || next.s === 'と') &&
      ['Noun', 'CommonNoun', 'Suffix', 'Prefix', 'IAdjective', 'Verb'].includes(prev.cls) &&
      isKanji(lastChar(prev.s))
    ) {
      const tailKanji = wc[0] as string;
      const before = result.at(-2);
      const formsNoun =
        known(ctx, prev.s + tailKanji) ||
        (!!before &&
          ['Noun', 'CommonNoun', 'Suffix', 'Prefix'].includes(before.cls) &&
          isKanji(lastChar(before.s)) &&
          known(ctx, before.s + prev.s + tailKanji));
      if (formsNoun) {
        result.push(
          ...recut(groups, i, 2, [
            { s: tailKanji, from: word, d: tailKanji, n: tailKanji, cls: 'Noun' },
            next.s === 'と' ? { s: 'っと', fresh: true, cls: 'Particle', r: 'ット' } : tte(next as Group),
          ]),
        );
        i++;
        changed = true;
        continue;
      }
    }

    // A noun can't take past た, so 貴方|た|ちっ|て is 貴方|たち|って.
    const before = result.at(-2);
    if (
      next &&
      word.s === 'ちっ' &&
      word.cls === 'Auxiliary' &&
      word.d === 'ちう' &&
      next.s === 'て' &&
      prev?.s === 'た' &&
      prev.cls === 'Auxiliary' &&
      before &&
      ['Pronoun', 'Noun', 'CommonNoun'].includes(before.cls)
    ) {
      rebuild(
        result,
        1,
        [word, next],
        [{ s: 'たち', from: prev, d: 'たち', n: '達', cls: 'Suffix', r: 'タチ' }, tte(next as Group)],
      );
      i++;
      changed = true;
      continue;
    }

    // 婆|さ|んっ|て|ね: the gate below filters Interjection, so ん reattaches here.
    if (next && word.s === 'んっ' && word.cls === 'Interjection' && next.s === 'て' && prev) {
      const run = wordReattachRunLength('ん');
      if (run > 0) {
        mergeRunInto(run, 'ん', [word, next], [tte(next as Group)]);
        i++;
        changed = true;
        continue;
      }
    }

    // っつー steals morae like って (びびり|す|ぎっ|つーか); only the noun run applies, never a te-form.
    if (
      next &&
      prev &&
      wc.length > 1 &&
      lastChar(word.s) === 'っ' &&
      (next.s.startsWith('つー') || next.s.startsWith('つう') || next.s.startsWith('ちゅう'))
    ) {
      const strippedMora = dropLast(word.s);
      if (/^[ぁ-ゖ一-鿿]+$/.test(strippedMora)) {
        const run = wordReattachRunLength(strippedMora);
        if (run > 0) {
          mergeRunInto(run, strippedMora, [word, next], [{ s: `っ${next.s}`, from: next, r: `ッ${next.r}` }]);
          i++;
          changed = true;
          continue;
        }
      }
    }

    // Fused theft: 勉|強って (強って lemmatised as たって).
    if (prev && wc.length >= 3 && word.s.endsWith('って') && wc.slice(0, -2).every(isKanji)) {
      const headText = wc.slice(0, -2).join('');
      const run = wordReattachRunLength(headText);
      if (run > 0) {
        mergeRunInto(run, headText, [word], [tte(word)]);
        changed = true;
        continue;
      }
    }

    // Auxiliary/Interjection thieves are lemmatised stolen morae too (育|ちっ|て, た|めっ|て).
    if (
      !next ||
      wc.length < 2 ||
      lastChar(word.s) !== 'っ' ||
      next.s !== 'て' ||
      !['Verb', 'Noun', 'CommonNoun', 'Adverb', 'Auxiliary', 'Interjection', 'Particle'].includes(word.cls)
    ) {
      result.push(word);
      continue;
    }

    const thief = word;
    const stripped = dropLast(thief.s);
    const repair = (pieces: Piece[], k: number) => {
      rebuild(result, k, [thief, next], [...pieces, tte(next)]);
      i++;
      changed = true;
    };

    // のか|なっ|て → のかな|って; a clause-final token before か makes the question reading certain.
    if (
      thief.s === 'なっ' &&
      prev?.cls === 'Particle' &&
      prev.s === 'か' &&
      before &&
      isClauseFinalBeforeKana(before)
    ) {
      repair([{ s: 'かな', from: prev, d: 'かな', n: 'かな' }], 1);
      continue;
    }

    // 言うな|って: a terminal form never takes なる (that is たくなって), so な is sentence-final.
    if (
      thief.s === 'なっ' &&
      prev &&
      (((prev.cls === 'Verb' || prev.cls === 'IAdjective') && prev.s === prev.d) ||
        (prev.cls === 'Auxiliary' && ['だ', 'た', 'です', 'ます', 'たい', 'ない'].includes(prev.s)))
    ) {
      repair([{ s: 'な', fresh: true, cls: 'Particle', r: 'ナ' }], 0);
      continue;
    }

    // 言|うなっ|て → 言う|な|って; genuine うなる "growl" follows a particle, which the prev-POS check excludes.
    if (
      thief.s === 'うなっ' &&
      prev &&
      !['Particle', 'Auxiliary', 'SupplementarySymbol', 'Symbol', 'BlankSpace'].includes(prev.cls) &&
      (known(ctx, `${prev.s}う`) || hasOneStepVolitional(ctx, `${prev.s}う`))
    ) {
      repair(
        [
          { s: `${prev.s}う`, from: prev },
          { s: 'な', fresh: true, cls: 'Particle', r: 'ナ' },
        ],
        1,
      );
      continue;
    }

    // デー|トっ|て: a mid-katakana cut before って is never real, so shape alone suffices (OOV names too).
    if (
      cpLength(stripped) === 1 &&
      stripped !== 'ー' &&
      isKatakanaWordChar(stripped) &&
      prev &&
      isAllKatakana(prev.s)
    ) {
      const merged = prev.s + stripped;
      repair([{ s: merged, from: prev, d: merged, n: merged, cls: 'Noun' }], 1);
      continue;
    }

    // すご|くっ[来る]|て is すごく|って; must run before the CommonTeFormVerbs skip, which would keep くる.
    if (
      stripped === 'く' &&
      thief.d === 'くる' &&
      prev &&
      (((prev.cls === 'IAdjective' || prev.cls === 'Prefix') && prev.d.endsWith('い') && known(ctx, prev.d)) ||
        // Bare-kanji adverb stem (早[早い]); all-kanji keeps kana お|くっ|て (送る) out.
        (prev.cls === 'Adverb' && prev.s.length > 0 && chars(prev.s).every(isKanji) && known(ctx, `${prev.s}い`)))
    ) {
      repair([{ s: `${prev.s}く`, from: prev, cls: 'IAdjective' }], 1);
      continue;
    }

    // と|かっ[買う]|て is とか|って; a genuine 買って follows を or a noun, never と.
    if (
      stripped === 'か' &&
      thief.cls === 'Verb' &&
      ['買う', '飼う', 'かう'].includes(thief.d) &&
      prev?.s === 'と' &&
      prev.cls === 'Particle'
    ) {
      repair([{ s: 'か', from: thief, d: 'か', n: 'か', cls: 'Particle', r: 'カ' }], 0);
      continue;
    }

    // する has no すっ stem and くる no くっ stem (that is 繰る), so those thieves are shreds (で|すっ|て, し|ばら|くっ|て).
    if (
      thief.cls === 'Verb' &&
      COMMON_TE_FORM_VERBS.has(thief.d) &&
      !(thief.d === 'する' && thief.s === 'すっ') &&
      !(thief.d === 'くる' && thief.s === 'くっ')
    ) {
      result.push(thief);
      continue;
    }

    // 繋|がりっ|て → 繋がり|って; bare う is a volitional (いこ|うっ|て) and いっ/だっ would hit particles (て+い=弟).
    if (
      cpLength(stripped) >= 1 &&
      stripped !== 'う' &&
      !IU_IKU_DICT_FORMS.has(thief.d) &&
      thief.d !== 'だつ' &&
      /^[ぁ-ゖ]+$/.test(stripped)
    ) {
      const run = wordReattachRunLength(stripped);
      if (run > 0) {
        mergeRunInto(run, stripped, [thief, next], [tte(next as Group)]);
        i++;
        changed = true;
        continue;
      }
    }

    // 必|要っ[要る]|て → 必要|って; the lookup gate keeps 家に帰って out (に+帰 does not attest).
    if (hasKanji(stripped)) {
      const run = wordReattachRunLength(stripped);
      if (run > 0) {
        mergeRunInto(run, stripped, [thief, next], [tte(next as Group)]);
        i++;
        changed = true;
        continue;
      }
    }

    // わからない|けどっ[気取る]|て: a conjunctive particle after a predicate quoted with って, not a verb te-form.
    if (
      ['けど', 'けれど', 'けども', 'から', 'のに', 'ので'].includes(stripped) &&
      prev &&
      (['Verb', 'IAdjective', 'Auxiliary'].includes(prev.cls) || prev.s.endsWith('だ') || prev.s.endsWith('です'))
    ) {
      repair(
        [
          {
            s: stripped,
            from: thief,
            d: stripped,
            n: stripped,
            cls: 'Particle',
            r: toKatakana(stripped),
            sec: ['接続助詞', '*', '*'],
          },
        ],
        0,
      );
      continue;
    }

    // Later heuristics would split genuine auxiliary te-forms (食べ|ちゃっ|て), so these repair only via reattach.
    if (thief.cls === 'Auxiliary' || thief.cls === 'Interjection' || thief.cls === 'Particle') {
      result.push(thief);
      continue;
    }

    let shouldRepair = false;
    let mergeIntoPrev = false;
    let mergeAsVerb = false;
    const sc = chars(stripped);
    if (sc.length === 1 && /[ぁ-ゖ]/.test(stripped) && thief.cls !== 'Adverb') {
      if (prev) {
        if (prev.cls === 'Particle' && CASE_PARTICLES.has(prev.s)) {
          result.push(thief);
          continue;
        }
        const merged = prev.s + stripped;
        // RunBfs always returns the identity form (0 steps), so exactly one step is required.
        let realStep = deconj(ctx, merged).some((form) => form.process.length === 1);
        // いっ|て is usually 言って/行って; steal い only for a real word (悪い, not ギシギシい).
        if (realStep && IU_IKU_DICT_FORMS.has(thief.d) && !known(ctx, merged)) realStep = false;
        // 信じ|きっ|て is 信じきる's te-form; leave it for CombineCompounds, not a fake 信じき + って.
        if (realStep && thief.cls === 'Verb' && known(ctx, prev.s + thief.d)) realStep = false;
        // ささやき|あっ|て: a verb stem before a verb te-form is a split compound verb (囁き合う), not a theft.
        if (
          realStep &&
          thief.cls === 'Verb' &&
          prev.cls === 'Verb' &&
          prev.d !== prev.s &&
          COMPOUND_VERB_SECOND_HALVES.has(thief.d)
        )
          realStep = false;
        if (realStep) {
          shouldRepair = true;
          mergeIntoPrev = true;
        }
      }
    } else if (sc.length >= 2 && isAllKana(stripped) && !COMMON_TE_FORM_VERBS.has(thief.d)) {
      // Prefer a clause-final reattachment: 信|じろっ|て → 信じろ|って.
      if (
        prev &&
        ['Verb', 'Noun', 'CommonNoun'].includes(prev.cls) &&
        oneStepFinalFormBase(ctx, prev.s + stripped, true)
      ) {
        shouldRepair = true;
        mergeIntoPrev = true;
        mergeAsVerb = true;
      } else if (thief.cls !== 'Adverb') {
        // A genuine te-stem (わかっ+て → わかる) is no theft, unless a quote verb follows (かなっ|て|思ったら).
        // The frame is deliberately broad: わかって思った loses its boundary, but narrowing costs more.
        const after = groups[i + 2];
        const quoteVerbFollows = !!after && after.cls === 'Verb' && QUOTE_VERB_HEADS.has(chars(after.s)[0] ?? '');
        let selfTeForm = false;
        if (
          !quoteVerbFollows &&
          thief.cls === 'Verb' &&
          cpLength(thief.d) >= 2 &&
          thief.d !== thief.s &&
          known(ctx, thief.d)
        ) {
          const dictHira = toHiragana(thief.d);
          selfTeForm = ctx.deconjugate(`${toHiragana(thief.s)}て`).some((form) => form.text === dictHira);
        }
        if (!selfTeForm) shouldRepair = ctx.deconjugate(stripped).length > 0;
      }
      // Adverb-tagged するっ|て is する|って; the う-row gate keeps ことっ a noun.
      else if (isVerbReattachment(stripped)) shouldRepair = true;
    }

    if (shouldRepair) {
      if (mergeIntoPrev && prev) {
        const merged = prev.s + stripped;
        const inflected = mergeAsVerb ? undefined : inflectedLemmaOf(ctx, merged, prev);
        repair(
          [
            {
              s: merged,
              from: prev,
              d: inflected?.lemma ?? prev.d,
              n: inflected?.lemma ?? prev.n,
              cls: mergeAsVerb ? 'Verb' : (inflected?.cls ?? prev.cls),
            },
          ],
          1,
        );
      } else if (prev && prev.s === stripped && known(ctx, prev.s + stripped)) {
        // やれ|やれっ|て → やれやれ|って; otherwise the copy is dropped as a kana stutter.
        repair([{ s: prev.s + stripped, from: prev, d: prev.s + stripped, n: prev.s + stripped }], 1);
      } else {
        repair([{ s: stripped, from: thief, cls: 'Verb' }], 0);
      }
      continue;
    }

    result.push(thief);
  }

  return changed ? result : groups;
}

const STOLEN_U_SSU_SURFACES = new Set(['うっす', 'うっス', 'うッス']);

/** The copula っす steals the う it follows (そ|うっす reads as the greeting うっす); the う goes back when it completes a word. */
export function repairStolenUBeforeSsu(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit, last) => {
    const ssu = list[i] as Group;
    if (i === 0 || ssu.flags.pin !== undefined) return 0;
    // Sudachi also cuts it as う[つ]っ|す (そ|うっ|す).
    let consumed = 1;
    const next = list[i + 1];
    if (!STOLEN_U_SSU_SURFACES.has(ssu.s)) {
      if (
        (ssu.s === 'うっ' || ssu.s === 'ウッ') &&
        next &&
        (next.s === 'す' || next.s === 'ス') &&
        next.cls === 'Auxiliary'
      )
        consumed = 2;
      else return 0;
    }
    const prev = last() as Group;
    if (prev.flags.pin !== undefined || prev.s.length === 0 || isSymbolClass(prev.cls) || prev.cls === 'Particle')
      return 0;
    const completed = `${prev.s}う`;
    let lemma: string;
    let cls: WordClass;
    if (deconjugationKey(prev.d) === deconjugationKey(completed)) {
      // Sudachi already lemmatised the shred as the completed word (そ → そう).
      lemma = prev.d;
      cls = prev.cls;
    } else if (prev.cls === 'Auxiliary' && prev.s.endsWith('ょ')) {
      // Volitional auxiliaries (ましょ|う, でしょ|う) keep their lemma.
      lemma = prev.d;
      cls = 'Auxiliary';
    } else if (knownVerbOrAdjective(ctx, completed)) {
      lemma = completed;
      cls = 'Verb';
    } else return 0;
    const inputs = list.slice(i, i + consumed);
    const ssuText = inputs
      .map((group) => group.s)
      .join('')
      .slice(1);
    rebuild(emit(), 1, inputs, [
      { s: completed, from: prev, d: lemma, n: lemma, cls, r: `${prev.r}ウ` },
      // Lemma です keeps CombineAuxiliary from fusing it into the head (そうっす → 沿う).
      {
        s: ssuText,
        from: ssu,
        d: 'です',
        n: 'っす',
        cls: 'Auxiliary',
        r: 'ッス',
        sec: ['*', '*', '*'],
        pos: ['助動詞', '*', '*', '*', '助動詞-デス', '終止形-一般'],
      },
    ]);
    return consumed;
  });
}

/** Classes a recombined hiragana run may not contain. */
const RECOMBINE_BLOCKED_CLASSES = new Set<WordClass>([
  'Verb',
  'IAdjective',
  'NaAdjective',
  'Particle',
  'Auxiliary',
  'Prefix',
  'Suffix',
  'NounSuffix',
  'SupplementarySymbol',
  'Symbol',
  'BlankSpace',
  'Conjunction',
]);

/** RecombineHiraganaTokens: a run of 2-4 hiragana content tokens that spells one word (kana-appropriately,
 * or as an inflected verb or adjective) becomes that word (classical attributive き fused into the next noun:
 * 白|き尾 → 白き|尾). */
export function recombineHiraganaTokens(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  let result: Group[] | undefined;
  let i = 0;
  while (i < groups.length) {
    let combined = false;
    for (let spanLen = Math.min(4, groups.length - i); spanLen >= 2 && !combined; spanLen--) {
      const span = groups.slice(i, i + spanLen);
      if (
        span.some(
          (w) =>
            !isAllHiragana(w.s) ||
            RECOMBINE_BLOCKED_CLASSES.has(w.cls) ||
            (w.cls === 'Expression' && (w.s === 'だった' || w.s === 'だったら')),
        )
      )
        continue;
      const text = span.map((w) => w.s).join('');
      if (cpLength(text) < 3 || cpLength(text) > 12) continue;
      const first = span[0] as Group;
      if (first.cls === 'Interjection' && span.every((w) => w.s === first.s && w.cls === 'Interjection')) continue;
      // えっ|そう is two utterances; neither えっそう nor its 得る deconjugation is valid.
      if (first.cls === 'Interjection' && span[1]?.s === 'そう') continue;

      let dict: string | undefined;
      let cls: WordClass = 'CommonNoun';
      if (kanaAppropriate(ctx, text)) dict = text;
      else if (!span.every((w) => prioritized(ctx, w.s))) {
        for (const form of deconj(ctx, text)) {
          if (form.tags.length === 0 || form.tags.length > 5) continue;
          const lastTag = form.tags.at(-1) as string;
          if (!lastTag.startsWith('v') && lastTag !== 'adj-i' && lastTag !== 'adj-na') continue;
          if (!known(ctx, form.text)) continue;
          dict = form.text;
          cls = lastTag === 'adj-i' ? 'IAdjective' : lastTag === 'adj-na' ? 'NaAdjective' : 'Verb';
          break;
        }
      }
      if (dict === undefined) continue;
      result ??= groups.slice(0, i);
      // Our kind, which upstream reads from JMdict at lookup: a merge JMdict lists as an expression is one (このまま).
      const flags = ctx.lexicon.hasClass(dict, 'exp') ? { kind: 'expression' as const } : {};
      result.push(...recut(groups, i, spanLen, [{ s: text, fresh: true, d: dict, n: dict, cls, flags }]));
      i += spanLen;
      combined = true;
    }
    if (!combined) {
      result?.push(groups[i] as Group);
      i++;
    }
  }
  return result ?? groups;
}

/** さっき loses its き to a following きみ (さっきみごと → さっ|きみ|ごと); み rejoins the next token when that attests. */
export function repairSakkiMoraTheft(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    const stolen = list[i + 1];
    if (word.s !== 'さっ' || stolen?.s !== 'きみ') return 0;
    const sakki: Piece = { s: 'さっき', from: word, d: 'さっき', n: 'さっき', cls: 'Noun', r: 'サッキ' };
    const following = list[i + 2];
    if (following && known(ctx, `み${following.s}`)) {
      const mi = `み${following.s}`;
      emit().push(
        ...recut(list, i, 3, [
          sakki,
          { s: mi, from: following, d: mi, n: mi, cls: 'Noun', flags: {}, r: following.r ? `ミ${following.r}` : '' },
        ]),
      );
      return 3;
    }
    emit().push(
      ...recut(list, i, 2, [sakki, { s: 'み', from: stolen, d: 'み', n: 'み', cls: 'Noun', r: 'ミ', flags: {} }]),
    );
    return 2;
  });
}

const isRepetitionOf = (text: string, unit: string) => {
  const cs = chars(text);
  if (cs.length === 0 || cs.length % 2 !== 0 || !isAllKana(text)) return false;
  for (let k = 0; k < cs.length; k += 2) if (cs[k] + (cs[k + 1] as string) !== unit) return false;
  return true;
};

/** Pins a 3×+ mimetic run (ごろごろごろ) to its 2× entry; DictionaryForm holds the 2× key. We have no word ids, so the
 * 2× entry is the dictionary form only. */
export function collapseReduplicatedMimetic(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const first = list[i] as Group;
    const cs = chars(first.s);
    if (cs.length < 2) return 0;
    const unit = cs.slice(0, 2).join('');
    if (!isRepetitionOf(first.s, unit)) return 0;
    let j = i + 1;
    let units = cs.length / 2;
    let allInterjections = first.cls === 'Interjection';
    while (j < list.length && isRepetitionOf((list[j] as Group).s, unit)) {
      units += cpLength((list[j] as Group).s) / 2;
      allInterjections &&= (list[j] as Group).cls === 'Interjection';
      j++;
    }
    // Repeated interjections (はい|はい|はい) are emphasis, and their 2× can be an unrelated word (はいはい → 這い這い).
    if (units < 3 || allInterjections || !known(ctx, unit + unit)) return 0;
    const text = list
      .slice(i, j)
      .map((group) => group.s)
      .join('');
    emit().push(
      ...recut(list, i, j - i, [
        {
          s: text,
          from: first,
          d: unit + unit,
          n: unit + unit,
          cls: 'Adverb',
          flags: { ...first.flags, kind: 'word' },
        },
      ]),
    );
    return j - i;
  });
}

/** A clipped exclamatory adjective (足短っ, 寒っ): kanji stem + っ is the adjective, not the noun. */
export function repairClippedAdjective(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const current = list[i] as Group;
    let tsu = -1;
    for (let j = i + 1; j < list.length && j <= i + 2; j++) {
      // The forced sokuon boundary leaves a blank or stop token between stem and っ.
      if ((list[j] as Group).cls === 'BlankSpace') continue;
      if ((list[j] as Group).s === 'っ' || (list[j] as Group).s === 'ッ') tsu = j;
      break;
    }
    const prev = list[i - 1];
    if (
      tsu < 0 ||
      current.s.length === 0 ||
      cpLength(current.s) > 4 ||
      current.flags.pin !== undefined ||
      ['Verb', 'Particle', 'Auxiliary', 'Symbol', 'SupplementarySymbol'].includes(current.cls) ||
      // A kana stem + い hits unrelated keys (がん+い = 含意) and resurrects SFX fragments.
      !isKanji(lastChar(current.s)) ||
      // Verb/adjective entries only, so noun collisions (兄い) don't qualify.
      !knownVerbOrAdjective(ctx, `${current.s}い`) ||
      // Vocative 隊|長っ must re-fuse to 隊長, not become 長い.
      (prev && known(ctx, prev.s + current.s))
    )
      return 0;
    const text = list
      .slice(i, tsu + 1)
      .map((group) => group.s)
      .join('');
    emit().push(
      ...recut(list, i, tsu - i + 1, [
        {
          s: text,
          from: current,
          d: `${current.s}い`,
          n: `${current.s}い`,
          cls: 'IAdjective',
          r: '',
          pos: ['形容詞', '一般', '*', '*', '形容詞', '語幹-一般'],
        },
      ]),
    );
    return tsu - i + 1;
  });
}

const SENTENCE_FINAL_PARTICLES = ['ね', 'ねえ', 'な', 'なあ', 'よ', 'よね', 'さ', 'わ', 'の', 'のよ', 'もの'].sort(
  (a, b) => cpLength(b) - cpLength(a),
);

/** Splits an unmatched interjection that absorbed a sentence-final particle (ごめんなさいね). */
export function repairFusedInterjectionParticle(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    if (word.cls !== 'Interjection' || cpLength(word.s) < 3 || known(ctx, word.s)) return 0;
    for (const particle of SENTENCE_FINAL_PARTICLES) {
      if (!word.s.endsWith(particle)) continue;
      const base = chars(word.s).slice(0, -cpLength(particle)).join('');
      if (cpLength(base) < 2 || !known(ctx, base)) continue;
      emit().push(
        ...recut(list, i, 1, [
          { s: base, fresh: true, cls: 'Interjection', pos: word.pos },
          { s: particle, fresh: true, cls: 'Particle', pos: ['助詞', '終助詞', '*', '*', '*', '*'] },
        ]),
      );
      return 1;
    }
    return 0;
  });
}

/** RepairOrphanedAuxiliary: a verb Sudachi read into the noun before an auxiliary (言い出し|た, 首|吊ら|れる
 * read as 首吊|ら|れる) gets its verb back. */
export function repairOrphanedAuxiliary(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const result: Group[] = [];
  let changed = false;

  for (let i = 0; i < groups.length; i++) {
    const word = groups[i] as Group;
    const prev = result.at(-1);
    if (!prev) {
      result.push(word);
      continue;
    }

    // 連用形 noun + た/て is the whole verb (言い出し|た → 言い出した), not the split below; だ/で is copula (手伝いだ).
    if (
      word.cls === 'Auxiliary' &&
      (word.s === 'た' || word.s === 'て') &&
      prev.cls === 'Noun' &&
      cpLength(prev.s) >= 2 &&
      prev.d === prev.s
    ) {
      const end = GODAN_RENYOU_TO_DICT_END[lastChar(prev.s)];
      if (end) {
        const verbDict = dropLast(prev.s) + end;
        if (/[一-龯]/.test(verbDict) && known(ctx, verbDict)) {
          rebuild(result, 1, [word], [{ s: prev.s + word.s, from: prev, d: verbDict, n: verbDict, cls: 'Verb' }]);
          changed = true;
          continue;
        }
      }
    }

    // そりゃそうだ eats だろう's だ, stranding ろう as 蝋; reattach keeping the expression's dict form.
    if (word.s === 'ろう' && word.cls === 'Noun' && prev.cls === 'Expression' && prev.s.endsWith('だ')) {
      rebuild(result, 1, [word], [{ s: prev.s + word.s, from: prev }]);
      changed = true;
      continue;
    }

    const isOrphanedAuxiliary = word.cls === 'Auxiliary' && VERB_INDICATING_AUXILIARIES.has(word.d);
    const isOrphanedVerbEnding = !isOrphanedAuxiliary && cpLength(word.s) === 1 && GODAN_VERB_ENDINGS.includes(word.s);
    if ((!isOrphanedAuxiliary && !isOrphanedVerbEnding) || prev.cls !== 'Noun' || cpLength(prev.s) < 2) {
      result.push(word);
      continue;
    }

    const pc = chars(prev.s);
    let repaired = false;
    for (let w = 1; w <= Math.min(pc.length - 1, 3) && !repaired; w++) {
      const verbStem = pc.slice(-w).join('');
      if (!/[一-龯]/.test(verbStem)) continue;
      const nounRemainder = pc.slice(0, -w).join('');
      const endings = isOrphanedVerbEnding ? [word.s] : GODAN_VERB_ENDINGS;
      for (const ending of endings) {
        const dictForm = verbStem + ending;
        if (!known(ctx, dictForm) || !known(ctx, nounRemainder)) continue;
        const pieces: Piece[] = [
          {
            s: nounRemainder,
            from: prev,
            d: prev.d.endsWith(verbStem) ? chars(prev.d).slice(0, -w).join('') : prev.d,
            n: prev.n.endsWith(verbStem) ? chars(prev.n).slice(0, -w).join('') : prev.n,
          },
          { s: verbStem + word.s, fresh: true, d: dictForm, n: dictForm, cls: 'Verb' },
        ];
        rebuild(result, 1, [word], pieces);
        repaired = true;
        break;
      }
    }
    if (repaired) changed = true;
    else result.push(word);
  }
  return changed ? result : groups;
}

/** RepairTankaToTaNKa: noun たか/たんか after a verb is the past た + (ん +) か (言い過ぎ|たか, 云う|たんか). */
export function repairTankaToTaNKa(groups: Group[], ctx: CombineContext): Group[] {
  const result: Group[] = [];
  let changed = false;
  const nTok = (): Piece => ({
    s: 'ん',
    fresh: true,
    d: 'の',
    n: 'ん',
    cls: 'Particle',
    r: 'ン',
    sec: ['準体助詞', '*', '*'],
  });
  const ka = (): Piece => ({ s: 'か', fresh: true, cls: 'Particle', r: 'カ' });
  /** Index in `result` of the `offset`-th group back that is not a SupplementarySymbol, or -1. */
  const prevIndex = (offset = 1) => {
    let count = 0;
    for (let j = result.length - 1; j >= 0; j--) {
      if ((result[j] as Group).cls === 'SupplementarySymbol') continue;
      if (++count === offset) return j;
    }
    return -1;
  };

  for (let i = 0; i < groups.length; i++) {
    const word = groups[i] as Group;
    const last = result.at(-1);

    // Noun たか after a verb stem is past た + か (言い過ぎ|たか); 鷹/高 after を/の never forms a past tense.
    // Departure: not after a blank or symbol, which the deconjugator also reads as a stem (じゃ たか).
    if (
      word.cls === 'Noun' &&
      word.s === 'たか' &&
      last &&
      !isSymbolClass(last.cls) &&
      !isNonWordToken(last) &&
      isVerbPast(ctx, `${last.s}た`)
    ) {
      rebuild(result, 1, [word], [{ s: `${last.s}た`, from: last, cls: 'Verb', r: last.r ? `${last.r}タ` : '' }, ka()]);
      changed = true;
      continue;
    }

    if (word.cls !== 'Noun' || word.s !== 'たんか') {
      result.push(word);
      continue;
    }
    // An adjacent を or a possessive の marks the real noun (たんかを吐く, お島の方のたんか).
    if (groups[i + 1]?.s === 'を' || last?.s === 'を' || last?.s === 'の') {
      result.push(word);
      continue;
    }

    const pi = prevIndex(1);
    const prev = pi >= 0 ? (result[pi] as Group) : undefined;
    // Upstream skips punctuation back to the predecessor; a re-cut here keeps groups adjacent, so it must touch たんか.
    if (prev && pi === result.length - 1) {
      // Kansai てもうた (ハズレて|もう|たんか → ハズレてもうた|ん|か); matched by text since もう's POS varies.
      const verbBefore = result.at(-2);
      if (prev.s === 'もう' && verbBefore && (verbBefore.s.endsWith('て') || verbBefore.s.endsWith('で'))) {
        rebuild(result, 2, [word], [{ s: `${verbBefore.s}もうた`, from: verbBefore, cls: 'Verb' }, nTok(), ka()]);
        changed = true;
        continue;
      }
      // Kansai てしもた (言うて|し|も|たんか → 言うてしもた|ん|か).
      const shi = result.at(-2);
      const verb3 = result.at(-3);
      if (
        prev.s === 'も' &&
        shi?.s === 'し' &&
        verb3 &&
        (verb3.s.endsWith('て') || verb3.s.endsWith('で') || verb3.cls === 'Expression')
      ) {
        rebuild(result, 3, [word], [{ s: `${verb3.s}しもた`, from: verb3, cls: 'Verb' }, nTok(), ka()]);
        changed = true;
        continue;
      }
      // 云う|たんか → 云うた|ん|か; any て/で ending takes the た, even one Sudachi tags IAdjective (怖がって|たんか → 怖がってた).
      const shouldSplit =
        (prev.cls === 'Verb' && deconjugatesToVerb(ctx, `${prev.s}た`)) ||
        prev.s.endsWith('て') ||
        prev.s.endsWith('で');
      if (shouldSplit) {
        rebuild(result, 1, [word], [{ s: `${prev.s}た`, from: prev, cls: 'Verb' }, nTok(), ka()]);
        changed = true;
        continue;
      }
    }
    result.push(word);
  }
  return changed ? result : groups;
}

/** ってな(=という) takes a noun head (ってな具合), never bare に, so ってな|に and って|な|に are って + なに. */
export function repairTteNani(groups: Group[], _ctx: CombineContext): Group[] {
  const nani = (from: Group): Piece => ({
    s: 'なに',
    from,
    d: 'なに',
    n: '何',
    r: 'ナニ',
    cls: 'Noun',
    sec: ['*', from.sec[1], from.sec[2]],
    flags: { ...from.flags, pin: 1577100 },
  });
  return scanRewrite(groups, (list, i, emit) => {
    const word = list[i] as Group;
    if (word.s === 'ってな' && list[i + 1]?.s === 'に') {
      emit().push(...recut(list, i, 2, [tte(word), nani(list[i + 1] as Group)]));
      return 2;
    }
    if (word.s === 'って' && list[i + 1]?.s === 'な' && list[i + 2]?.s === 'に') {
      emit().push(word, ...recut(list, i + 1, 2, [nani(list[i + 1] as Group)]));
      return 3;
    }
    return 0;
  });
}

/** A numeral claims 段 (一段|飛ばし), stranding 飛ばし on the fraud noun; reform 段飛ばし. A blanket 段+X rule would split 三段跳び. */
export function repairDanTobashi(groups: Group[], _ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const w = list[i] as Group;
    const b = list[i + 1];
    if (b?.s !== '飛ばし' || w.flags.pin !== undefined || b.flags.pin !== undefined || !w.s.endsWith('段')) return 0;
    const danTobashi: Piece = {
      s: '段飛ばし',
      from: b,
      d: '段飛ばし',
      n: '段飛ばし',
      r: 'ダントバシ',
      cls: 'Noun',
      flags: { ...b.flags, pin: 2746000 },
    };
    const headText = dropLast(w.s);
    if (headText.length === 0) {
      emit().push(...recut(list, i, 2, [danTobashi]));
      return 2;
    }
    // 何段/数段 ("how many / several steps") count as numeral heads.
    if (chars(headText).every((char) => isNumeralChar(char) || char === '何' || char === '数')) {
      emit().push(...recut(list, i, 2, [{ s: headText, from: w, d: headText, n: headText, r: '' }, danTobashi]));
      return 2;
    }
    return 0;
  });
}
