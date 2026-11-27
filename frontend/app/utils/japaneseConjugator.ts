import type { DictionaryWord } from './wordCard';

export interface ConjugatedForm {
  stem: string;
  ending: string;
  full: string;
}

export type ConjugationRowKey =
  | 'nonPast'
  | 'past'
  | 'te'
  | 'continuative'
  | 'volitional'
  | 'imperative'
  | 'potential'
  | 'passive'
  | 'causative'
  | 'causativePassive'
  | 'provisional'
  | 'conditional'
  | 'alternative'
  | 'adverbial';

export type ConjugationGroupKey = 'basics' | 'volitionCommand' | 'voiceCausation' | 'conditionals';

export type ConjugationClassKey = 'ichidan' | 'godan' | 'suru' | 'kuru' | 'iAdjective' | 'naAdjective';

export interface ConjugationRow {
  key: ConjugationRowKey;
  plainAff: ConjugatedForm | null;
  plainNeg: ConjugatedForm | null;
  politeAff: ConjugatedForm | null;
  politeNeg: ConjugatedForm | null;
}

export interface ConjugationGroup {
  key: ConjugationGroupKey;
  rows: ConjugationRow[];
}

export interface ConjugationTable {
  headword: string;
  reading: string;
  classKey: ConjugationClassKey;
  groups: ConjugationGroup[];
}

function form(stem: string, ending: string): ConjugatedForm {
  return { stem, ending, full: `${stem}${ending}` };
}

interface GodanRow {
  a: string;
  i: string;
  u: string;
  e: string;
  o: string;
  te: string;
  ta: string;
}

const GODAN: Record<string, GodanRow> = {
  う: { a: 'わ', i: 'い', u: 'う', e: 'え', o: 'お', te: 'って', ta: 'った' },
  く: { a: 'か', i: 'き', u: 'く', e: 'け', o: 'こ', te: 'いて', ta: 'いた' },
  ぐ: { a: 'が', i: 'ぎ', u: 'ぐ', e: 'げ', o: 'ご', te: 'いで', ta: 'いだ' },
  す: { a: 'さ', i: 'し', u: 'す', e: 'せ', o: 'そ', te: 'して', ta: 'した' },
  つ: { a: 'た', i: 'ち', u: 'つ', e: 'て', o: 'と', te: 'って', ta: 'った' },
  ぬ: { a: 'な', i: 'に', u: 'ぬ', e: 'ね', o: 'の', te: 'んで', ta: 'んだ' },
  ぶ: { a: 'ば', i: 'び', u: 'ぶ', e: 'べ', o: 'ぼ', te: 'んで', ta: 'んだ' },
  む: { a: 'ま', i: 'み', u: 'む', e: 'め', o: 'も', te: 'んで', ta: 'んだ' },
  る: { a: 'ら', i: 'り', u: 'る', e: 'れ', o: 'ろ', te: 'って', ta: 'った' },
};

function buildVerbGroups(opts: {
  stem: string;
  nonPast: string;
  negStem: string;
  masuStem: string;
  past: string;
  te: string;
  volitional: string;
  imperative: string;
  potentialStem: string;
  passiveStem: string;
  causativeStem: string;
  causativePassiveStem: string;
  provisional: string;
  conditional: string;
  alternative: string;
  plainNegOverride?: ConjugatedForm;
  plainPastNegOverride?: ConjugatedForm;
  teNegOverride?: ConjugatedForm;
  provisionalNegOverride?: ConjugatedForm;
  conditionalNegOverride?: ConjugatedForm;
  alternativeNegOverride?: ConjugatedForm;
  politeImperativeNegOverride?: ConjugatedForm | null;
}): ConjugationGroup[] {
  const { stem } = opts;
  const plainNeg = opts.plainNegOverride ?? form(stem, `${opts.negStem}ない`);
  const plainPastNeg = opts.plainPastNegOverride ?? form(stem, `${opts.negStem}なかった`);
  const teNeg = opts.teNegOverride ?? form(stem, `${opts.negStem}なくて`);
  const provisionalNeg = opts.provisionalNegOverride ?? form(stem, `${opts.negStem}なければ`);
  const conditionalNeg = opts.conditionalNegOverride ?? form(stem, `${opts.negStem}なかったら`);
  const alternativeNeg = opts.alternativeNegOverride ?? form(stem, `${opts.negStem}なかったり`);
  const politeImperativeNeg =
    opts.politeImperativeNegOverride !== undefined
      ? opts.politeImperativeNegOverride
      : form(stem, `${opts.negStem}ないでください`);

  return [
    {
      key: 'basics',
      rows: [
        {
          key: 'nonPast',
          plainAff: form(stem, opts.nonPast),
          plainNeg,
          politeAff: form(stem, `${opts.masuStem}ます`),
          politeNeg: form(stem, `${opts.masuStem}ません`),
        },
        {
          key: 'past',
          plainAff: form(stem, opts.past),
          plainNeg: plainPastNeg,
          politeAff: form(stem, `${opts.masuStem}ました`),
          politeNeg: form(stem, `${opts.masuStem}ませんでした`),
        },
        {
          key: 'te',
          plainAff: form(stem, opts.te),
          plainNeg: teNeg,
          politeAff: form(stem, `${opts.masuStem}まして`),
          politeNeg: null,
        },
        {
          key: 'continuative',
          plainAff: form(stem, opts.masuStem),
          plainNeg: null,
          politeAff: null,
          politeNeg: null,
        },
      ],
    },
    {
      key: 'volitionCommand',
      rows: [
        {
          key: 'volitional',
          plainAff: form(stem, opts.volitional),
          plainNeg: form(stem, `${opts.nonPast}まい`),
          politeAff: form(stem, `${opts.masuStem}ましょう`),
          politeNeg: null,
        },
        {
          key: 'imperative',
          plainAff: form(stem, opts.imperative),
          plainNeg: form(stem, `${opts.nonPast}な`),
          politeAff: form(stem, `${opts.masuStem}なさい`),
          politeNeg: politeImperativeNeg,
        },
      ],
    },
    {
      key: 'voiceCausation',
      rows: [
        {
          key: 'potential',
          plainAff: form(stem, `${opts.potentialStem}る`),
          plainNeg: form(stem, `${opts.potentialStem}ない`),
          politeAff: form(stem, `${opts.potentialStem}ます`),
          politeNeg: form(stem, `${opts.potentialStem}ません`),
        },
        {
          key: 'passive',
          plainAff: form(stem, `${opts.passiveStem}る`),
          plainNeg: form(stem, `${opts.passiveStem}ない`),
          politeAff: form(stem, `${opts.passiveStem}ます`),
          politeNeg: form(stem, `${opts.passiveStem}ません`),
        },
        {
          key: 'causative',
          plainAff: form(stem, `${opts.causativeStem}る`),
          plainNeg: form(stem, `${opts.causativeStem}ない`),
          politeAff: form(stem, `${opts.causativeStem}ます`),
          politeNeg: form(stem, `${opts.causativeStem}ません`),
        },
        {
          key: 'causativePassive',
          plainAff: form(stem, `${opts.causativePassiveStem}る`),
          plainNeg: form(stem, `${opts.causativePassiveStem}ない`),
          politeAff: form(stem, `${opts.causativePassiveStem}ます`),
          politeNeg: form(stem, `${opts.causativePassiveStem}ません`),
        },
      ],
    },
    {
      key: 'conditionals',
      rows: [
        {
          key: 'provisional',
          plainAff: form(stem, opts.provisional),
          plainNeg: provisionalNeg,
          politeAff: null,
          politeNeg: null,
        },
        {
          key: 'conditional',
          plainAff: form(stem, opts.conditional),
          plainNeg: conditionalNeg,
          politeAff: form(stem, `${opts.masuStem}ましたら`),
          politeNeg: form(stem, `${opts.masuStem}ませんでしたら`),
        },
        {
          key: 'alternative',
          plainAff: form(stem, opts.alternative),
          plainNeg: alternativeNeg,
          politeAff: null,
          politeNeg: null,
        },
      ],
    },
  ];
}

function conjugateIchidan(word: string, code: string): ConjugationGroup[] | null {
  if (!word.endsWith('る')) return null;
  const stem = word.slice(0, -1);
  return buildVerbGroups({
    stem,
    nonPast: 'る',
    negStem: '',
    masuStem: '',
    past: 'た',
    te: 'て',
    volitional: 'よう',
    imperative: code === 'v1-s' ? '' : 'ろ',
    potentialStem: 'られ',
    passiveStem: 'られ',
    causativeStem: 'させ',
    causativePassiveStem: 'させられ',
    provisional: 'れば',
    conditional: 'たら',
    alternative: 'たり',
  });
}

function conjugateGodan(word: string, code: string): ConjugationGroup[] | null {
  const last = word.slice(-1);
  const row = GODAN[last];
  if (!row) return null;
  const stem = word.slice(0, -1);

  const isIku = code === 'v5k-s';
  const isAru = code === 'v5r-i' && (word === 'ある' || word === '有る' || word === '在る');
  const isV5aru = code === 'v5aru';
  const isV5us = code === 'v5u-s';

  const te = isIku ? 'って' : isV5us ? 'うて' : row.te;
  const ta = isIku ? 'った' : isV5us ? 'うた' : row.ta;
  const masuStem = isV5aru ? 'い' : row.i;
  const imperative = isV5aru ? 'い' : row.e;

  return buildVerbGroups({
    stem,
    nonPast: row.u,
    negStem: row.a,
    masuStem,
    past: ta,
    te,
    volitional: `${row.o}う`,
    imperative,
    potentialStem: row.e,
    passiveStem: `${row.a}れ`,
    causativeStem: `${row.a}せ`,
    causativePassiveStem: `${row.a}せられ`,
    provisional: `${row.e}ば`,
    conditional: `${ta}ら`,
    alternative: `${ta}り`,
    plainNegOverride: isAru ? form('', 'ない') : undefined,
    plainPastNegOverride: isAru ? form('', 'なかった') : undefined,
    teNegOverride: isAru ? form('', 'なくて') : undefined,
    provisionalNegOverride: isAru ? form('', 'なければ') : undefined,
    conditionalNegOverride: isAru ? form('', 'なかったら') : undefined,
    alternativeNegOverride: isAru ? form('', 'なかったり') : undefined,
    politeImperativeNegOverride: isAru ? null : undefined,
  });
}

function conjugateSuru(word: string, code: string): ConjugationGroup[] {
  // `vs` is a suru-noun like 卒業; `vs-i`/`vs-s` ends in する (e.g. する, 勉強する, 愛する).
  const isSpecial = code === 'vs-s';
  const stem = (code === 'vs-i' || isSpecial) && word.endsWith('する') ? word.slice(0, -2) : word;
  return buildVerbGroups({
    stem,
    nonPast: 'する',
    negStem: isSpecial ? 'さ' : 'し',
    masuStem: 'し',
    past: 'した',
    te: 'して',
    volitional: 'しよう',
    imperative: 'しろ',
    potentialStem: isSpecial ? 'せ' : 'でき',
    passiveStem: 'され',
    causativeStem: 'させ',
    causativePassiveStem: 'させられ',
    provisional: 'すれば',
    conditional: 'したら',
    alternative: 'したり',
  });
}

function conjugateKuru(word: string): ConjugationGroup[] | null {
  if (!word.endsWith('来る') && !word.endsWith('くる')) return null;
  const isKana = word.endsWith('くる');
  const prefix = word.slice(0, -2);
  const kanji = isKana ? '' : '来';

  if (isKana) {
    return buildVerbGroups({
      stem: prefix,
      nonPast: 'くる',
      negStem: 'こ',
      masuStem: 'き',
      past: 'きた',
      te: 'きて',
      volitional: 'こよう',
      imperative: 'こい',
      potentialStem: 'こられ',
      passiveStem: 'こられ',
      causativeStem: 'こさせ',
      causativePassiveStem: 'こさせられ',
      provisional: 'くれば',
      conditional: 'きたら',
      alternative: 'きたり',
    });
  }

  return buildVerbGroups({
    stem: `${prefix}${kanji}`,
    nonPast: 'る',
    negStem: '',
    masuStem: '',
    past: 'た',
    te: 'て',
    volitional: 'よう',
    imperative: 'い',
    potentialStem: 'られ',
    passiveStem: 'られ',
    causativeStem: 'させ',
    causativePassiveStem: 'させられ',
    provisional: 'れば',
    conditional: 'たら',
    alternative: 'たり',
  });
}

function conjugateIAdjective(word: string, code: string): ConjugationGroup[] | null {
  if (!word.endsWith('い')) return null;
  const isIi = code === 'adj-ix' && (word === 'いい' || word.endsWith('いい'));
  const stem = isIi ? `${word.slice(0, -2)}よ` : word.slice(0, -1);
  const nonPastStem = isIi ? word.slice(0, -2) : stem;
  const nonPastEnding = isIi ? 'いい' : 'い';

  return [
    {
      key: 'basics',
      rows: [
        {
          key: 'nonPast',
          plainAff: form(nonPastStem, nonPastEnding),
          plainNeg: form(stem, 'くない'),
          politeAff: form(nonPastStem, `${nonPastEnding}です`),
          politeNeg: form(stem, 'くないです'),
        },
        {
          key: 'past',
          plainAff: form(stem, 'かった'),
          plainNeg: form(stem, 'くなかった'),
          politeAff: form(stem, 'かったです'),
          politeNeg: form(stem, 'くなかったです'),
        },
        {
          key: 'te',
          plainAff: form(stem, 'くて'),
          plainNeg: form(stem, 'くなくて'),
          politeAff: null,
          politeNeg: null,
        },
        {
          key: 'adverbial',
          plainAff: form(stem, 'く'),
          plainNeg: null,
          politeAff: null,
          politeNeg: null,
        },
      ],
    },
    {
      key: 'conditionals',
      rows: [
        {
          key: 'provisional',
          plainAff: form(stem, 'ければ'),
          plainNeg: form(stem, 'くなければ'),
          politeAff: null,
          politeNeg: null,
        },
        {
          key: 'conditional',
          plainAff: form(stem, 'かったら'),
          plainNeg: form(stem, 'くなかったら'),
          politeAff: null,
          politeNeg: null,
        },
        {
          key: 'alternative',
          plainAff: form(stem, 'かったり'),
          plainNeg: form(stem, 'くなかったり'),
          politeAff: null,
          politeNeg: null,
        },
      ],
    },
  ];
}

function conjugateNaAdjective(word: string): ConjugationGroup[] {
  const stem = word.endsWith('な') ? word.slice(0, -1) : word;
  return [
    {
      key: 'basics',
      rows: [
        {
          key: 'nonPast',
          plainAff: form(stem, 'だ'),
          plainNeg: form(stem, 'じゃない'),
          politeAff: form(stem, 'です'),
          politeNeg: form(stem, 'じゃありません'),
        },
        {
          key: 'past',
          plainAff: form(stem, 'だった'),
          plainNeg: form(stem, 'じゃなかった'),
          politeAff: form(stem, 'でした'),
          politeNeg: form(stem, 'じゃありませんでした'),
        },
        {
          key: 'te',
          plainAff: form(stem, 'で'),
          plainNeg: form(stem, 'じゃなくて'),
          politeAff: null,
          politeNeg: null,
        },
        {
          key: 'adverbial',
          plainAff: form(stem, 'に'),
          plainNeg: null,
          politeAff: null,
          politeNeg: null,
        },
      ],
    },
    {
      key: 'conditionals',
      rows: [
        {
          key: 'provisional',
          plainAff: form(stem, 'なら'),
          plainNeg: form(stem, 'じゃなければ'),
          politeAff: null,
          politeNeg: null,
        },
        {
          key: 'conditional',
          plainAff: form(stem, 'だったら'),
          plainNeg: form(stem, 'じゃなかったら'),
          politeAff: null,
          politeNeg: null,
        },
        {
          key: 'alternative',
          plainAff: form(stem, 'だったり'),
          plainNeg: form(stem, 'じゃなかったり'),
          politeAff: null,
          politeNeg: null,
        },
      ],
    },
  ];
}

/** Collects JMdict part-of-speech codes from a dictionary word. */
function posCodesOf(word: DictionaryWord): string[] {
  const codes: string[] = [];
  for (const entry of word.entries ?? []) {
    for (const sense of entry.senses ?? []) {
      for (const tag of sense.tags ?? []) {
        if (tag.category === 'partOfSpeech' && tag.code && !codes.includes(tag.code)) {
          codes.push(tag.code);
        }
      }
    }
  }
  return codes;
}

/**
 * Generates a full conjugation matrix for conjugable Japanese words (ichidan, godan, suru, kuru, i-adj, na-adj).
 * Returns `null` for non-conjugable words (plain nouns, adverbs, pronouns, particles, etc.).
 */
export function buildConjugationTable(word: DictionaryWord): ConjugationTable | null {
  const headword = word.headword;
  if (!headword) return null;
  const reading = word.reading ?? '';
  const codes = posCodesOf(word);

  for (const code of codes) {
    if (code === 'vk') {
      const groups = conjugateKuru(headword);
      if (groups) return { headword, reading, classKey: 'kuru', groups };
    }
    if (code === 'v1' || code === 'v1-s') {
      const groups = conjugateIchidan(headword, code);
      if (groups) return { headword, reading, classKey: 'ichidan', groups };
    }
    if (/^v5/.test(code)) {
      const groups = conjugateGodan(headword, code);
      if (groups) return { headword, reading, classKey: 'godan', groups };
    }
    if (code === 'vs' || code === 'vs-i' || code === 'vs-s') {
      return { headword, reading, classKey: 'suru', groups: conjugateSuru(headword, code) };
    }
    if (code === 'adj-i' || code === 'adj-ix') {
      const groups = conjugateIAdjective(headword, code);
      if (groups) return { headword, reading, classKey: 'iAdjective', groups };
    }
    if (code === 'adj-na') {
      return { headword, reading, classKey: 'naAdjective', groups: conjugateNaAdjective(headword) };
    }
  }

  return null;
}
