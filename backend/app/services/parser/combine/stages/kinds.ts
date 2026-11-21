import { deconj, isSymbolClass } from '../group';
import { deconjugationKey } from '../kana';
import type { CombineContext, Group, GroupKind } from '../types';

const DICTIONARY_WINDOWS = new Set(['CombineCompounds', 'CombineExpressions']);

function kindOf(group: Group, ctx: CombineContext): GroupKind {
  if (isSymbolClass(group.cls)) return 'symbol';
  if (group.flags.kind) return group.flags.kind;
  const via = group.flags.via;
  if (via && DICTIONARY_WINDOWS.has(via)) return 'expression';
  if (via === 'CombineNounCompounds') return 'compound';
  if (group.cls === 'Expression' || group.pos[0] === '連語') return 'expression';

  const merged = group.members.length > 1;
  if (group.cls === 'Verb' || group.cls === 'IAdjective') {
    if (group.flags.inflected || group.s !== group.d) return 'inflected';
    return 'word';
  }
  if (group.flags.inflected && group.cls !== 'Auxiliary') return 'inflected';
  if (group.cls === 'Particle' || group.cls === 'Auxiliary') {
    // A particle cluster JMdict lists as an expression (には, では) is one; のに (prt only) stays a function word.
    if (merged && group.cls === 'Particle' && ctx.lexicon.hasClass(group.d, 'exp')) return 'expression';
    return 'function';
  }
  // Curated units CombineFinal and CombineLexicalAdverbs build: だから, 本当に, 何か.
  if (merged && via !== 'CombinePrefixes' && via !== 'CombineSuffix') {
    if (
      ['Conjunction', 'Adverb', 'Pronoun', 'NominalAdjective', 'PrenounAdjectival', 'Interjection'].includes(group.cls)
    )
      return 'expression';
  }
  return 'word';
}

/** The deconjugation from the surface to `d`, when there is one (食べました → 食べる via polite, past). */
function deconjugationOf(group: Group, ctx: CombineContext) {
  if (group.s === group.d || !group.d) return null;
  const target = deconjugationKey(group.d);
  return deconj(ctx, group.s).find((form) => form.text === target && form.process.length > 0) ?? null;
}

/**
 * Settles `kind` and `deconjugation` once grouping is done. Not an upstream stage: there `PartOfSpeech` and
 * `Conjugations` play this role later, at lookup.
 */
export function assignKinds(groups: Group[], ctx: CombineContext): Group[] {
  return groups.map((group) => {
    const kind = kindOf(group, ctx);
    // A rewrite rule may have recovered a chain against a kana lemma (返る via かえる) that this cannot find.
    const deconjugation = kind === 'symbol' ? null : (deconjugationOf(group, ctx) ?? group.deconjugation);
    return kind === group.kind && deconjugation === group.deconjugation ? group : { ...group, kind, deconjugation };
  });
}
