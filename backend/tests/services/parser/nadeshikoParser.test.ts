import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { fromMorpheme, InMemoryLexicon } from '@app/services/parser/combine';
import { parseWithNadeshiko, toSlimToken } from '@app/services/parser/nadeshiko';
import type { Morpheme } from '@app/services/parser/sudachi';
import { morphemes } from './combine/fixtures';
import { lexicon } from './combine/testLexicon';

const mocks = vi.hoisted(() => ({ analyse: vi.fn(), loadLexicon: vi.fn() }));

vi.mock('@app/services/parser/sudachi', () => ({ analyse: mocks.analyse }));
vi.mock('@app/services/parser/combine/lexicon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/services/parser/combine/lexicon')>()),
  loadLexicon: mocks.loadLexicon,
}));

/** A hand-made morpheme; `extra` overrides fields such as the normalised form. */
function m(s: string, b: number, pos: string, d = s, r = s, extra: Partial<Morpheme> = {}): Morpheme {
  const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
  return { s, b, e: b + [...s].length, pos: fields, d, n: d, r, a: [], ...extra };
}

type Row = { text: string; reading: string; segments: Array<{ text: string; ruby?: string }> };

/** A data source whose furigana query answers with `rows`. */
function dataSource(rows: Row[] = []) {
  const query = vi.fn().mockResolvedValue(rows);
  return { source: { query } as unknown as DataSource, query };
}

beforeEach(() => {
  mocks.analyse.mockReset();
  mocks.loadLexicon.mockReset().mockResolvedValue(lexicon);
});

describe('parseWithNadeshiko', () => {
  it('returns nothing for no texts, without calling Sudachi', async () => {
    const { source, query } = dataSource();
    expect(await parseWithNadeshiko(source, [])).toEqual([]);
    expect(mocks.analyse).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('parses a kana-only sentence (ですか) without asking for furigana', async () => {
    mocks.analyse.mockResolvedValue([morphemes('ですか')]);
    const { source, query } = dataSource();

    const [tokens] = await parseWithNadeshiko(source, ['ですか']);

    expect(mocks.analyse).toHaveBeenCalledWith(['ですか'], 'B');
    expect(query).not.toHaveBeenCalled();
    expect(tokens).toHaveLength(1);
    expect(tokens?.[0]).toMatchObject({ s: 'ですか', d: 'ですか', kind: 'expression', posLabel: 'Expression' });
  });

  it('asks for the furigana of every kanji spelling and keeps A units as parts (…内家拳の達人…)', async () => {
    const text = 'さすがは内家拳の達人と言われるお方';
    mocks.analyse.mockResolvedValue([morphemes(text)]);
    const { source, query } = dataSource([
      {
        text: '達人',
        reading: 'たつじん',
        segments: [
          { text: '達', ruby: 'たつ' },
          { text: '人', ruby: 'じん' },
        ],
      },
      { text: 'お方', reading: 'おかた', segments: [{ text: 'お' }, { text: '方', ruby: 'かた' }] },
      { text: 'お方', reading: 'おほう', segments: [{ text: 'お' }, { text: '方', ruby: 'ほう' }] },
    ]);

    const [tokens] = await parseWithNadeshiko(source, [text]);

    const spellings = query.mock.calls[0]?.[1]?.[0] as string[];
    expect(spellings).toEqual(expect.arrayContaining(['内家拳', '達人', 'お方']));
    expect(spellings).not.toContain('さすが');
    const naikaken = tokens?.find((token) => token.s === '内家拳');
    expect(naikaken?.parts?.map((part) => part.s)).toEqual(['内家', '拳']);
    expect(tokens?.find((token) => token.s === '達人')?.f).toEqual([{ t: '達人', r: 'たつじん' }]);
    expect(tokens?.at(-1)).toMatchObject({ s: 'お方', f: [{ t: 'お' }, { t: '方', r: 'かた' }] });
  });

  it('puts the ruby the sentence reads first (開いた read あいた, not ひらいた)', async () => {
    mocks.analyse.mockResolvedValue([[m('開い', 0, '動詞,一般', '開く', 'アイ'), m('た', 2, '助動詞', 'た', 'タ')]]);
    const { source } = dataSource([
      { text: '開く', reading: 'ひらく', segments: [{ text: '開', ruby: 'ひら' }, { text: 'く' }] },
      { text: '開く', reading: 'あく', segments: [{ text: '開', ruby: 'あ' }, { text: 'く' }] },
    ]);
    mocks.loadLexicon.mockResolvedValue(new InMemoryLexicon([], { verb: ['開く'] }));

    const [tokens] = await parseWithNadeshiko(source, ['開いた']);

    expect(tokens).toHaveLength(1);
    expect(tokens?.[0]).toMatchObject({
      s: '開いた',
      d: '開く',
      r: 'アイタ',
      f: [{ t: '開', r: 'あ' }, { t: 'いた' }],
    });
  });

  it('returns one token list per text, in order, and drops empty-surface groups', async () => {
    mocks.analyse.mockResolvedValue([
      [m('犬', 0, '名詞,普通名詞', '犬', 'イヌ'), m('', 1, '補助記号,一般')],
      [m('猫', 0, '名詞,普通名詞', '猫', 'ネコ')],
    ]);
    const { source } = dataSource();

    const out = await parseWithNadeshiko(source, ['犬', '猫']);

    expect(out.map((tokens) => tokens.map((token) => token.s))).toEqual([['犬'], ['猫']]);
    expect(out[0]?.[0]).toMatchObject({ r: 'イヌ', pt: 'noun', posLabel: 'Noun' });
  });
});

describe('toSlimToken', () => {
  it('reads a symbol as itself and gives it no lookup tag (、)', () => {
    const token = toSlimToken(fromMorpheme(m('、', 0, '補助記号,読点', '、', 'キゴウ')), '、', new Map());
    expect(token).toEqual({ s: '、', d: '、', r: '、', b: 0, e: 1, p: '補助記号', kind: 'symbol', posLabel: 'Symbol' });
  });

  it('falls back to the surface for a missing reading and dictionary form', () => {
    const token = toSlimToken(fromMorpheme(m('ぴえん', 0, '感動詞', '', '')), 'ぴえん', new Map());
    expect(token).toMatchObject({ s: 'ぴえん', d: 'ぴえん', r: 'ぴえん', pt: 'intj' });
    expect(token.f).toBeUndefined();
    expect(token.parts).toBeUndefined();
  });

  it('uses the rubies of the normalised spelling too (遣り, lemma やる, normalised 遣る)', () => {
    const group = fromMorpheme(m('遣り', 0, '動詞,一般', 'やる', 'ヤリ', { n: '遣る' }));
    const rubies = new Map([['遣る', [{ reading: 'やる', segments: [{ text: '遣', ruby: 'や' }, { text: 'る' }] }]]]);

    expect(toSlimToken(group, '遣り', rubies).f).toEqual([{ t: '遣', r: 'や' }, { t: 'り' }]);
  });

  it('guesses furigana from the reading when neither spelling has a ruby (遣り)', () => {
    const group = fromMorpheme(m('遣り', 0, '動詞,一般', 'やる', 'ヤリ', { n: '遣る' }));
    expect(toSlimToken(group, '遣り', new Map()).f).toEqual([{ t: '遣', r: 'や' }, { t: 'り' }]);
  });

  it('guesses furigana from the reading when no ruby is known (猫)', () => {
    const token = toSlimToken(fromMorpheme(m('猫', 0, '名詞,普通名詞', '猫', 'ネコ')), '猫', new Map());
    expect(token.f).toEqual([{ t: '猫', r: 'ねこ' }]);
  });
});
