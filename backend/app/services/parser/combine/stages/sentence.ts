import {
  EXPRESSION_EXCLUSIONS,
  HONORIFIC_SUFFIXES,
  LEXICALIZED_ADVERB_PAIRS,
  NOUN_COMPOUND_EXCLUSIONS,
  PARTICLE_EXPRESSION_OPENERS,
  TWO_TOKEN_EXPRESSION_WHITELIST,
  TWO_TOKEN_NOUN_VERB_IDIOMS,
} from '../data/ruleData';
import {
  concatText,
  DICTIONARY_VERB_ENDINGS,
  deconj,
  isNameLike,
  isNounForCompounding,
  isPrenominalModifier,
  known,
  span,
} from '../group';
import { isKanji, toHiragana } from '../kana';
import type { LexClass } from '../lexicon';
import type { CombineContext, Group } from '../types';

/*
 * The dictionary-window merges run per sentence after the token stages, as in `Parser.PreprocessSentences`:
 * CombineNounCompounds, CombineCompounds, CombineExpressions, CombineLexicalAdverbs. Upstream checks windows against
 * rolling hashes of its lookup table first; we ask the lexicon directly. Upstream word-id selection (expression entry
 * vs compound entry, by priority) becomes a class test.
 */

const isSymbol = (group: Group) => group.cls === 'SupplementarySymbol';
const hasClassAny = (ctx: CombineContext, text: string, classes: readonly LexClass[]) =>
  classes.some((cls) => ctx.lexicon.hasClass(text, cls));
/** `PosMapper.ValidCompoundPOS`: what a non-expression compound match may be. */
const COMPOUND_CLASSES: readonly LexClass[] = ['exp', 'verb', 'adj-i', 'adj-na', 'aux', 'conj'];

const excluded = (text: string) => EXPRESSION_EXCLUSIONS.has(text) || EXPRESSION_EXCLUSIONS.has(toHiragana(text));

/** A name's honorific stays outside any compound (シュウ|さん is not シュウさん). `IsNameHonorificPair`. */
function isNameHonorificPair(head: Group, honorific: Group): boolean {
  return (
    honorific.cls === 'Suffix' &&
    ['さん', 'くん', 'ちゃん', '氏'].includes(honorific.s) &&
    (head.cls === 'Name' || isNameLike(head))
  );
}

const isNameConnectorSymbol = (group: Group) => isSymbol(group) && (group.s === '・' || group.s === '＝');

/**
 * Runs of nouns (and prefixes, suffixes, counters, inner の) that JMdict lists as one word: 総合|格闘技, お嬢|様,
 * 私|たち. `CombineNounCompounds`, without its frequency-based overlap rescoring (we have no ranks) and
 * without its noun + verb-stem branch.
 */
/** The `HardPinned` check: a hard-pinned group is a final word decision no merge may swallow; soft pins stay
 * absorbable (臆病風に吹かれる). */
const hardPinned = (group: Group) => group.flags.hardPin === true && group.flags.pin !== undefined;
/** What a sentence-level merge sets: upstream gives the merged token the compound's own word (or none), so the
 * members' pins no longer apply. */
const merged = (via: string) => ({ via, pin: undefined, hardPin: undefined });

export function combineNounCompounds(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  let i = 0;

  while (i < groups.length) {
    const word = groups[i] as Group;
    const nextWord = groups[i + 1];

    if (!isNounForCompounding(word.cls)) {
      // Sudachi splits でか|ぶつ, 飛び|道具, 一向|一揆 and mis-tagged kanji leads (偶|然); lookups gate the merge.
      const misparsedKanjiLead = [...word.s].length === 1 && isKanji(word.s);
      const kanjiAdverbLead =
        word.cls === 'Adverb' && [...word.s].some((char) => isKanji(char) || /[゠-ヿ]/.test(char));
      if (
        (word.cls === 'IAdjective' || word.cls === 'Verb' || kanjiAdverbLead || misparsedKanjiLead) &&
        nextWord &&
        isNounForCompounding(nextWord.cls) &&
        !hardPinned(word) &&
        !hardPinned(nextWord) &&
        known(ctx, word.s + nextWord.s)
      ) {
        const text = word.s + nextWord.s;
        out.push(span(groups, i, i + 2, { d: text, n: text, cls: 'Noun', flags: merged('CombineNounCompounds') }));
        changed = true;
        i += 2;
        continue;
      }
      out.push(word);
      i++;
      continue;
    }

    // A prefix mustn't eat the head below it (お|母上, not お母|上), unless the whole span is a word (お手紙).
    const head = groups[i + 1];
    const following = groups[i + 2];
    if (
      word.cls === 'Prefix' &&
      head &&
      following &&
      isNounForCompounding(following.cls) &&
      known(ctx, head.s + following.s) &&
      !known(ctx, word.s + head.s + following.s)
    ) {
      out.push(word);
      i++;
      continue;
    }

    let best = 1;
    for (let size = Math.min(8, groups.length - i); size >= 2; size--) {
      let allValid = true;
      for (let j = 0; j < size; j++) {
        const w = groups[i + j] as Group;
        // Counters only continue a compound, prefixes only start one (さん+なん must not become 三男).
        const isNoun =
          (isNounForCompounding(w.cls) && (j === 0 || w.cls !== 'Prefix')) || (j > 0 && w.cls === 'Counter');
        const isInnerConnector =
          j > 0 && j < size - 1 && ((w.cls === 'Particle' && w.s === 'の') || isNameConnectorSymbol(w));
        if (!isNoun && !isInnerConnector) {
          allValid = false;
          break;
        }
        // Hard pins (三つ目's ordinal 目) are never re-absorbed; soft pins are.
        if (hardPinned(w)) {
          allValid = false;
          break;
        }
      }
      if (!allValid) continue;
      const last = i + size - 1;
      if (last >= 1 && isNameHonorificPair(groups[last - 1] as Group, groups[last] as Group)) continue;
      const text = concatText(groups, i, size);
      if (NOUN_COMPOUND_EXCLUSIONS.has(text)) continue;
      if (ctx.lexicon.has(text)) {
        best = size;
        break;
      }
    }

    if (best > 1) {
      const text = concatText(groups, i, best);
      // Sudachi splits proper names into parts; the merged token must stay name-like.
      const members = groups.slice(i, i + best);
      const carrier =
        members.find((w) => isNameLike(w)) ?? members.find((w) => w.sec.some((sec) => sec !== '*')) ?? word;
      out.push({
        ...span(groups, i, i + best),
        pos: carrier.pos,
        sec: carrier.sec,
        d: text,
        n: text,
        cls: word.cls,
        flags: merged('CombineNounCompounds'),
      });
      changed = true;
      i += best;
      continue;
    }

    out.push(word);
    i++;
  }

  return changed ? out : groups;
}

/** `DeconjBasesAllow`: a dictionary form the deconjugator cannot reach from the surface is a homograph. */
function deconjBasesAllow(ctx: CombineContext, surface: string, dictForm: string): boolean {
  let anyRealBase = false;
  for (const form of deconj(ctx, surface)) {
    if (form.process.length === 0) continue;
    anyRealBase = true;
    if (form.text === dictForm) return true;
  }
  return !anyRealBase;
}

interface WindowMatch {
  start: number;
  dictionaryForm: string;
}

/** `TryMatchCompoundWindow`: the longest window (5 down to 2 groups) ending at `index` whose texts, with the
 * anchor spelt `dictForm`, are a JMdict expression (or, unless `expressionOnly`, a verb/adjective/aux/conj). */
function matchWindow(
  groups: readonly Group[],
  index: number,
  dictForm: string,
  forceExpressionOnly: boolean,
  ctx: CombineContext,
): WindowMatch | null {
  if (index > 0 && isNameHonorificPair(groups[index - 1] as Group, groups[index] as Group)) return null;
  const anchor = groups[index] as Group;

  for (let size = Math.min(5, index + 1); size >= 2; size--) {
    const start = index - size + 1;
    const first = groups[start] as Group;
    // Particles over-merge as openers (とは); curated heads like しか (Vしか+ない) are expression-only.
    const curatedParticleOpener = first.cls === 'Particle' && PARTICLE_EXPRESSION_OPENERS.has(first.s);
    if ((first.cls === 'Particle' || first.cls === 'Interjection') && !curatedParticleOpener) continue;
    if (first.cls === 'Conjunction' && [...first.s].length === 1) continue;
    if (first.flags.reclassifiedSuffix) continue;
    // A name's honorific can't open a window (ヴァレリア様|に言わせれば ≠ ように言う).
    const beforeFirst = groups[start - 1];
    if (
      beforeFirst &&
      HONORIFIC_SUFFIXES.has(first.s) &&
      ['Noun', 'CommonNoun', 'Pronoun', 'Name'].includes(beforeFirst.cls)
    )
      continue;
    if (groups.slice(start, index).some(isSymbol)) continue;
    if (size === 2 && first.s === dictForm && anchor.s !== dictForm) continue;

    const candidate = concatText(groups, start, size - 1) + dictForm;
    const expressionOnly =
      forceExpressionOnly || curatedParticleOpener || ['Suffix', 'Auxiliary', 'Adverb'].includes(first.cls);
    const isExpression = ctx.lexicon.hasClass(candidate, 'exp');
    const matched = expressionOnly ? isExpression : hasClassAny(ctx, candidate, COMPOUND_CLASSES);
    if (!matched || excluded(candidate)) continue;
    // A pronoun is never a suru-noun stem: 私+してない is not 私する "use for personal gain".
    if (first.cls === 'Pronoun' && !isExpression && ctx.lexicon.hasClass(candidate, 'verb')) continue;
    // Attributive forms only modify nouns, so the noun after one is a noun head, never a verb stem (綺麗な|目してる
    // is not 目する).
    if (
      beforeFirst &&
      (first.cls === 'Noun' || first.cls === 'CommonNoun') &&
      isPrenominalModifier(beforeFirst) &&
      dictForm.endsWith('する') &&
      !isExpression &&
      ctx.lexicon.hasClass(candidate, 'verb')
    )
      continue;
    return { start, dictionaryForm: candidate };
  }
  return null;
}

const byLengthDesc = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => b.length - a.length);

/** `TryMatchCompounds`: the anchor's dictionary form first, then its surface and other spellings. */
function matchCompounds(
  groups: readonly Group[],
  index: number,
  forceExpressionOnly: boolean,
  ctx: CombineContext,
): WindowMatch | null {
  const verb = groups[index] as Group;
  const text = verb.s;
  const tryForm = (form: string) => matchWindow(groups, index, form, forceExpressionOnly, ctx);
  const dictForm = verb.d;

  if (!dictForm) {
    const forms = deconj(ctx, text);
    if (forms.length === 0) return null;
    const shortest = [...forms].sort((a, b) => a.text.length - b.text.length || (a.text < b.text ? -1 : 1))[0];
    return tryForm(shortest?.text || text);
  }

  let result = tryForm(dictForm);
  // DictionaryForm may be an unreachable homograph (立って df=立てる → 役に立てる); deconjugation below finds 役に立つ.
  if (result && dictForm !== text && !deconjBasesAllow(ctx, text, dictForm)) result = null;
  if (result) return result;

  if (text !== dictForm) {
    result = tryForm(text);
    if (result) return result;
  }

  // Classical 高き (df=高し) has the modern lemma only in NormalizedForm, which compounds use (気高い).
  if (verb.cls === 'IAdjective' && dictForm.endsWith('し') && verb.n.endsWith('い') && verb.n !== dictForm) {
    result = tryForm(verb.n);
    if (result) return result;
  }

  if (
    ['する', 'ある', 'いく', '行く', 'なる', 'くる', '来る'].includes(dictForm) &&
    (['ない', 'なかっ', 'なく', 'ねえ', 'ねー', 'ねぇ', 'ませ'].some((neg) => text.includes(neg)) ||
      text.endsWith('ん') ||
      text.endsWith('ず'))
  ) {
    // Idioms are keyed under ない, so 一筋縄では+いかん must be retried as いかない.
    const negForm: Record<string, string> = {
      する: 'しない',
      いく: 'いかない',
      行く: 'いかない',
      なる: 'ならない',
      くる: 'こない',
      来る: 'こない',
    };
    result = tryForm(negForm[dictForm] ?? 'ない');
    if (result) return result;
  }

  // ねぇ/ねー is never a key (ろくでも+ねぇ), so retry with ない; Sudachi normalizes these to 無い.
  if (
    (verb.cls === 'IAdjective' || verb.n === '無い' || verb.n === 'ない') &&
    dictForm.length >= 2 &&
    ['ねぇ', 'ねえ', 'ねー'].some((tail) => dictForm.endsWith(tail))
  ) {
    result = tryForm(`${dictForm.slice(0, -2)}ない`);
    if (result) return result;
  }

  if (dictForm !== text && text.length > dictForm.length) {
    const forms = deconj(ctx, text);
    const intermediates = forms.flatMap((form) =>
      form.seenText.filter((seen) => seen.length > dictForm.length && seen.length < text.length),
    );
    for (const form of byLengthDesc(intermediates)) {
      result = tryForm(form);
      if (result) return result;
    }
    const isVerbEnding = (form: string) => DICTIONARY_VERB_ENDINGS.has(form.at(-1) as string);
    const shortBases = forms
      .map((form) => form.text)
      .filter((form) => form.length >= 3 && form.length < dictForm.length && isVerbEnding(form));
    for (const form of byLengthDesc(shortBases)) {
      result = tryForm(form);
      if (result) return result;
    }
    const altBases = forms
      .map((form) => form.text)
      .filter(
        (form) => form && form !== dictForm && form.length <= dictForm.length && form.length >= 2 && isVerbEnding(form),
      );
    for (const form of byLengthDesc(altBases)) {
      result = tryForm(form);
      if (result) return result;
    }
  }

  if (dictForm === text) {
    if (verb.cls === 'Verb' && verb.n && verb.n !== dictForm) {
      result = tryForm(verb.n);
      if (result) return result;
      const hiraganaNorm = toHiragana(verb.n);
      if (hiraganaNorm !== verb.n) {
        result = tryForm(hiraganaNorm);
        if (result) return result;
      }
    }
    if (!['Noun', 'CommonNoun', 'Name'].includes(verb.cls)) {
      const kana = toHiragana(text);
      if ([...text].some((char) => isKanji(char)) && !DICTIONARY_VERB_ENDINGS.has(kana.at(-1) as string)) {
        const texts = [...new Set(deconj(ctx, text).map((form) => form.text))]
          .filter((form) => form && form !== dictForm)
          .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
        for (const form of texts) {
          result = tryForm(form);
          if (result) return result;
        }
      }
    }
  }

  return null;
}

/**
 * A window of up to five groups ending at a verb, adjective, noun or expression, whose texts with the anchor in a
 * dictionary spelling make a JMdict entry: 手|に|入って → 手に入って (手に入る), その|ため → そのため. Scans right
 * to left, as `CombineCompounds` does; noun anchors only form expressions.
 */
export function combineCompounds(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const reversed: Group[] = [];
  let changed = false;

  for (let i = groups.length - 1; i >= 0; i--) {
    const word = groups[i] as Group;
    // Na-adjectives anchor expression windows only (見るも無残), like nouns; plain compounds would over-merge.
    if (
      ['Verb', 'IAdjective', 'Expression', 'Suffix', 'Noun', 'CommonNoun', 'Name', 'NaAdjective'].includes(word.cls)
    ) {
      const nounTrigger = ['Noun', 'CommonNoun', 'Name', 'NaAdjective'].includes(word.cls);
      let match = matchCompounds(groups, i, nounTrigger, ctx);
      // Hard pins are never swallowed (ぶん in ４分の１ ≠ ４分); soft pins stay absorbable (臆病風に吹かれる).
      if (match && groups.slice(match.start, i + 1).some(hardPinned)) match = null;
      if (match) {
        reversed.push(
          span(groups, match.start, i + 1, {
            d: match.dictionaryForm,
            n: match.dictionaryForm,
            cls: 'Expression',
            flags: merged('CombineCompounds'),
          }),
        );
        changed = true;
        i = match.start;
        continue;
      }
    }
    reversed.push(word);
  }

  return changed ? reversed.reverse() : groups;
}

const isCohesiveFunctionWord = (ctx: CombineContext, text: string) =>
  hasClassAny(ctx, text, ['aux', 'adv', 'conj', 'prt', 'exp']);

/** Rejects merges stealing a neighbour's token: a name's honorific (ヴァレリア様|に言わせれば) or だ of だろう.
 * `IsExpressionBoundaryTheft`. */
function isBoundaryTheft(groups: readonly Group[], start: number, size: number, ctx: CombineContext): boolean {
  const first = groups[start] as Group;
  const before = groups[start - 1];
  if (before && HONORIFIC_SUFFIXES.has(first.s) && ['Noun', 'CommonNoun', 'Pronoun'].includes(before.cls)) return true;
  const next = groups[start + size];
  if (next && !['Particle', 'Auxiliary', 'SupplementarySymbol'].includes(next.cls)) {
    if (isCohesiveFunctionWord(ctx, (groups[start + size - 1] as Group).s + next.s)) return true;
  }
  return false;
}

const PREDICATE_CLASSES = ['Verb', 'IAdjective', 'Auxiliary'];

/** The whitelisted two-group units, with the upstream blocks. */
function matchPair(groups: readonly Group[], i: number, ctx: CombineContext): string | null {
  const pair = concatText(groups, i, 2);
  if (TWO_TOKEN_EXPRESSION_WHITELIST.has(pair)) {
    // The conjunction とはいえ never continues into ない (とは言えない).
    const after = groups[i + 2];
    const blockedByNegation =
      (pair === 'とはいえ' || pair === 'とは言え') &&
      after !== undefined &&
      ['ない', 'ません', 'ん', 'なかった'].includes(after.s);
    // いいや = "nope" only clause-initially; 天気もいいや is いい+や.
    const blockedNonInitial = pair === 'いいや' && i > 0;
    // Rhetorical ものか follows a predicate (負ける、ものか); after a nominal it's もの+か (どのようなものか).
    let blockedMonoKa = false;
    if (pair === 'ものか' || pair === 'もんか') {
      let p = i - 1;
      while (p >= 0 && ['SupplementarySymbol', 'Symbol', 'BlankSpace'].includes((groups[p] as Group).cls)) p--;
      blockedMonoKa = !(p >= 0 && PREDICATE_CLASSES.includes((groups[p] as Group).cls));
    }
    if (!blockedByNegation && !blockedNonInitial && !blockedMonoKa && !isBoundaryTheft(groups, i, 2, ctx)) return pair;
    return null;
  }
  const idiom = TWO_TOKEN_NOUN_VERB_IDIOMS.get(`${(groups[i] as Group).s}\u0000${(groups[i + 1] as Group).d}`);
  if (idiom && !isBoundaryTheft(groups, i, 2, ctx)) return idiom;
  return null;
}

/** A window of three to eight groups, holding a particle, that is a JMdict expression (or multi-word adverb, or a
 * three-group particle/conjunction/auxiliary cluster) as written or with its last verb in a dictionary form. */
function matchLongWindow(groups: readonly Group[], i: number, size: number, ctx: CombineContext): string | null {
  const window = groups.slice(i, i + size);
  if (!window.some((w) => w.cls === 'Particle')) return null;

  const combined = concatText(groups, i, size);
  if (excluded(combined)) return null;
  let matched: string | null = null;
  if (
    ctx.lexicon.hasClass(combined, 'exp') ||
    ctx.lexicon.hasClass(combined, 'adv') ||
    (size === 3 && hasClassAny(ctx, combined, ['prt', 'conj', 'aux']))
  )
    matched = combined;

  if (!matched) {
    const last = window.at(-1) as Group;
    const prefix = concatText(groups, i, size - 1);
    if ((last.cls === 'Verb' || last.cls === 'IAdjective') && last.d && last.d !== last.s) {
      if (ctx.lexicon.hasClass(prefix + last.d, 'exp')) matched = prefix + last.d;
      // DictionaryForm skips to the base (取られ → 取る), missing entries like 呆気に取られる.
      if (!matched && size <= 4) {
        for (const form of deconj(ctx, last.s)) {
          if (form.process.length > 2 || form.text === last.s || form.text === last.d) continue;
          if (ctx.lexicon.hasClass(prefix + form.text, 'exp')) {
            matched = prefix + form.text;
            break;
          }
        }
      }
    } else if (last.cls === 'Verb' && last.d === 'なくなる') {
      // Sudachi lexicalises なくなる as its own verb, so 元も子もなくなる needs its ない tail rebuilt.
      if (ctx.lexicon.hasClass(`${prefix}ない`, 'exp')) matched = `${prefix}ない`;
    }
  }

  // The completion paths rebuild the text (好まない → ことを好む) past the surface exclusion check.
  if (!matched || excluded(matched) || isBoundaryTheft(groups, i, size, ctx)) return null;
  return matched;
}

/**
 * Left to right, the longest window of up to eight groups that is a JMdict expression (に|とっ|て, 元|も|子|も
 * |なくなる), a whitelisted pair (どちら|も), or an adverb + と that JMdict lists (ぱっ|と).
 * `CombineExpressions` / `CombineExpressionsInSentence`.
 */
export function combineExpressions(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 3) return groups;
  const out: Group[] = [];
  let changed = false;
  let i = 0;

  while (i < groups.length) {
    let best = 1;
    let matchedText: string | null = null;

    for (let size = Math.min(8, groups.length - i); size >= 2; size--) {
      if (groups.slice(i, i + size).some(isSymbol)) continue;
      const matched = size === 2 ? matchPair(groups, i, ctx) : matchLongWindow(groups, i, size, ctx);
      if (matched) {
        best = size;
        matchedText = matched;
        break;
      }
    }

    const next = groups[i + 1];
    if (best === 1 && next && next.s === 'と' && next.cls === 'Particle') {
      const adverb = `${(groups[i] as Group).s}と`;
      if (ctx.lexicon.hasClass(adverb, 'adv')) {
        best = 2;
        matchedText = adverb;
      }
    }

    if (best > 1 && matchedText) {
      out.push(
        span(groups, i, i + best, {
          d: matchedText,
          n: matchedText,
          cls: 'Expression',
          flags: merged('CombineExpressions'),
        }),
      );
      changed = true;
      i += best;
    } else {
      out.push(groups[i] as Group);
      i++;
    }
  }

  return changed ? out : groups;
}

const isVolitionalSurface = (text: string) =>
  text.length >= 2 && text.endsWith('う') && 'おこそとのほもよろごぞどぼぽょ'.includes(text.at(-2) as string);

/** X的+に, curated X+に/でも pairs, noun+ほど and と+したら that JMdict lists as adverbs or conjunctions (具体的|に,
 * 山|ほど). `CombineLexicalAdverbs`. */
export function combineLexicalAdverbs(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  const via = { via: 'CombineLexicalAdverbs' };

  for (let i = 0; i < groups.length; i++) {
    const word = groups[i] as Group;
    const next = groups[i + 1];
    if (!next) {
      out.push(word);
      continue;
    }
    const text = word.s + next.s;

    // としたら is suppositional (ためだとしたら) except after a volitional, where it's とする "try to" (押そうとしたら).
    if (
      word.s === 'と' &&
      word.cls === 'Particle' &&
      ['したら', 'すれば', 'すると'].includes(next.s) &&
      (next.d === 'する' || next.d === '為る') &&
      !(i > 0 && isVolitionalSurface((groups[i - 1] as Group).s)) &&
      ctx.lexicon.hasClass(text, 'conj')
    ) {
      out.push(span(groups, i, i + 2, { d: text, n: text, cls: 'Conjunction', flags: via }));
      changed = true;
      i++;
      continue;
    }

    if (['Noun', 'CommonNoun', 'NaAdjective', 'NominalAdjective'].includes(word.cls)) {
      const isNiPair =
        next.s === 'に' && (next.cls === 'Particle' || next.cls === 'Auxiliary') && word.s.endsWith('的');
      const isCuratedPair = (next.s === 'に' || next.s === 'でも') && LEXICALIZED_ADVERB_PAIRS.has(text);
      const isHodoPair = next.s === 'ほど' && next.cls === 'Particle';
      // 先に tails always merge (一足先に); には only clause-initially, since mid-clause it's case+topic (その時には).
      const isSakiNiPair = next.s === '先に';
      const before = groups[i - 1];
      const isNiwaPair =
        next.s === 'には' &&
        next.cls === 'Particle' &&
        (i === 0 || ['Symbol', 'SupplementarySymbol', 'BlankSpace'].includes((before as Group).cls));
      if (
        (isNiPair || isCuratedPair || isHodoPair || isSakiNiPair || isNiwaPair) &&
        ctx.lexicon.hasClass(text, 'adv')
      ) {
        out.push(span(groups, i, i + 2, { d: text, n: text, cls: 'Adverb', flags: via }));
        changed = true;
        i++;
        continue;
      }
    }

    out.push(word);
  }

  return changed ? out : groups;
}
