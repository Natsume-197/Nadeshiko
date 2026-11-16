/*
 * Inflection labels for the word card: turns the deconjugator's `process` (the rules' `detail` strings, outermost
 * first; see ./deconjugator) into `SlimToken.inflection.labels`, outermost first, in the card's fixed vocabulary.
 */

/** What one `detail` becomes. `consumesNext` swallows the next non-empty step (e.g. "contracted" ちゃう already says
 * what the "finish/completely/end up" step under it would). */
interface Resolved {
  labels: readonly string[];
  consumesNext?: boolean;
}

interface StepContext {
  /** The token's surface, when known; used only where the detail alone is ambiguous. */
  surface: string;
  /** The next non-empty step in `process`, if any. */
  next: string | undefined;
  /** True for the first non-empty step, i.e. the outermost inflection. */
  outermost: boolean;
}

type Mapping = readonly string[] | ((context: StepContext) => readonly string[] | Resolved);

const PROGRESSIVE = ['progressive'];
const COMPLETIVE_SHIMAU = ['completive (〜しまう)'];
const CONDITIONAL_CONTRACTION = 'conditional contraction (〜ゃ)';

/** The step after "contracted" names which contraction it is. */
const contracted = ({ surface, next }: StepContext): Resolved => {
  if (next === 'finish/completely/end up') {
    const chimau = /[ちじ]ま/.test(surface);
    return { labels: [chimau ? 'completive (〜ちまう)' : 'completive (〜ちゃう)'], consumesNext: true };
  }
  if (next === 'topic/condition') {
    return { labels: [/じゃ/.test(surface) ? 'contracted (〜じゃ)' : 'contracted (〜ちゃ)'], consumesNext: true };
  }
  if (next === 'provisional conditional') return { labels: [CONDITIONAL_CONTRACTION], consumesNext: true };
  // Not followed by its usual step (never seen in practice): fall back on the ending.
  if (/[ちじ]ま/.test(surface)) return { labels: ['completive (〜ちまう)'] };
  if (/[けき]ゃ$/.test(surface)) return { labels: [CONDITIONAL_CONTRACTION] };
  return { labels: ['completive (〜ちゃう)'] };
};

/** りゃ, てりゃ: the provisional ば they contract is said by the label itself. */
const conditionalContraction = ({ next }: StepContext): Resolved => ({
  labels: [CONDITIONAL_CONTRACTION],
  consumesNext: next === 'provisional conditional',
});

/**
 * Every distinct `detail` in ./deconjugator/rules.json and the card labels it becomes. Parenthesised details are the
 * deconjugator's internal stems: they say nothing unless they are the outermost step (食べて, 食べ, 高く).
 */
export const DETAIL_LABELS: Readonly<Record<string, Mapping>> = {
  '': [],

  // Internal stems: shown only when the word stops there.
  '(te form)': ({ outermost, next, surface }) => {
    if (!outermost) return [];
    if (next === 'negative' && surface.endsWith('ないで'))
      return { labels: ['negative (〜ないで)'], consumesNext: true };
    return ['te-form'];
  },
  '(infinitive)': ({ outermost }) => (outermost ? ['continuative'] : []),
  '(adverbial stem)': ({ outermost }) => (outermost ? ['adverbial (〜く)'] : []),
  '(unstressed infinitive)': [],
  '(izenkei)': [],
  "('a' stem)": [],
  '(mizenkei)': [],
  '(suru verb noun stem)': [],
  '(ka stem)': [],
  '(ke stem)': [],
  '(stem)': [],

  // Plain forms
  past: ['past'],
  negative: ({ outermost, surface }) => (outermost && surface.endsWith('ざる') ? ['negative (〜ざる)'] : ['negative']),
  volitional: ['volitional'],
  'shortened volitional': ['volitional'],
  presumptive: ['volitional'],
  imperative: ['imperative'],
  potential: ['potential'],
  passive: ['passive'],
  'passive/potential': ['potential / passive'],
  causative: ['causative'],
  'short causative': ['short causative'],
  want: ['desiderative (〜たい)'],
  'classical attributive': ['attributive (〜き)'],

  // Polite
  polite: ['polite'],
  'past polite': ['past', 'polite'],
  'negative polite': ['negative', 'polite'],
  'past negative polite': ['past', 'negative', 'polite'],
  'negative polite (classical ぬ)': ['negative (〜ぬ)', 'polite'],
  'formal negative': ['negative', 'polite'],
  'formal negative past': ['past', 'negative', 'polite'],
  'te polite': ['te-form', 'polite'],
  'polite volitional': ['volitional', 'polite'],
  'polite volitional (kansaiben)': ['volitional', 'polite', 'kansai dialect'],
  'polite (childish)': ['polite'],
  'polite request': ['polite request (〜てください)'],
  'polite command': ['polite imperative (〜なさい)'],
  'kind request': ['polite imperative (〜なさい)'],
  'casual kind request': ['polite imperative (〜なさい)'],

  // Conditionals
  conditional: ['conditional (〜たら)'],
  'formal conditional': ['conditional (〜たら)'],
  'provisional conditional': ['provisional (〜ば)'],
  'classical hypothetical conditional': ['provisional (〜ば)'],
  'negative conditional': ['negative conditional (〜ねば)'],
  'colloquial negative conditional': ['negative conditional (〜ねば)'],
  'contracted conditional (te-ireba)': conditionalContraction,
  'contracted conditional (-reba)': conditionalContraction,
  'topic/condition': ['te-form'],

  // Negatives
  // んない/らんない rewrite to ない and leave the "negative" step to follow; ねえ is the negative itself.
  'slang negative': ({ next }) => (next === 'negative' ? ['n-slang'] : ['slang (〜え)', 'negative']),
  'slang negative (shirenai)': ['n-slang'],
  'slurred negative': ['negative (〜ん)'],
  'negative (classical)': ['negative (〜ん)'],
  'negative (kansaiben)': ['negative', 'kansai dialect'],
  'negative past (kansaiben)': ['past', 'negative', 'kansai dialect'],
  'adverbial negative': ['negative (〜ず)'],
  'without doing so': ['negative (〜ず)'],
  'remain without doing': ['progressive', 'negative (〜ず)'],
  'archaic negative': ['negative (〜ぬ)'],
  'archaic negative presumptive': ['volitional', 'negative (〜ぬ)'],
  'slurred negative conditional': ['n-slang'],
  'slang negative conditional': ['n-slang'],
  mai: ['negative volitional (〜まい)'],
  'negative volition/conjecture': ['negative volitional (〜まい)'],
  'negative appearance': ['looks like (〜そう)', 'negative'],

  // Auxiliaries after the te-form
  teiru: PROGRESSIVE,
  'teru (teiru)': PROGRESSIVE,
  teoru: PROGRESSIVE,
  'toru (teoru)': PROGRESSIVE,
  tearu: ['resultant state (〜てある)'],
  temiru: ['attempt (〜てみる)'],
  teiku: ['progression away (〜ていく)'],
  'teku (teiku)': ['progression away (〜ていく)'],
  tekuru: ['progression toward (〜てくる)'],
  'for now': ['preparatory (〜おく)'],
  'toku (for now)': ['preparatory (〜おく)'],
  'finish/completely/end up': COMPLETIVE_SHIMAU,
  contracted,
  dialectal: ['kansai dialect'],
  'do for someone': ['doing for someone (〜てあげる)'],
  'do for someone (casual)': ['doing for someone, plain (〜てやる)'],
  'do for someone (humble)': ['doing for someone (〜てあげる)'],
  'do for me': ['done for me (〜てくれる)'],
  'have someone do': ['having someone do (〜てもらう)'],
  'have someone do (humble)': ['having someone do, humble (〜ていただく)'],
  'honorific receive': ['done for me, honorific (〜てくださる)'],
  'contracted -te yarou (kansaiben)': ['volitional', 'doing for someone, plain (〜てやる)', 'kansai dialect'],

  // Other auxiliaries
  'too much': ['excessive (〜過ぎる)'],
  excess: ['excessive (〜過ぎる)'],
  seemingness: ['looks like (〜そう)'],
  hearsay: ['looks like (〜そう)'],
  seeming: ['appearance (〜げ)'],
  garu: ['showing signs (〜がる)'],
  'noun form': ['nominalization (〜さ)'],
  while: ['simultaneous (〜ながら)'],
  tari: ['representative (〜たり)'],

  // Slang and slurs
  slurred: ['n-slang'],
  'slang (ee/ii)': ['slang (〜え)'],
  'slang (irregular)': ['slang (〜え)'],
  'rustic i->e slur (kudasai)': ['slang (〜え)', 'polite request (〜てください)'],
};

/** The card's labels for a deconjugation `process`, outermost first. Unknown details are skipped. */
export function inflectionLabels(process: readonly string[], surface = ''): string[] {
  const steps = process.filter((step) => step !== '');
  const labels: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const mapping = DETAIL_LABELS[steps[i] ?? ''];
    if (mapping === undefined) continue;
    const resolved =
      typeof mapping === 'function' ? mapping({ surface, next: steps[i + 1], outermost: i === 0 }) : mapping;
    const { labels: stepLabels, consumesNext } = isResolved(resolved)
      ? resolved
      : { labels: resolved, consumesNext: false };
    for (const label of stepLabels) if (labels.at(-1) !== label) labels.push(label);
    if (consumesNext) i++;
  }
  return labels;
}

function isResolved(value: readonly string[] | Resolved): value is Resolved {
  return !Array.isArray(value);
}
