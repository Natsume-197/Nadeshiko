import { describe, expect, it } from 'vitest';
import { type CombineContext, fromMorpheme, type Group, InMemoryLexicon } from '@app/services/parser/combine';
import { toKatakana } from '@app/services/parser/combine/kana';
import { applyCollocations, resolveOrphanDeverbalNoun } from '@app/services/parser/combine/stages/forms';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { Morpheme } from '@app/services/parser/sudachi';

const NOUN = '名詞,普通名詞,一般';
const VERB = '動詞,一般';
const CASE = '助詞,格助詞';
const AUX = '助動詞';
const SUFFIX = '接尾辞,名詞的,一般';

type Tok = [s: string, pos: string, d?: string, r?: string];

function sentence(...tokens: Tok[]): Group[] {
  let b = 0;
  return tokens.map(([s, pos, d = s, r]) => {
    const e = b + [...s].length;
    const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
    const morpheme: Morpheme = { s, b, e, pos: fields, d, n: d, r: r ?? toKatakana(s), a: [] };
    b = e;
    return fromMorpheme(morpheme);
  });
}

const view = (list: readonly Group[]) => list.map((group) => [group.s, group.d, group.cls]);

describe('resolveOrphanDeverbalNoun', () => {
  const lexicon = new InMemoryLexicon(['用事'], { verb: ['探す'], noun: ['話し'], suf: ['捜し'] });
  const ctx: CombineContext = { lexicon, deconjugate };

  it('reads 探し with no noun before it as 探す (用事なら|探し|に)', () => {
    const out = resolveOrphanDeverbalNoun(
      sentence(['用事', NOUN], ['なら', AUX, 'だ'], ['探し', NOUN], ['に', CASE], ['行く', VERB]),
      ctx,
    );
    expect(view(out)[2]).toEqual(['探し', '探す', 'Verb']);
  });

  it('reads a suffix-only spelling at the start of a sentence as the verb', () => {
    const out = resolveOrphanDeverbalNoun(sentence(['捜し', SUFFIX], ['に', CASE]), {
      ...ctx,
      lexicon: new InMemoryLexicon([], { verb: ['捜す'], suf: ['捜し'] }),
    });
    expect(view(out)[0]).toEqual(['捜し', '捜す', 'Verb']);
  });

  it('keeps it after a noun host (宝|探し) and keeps real nouns (話し)', () => {
    const afterNoun = sentence(['宝', NOUN], ['探し', NOUN]);
    expect(resolveOrphanDeverbalNoun(afterNoun, ctx)).toBe(afterNoun);
    const noun = sentence(['なら', AUX, 'だ'], ['話し', NOUN]);
    expect(resolveOrphanDeverbalNoun(noun, ctx)).toBe(noun);
  });
});

describe('applyCollocations', () => {
  const lexicon = new InMemoryLexicon([]);
  lexicon.addWord(1, [
    { text: '弾く', kana: false },
    { text: 'ひく', kana: true },
  ]);
  lexicon.addCollocation('ピアノ', 'を', 'ひく', '弾く');
  lexicon.addCollocation('ピアノ', 'は', 'ひく', '弾く');
  lexicon.addCollocation('風邪', 'を', 'ひく', '引く');
  const ctx: CombineContext = { lexicon, deconjugate };

  it('names a kana verb after noun + particle (ピアノを|ひいた → 弾く)', () => {
    const out = applyCollocations(sentence(['ピアノ', NOUN], ['を', CASE], ['ひいた', VERB, 'ひく']), ctx);
    expect(view(out)[2]).toEqual(['ひいた', '弾く', 'Verb']);
  });

  it('files も under は', () => {
    const out = applyCollocations(sentence(['ピアノ', NOUN], ['も', '助詞,係助詞'], ['ひいた', VERB, 'ひく']), ctx);
    expect(out[2]?.d).toBe('弾く');
  });

  it('leaves a verb alone when the table names a verb not read that way, or has no row', () => {
    const wrongReading = sentence(['風邪', NOUN], ['を', CASE], ['ひいた', VERB, 'ひく']);
    expect(applyCollocations(wrongReading, ctx)).toBe(wrongReading);
    const noRow = sentence(['ピアノ', NOUN], ['に', CASE], ['ひいた', VERB, 'ひく']);
    expect(applyCollocations(noRow, ctx)).toBe(noRow);
    const kanji = sentence(['ピアノ', NOUN], ['を', CASE], ['引いた', VERB, '引く']);
    expect(applyCollocations(kanji, ctx)).toBe(kanji);
  });

  it('leaves the usual kana spelling of a common word alone (マッチを|する stays する)', () => {
    const usual = new InMemoryLexicon([], { 'usual-kana': ['する'] });
    usual.addWord(2, [
      { text: '擦る', kana: false },
      { text: 'する', kana: true },
    ]);
    usual.addCollocation('マッチ', 'を', 'する', '擦る');
    const input = sentence(['マッチ', NOUN], ['を', CASE], ['した', VERB, 'する']);
    expect(applyCollocations(input, { lexicon: usual, deconjugate })).toBe(input);
  });
});
