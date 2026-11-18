import type { Morpheme } from '../sudachi';
import { hasSection, SECTION, toGroups } from './group';
import { combineAmounts } from './stages/amounts';
import {
  combineAdverbialParticle,
  combineAuxiliary,
  combineAuxiliaryVerbStem,
  combineCompletionAuxVerb,
  combineConjunctiveParticle,
  combineToNaru,
  combineTte,
  combineVerbDependant,
} from './stages/auxiliaries';
import { combineInflections } from './stages/inflections';
import { applyContextPins, fixReadingAmbiguity } from './stages/disambiguation';
import { assignKinds } from './stages/kinds';
import { combineFinal, combineParticles, combineQuotativeToIu } from './stages/particles';
import { combinePrefixes } from './stages/prefixes';
import { combineCompounds, combineExpressions, combineLexicalAdverbs, combineNounCompounds } from './stages/sentence';
import { linkReadings, readAmounts } from './stages/readings';
import { applyCollocations, resolveOrphanDeverbalNoun } from './stages/forms';
import { repairEmphaticKanaSpelling, repairSplitMimeticAdverb, repairTeOkuRequest } from './stages/repairEmphatic';
import { repairNdaPastTense } from './stages/repairNda';
import {
  collapseReduplicatedMimetic,
  recombineHiraganaTokens,
  repairClippedAdjective,
  repairColloquialNegativeNee,
  repairColloquialRanNai,
  repairDanTobashi,
  repairFusedInterjectionParticle,
  repairHasaNoun,
  repairIntensifierKaeru,
  repairNounReadAsTeForm,
  repairOrphanedAuxiliary,
  repairQuotativeTte,
  repairSakkiMoraTheft,
  repairStolenUBeforeSsu,
  repairTankaToTaNKa,
  repairTteNani,
  repairVowelElongation,
} from './stages/repair';
import {
  applyTokenRewriteRulesCleanup,
  applyTokenRewriteRulesEarly,
  applyTokenRewriteRulesLate,
  applyTokenRewriteRulesReading,
} from './stages/rewrite';
import {
  splitCompoundAuxiliaryVerbs,
  splitDoushiteContraction,
  splitEmphaticMoSuru,
  splitLexicalisedKaratte,
  splitTanSuffix,
  splitTatteParticle,
  splitTawakeNoun,
  splitUnattestedToAdverbs,
  splitUnresolvableSuruCompounds,
} from './stages/split';
import { combineSuffix, reclassifyOrphanedSuffixes } from './stages/suffix';
import type { CombineContext, Feature, Group, Stage } from './types';

export { InMemoryLexicon, loadLexicon, type Lexicon, type LexClass, type WordForm, type WordReadings } from './lexicon';
export { fromMorpheme, toGroups } from './group';
export type { CombineContext, Group, GroupKind, Stage, WordClass } from './types';

const COMBINE = 'combine stages';
const PREPROCESS = 'sentence preprocessing (PreprocessSentences)';
const SPLIT = 'split stages';
const REPAIR = 'repair stages';
const DISAMBIGUATION = 'disambiguation stages (+ numeral disambiguation), reading rules only';
const REWRITE = 'rewrite rules';

/**
 * The stages in the upstream order (`BuildTokenStages`, then `Parser.PreprocessSentences`), with the upstream
 * feature gates on the combine stages (the split and repair stages test their own shapes; the gates there only skip
 * work). Left out of BuildTokenStages:
 * SplitOovGarbageTokens and RetokeniseOovBlobs (OCR blobs), SplitUnresolvableCompoundVerbs,
 * SplitUnresolvableRenyokeiNounCompounds and SplitUnresolvablePrefixedAdjectives (written-text OOV compounds),
 * ProcessSpecialCases, RepairInterjectionStemShred, RepairNounTsukuCompound, RecombinePartialKanaSpellings and the
 * candidate-position stages (RepairGeminateSuffixTheft, RepairKatakanaShreds, RepairCompoundBoundaryTheft,
 * RepairKanjiVerbShred), which need lookups we do not have (partial kana spellings, frequency ranks), and
 * RepairClassicalKiAdjective (classical Japanese). RepairNTokenisation is only its ん+だ/で past-tense part. The
 * disambiguation stages are reduced to the rules that settle a reading. ReadAmounts and LinkReadings then settle the
 * readings upstream takes from JMdict at lookup. RepairIntensifierKaeru stays although upstream dropped it: upstream
 * now gets のさばり|かえって from its resegmentation pass, which we do not have.
 */
export const STAGES: readonly Stage[] = [
  { name: 'SplitCompoundAuxiliaryVerbs', origin: SPLIT, run: splitCompoundAuxiliaryVerbs },
  { name: 'SplitTatteParticle', origin: SPLIT, run: splitTatteParticle },
  { name: 'SplitUnattestedToAdverbs', origin: SPLIT, run: splitUnattestedToAdverbs },
  { name: 'SplitTanSuffix', origin: SPLIT, run: splitTanSuffix },
  { name: 'SplitTawakeNoun', origin: SPLIT, run: splitTawakeNoun },
  { name: 'SplitLexicalisedKaratte', origin: SPLIT, run: splitLexicalisedKaratte },
  { name: 'SplitDoushiteContraction', origin: SPLIT, run: splitDoushiteContraction },
  { name: 'SplitEmphaticMoSuru', origin: SPLIT, run: splitEmphaticMoSuru },
  { name: 'RepairHasaNoun', origin: REPAIR, run: repairHasaNoun },
  { name: 'RepairNTokenisation', origin: `${REPAIR} (ん+だ/で only)`, run: repairNdaPastTense },
  { name: 'RepairVowelElongation', origin: REPAIR, run: repairVowelElongation },
  { name: 'ApplyTokenRewriteRulesEarly', origin: REWRITE, run: applyTokenRewriteRulesEarly },
  { name: 'RepairTeOkuRequest', origin: REPAIR, run: repairTeOkuRequest },
  { name: 'RepairColloquialNegativeNee', origin: REPAIR, run: repairColloquialNegativeNee },
  { name: 'RepairColloquialRanNai', origin: REPAIR, run: repairColloquialRanNai },
  { name: 'RepairIntensifierKaeru', origin: `${REPAIR} (kept: upstream dropped it)`, run: repairIntensifierKaeru },
  { name: 'RepairQuotativeTte', origin: REPAIR, run: repairQuotativeTte },
  { name: 'RepairNounReadAsTeForm', origin: REPAIR, run: repairNounReadAsTeForm },
  { name: 'RepairStolenUBeforeSsu', origin: REPAIR, run: repairStolenUBeforeSsu },
  { name: 'RecombineHiraganaTokens', origin: REPAIR, run: recombineHiraganaTokens },
  { name: 'ApplyTokenRewriteRulesLate', origin: REWRITE, run: applyTokenRewriteRulesLate },
  { name: 'RepairSakkiMoraTheft', origin: REPAIR, run: repairSakkiMoraTheft },
  { name: 'CollapseReduplicatedMimetic', origin: REPAIR, run: collapseReduplicatedMimetic },
  { name: 'RepairClippedAdjective', origin: REPAIR, run: repairClippedAdjective },
  { name: 'RepairSplitMimeticAdverb', origin: REPAIR, run: repairSplitMimeticAdverb },
  { name: 'RepairEmphaticKanaSpelling', origin: REPAIR, run: repairEmphaticKanaSpelling },
  { name: 'CombinePrefixes', origin: COMBINE, requires: 'Prefix', run: combinePrefixes },
  { name: 'CombineInflections', origin: COMBINE, requires: 'InflectableBase', run: combineInflections },
  { name: 'CombineCompletionAuxVerb', origin: COMBINE, requires: 'DictKiru', run: combineCompletionAuxVerb },
  { name: 'CombineAmounts', origin: COMBINE, requires: 'NumericAmount', run: combineAmounts },
  { name: 'CombineTte', origin: COMBINE, requires: 'EndsWithTsu', run: combineTte },
  { name: 'CombineAuxiliaryVerbStem', origin: COMBINE, requires: 'AuxVerbStem', run: combineAuxiliaryVerbStem },
  { name: 'CombineSuffix', origin: COMBINE, requires: 'Suffix', run: combineSuffix },
  { name: 'ReclassifyOrphanedSuffixes', origin: COMBINE, requires: 'Suffix', run: reclassifyOrphanedSuffixes },
  { name: 'CombineConjunctiveParticle', origin: COMBINE, requires: 'ConjParticle', run: combineConjunctiveParticle },
  { name: 'CombineAuxiliary', origin: COMBINE, run: combineAuxiliary },
  { name: 'CombineToNaru', origin: COMBINE, run: combineToNaru },
  { name: 'RepairFusedInterjectionParticle', origin: REPAIR, run: repairFusedInterjectionParticle },
  { name: 'RepairOrphanedAuxiliary', origin: REPAIR, run: repairOrphanedAuxiliary },
  { name: 'CombineAdverbialParticle', origin: COMBINE, requires: 'AdvParticle', run: combineAdverbialParticle },
  { name: 'CombineVerbDependant', origin: COMBINE, run: combineVerbDependant },
  { name: 'CombineParticles', origin: COMBINE, run: combineParticles },
  { name: 'CombineQuotativeToIu', origin: COMBINE, run: combineQuotativeToIu },
  { name: 'CombineFinal', origin: COMBINE, run: combineFinal },
  { name: 'SplitUnresolvableSuruCompounds', origin: SPLIT, run: splitUnresolvableSuruCompounds },
  { name: 'RepairTankaToTaNKa', origin: REPAIR, run: repairTankaToTaNKa },
  { name: 'RepairTteNani', origin: REPAIR, run: repairTteNani },
  { name: 'ApplyTokenRewriteRulesCleanup', origin: REWRITE, run: applyTokenRewriteRulesCleanup },
  { name: 'RepairDanTobashi', origin: REPAIR, run: repairDanTobashi },
  { name: 'ApplyContextPins', origin: DISAMBIGUATION, run: applyContextPins },
  { name: 'ApplyTokenRewriteRulesReading', origin: REWRITE, run: applyTokenRewriteRulesReading },
  { name: 'FixReadingAmbiguity', origin: DISAMBIGUATION, run: fixReadingAmbiguity },
  { name: 'CombineNounCompounds', origin: PREPROCESS, run: combineNounCompounds },
  { name: 'CombineCompounds', origin: PREPROCESS, run: combineCompounds },
  { name: 'CombineExpressions', origin: PREPROCESS, run: combineExpressions },
  { name: 'CombineLexicalAdverbs', origin: PREPROCESS, run: combineLexicalAdverbs },
  { name: 'ResolveOrphanDeverbalNoun', origin: 'form choice, deverbal-suffix rule', run: resolveOrphanDeverbalNoun },
  { name: 'ApplyCollocations', origin: '(ours)', run: applyCollocations },
  { name: 'ReadAmounts', origin: '(ours)', run: readAmounts },
  {
    name: 'LinkReadings',
    origin: '(ours, after FormReading)',
    run: linkReadings,
  },
  { name: 'AssignKinds', origin: '(ours)', run: assignKinds },
];

/** The features present in a sentence, as `TokenFeatureScanner.Scan` computes them (the subset we gate on). */
export function scanFeatures(groups: readonly Group[]): Set<Feature> {
  const features = new Set<Feature>();
  for (const group of groups) {
    if (group.cls === 'Prefix') features.add('Prefix');
    if (group.cls === 'Suffix' || hasSection(group, SECTION.Suffix)) features.add('Suffix');
    if (
      group.cls === 'Verb' ||
      group.cls === 'IAdjective' ||
      group.cls === 'NaAdjective' ||
      hasSection(group, SECTION.VerbLike) ||
      hasSection(group, SECTION.PossibleSuru) ||
      hasSection(group, SECTION.PossibleVerbSuruNoun)
    )
      features.add('InflectableBase');
    if (hasSection(group, SECTION.AuxiliaryVerbStem)) features.add('AuxVerbStem');
    if (hasSection(group, SECTION.ConjunctionParticle)) features.add('ConjParticle');
    if (hasSection(group, SECTION.Amount) || hasSection(group, SECTION.Numeral)) features.add('NumericAmount');
    if (hasSection(group, SECTION.AdverbialParticle)) features.add('AdvParticle');
    if (group.d === '切る') features.add('DictKiru');
    if (group.s.endsWith('っ') || group.s.endsWith('ッ')) features.add('EndsWithTsu');
    // The emphatic prefix ど arrives as Adverb (truncated どう); CombinePrefixes re-checks precisely.
    if (group.s === 'ど' && group.cls === 'Adverb') features.add('Prefix');
  }
  return features;
}

/** Runs `stages` over `groups` in order, skipping a gated stage when no group has its feature. */
export function runStages(groups: Group[], ctx: CombineContext, stages: readonly Stage[] = STAGES): Group[] {
  let current = groups;
  for (const stage of stages) {
    if (stage.requires && !scanFeatures(current).has(stage.requires)) continue;
    current = stage.run(current, ctx);
    ctx.debug?.(stage.name, current);
  }
  return current;
}

/** One sentence's morphemes grouped into the words Nadeshiko shows. */
export function combine(morphemes: readonly Morpheme[], ctx: CombineContext): Group[] {
  return runStages(toGroups(morphemes), ctx);
}
