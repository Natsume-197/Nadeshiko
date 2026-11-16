import type { DeconjugatedForm } from '../deconjugator';
import type { Morpheme } from '../sudachi';
import { deconjugationKey, normalizeLongVowels, toHiragana } from './kana';
import type { CombineContext, Group, GroupKind, WordClass } from './types';

/** Sudachi's first POS field to the coarse `PartOfSpeech`, as `PosMapper.FromSudachi` maps it. */
export function classOf(pos0: string): WordClass {
  switch (pos0) {
    case '名詞':
      return 'Noun';
    case '動詞':
      return 'Verb';
    case '形容詞':
      return 'IAdjective';
    case '形状詞':
      return 'NaAdjective';
    case '副詞':
      return 'Adverb';
    case '助詞':
      return 'Particle';
    case '接続詞':
      return 'Conjunction';
    case '助動詞':
      return 'Auxiliary';
    case '感動詞':
      return 'Interjection';
    case '記号':
      return 'Symbol';
    case '接頭詞':
    case '接頭辞':
      return 'Prefix';
    case 'フィラー':
      return 'Filler';
    case '代名詞':
      return 'Pronoun';
    case '接尾辞':
      return 'Suffix';
    case '補助記号':
      return 'SupplementarySymbol';
    case '空白':
      return 'BlankSpace';
    case '連体詞':
      return 'PrenounAdjectival';
    default:
      return 'Unknown';
  }
}

/**
 * UniDic labels of the `PartOfSpeechSection` values the stages test (`ToPartOfSpeechSection`). `非自立` and `数`
 * are IPADIC labels the mapping also covers; UniDic rarely emits them.
 */
export const SECTION = {
  Dependant: '非自立',
  PossibleDependant: '非自立可能',
  PossibleSuru: 'サ変可能',
  PossibleVerbSuruNoun: 'サ変形状詞可能',
  AuxiliaryVerbStem: '助動詞語幹',
  ConjunctionParticle: '接続助詞',
  AdverbialParticle: '副助詞',
  VerbLike: '動詞的',
  Numeral: '数詞',
  Amount: '数',
  Suffix: '接尾',
  PossibleNaAdjective: '形状詞可能',
  Adjectival: '形容詞的',
  NaAdjectiveLike: '形状詞的',
} as const;

const NAME_SECTIONS = new Set(['固有名詞', '人名', '姓', '組織', '地名', '地域', '国', '名']);

export function hasSection(group: Group, label: string): boolean {
  return group.sec[0] === label || group.sec[1] === label || group.sec[2] === label;
}

/** `PosMapper.IsNameLikeSudachiNoun`. */
export function isNameLike(group: Group): boolean {
  return group.cls === 'Noun' && group.sec.some((section) => NAME_SECTIONS.has(section));
}

export function isImperative(group: Group): boolean {
  return group.pos[5] === '命令形';
}

/** `PosMapper.IsInflectableBase`. */
export const isInflectableBase = (cls: WordClass) => cls === 'Verb' || cls === 'IAdjective' || cls === 'NaAdjective';
/** `PosMapper.IsInflectionPart`. */
export const isInflectionPart = (cls: WordClass) => cls === 'Auxiliary' || cls === 'Suffix' || cls === 'Particle';
/** `PosMapper.IsNounForCompounding`. */
export const isNounForCompounding = (cls: WordClass) =>
  cls === 'Noun' ||
  cls === 'Name' ||
  cls === 'CommonNoun' ||
  cls === 'NaAdjective' ||
  cls === 'Numeral' ||
  cls === 'Prefix' ||
  cls === 'Suffix';

export function baseKind(cls: WordClass): GroupKind {
  if (cls === 'SupplementarySymbol' || cls === 'BlankSpace' || cls === 'Symbol') return 'symbol';
  if (cls === 'Particle' || cls === 'Auxiliary') return 'function';
  return 'word';
}

export function fromMorpheme(morpheme: Morpheme): Group {
  const cls = classOf(morpheme.pos[0]);
  return {
    s: morpheme.s,
    b: morpheme.b,
    e: morpheme.e,
    r: morpheme.r,
    d: morpheme.d,
    pos: morpheme.pos,
    members: [morpheme],
    kind: baseKind(cls),
    deconjugation: null,
    n: morpheme.n,
    cls,
    sec: [morpheme.pos[1], morpheme.pos[2], morpheme.pos[3]],
    flags: {},
  };
}

/** One group per morpheme: the input every stage list starts from. */
export function toGroups(morphemes: readonly Morpheme[]): Group[] {
  return morphemes.map(fromMorpheme);
}

/** `head` extended by `tail` (`Text += next.Text; EndOffset = next.EndOffset; Reading += next.Reading`),
 * keeping the head's other fields unless `patch` overrides them. */
export function append(head: Group, tail: Group, patch: Partial<Group> = {}): Group {
  return {
    ...head,
    s: head.s + tail.s,
    e: tail.e,
    r: head.r + tail.r,
    members: [...head.members, ...tail.members],
    deconjugation: null,
    ...patch,
    flags: { ...head.flags, ...patch.flags },
  };
}

/** `lead` absorbed into the group after it, which stays the head (`new WordInfo(nextWord)` with the
 * prefix's text and start offset in front). */
export function prepend(lead: Group, head: Group, patch: Partial<Group> = {}): Group {
  return {
    ...head,
    s: lead.s + head.s,
    b: lead.b,
    r: lead.r + head.r,
    members: [...lead.members, ...head.members],
    deconjugation: null,
    ...patch,
    flags: { ...head.flags, ...patch.flags },
  };
}

/** `groups[start..end)` as one group headed by `groups[start]`. */
export function span(groups: readonly Group[], start: number, end: number, patch: Partial<Group> = {}): Group {
  let out = groups[start] as Group;
  for (let i = start + 1; i < end; i++) out = append(out, groups[i] as Group);
  return { ...out, ...patch, flags: { ...out.flags, ...patch.flags } };
}

export function concatText(groups: readonly Group[], start: number, count: number): string {
  let text = '';
  for (let i = start; i < start + count; i++) text += (groups[i] as Group).s;
  return text;
}

/** `HasCompoundLookup`: a lookup that also tries the long-vowel-normalised hiragana. */
export function known(ctx: CombineContext, text: string): boolean {
  if (!text) return false;
  return ctx.lexicon.has(text) || ctx.lexicon.has(normalizeLongVowels(toHiragana(text)));
}

/** `HasVerbOrAdjectiveLookup`. */
export function knownVerbOrAdjective(ctx: CombineContext, text: string): boolean {
  return ctx.lexicon.hasClass(text, 'verb') || ctx.lexicon.hasClass(text, 'adj-i');
}

export function deconj(ctx: CombineContext, text: string): readonly DeconjugatedForm[] {
  return ctx.deconjugate(deconjugationKey(text));
}

export const containsText = (forms: readonly DeconjugatedForm[], target: string) =>
  forms.some((form) => form.text === target);

/** `CompoundExistsInLookup`. */
export function compoundExists(ctx: CombineContext, text: string): boolean {
  if (known(ctx, text)) return true;
  return deconj(ctx, text).some((form) => known(ctx, form.text));
}

/** `DictionaryVerbEndings`. */
export const DICTIONARY_VERB_ENDINGS = new Set(['う', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'ぶ', 'む', 'る']);

/** `VerbDictFormExistsInLookup`. */
export function verbDictFormExists(ctx: CombineContext, dictForm: string, normalized: string): boolean {
  if (known(ctx, dictForm)) return true;
  if (normalized && normalized !== dictForm && known(ctx, normalized)) return true;
  return deconj(ctx, dictForm).some(
    (form) => form.text.length > 0 && DICTIONARY_VERB_ENDINGS.has(form.text.at(-1) as string) && known(ctx, form.text),
  );
}

/** `MergeAdjacentWhere`: folds each group into the one before it while `shouldMerge` holds. */
export function mergeAdjacentWhere(
  groups: Group[],
  shouldMerge: (current: Group, next: Group) => boolean,
  patch: Partial<Group> = {},
): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let current = groups[0] as Group;
  let changed = false;
  for (let i = 1; i < groups.length; i++) {
    const next = groups[i] as Group;
    if (shouldMerge(current, next)) {
      current = append(current, next, patch);
      changed = true;
    } else {
      out.push(current);
      current = next;
    }
  }
  out.push(current);
  return changed ? out : groups;
}
