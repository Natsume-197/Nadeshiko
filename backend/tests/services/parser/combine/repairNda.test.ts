import { describe, expect, it } from 'vitest';
import { type CombineContext, fromMorpheme, type Group, InMemoryLexicon } from '@app/services/parser/combine';
import { toKatakana } from '@app/services/parser/combine/kana';
import { repairNdaPastTense } from '@app/services/parser/combine/stages/repairNda';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { Morpheme } from '@app/services/parser/sudachi';

const ctx: CombineContext = { lexicon: new InMemoryLexicon([]), deconjugate };

/** A sentence of hand-made Sudachi morphemes: surface, POS and optional dictionary form. */
function sentence(...tokens: Array<[s: string, pos: string, d?: string]>): Group[] {
  let b = 0;
  return tokens.map(([s, pos, d = s]) => {
    const e = b + [...s].length;
    const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
    const morpheme: Morpheme = { s, b, e, pos: fields, d, n: d, r: toKatakana(s), a: [] };
    b = e;
    return fromMorpheme(morpheme);
  });
}

const STEM = '動詞,一般,*,*,五段,連用形-撥音便';

describe('repairNdaPastTense', () => {
  it.each([
    ['死ん|だ (ぬ)', '死ん', '死ぬ', 'だ'],
    ['遊ん|で (ぶ)', '遊ん', '遊ぶ', 'で'],
    ['飲ん|だ (む)', '飲ん', '飲む', 'だ'],
  ])('joins the past or て-form %s into one verb', (_label, stem, base, tail) => {
    const out = repairNdaPastTense(sentence([stem, STEM, base], [tail, '助動詞', 'だ'], ['よ', '助詞,終助詞']), ctx);
    expect(out.map((group) => [group.s, group.d, group.cls])).toEqual([
      [stem + tail, base, 'Verb'],
      ['よ', 'よ', 'Particle'],
    ]);
    expect(out[0]?.flags).toMatchObject({ inflected: true, via: 'RepairNTokenisation' });
    expect(out[0]?.members).toHaveLength(2);
  });

  it.each<[string, Group[]]>([
    ['a lone token', sentence(['死ん', STEM, '死ぬ'])],
    ['a bare ん (ん|だ)', sentence(['ん', '助詞,準体助詞', 'の'], ['だ', '助動詞'])],
    ['a na-adjective (盛ん|だ)', sentence(['盛ん', '形状詞,一般'], ['だ', '助動詞'])],
    [
      'a word that may be a na-adjective (たくさん|だ)',
      sentence(['たくさん', '名詞,普通名詞,形状詞可能'], ['だ', '助動詞']),
    ],
    [
      'a suffix (田中|さん|だ)',
      sentence(['田中', '名詞,固有名詞,人名'], ['さん', '接尾辞,名詞的,一般'], ['だ', '助動詞']),
    ],
    ['a lemma that itself ends in ん (みかん|だ)', sentence(['みかん', '名詞,普通名詞,一般'], ['だ', '助動詞'])],
    ['a stem before something other than だ/で (死ん|じゃう)', sentence(['死ん', STEM, '死ぬ'], ['じゃう', '助動詞'])],
  ])('leaves %s alone', (_label, input) => {
    expect(repairNdaPastTense(input, ctx)).toBe(input);
  });
});
