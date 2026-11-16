import { describe, it, expect } from 'vitest';
import type { JMdictWord, JMnedictWord } from '@scriptin/jmdict-simplified-types';
import {
  assignFormIndexes,
  fromJmdict,
  fromJmnedict,
  lookupKeys,
  toHiragana,
} from '@app/services/dictionary/import/entries';

// Trimmed from jmdict-simplified 3.6.2 (JMdict 2026-11-02, EDRDG, CC BY-SA 4.0).
const TABERU: JMdictWord = {
  id: '1358280',
  kanji: [
    { common: true, text: '食べる', tags: [] },
    { common: false, text: '喰べる', tags: ['sK'] },
  ],
  kana: [{ common: true, text: 'たべる', tags: [], appliesToKanji: ['*'] }],
  sense: [
    {
      partOfSpeech: ['v1', 'vt'],
      appliesToKanji: ['*'],
      appliesToKana: ['*'],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: [],
      info: [],
      languageSource: [],
      gloss: [{ lang: 'eng', gender: null, type: null, text: 'to eat' }],
    },
    {
      partOfSpeech: ['v1', 'vt'],
      appliesToKanji: ['*'],
      appliesToKana: ['*'],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: [],
      info: [],
      languageSource: [],
      gloss: [{ lang: 'dut', gender: null, type: null, text: 'eten' }],
    },
    {
      partOfSpeech: ['v1', 'vt'],
      appliesToKanji: ['*'],
      appliesToKana: ['*'],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: [],
      info: [],
      languageSource: [],
      gloss: [
        { lang: 'spa', gender: null, type: null, text: 'comer' },
        { lang: 'eng', gender: null, type: 'figurative', text: 'to consume' },
      ],
    },
  ],
};

const CHUSEN: JMnedictWord = {
  id: '5000000',
  kanji: [{ text: 'ゝ泉', tags: [] }],
  kana: [{ text: 'ちゅせん', tags: [], appliesToKanji: ['*'] }],
  translation: [{ type: ['given'], related: [], translation: [{ lang: 'eng', text: 'Chusen' }] }],
};

describe('fromJmdict', () => {
  it('keeps the entry id, every spelling, and the common flag', () => {
    const entry = fromJmdict(TABERU);

    expect(entry).toMatchObject({ id: 1358280, source: 'jmdict', common: true });
    expect(entry.forms.map(({ text, kana }) => [text, kana])).toEqual([
      ['食べる', false],
      ['喰べる', false],
      ['たべる', true],
    ]);
    expect(entry.forms[1]?.tags).toEqual(['sK']);
  });

  it('keeps English and Spanish only, one sense per language, in upstream order', () => {
    const entry = fromJmdict(TABERU);

    expect(entry.senses.map((sense) => [sense.lang, sense.glosses.map((g) => g.text)])).toEqual([
      ['eng', ['to eat']],
      ['spa', ['comer']],
      ['eng', ['to consume']],
    ]);
    expect(entry.senses[2]?.glosses[0]?.type).toBe('figurative');
  });
});

describe('fromJmnedict', () => {
  it('uses the name types as the part of speech and is never common', () => {
    const entry = fromJmnedict(CHUSEN);

    expect(entry).toMatchObject({ id: 5000000, source: 'jmnedict', common: false });
    expect(entry.senses).toEqual([
      expect.objectContaining({ lang: 'eng', pos: ['given'], glosses: [{ text: 'Chusen', type: null }] }),
    ]);
  });
});

describe('lookup keys', () => {
  it('turn katakana into hiragana and leave the rest alone', () => {
    expect(toHiragana('タベル')).toBe('たべる');
    expect(toHiragana('コーヒー')).toBe('こーひー');
    expect(toHiragana('ヴァイオリン')).toBe('ゔぁいおりん');
    expect(toHiragana('食べる')).toBe('食べる');
  });

  it('list a spelling once when it is already hiragana or kanji', () => {
    expect(lookupKeys('たべる')).toEqual(['たべる']);
    expect(lookupKeys('カメラ')).toEqual(['カメラ', 'かめら']);
  });
});

describe('assignFormIndexes', () => {
  const form = (text: string, kana = false) => ({ text, kana, common: false, tags: [], appliesToKanji: [] });

  it('numbers a new word from zero', () => {
    const result = assignFormIndexes([], [form('食べる'), form('たべる', true)]);

    expect(result.rows.map(({ text, idx }) => [text, idx])).toEqual([
      ['食べる', 0],
      ['たべる', 1],
    ]);
    expect(result).toMatchObject({ added: 2, reactivated: 0, deactivate: [] });
  });

  it('keeps stored indexes even when upstream reorders the spellings', () => {
    const stored = [
      { idx: 0, text: '食べる', kana: false, active: true },
      { idx: 1, text: 'たべる', kana: true, active: true },
    ];

    const result = assignFormIndexes(stored, [form('たべる', true), form('食べる')]);

    expect(result.rows.map(({ text, idx }) => [text, idx])).toEqual([
      ['たべる', 1],
      ['食べる', 0],
    ]);
  });

  it('gives a new spelling the next index, never a freed one', () => {
    const stored = [
      { idx: 0, text: '喰べる', kana: false, active: true },
      { idx: 1, text: 'たべる', kana: true, active: true },
    ];

    const result = assignFormIndexes(stored, [form('食べる'), form('たべる', true)]);

    expect(result.rows.find((row) => row.text === '食べる')?.idx).toBe(2);
    expect(result.deactivate).toEqual([0]);
  });

  it('brings a dropped spelling back under its old index', () => {
    const stored = [{ idx: 0, text: '喰べる', kana: false, active: false }];

    const result = assignFormIndexes(stored, [form('喰べる')]);

    expect(result.rows).toEqual([expect.objectContaining({ idx: 0 })]);
    expect(result.reactivated).toBe(1);
  });

  it('tells kanji and kana spellings apart even when the text is the same', () => {
    const stored = [{ idx: 0, text: 'ＡＢＣ', kana: false, active: true }];

    const result = assignFormIndexes(stored, [form('ＡＢＣ', true)]);

    expect(result.rows[0]?.idx).toBe(1);
    expect(result.deactivate).toEqual([0]);
  });
});
