import { describe, expect, it } from 'vitest';
import { tokenPos } from '@app/services/parser/pos';

const pos = (...fields: string[]) => [...fields, '*', '*', '*', '*', '*', '*'].slice(0, 6);

describe('tokenPos', () => {
  it.each([
    ['、 (読点)', pos('補助記号', '読点'), 'symbol', '、', { p: '補助記号', posLabel: 'Symbol' }],
    ['a blank', pos('空白'), 'symbol', ' ', { p: '空白', posLabel: 'Symbol' }],
    ['a 記号 sign', pos('記号', '一般'), 'word', '＄', { p: '記号', posLabel: 'Symbol' }],
    ['a symbol-kind group with no POS', [], 'symbol', '…', { p: '補助記号', posLabel: 'Symbol' }],
    ['a word the stages marked as a symbol', pos('名詞', '普通名詞'), 'symbol', '※', { p: '名詞', posLabel: 'Symbol' }],
  ])('%s is a Symbol without a lookup tag', (_name, fields, kind, d, expected) => {
    const out = tokenPos(fields, kind, d);
    expect(out).toEqual(expected);
    expect(out.pt).toBeUndefined();
  });

  it('stores an expression (手に入る) as 連語 whatever its head morpheme is', () => {
    expect(tokenPos(pos('名詞', '普通名詞', '一般'), 'expression', '手に入る')).toEqual({
      p: '連語',
      pt: 'exp',
      posLabel: 'Expression',
    });
  });

  it.each([
    ['三枚 (a counter group)', pos('名詞', '数詞'), 'counter', 'Counter'],
    ['東京 (固有名詞)', pos('名詞', '固有名詞', '地名'), 'word', 'Proper noun'],
    ['三 (数詞)', pos('名詞', '数詞'), 'word', 'Numeric'],
    ['犬 (普通名詞)', pos('名詞', '普通名詞', '一般'), 'word', 'Noun'],
  ])('labels the noun %s', (_name, fields, kind, label) => {
    expect(tokenPos(fields, kind, '')).toEqual({ p: '名詞', pt: 'noun', posLabel: label });
  });

  it.each([
    ['食べる', pos('動詞', '一般'), { p: '動詞', pt: 'verb', posLabel: 'Verb' }],
    ['高い', pos('形容詞', '一般'), { p: '形容詞', pt: 'adj', posLabel: 'Adjective' }],
    ['静か', pos('形状詞', '一般'), { p: '形状詞', pt: 'adj', posLabel: 'Na-adjective' }],
    ['よう', pos('形状詞', '助動詞語幹'), { p: '形状詞', pt: 'adj', posLabel: 'Auxiliary' }],
    ['だ', pos('助動詞'), { p: '助動詞', pt: 'aux', posLabel: 'Copula' }],
    ['です', pos('助動詞'), { p: '助動詞', pt: 'aux', posLabel: 'Copula' }],
    ['ます', pos('助動詞'), { p: '助動詞', pt: 'aux', posLabel: 'Auxiliary' }],
    ['は', pos('助詞', '係助詞'), { p: '助詞', pt: 'prt', posLabel: 'Particle' }],
    ['これ', pos('代名詞'), { p: '代名詞', pt: 'pron', posLabel: 'Pronoun' }],
    ['とても', pos('副詞'), { p: '副詞', pt: 'adv', posLabel: 'Adverb' }],
    ['この', pos('連体詞'), { p: '連体詞', pt: 'det', posLabel: 'Pre-noun adjectival' }],
    ['しかし', pos('接続詞'), { p: '接続詞', pt: 'conj', posLabel: 'Conjunction' }],
    ['ああ', pos('感動詞', '一般'), { p: '感動詞', pt: 'intj', posLabel: 'Interjection' }],
    ['お', pos('接頭辞'), { p: '接頭辞', pt: 'pref', posLabel: 'Prefix' }],
    ['さん', pos('接尾辞', '名詞的', '一般'), { p: '接尾辞', pt: 'suf', posLabel: 'Suffix' }],
  ])('labels %s by its UniDic tag', (d, fields, expected) => {
    expect(tokenPos(fields, 'word', d)).toEqual(expected);
  });

  it('labels a counter suffix (枚 after a numeral) as a Counter', () => {
    expect(tokenPos(pos('接尾辞', '名詞的', '助数詞'), 'counter', '枚')).toEqual({
      p: '接尾辞',
      pt: 'suf',
      posLabel: 'Counter',
    });
  });

  it('passes an unmapped tag (フィラー えーと) through as its own label, with no lookup tag', () => {
    expect(tokenPos(pos('フィラー'), 'word', 'えーと')).toEqual({ p: 'フィラー', posLabel: 'フィラー' });
  });

  it('copes with a POS that has no second field', () => {
    expect(tokenPos(['名詞'], 'word', '犬')).toEqual({ p: '名詞', pt: 'noun', posLabel: 'Noun' });
  });
});
