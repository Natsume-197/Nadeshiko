import type { DeconjugatedForm } from '../deconjugator';
import type { Morpheme } from '../sudachi';
import type { Lexicon } from './lexicon';

/** What a group is to a reader; the same vocabulary as `SlimToken.kind`. */
export type GroupKind = 'word' | 'compound' | 'inflected' | 'counter' | 'function' | 'expression' | 'symbol';

/**
 * The `PartOfSpeech` enum, the coarse class every stage reads and rewrites.
 * Sudachi's first POS field maps to it through {@link classOf}; stages then change it as groups form (a suru-noun
 * becomes a Verb, a particle cluster an Expression). `Name` and `CommonNoun` never come from Sudachi directly.
 */
export type WordClass =
  | 'Noun'
  | 'Verb'
  | 'IAdjective'
  | 'NaAdjective'
  | 'Adverb'
  | 'Particle'
  | 'Conjunction'
  | 'Auxiliary'
  | 'Interjection'
  | 'Symbol'
  | 'Prefix'
  | 'Filler'
  | 'Pronoun'
  | 'Suffix'
  | 'CommonNoun'
  | 'SupplementarySymbol'
  | 'BlankSpace'
  | 'Expression'
  | 'NominalAdjective'
  | 'PrenounAdjectival'
  | 'Numeral'
  | 'Counter'
  | 'Name'
  | 'Unknown'
  // The upstream enum also has these; nothing here produces them, but copied rewrite rows test for them.
  | 'NounSuffix'
  | 'Adnominal';

/**
 * One word as Nadeshiko shows it: one or more adjacent Sudachi morphemes. The first group of fields is the output;
 * `n`, `cls`, `sec` and `flags` are the working state of `WordInfo` that the stages read and rewrite.
 */
export interface Group {
  /** Surface: the members' surfaces concatenated, which is the sentence between `b` and `e`. */
  s: string;
  /** Code-point offsets into the sentence, like {@link Morpheme}. */
  b: number;
  e: number;
  /** Katakana reading: the members' readings concatenated. */
  r: string;
  /** Dictionary form of the whole group: the base for inflected groups, the matched entry for expressions. */
  d: string;
  /** The head morpheme's six UniDic POS fields. */
  pos: Morpheme['pos'];
  /** The original split-mode-B morphemes, in order. Upstream drops these when it merges; we keep them for `parts`. */
  members: Morpheme[];
  kind: GroupKind;
  /** The deconjugation that leads from `s` to `d`, when the group is conjugated; else null. */
  deconjugation: DeconjugatedForm | null;

  /** Normalised form (`NormalizedForm`). */
  n: string;
  /** Coarse word class (`PartOfSpeech`). */
  cls: WordClass;
  /** POS sections 1-3 as UniDic labels (`PartOfSpeechSection1..3`); a stage may clear one to `*`. */
  sec: readonly [string, string, string];
  flags: GroupFlags;
}

export interface GroupFlags {
  /** Merged by an inflection stage (`IsMergedInflection`, set more widely here because it drives `kind`). */
  inflected?: boolean;
  /** A suffix that ReclassifyOrphanedSuffixes turned into a noun or verb (`WasReclassifiedFromSuffix`). */
  reclassifiedSuffix?: boolean;
  /** The stage that last merged this group, which decides its kind for the dictionary-window stages. */
  via?: string;
  /** A kind a stage settled itself; AssignKinds keeps it. */
  kind?: GroupKind;
  /** The JMdict word a disambiguation stage settled (`PreMatchedWordId`); its reading is final, so
   * LinkReadings leaves it alone. */
  pin?: number;
  /** `HardPinned`: the pin is a final word decision, so the compound passes must not swallow the group. */
  hardPin?: boolean;
}

/** What a stage may consult. Upstream asks the dictionary through callbacks; `lexicon` is our equivalent. */
export interface CombineContext {
  lexicon: Lexicon;
  /** The deconjugator; callers pass `deconjugate` from `../deconjugator` (tests may pass a stub). */
  deconjugate: (text: string) => readonly DeconjugatedForm[];
  /** Called after every stage that ran, with the groups it returned. */
  debug?: (stage: string, groups: readonly Group[]) => void;
}

export type StageFn = (groups: Group[], ctx: CombineContext) => Group[];

/** Token features that gate a stage, as in `TokenFeatures` (only the ones our stages use). */
export type Feature =
  | 'Prefix'
  | 'Suffix'
  | 'InflectableBase'
  | 'DictKiru'
  | 'NumericAmount'
  | 'EndsWithTsu'
  | 'AuxVerbStem'
  | 'ConjParticle'
  | 'AdvParticle';

export interface Stage {
  /** The upstream method name, which is also ours. */
  name: string;
  /** Which group of upstream stages it ports, or '(ours)'. */
  origin: string;
  /** Skipped when no group has this feature, as `RunPipeline` does. */
  requires?: Feature;
  run: StageFn;
}
