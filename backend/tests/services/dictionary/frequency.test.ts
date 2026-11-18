import { describe, it, expect } from 'vitest';
import { attribute, countKanji, type KanjiCount, kanjiRows, tokenTripleOf } from '@app/services/dictionary/frequency';
import type { StoredWord } from '@app/services/dictionary/identify';

const form = (idx: number, text: string, kana: boolean) => ({
  idx,
  text,
  kana,
  common: true,
  tags: [],
  applies_to_kanji: kana ? ['*'] : [],
  active: true,
});
const sense = (pos: string[], misc: string[] = []) => ({
  idx: 0,
  lang: 'eng' as const,
  pos,
  misc,
  field: [],
  dialect: [],
  info: [],
  applies_to_kanji: ['*'],
  applies_to_kana: ['*'],
  glosses: [{ text: 'x', type: null }],
});
const word = (id: number, forms: StoredWord['forms'], senses: StoredWord['senses'], over: Partial<StoredWord> = {}) =>
  ({ id, source: 'jmdict', common: true, active: true, jlpt: null, forms, senses, ...over }) as StoredWord;

const IRU = word(1577980, [form(0, '居る', false), form(1, 'いる', true)], [sense(['v1'], ['uk'])]);
const ORU = word(1454500, [form(0, '居る', false), form(1, 'おる', true)], [sense(['v5r'])]);
const NEED = word(1546640, [form(0, '要る', false), form(1, 'いる', true)], [sense(['v5r'], ['uk'])]);

describe('attribute', () => {
  it('gives いる normalised to 居る to 居る read いる, not to おる or 要る', () => {
    const owners = attribute({ n: '居る', kana: 'いる', pt: 'verb', count: 7 }, [IRU, ORU, NEED]);

    expect(owners).toEqual([{ id: 1577980, share: 7 }]);
  });

  it('reads a kanji surface by its own reading', () => {
    const owners = attribute({ n: '居る', s: '居った', r: 'オッタ', pt: 'verb', count: 2 }, [IRU, ORU]);

    expect(owners.map((owner) => owner.id)).toEqual([1454500]);
  });

  it('shares the count between words it cannot tell apart, and gives names nothing', () => {
    const a = word(1, [form(0, 'あ', true)], [sense(['int'])]);
    const b = word(2, [form(0, 'あ', true)], [sense(['int'])]);
    const name = word(5000000, [form(0, 'あ', true)], [sense(['given'])], { source: 'jmnedict' });

    expect(attribute({ n: 'あ', kana: 'あ', count: 4 }, [a, b, name])).toEqual([
      { id: 1, share: 2 },
      { id: 2, share: 2 },
    ]);
  });

  it('ignores the stored frequency, so a recount does not confirm the last one', () => {
    const favoured = { ...NEED, frequency: { rank: 1, perMillion: 1e6 } };

    expect(attribute({ n: '居る', kana: 'いる', count: 1 }, [IRU, favoured]).map((owner) => owner.id)).toEqual([
      1577980,
    ]);
  });
});

describe('tokenTripleOf', () => {
  const part = { b: 0, e: 1 };
  it('counts a grouped expression, compound or counter as a word of its own', () => {
    expect(
      tokenTripleOf({
        s: '心臓麻痺',
        d: '心臓麻痺',
        r: 'シンゾウマヒ',
        kind: 'compound',
        pt: 'noun',
        parts: [part, part],
      } as never),
    ).toEqual({
      n: '心臓麻痺',
      s: '心臓麻痺',
      r: 'シンゾウマヒ',
      pt: 'noun',
    });
    expect(
      tokenTripleOf({ s: 'のに', d: 'のに', r: 'ノニ', kind: 'function', pt: 'prt', parts: [part, part] } as never),
    ).toEqual({
      n: 'のに',
      kana: 'のに',
      pt: 'prt',
    });
  });

  it('leaves inflected words and single morphemes to the morpheme count', () => {
    expect(
      tokenTripleOf({ s: '食べられない', d: '食べる', kind: 'inflected', parts: [part, part] } as never),
    ).toBeNull();
    expect(tokenTripleOf({ s: '本', d: '本', kind: 'word' } as never)).toBeNull();
  });
});

describe('kanji counts', () => {
  it('counts every kanji written and each sentence once, skipping repeat marks and kana', () => {
    const counts = new Map<string, KanjiCount>();
    countKanji('食べ物を食べる', counts);
    countKanji('時々、物を食う', counts);

    expect(Object.fromEntries(counts)).toEqual({
      食: { count: 3, sentences: 2 },
      物: { count: 2, sentences: 2 },
      時: { count: 1, sentences: 1 },
    });
  });

  it('ranks the most written first', () => {
    const counts = new Map<string, KanjiCount>([
      ['物', { count: 2, sentences: 2 }],
      ['食', { count: 3, sentences: 2 }],
      ['時', { count: 1, sentences: 1 }],
    ]);

    expect(kanjiRows(counts)).toEqual([
      { character: '食', count: 3, sentences: 2, rank: 1 },
      { character: '物', count: 2, sentences: 2, rank: 2 },
      { character: '時', count: 1, sentences: 1, rank: 3 },
    ]);
  });
});
