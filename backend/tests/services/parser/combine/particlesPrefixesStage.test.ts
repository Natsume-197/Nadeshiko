import { describe, expect, it } from 'vitest';
import { type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import { combineFinal, combineParticles, combineQuotativeToIu } from '@app/services/parser/combine/stages/particles';
import { combinePrefixes } from '@app/services/parser/combine/stages/prefixes';
import type { Morpheme } from '@app/services/parser/sudachi';
import { ctx } from './testLexicon';

const surfaces = (groups: readonly Group[]) => groups.map((group) => group.s);

/** A hand-made morpheme; `extra` overrides fields such as the normalised form. */
function m(s: string, b: number, pos: string, d = s, r = s, extra: Partial<Morpheme> = {}): Morpheme {
  const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
  return { s, b, e: b + [...s].length, pos: fields, d, n: d, r, a: [], ...extra };
}

/** Lays morphemes end to end, so offsets need not be counted by hand. */
function line(...parts: Array<[string, string, string?, string?, Partial<Morpheme>?]>): Group[] {
  let b = 0;
  return toGroups(
    parts.map(([s, pos, d, r, extra]) => {
      const morpheme = m(s, b, pos, d ?? s, r ?? s, extra);
      b = morpheme.e;
      return morpheme;
    }),
  );
}

const withLexicon = (keys: string[], classes = {}) => ({ ...ctx, lexicon: new InMemoryLexicon(keys, classes) });

describe('combineParticles', () => {
  it('leaves a single group alone', () => {
    const input = line(['に', '助詞,格助詞']);
    expect(combineParticles(input, ctx)).toBe(input);
  });

  it('joins a かも that an earlier stage already fused to the しれ after it (かも|しれ|ない)', () => {
    const out = combineParticles(
      line(['かも', '助詞,副助詞'], ['しれ', '動詞,一般', 'しれる'], ['ない', '助動詞']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['かもしれ', 'ない']);
    expect(out[0]).toMatchObject({ cls: 'Expression', d: 'かもしれない', flags: { via: 'CombineParticles' } });
  });

  it('accepts the contracted しんない after かも (かも|しんない)', () => {
    const out = combineParticles(line(['かも', '助詞,副助詞'], ['しんない', '動詞,一般', 'しれる']), ctx);
    expect(out[0]).toMatchObject({ s: 'かもしんない', d: 'かもしれない', cls: 'Expression' });
  });

  it('keeps かも before anything that is not しれ (かも|ね)', () => {
    const input = line(['かも', '助詞,副助詞'], ['ね', '助詞,終助詞']);
    expect(combineParticles(input, ctx)).toBe(input);
  });

  it.each([
    ['じゃない', 'じゃないか'],
    ['ではない', 'ではないか'],
  ])('adds か to a fused %s expression', (fused, expected) => {
    const [head, ka] = line([fused, '助動詞', 'だ'], ['か', '助詞,終助詞']) as [Group, Group];
    const out = combineParticles([{ ...head, cls: 'Expression', d: fused }, ka], ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: `${fused}か`, d: expected, cls: 'Expression' });
  });

  it('keeps か apart from a verb negative (しない|か) and from an expression that is not じゃない', () => {
    const verb = line(['しない', '動詞,非自立可能', 'する'], ['か', '助詞,終助詞']);
    expect(combineParticles(verb, ctx)).toBe(verb);
    const [head, ka] = line(['そうだ', '形状詞,助動詞語幹'], ['か', '助詞,終助詞']) as [Group, Group];
    const expression = [{ ...head, cls: 'Expression' as const, d: 'そうだ' }, ka];
    expect(combineParticles(expression, ctx)).toBe(expression);
    const [jaNai, yo] = line(['じゃない', '助動詞', 'だ'], ['よ', '助詞,終助詞']) as [Group, Group];
    const noKa = [{ ...jaNai, cls: 'Expression' as const, d: 'じゃない' }, yo];
    expect(combineParticles(noKa, ctx)).toBe(noKa);
  });

  it('builds ではない from で|は|ない', () => {
    const out = combineParticles(
      line(['で', '助動詞', 'だ'], ['は', '助詞,係助詞'], ['ない', '形容詞,非自立可能']),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: 'ではない', d: 'ではない', n: 'ではない', cls: 'Expression' });
  });

  it('builds ではないか from で|は|無い|か', () => {
    const out = combineParticles(
      line(['で', '助動詞', 'だ'], ['は', '助詞,係助詞'], ['無い', '形容詞,非自立可能', '無い'], ['か', '助詞,終助詞']),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: 'では無いか', d: 'ではないか', cls: 'Expression' });
  });

  it('builds ではない and leaves the next word when it is not か (ではない|よ)', () => {
    const out = combineParticles(
      line(['で', '助動詞', 'だ'], ['は', '助詞,係助詞'], ['ない', '形容詞,非自立可能'], ['よ', '助詞,終助詞']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['ではない', 'よ']);
  });

  it('makes only では when what follows is not ない (では|ある)', () => {
    const out = combineParticles(line(['で', '助動詞', 'だ'], ['は', '助詞,係助詞'], ['ある', '動詞,非自立可能']), ctx);
    expect(surfaces(out)).toEqual(['では', 'ある']);
    expect(out[0]).toMatchObject({ d: 'では', n: 'では' });
  });

  it.each([['とは'], ['のに']])('joins the compound particle %s', (pair) => {
    const out = combineParticles(line([pair[0] as string, '助詞,格助詞'], [pair[1] as string, '助詞,係助詞']), ctx);
    expect(out[0]).toMatchObject({ s: pair, d: pair });
  });
});

describe('combineQuotativeToIu', () => {
  it('keeps って before kanji 言う ("to say") and before a kana いう that is not the verb', () => {
    const kanji = line(['って', '助詞,副助詞'], ['言う', '動詞,一般']);
    expect(combineQuotativeToIu(kanji, ctx)).toBe(kanji);
    const single = line(['って', '助詞,副助詞']);
    expect(combineQuotativeToIu(single, ctx)).toBe(single);
  });
});

describe('combineFinal', () => {
  it('leaves a single group alone', () => {
    const input = line(['だ', '助動詞']);
    expect(combineFinal(input, ctx)).toBe(input);
  });

  it('joins ば to the verb before it (読め|ば)', () => {
    const out = combineFinal(line(['読め', '動詞,一般', '読む'], ['ば', '助詞,接続助詞']), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      s: '読めば',
      d: '読む',
      cls: 'Verb',
      flags: { via: 'CombineFinal', inflected: true },
    });
  });

  it('keeps ば apart from a word that is not a verb (それ|ば)', () => {
    const input = line(['それ', '代名詞'], ['ば', '助詞,接続助詞']);
    expect(combineFinal(input, ctx)).toBe(input);
  });

  it('joins ところ|で into the conjunction ところで at the start of a sentence', () => {
    const out = combineFinal(line(['ところ', '名詞,普通名詞,副詞可能'], ['で', '助詞,格助詞']), ctx);
    expect(out[0]).toMatchObject({ s: 'ところで', d: 'ところで', cls: 'Conjunction' });
  });

  it('joins ところ|で after a past form (行った|ところ|で)', () => {
    const out = combineFinal(
      line(['行った', '動詞,非自立可能', '行く'], ['ところ', '名詞,普通名詞,副詞可能'], ['で', '助詞,格助詞']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['行った', 'ところで']);
  });

  it('keeps the locative ところ|で after anything else (静かな|ところ|で)', () => {
    const input = line(['静かな', '形状詞,一般', '静か'], ['ところ', '名詞,普通名詞,副詞可能'], ['で', '助詞,格助詞']);
    expect(combineFinal(input, ctx)).toBe(input);
  });

  it('joins a special pair after another word (それ|だ|から)', () => {
    const out = combineFinal(line(['それ', '代名詞'], ['だ', '助動詞'], ['から', '助詞,接続助詞']), ctx);
    expect(surfaces(out)).toEqual(['それ', 'だから']);
    expect(out[1]?.cls).toBe('Conjunction');
  });

  it('joins the three-group unit に|つい|て', () => {
    const out = combineFinal(line(['に', '助詞,格助詞'], ['つい', '動詞,一般', 'つく'], ['て', '助詞,接続助詞']), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: 'について', d: 'について', cls: 'Expression' });
  });

  it.each([
    ['ねー', 'しょうがねー'],
    ['ね', 'しょうがね'],
  ])('joins しょう|が|%s, with or without its long vowel, into the adjective しょうがねー', (tail, surface) => {
    const out = combineFinal(line(['しょう', '名詞,普通名詞'], ['が', '助詞,格助詞'], [tail, '助動詞', 'ない']), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: surface, d: 'しょうがねー', cls: 'IAdjective' });
  });

  it('leaves a three-group head whose tail does not match (に|つい|た, に|とっ|た)', () => {
    const tsuita = line(['に', '助詞,格助詞'], ['つい', '動詞,一般', 'つく'], ['た', '助動詞']);
    expect(combineFinal(tsuita, ctx)).toBe(tsuita);
    const totta = line(['に', '助詞,格助詞'], ['とっ', '動詞,一般', 'とる'], ['た', '助動詞']);
    expect(combineFinal(totta, ctx)).toBe(totta);
  });
});

describe('combinePrefixes', () => {
  it('leaves a single group and a prefix at the end of the sentence alone', () => {
    const single = line(['お', '接頭辞']);
    expect(combinePrefixes(single, ctx)).toBe(single);
    const trailing = line(['犬', '名詞,普通名詞'], ['お', '接頭辞']);
    expect(combinePrefixes(trailing, ctx)).toBe(trailing);
  });

  it('treats an emphatic ど before an i-adjective as a prefix (ど|偉い)', () => {
    const out = combinePrefixes(line(['ど', '副詞'], ['偉い', '形容詞,一般']), withLexicon(['ど偉い']));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: 'ど偉い', d: 'ど偉い', cls: 'Noun', flags: { via: 'CombinePrefixes' } });
  });

  it('keeps an adverb ど before anything that is not an i-adjective (ど|真ん中)', () => {
    const input = line(['ど', '副詞'], ['真ん中', '名詞,普通名詞']);
    expect(combinePrefixes(input, withLexicon(['ど真ん中']))).toBe(input);
  });

  it.each([
    ['a na-adjective (ご|丁寧)', 'ご', '丁寧', '形状詞,一般', 'NaAdjective'],
    ['an adverb (ご|もっとも)', 'ご', 'もっとも', '副詞', 'Adverb'],
  ])('joins a kana prefix and %s', (_name, prefix, word, pos, cls) => {
    const out = combinePrefixes(line([prefix, '接頭辞'], [word, pos]), withLexicon([prefix + word]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: prefix + word, d: prefix + word, cls });
    expect(out[0]?.members.map((member) => member.s)).toEqual([prefix, word]);
  });

  it.each([['CommonNoun' as const], ['NominalAdjective' as const]])(
    'joins a kana prefix and a word a stage reclassified as %s (お|茶)',
    (cls) => {
      const [o, cha] = line(['お', '接頭辞'], ['茶', '名詞,普通名詞']) as [Group, Group];
      const out = combinePrefixes([o, { ...cha, cls }], withLexicon(['お茶']));
      expect(out[0]).toMatchObject({ s: 'お茶', d: 'お茶', cls });
    },
  );

  it('does not let a kana prefix take a verb (お|待ち)', () => {
    const input = line(['お', '接頭辞'], ['待ち', '動詞,一般', '待つ']);
    expect(combinePrefixes(input, withLexicon(['お待ち'], { verb: ['お待つ'] }))).toBe(input);
  });

  it('leaves a prefix before a particle alone (お|は)', () => {
    const input = line(['お', '接頭辞'], ['は', '助詞,係助詞']);
    expect(combinePrefixes(input, withLexicon(['おは']))).toBe(input);
  });

  it('lets a kanji prefix take a verb in its dictionary form (相|次ぐ), as a noun', () => {
    const out = combinePrefixes(line(['相', '接頭辞'], ['次ぐ', '動詞,一般']), withLexicon(['相次ぐ']));
    expect(out[0]).toMatchObject({ s: '相次ぐ', d: '相次ぐ', cls: 'Noun' });
  });

  it('finds an inflected verb by its dictionary form and keeps it a verb (相|次い → 相次ぐ)', () => {
    const out = combinePrefixes(
      line(['相', '接頭辞'], ['次い', '動詞,一般', '次ぐ'], ['で', '助詞,接続助詞']),
      withLexicon([], { verb: ['相次ぐ'] }),
    );
    expect(surfaces(out)).toEqual(['相次い', 'で']);
    expect(out[0]).toMatchObject({ d: '相次ぐ', n: '相次ぐ', cls: 'Verb', flags: { via: 'CombinePrefixes' } });
  });

  it('does not take an inflected verb whose prefixed dictionary form is not a verb (再|開い)', () => {
    const input = line(['再', '接頭辞'], ['開い', '動詞,一般', '開く']);
    expect(combinePrefixes(input, withLexicon(['再開く']))).toBe(input);
  });

  it('reaches a classical adjective through its normalised form (故|無き → 故無い)', () => {
    const out = combinePrefixes(
      line(['故', '接頭辞'], ['無き', '形容詞,非自立可能', '無し', 'ナキ', { n: '無い' }]),
      withLexicon(['故無い']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '故無き', d: '故無い', n: '故無い', cls: 'IAdjective' });
  });

  it('reaches a colloquial adjective through its reading (古|くせー read クサイ → 古くさい)', () => {
    const out = combinePrefixes(
      line(['古', '接頭辞'], ['くせー', '形容詞,一般', 'くさい', 'クサイ', { n: '臭い' }]),
      withLexicon(['古くさい']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '古くせー', d: '古くさい', r: '古クサイ', cls: 'IAdjective' });
  });

  it('leaves 古|くせー alone when its reading gives no word, or it has no reading', () => {
    const unlisted = line(['古', '接頭辞'], ['くせー', '形容詞,一般', 'くさい', 'クサイ', { n: '臭い' }]);
    expect(combinePrefixes(unlisted, withLexicon([]))).toBe(unlisted);
    const unread = line(['古', '接頭辞'], ['くせー', '形容詞,一般', 'くさい', '', { n: '臭い' }]);
    expect(combinePrefixes(unread, withLexicon(['古くさい']))).toBe(unread);
  });

  it('does not use the reading when the surface is itself a word (古|くせー with くせー listed)', () => {
    const input = line(['古', '接頭辞'], ['くせー', '形容詞,一般', 'くさい', 'クサイ', { n: '臭い' }]);
    expect(combinePrefixes(input, withLexicon(['古くさい', 'くせー']))).toBe(input);
  });

  it('does not use a reading that spells the surface again (古|くさい read クサイ)', () => {
    const input = line(['古', '接頭辞'], ['くさい', '形容詞,一般', 'くさい', 'クサイ']);
    expect(combinePrefixes(input, withLexicon(['古臭い']))).toBe(input);
  });

  it('skips a prefixed word on the exclusion list (お|にく)', () => {
    const input = line(['お', '接頭辞'], ['にく', '名詞,普通名詞']);
    expect(combinePrefixes(input, withLexicon(['おにく']))).toBe(input);
  });

  it('skips the whole word when the head forms a word with what follows (お|母|上 → お, 母上)', () => {
    const input = line(['お', '接頭辞'], ['母', '名詞,普通名詞'], ['上', '名詞,普通名詞']);
    expect(surfaces(combinePrefixes(input, withLexicon(['お母', '母上'])))).toEqual(['お', '母', '上']);
  });

  it('merges when the following word is not a noun (お|母|が)', () => {
    const out = combinePrefixes(
      line(['お', '接頭辞'], ['母', '名詞,普通名詞'], ['が', '助詞,格助詞']),
      withLexicon(['お母', '母が']),
    );
    expect(surfaces(out)).toEqual(['お母', 'が']);
  });

  it('lets the prefix keep its head when all three are also a word (お|手|紙 with お手紙 listed)', () => {
    const out = combinePrefixes(
      line(['お', '接頭辞'], ['手', '名詞,普通名詞'], ['紙', '名詞,普通名詞']),
      withLexicon(['お手', '手紙', 'お手紙']),
    );
    expect(surfaces(out)).toEqual(['お手', '紙']);
  });
});
