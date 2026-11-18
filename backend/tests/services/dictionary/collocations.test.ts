import { describe, expect, it } from 'vitest';
import type { SlimToken } from '@app/models/Segment';
import {
  type CollocationCounts,
  collocationRows,
  convertExternalCollocations,
  countCollocations,
  MIN_TOTAL,
  parseExternalCollocations,
  verbReading,
  type WordForms,
} from '@app/services/dictionary/collocations';
import { InMemoryLexicon } from '@app/services/parser/combine';
import { deconjugate } from '@app/services/parser/deconjugator';

const tok = (s: string, d: string, r: string, pt: string): SlimToken => ({ s, d, r, b: 0, e: 0, p: '', pt });

const lexicon = new InMemoryLexicon([]);
lexicon.addWord(1, [
  { text: '弾く', kana: false },
  { text: 'ひく', kana: true },
  { text: 'はじく', kana: true },
]);
lexicon.addWord(2, [
  { text: '引く', kana: false },
  { text: 'ひく', kana: true },
]);

const piano = (verb: SlimToken, particle = 'を') => [
  tok('ピアノ', 'ピアノ', 'ピアノ', 'noun'),
  tok(particle, particle, 'ヲ', 'prt'),
  verb,
];

describe('verbReading', () => {
  it('picks the reading the surface reading deconjugates to', () => {
    expect(verbReading(tok('弾いた', '弾く', 'ヒイタ', 'verb'), lexicon, deconjugate)).toBe('ひく');
    expect(verbReading(tok('弾いた', '弾く', 'ハジイタ', 'verb'), lexicon, deconjugate)).toBe('はじく');
    expect(verbReading(tok('弾く', '弾く', 'ヒク', 'verb'), lexicon, deconjugate)).toBe('ひく');
  });
});

describe('countCollocations and collocationRows', () => {
  it('keeps a clear winner over enough sentences', () => {
    const counts: CollocationCounts = new Map();
    for (let k = 0; k < 4; k++)
      countCollocations(piano(tok('弾いた', '弾く', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
    countCollocations(piano(tok('引いた', '引く', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
    expect(collocationRows(counts)).toEqual([
      { noun: 'ピアノ', particle: 'を', verb_kana: 'ひく', verb: '弾く', count: 4, total: 5 },
    ]);
  });

  it('drops a split or a thin group, and ignores kana verbs and non-collocation particles', () => {
    const counts: CollocationCounts = new Map();
    for (let k = 0; k < 2; k++) {
      countCollocations(piano(tok('弾いた', '弾く', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
      countCollocations(piano(tok('引いた', '引く', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
    }
    for (let k = 0; k < MIN_TOTAL - 1; k++)
      countCollocations(piano(tok('弾いた', '弾く', 'ヒイタ', 'verb'), 'が'), counts, lexicon, deconjugate);
    countCollocations(piano(tok('ひいた', 'ひく', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
    countCollocations(piano(tok('弾いた', '弾く', 'ヒイタ', 'verb'), 'の'), counts, lexicon, deconjugate);
    expect(collocationRows(counts)).toEqual([]);
    expect(counts.size).toBe(2);
  });
});

describe('external collocation table', () => {
  const tsv = [
    '# noun id, particle, picked verb id, verb id to prefer, bonus, note',
    '1600900\tを\t1591100\t1591110\t150\t話を + 効く -> 聞く (7119/7144)',
    '1600900\tは\t1591100\t1591110\t150\t話は + 効く -> 聞く (10/12)',
    '1600900\tの\t1591100\t1591110\t150\tnot a collocation particle',
    '9999999\tを\t1591100\t1591110\t150\tunknown noun (1/1)',
    '',
  ].join('\n');
  const words = new Map<number, WordForms>([
    [
      1600900,
      {
        forms: [
          { text: '話', kana: false },
          { text: '話し', kana: false },
          { text: 'はなし', kana: true },
        ],
      },
    ],
    [
      1591100,
      {
        forms: [
          { text: '効く', kana: false },
          { text: 'きく', kana: true },
        ],
      },
    ],
    [
      1591110,
      {
        forms: [
          { text: '聞く', kana: false },
          { text: '聴く', kana: false },
          { text: 'きく', kana: true },
        ],
      },
    ],
  ]);

  it('parses the rows and their evidence', () => {
    const rows = parseExternalCollocations(tsv);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      noun: 1600900,
      particle: 'を',
      rivalVerb: 1591100,
      targetVerb: 1591110,
      count: 7119,
      total: 7144,
    });
  });

  it('turns ids into spellings: every noun spelling, the shared reading, the first kanji spelling', () => {
    const rows = convertExternalCollocations(parseExternalCollocations(tsv), words);
    expect(rows.map((row) => `${row.noun}${row.particle}${row.verb_kana}→${row.verb}`).sort()).toEqual(
      [
        'はなしはきく→聞く',
        'はなしをきく→聞く',
        '話しはきく→聞く',
        '話しをきく→聞く',
        '話はきく→聞く',
        '話をきく→聞く',
      ].sort(),
    );
  });
});
