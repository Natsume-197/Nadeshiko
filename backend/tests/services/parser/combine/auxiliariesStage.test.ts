import { describe, expect, it } from 'vitest';
import { type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import {
  combineAdverbialParticle,
  combineAuxiliary,
  combineAuxiliaryVerbStem,
  combineCompletionAuxVerb,
  combineConjunctiveParticle,
  combineToNaru,
  combineVerbDependant,
} from '@app/services/parser/combine/stages/auxiliaries';
import type { Morpheme } from '@app/services/parser/sudachi';
import { ctx } from './testLexicon';

const surfaces = (groups: readonly Group[]) => groups.map((group) => group.s);

/** Lays hand-made morphemes end to end: [surface, POS fields, dictionary form, overrides]. */
function line(...parts: Array<[string, string, string?, Partial<Morpheme>?]>): Group[] {
  let b = 0;
  return toGroups(
    parts.map(([s, pos, d = s, extra = {}]) => {
      const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
      const morpheme: Morpheme = { s, b, e: b + [...s].length, pos: fields, d, n: d, r: s, a: [], ...extra };
      b = morpheme.e;
      return morpheme;
    }),
  );
}

const withLexicon = (keys: string[], classes = {}) => ({ ...ctx, lexicon: new InMemoryLexicon(keys, classes) });

describe('short inputs', () => {
  it.each([
    ['combineCompletionAuxVerb', combineCompletionAuxVerb],
    ['combineAuxiliaryVerbStem', combineAuxiliaryVerbStem],
    ['combineConjunctiveParticle', combineConjunctiveParticle],
    ['combineAuxiliary', combineAuxiliary],
    ['combineToNaru', combineToNaru],
    ['combineAdverbialParticle', combineAdverbialParticle],
    ['combineVerbDependant', combineVerbDependant],
  ])('%s returns a single group (食べる) as it is', (_name, stage) => {
    const input = line(['食べる', '動詞,一般']);
    expect(stage(input, ctx)).toBe(input);
  });
});

describe('combineCompletionAuxVerb', () => {
  it('does not join 切る to a て-form (逃げて|切った)', () => {
    const input = line(['逃げて', '動詞,一般', '逃げる'], ['切っ', '動詞,一般', '切る']);
    expect(combineCompletionAuxVerb(input, ctx)).toBe(input);
  });
});

describe('combineAuxiliaryVerbStem', () => {
  it('joins そう to an i-adjective stem (高|そう)', () => {
    const out = combineAuxiliaryVerbStem(line(['高', '形容詞,一般', '高い'], ['そう', '形状詞,助動詞語幹']), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '高そう', d: '高い', cls: 'IAdjective' });
  });

  it.each([
    ['a possible na-adjective (元気|そう)', '元気', '名詞,普通名詞,形状詞可能'],
    ['a suru-or-na noun (心配|そう)', '心配', '名詞,普通名詞,サ変形状詞可能'],
  ])('joins そう to %s', (_name, noun, pos) => {
    const out = combineAuxiliaryVerbStem(line([noun, pos], ['そう', '形状詞,助動詞語幹']), ctx);
    expect(surfaces(out)).toEqual([`${noun}そう`]);
    expect(out[0]?.flags.via).toBe('CombineAuxiliaryVerbStem');
  });

  it('joins そう to an adjectival suffix stem (読み|やす|そう)', () => {
    const out = combineAuxiliaryVerbStem(
      line(['読み', '動詞,一般', '読む'], ['やす', '接尾辞,形容詞的', 'やすい'], ['そう', '形状詞,助動詞語幹']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['読み', 'やすそう']);
  });

  it('keeps そう apart from a plain noun, a suffix not ending in い, and みたい', () => {
    const noun = line(['犬', '名詞,普通名詞,一般'], ['そう', '形状詞,助動詞語幹']);
    expect(combineAuxiliaryVerbStem(noun, ctx)).toBe(noun);
    const suffix = line(['田中', '名詞,固有名詞'], ['さん', '接尾辞,名詞的'], ['そう', '形状詞,助動詞語幹']);
    expect(combineAuxiliaryVerbStem(suffix, ctx)).toBe(suffix);
    const mitai = line(['行く', '動詞,非自立可能'], ['みたい', '形状詞,助動詞語幹']);
    expect(combineAuxiliaryVerbStem(mitai, ctx)).toBe(mitai);
  });
});

describe('combineConjunctiveParticle', () => {
  it('joins て to an auxiliary (食べ|させ|て)', () => {
    const [tabe, sase, te] = line(
      ['食べ', '動詞,一般', '食べる'],
      ['させ', '助動詞', 'させる'],
      ['て', '助詞,接続助詞'],
    );
    const out = combineConjunctiveParticle([tabe as Group, sase as Group, te as Group], ctx);
    expect(surfaces(out)).toEqual(['食べ', 'させて']);
    expect(out[1]).toMatchObject({ cls: 'Auxiliary', flags: { inflected: true, via: 'CombineConjunctiveParticle' } });
  });

  it('keeps て apart from a noun (犬|て)', () => {
    const input = line(['犬', '名詞,普通名詞'], ['て', '助詞,接続助詞']);
    expect(combineConjunctiveParticle(input, ctx)).toBe(input);
  });
});

describe('combineAuxiliary', () => {
  it('joins copula で and kanji 有る into である', () => {
    const out = combineAuxiliary(line(['で', '助動詞', 'だ'], ['有る', '動詞,非自立可能', '有る']), ctx);
    expect(out[0]).toMatchObject({ s: 'で有る', d: 'である', cls: 'Verb', flags: { kind: 'expression' } });
  });

  it('keeps で apart from a verb other than ある (で|いる)', () => {
    const input = line(['で', '助動詞', 'だ'], ['いる', '動詞,非自立可能']);
    expect(combineAuxiliary(input, ctx)).toBe(input);
  });

  it('joins だっ|た to a na-adjective without marking it inflected (静か|だっ|た)', () => {
    const out = combineAuxiliary(line(['静か', '形状詞,一般'], ['だっ', '助動詞', 'だ'], ['た', '助動詞']), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      s: '静かだった',
      d: '静か',
      cls: 'NaAdjective',
      flags: { via: 'CombineAuxiliary' },
    });
    expect(out[0]?.flags.inflected).toBeUndefined();
  });

  it('joins た to an i-adjective and marks it inflected (高かっ|た)', () => {
    const out = combineAuxiliary(line(['高かっ', '形容詞,一般', '高い'], ['た', '助動詞']), ctx);
    expect(out[0]).toMatchObject({ s: '高かった', d: '高い', flags: { inflected: true } });
  });

  it('joins た to an adjectival suffix (子供|っぽかっ|た)', () => {
    const out = combineAuxiliary(
      line(['子供', '名詞,普通名詞'], ['っぽかっ', '接尾辞,形容詞的', 'っぽい'], ['た', '助動詞']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['子供', 'っぽかった']);
  });

  it('does not host an auxiliary on a verb whose dictionary form is unknown (ほげ|ます)', () => {
    const input = line(['ほげ', '動詞,一般', 'ほげる'], ['ます', '助動詞']);
    expect(combineAuxiliary(input, withLexicon([]))).toBe(input);
  });

  it('keeps って apart from an imperative (行け|って)', () => {
    const input = line(['行け', '動詞,非自立可能,*,*,五段-カ行,命令形', '行く'], ['って', '助動詞', 'って']);
    expect(combineAuxiliary(input, ctx)).toBe(input);
  });

  it('keeps a quotative だって before a quote verb (大袈裟|だって|言い)', () => {
    const input = line(['大袈裟', '形状詞,一般'], ['だって', '助動詞', 'だ'], ['言い', '動詞,一般', '言う']);
    expect(combineAuxiliary(input, ctx)).toBe(input);
  });

  it('joins だって to a na-adjective when no quote verb follows (大袈裟|だって|よ, 大袈裟|だって)', () => {
    const yo = combineAuxiliary(
      line(['大袈裟', '形状詞,一般'], ['だって', '助動詞', 'だ'], ['よ', '助詞,終助詞']),
      ctx,
    );
    expect(surfaces(yo)).toEqual(['大袈裟だって', 'よ']);
    const last = combineAuxiliary(line(['大袈裟', '形状詞,一般'], ['だって', '助動詞', 'だ']), ctx);
    expect(surfaces(last)).toEqual(['大袈裟だって']);
  });

  it('keeps the copula だ after a slurred negative (知らん|だ) and after an adjective (高い|だ)', () => {
    const shiran = line(['知らん', '動詞,一般', '知る'], ['だ', '助動詞']);
    expect(combineAuxiliary(shiran, withLexicon(['知る']))).toBe(shiran);
    const takai = line(['高い', '形容詞,一般'], ['だ', '助動詞']);
    expect(combineAuxiliary(takai, ctx)).toBe(takai);
  });

  it('keeps the contracted copula じゃ apart (行く|じゃ)', () => {
    const input = line(['行く', '動詞,非自立可能'], ['じゃ', '助動詞', 'だ']);
    expect(combineAuxiliary(input, ctx)).toBe(input);
  });

  it('names the contracted しまう compound when the dictionary has it (忘れ|ちまう)', () => {
    const known = combineAuxiliary(
      line(['忘れ', '動詞,一般', '忘れる'], ['ちまう', '助動詞', 'ちまう']),
      withLexicon(['忘れる', '忘れちまう']),
    );
    expect(known[0]).toMatchObject({ s: '忘れちまう', d: '忘れちまう' });
    const unknown = combineAuxiliary(
      line(['忘れ', '動詞,一般', '忘れる'], ['ちまう', '助動詞', 'ちまう']),
      withLexicon(['忘れる']),
    );
    expect(unknown[0]).toMatchObject({ s: '忘れちまう', d: '忘れる' });
  });

  it('joins た to an expression ending in て (に関して|た)', () => {
    const [head, ta] = line(['に関して', '助詞,格助詞'], ['た', '助動詞']) as [Group, Group];
    const out = combineAuxiliary([{ ...head, cls: 'Expression' }, ta], ctx);
    expect(out[0]).toMatchObject({ s: 'に関してた', cls: 'Expression', flags: { via: 'CombineAuxiliary' } });
  });

  it('keeps an expression apart from an auxiliary other than た, or when it does not end in て', () => {
    const [head, masu] = line(['に関して', '助詞,格助詞'], ['ます', '助動詞']) as [Group, Group];
    const notTa = [{ ...head, cls: 'Expression' as const }, masu];
    expect(combineAuxiliary(notTa, ctx)).toBe(notTa);
    const [sore, ta] = line(['それとも', '接続詞'], ['た', '助動詞']) as [Group, Group];
    const notTe = [{ ...sore, cls: 'Expression' as const }, ta];
    expect(combineAuxiliary(notTe, ctx)).toBe(notTe);
  });
});

describe('combineToNaru', () => {
  it('joins と|なり after a noun before punctuation (トラウマ|と|なり|、)', () => {
    const out = combineToNaru(
      line(
        ['トラウマ', '名詞,普通名詞'],
        ['と', '助詞,格助詞'],
        ['なり', '動詞,非自立可能', 'なる'],
        ['、', '補助記号,読点'],
      ),
      ctx,
    );
    expect(surfaces(out)).toEqual(['トラウマ', 'となり', '、']);
    expect(out[1]).toMatchObject({
      b: 4,
      e: 7,
      d: 'となる',
      n: 'なる',
      cls: 'Verb',
      r: 'となり',
      flags: { via: 'CombineToNaru' },
    });
    expect(out[1]?.members.map((member) => member.s)).toEqual(['と', 'なり']);
  });

  it.each([
    ['kanji 成る after a pronoun (それ|と|成り)', 'それ', '代名詞', '成り', '動詞,一般', '成る', {}],
    [
      'an auxiliary なる known by its normalised form (静か|と|なっ)',
      '静か',
      '形状詞,一般',
      'なっ',
      '助動詞',
      'なっ',
      { n: 'なる' },
    ],
    [
      '成る by its normalised form when the lemma is the surface (彼|と|成っ)',
      '彼',
      '代名詞',
      '成っ',
      '動詞,一般',
      '成っ',
      { n: '成る' },
    ],
  ])('joins %s', (_name, head, headPos, naru, naruPos, d, extra) => {
    const out = combineToNaru(line([head, headPos], ['と', '助詞,格助詞'], [naru, naruPos, d, extra]), ctx);
    expect(surfaces(out)).toEqual([head, `と${naru}`]);
    expect(out[1]?.d).toBe('となる');
  });

  it('leaves と|なる after a verb, at the start, with a long tail, or before another verb', () => {
    const afterVerb = line(['行く', '動詞,非自立可能'], ['と', '助詞,格助詞'], ['なる', '動詞,非自立可能']);
    expect(combineToNaru(afterVerb, ctx)).toBe(afterVerb);
    const initial = line(['と', '助詞,格助詞'], ['なる', '動詞,非自立可能']);
    expect(combineToNaru(initial, ctx)).toBe(initial);
    const long = line(['犬', '名詞,普通名詞'], ['と', '助詞,格助詞'], ['なりまして', '動詞,非自立可能', 'なる']);
    expect(combineToNaru(long, ctx)).toBe(long);
    const other = line(['犬', '名詞,普通名詞'], ['と', '助詞,格助詞'], ['遊ぶ', '動詞,一般']);
    expect(combineToNaru(other, ctx)).toBe(other);
    const particle = line(['犬', '名詞,普通名詞'], ['と', '助詞,格助詞'], ['なる', '名詞,普通名詞']);
    expect(combineToNaru(particle, ctx)).toBe(particle);
    const trailing = line(['犬', '名詞,普通名詞'], ['と', '助詞,格助詞']);
    expect(combineToNaru(trailing, ctx)).toBe(trailing);
  });
});

describe('combineAdverbialParticle', () => {
  it('joins たり to a verb (食べ|たり)', () => {
    const out = combineAdverbialParticle(line(['食べ', '動詞,一般', '食べる'], ['たり', '助詞,副助詞']), ctx);
    expect(out[0]).toMatchObject({
      s: '食べたり',
      d: '食べる',
      flags: { inflected: true, via: 'CombineAdverbialParticle' },
    });
  });

  it('keeps たり apart from a noun (雨|たり) and leaves other adverbial particles (食べ|など)', () => {
    const noun = line(['雨', '名詞,普通名詞'], ['たり', '助詞,副助詞']);
    expect(combineAdverbialParticle(noun, ctx)).toBe(noun);
    const nado = line(['食べ', '動詞,一般', '食べる'], ['など', '助詞,副助詞']);
    expect(combineAdverbialParticle(nado, ctx)).toBe(nado);
  });
});

describe('combineVerbDependant: dependants tagged 非自立', () => {
  it('joins a dependant verb to the verb before it (食べて|しまう)', () => {
    const out = combineVerbDependant(line(['食べて', '動詞,一般', '食べる'], ['しまう', '動詞,非自立']), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      s: '食べてしまう',
      d: '食べる',
      flags: { inflected: true, via: 'CombineVerbDependant' },
    });
  });

  it.each([
    ['おる', ['来て', '動詞,一般', '来る'], ['おる', '動詞,非自立']],
    ['a repeated surface', ['いる', '動詞,一般'], ['いる', '動詞,非自立']],
    ['an interjection (持ち|あ)', ['持ち', '動詞,一般', '持つ'], ['あ', '感動詞,非自立']],
    ['an adjective te-form', ['良くて', '動詞,一般', '良い'], ['しまう', '動詞,非自立']],
    ['a non-verb host', ['犬', '名詞,普通名詞'], ['しまう', '動詞,非自立']],
  ] as const)('does not join %s', (_name, head, tail) => {
    const input = line([...head] as [string, string, string?], [...tail] as [string, string]);
    expect(surfaces(combineVerbDependant(input, ctx))).toEqual([head[0], tail[0]]);
  });
});

describe('combineVerbDependant: possible dependants', () => {
  it('joins aspectual だす only to a listed compound (走り|だし, kana or kanji)', () => {
    const kana = combineVerbDependant(
      line(['走り', '動詞,一般', '走る'], ['だし', '動詞,非自立可能', 'だす']),
      withLexicon(['走りだす']),
    );
    expect(surfaces(kana)).toEqual(['走りだし']);
    const kanji = combineVerbDependant(
      line(['走り', '動詞,一般', '走る'], ['だし', '動詞,非自立可能', 'だす']),
      withLexicon(['走り出す']),
    );
    expect(surfaces(kanji)).toEqual(['走りだし']);
    const unlisted = line(['混じり', '動詞,一般', '混じる'], ['だし', '動詞,非自立可能', 'だす']);
    expect(surfaces(combineVerbDependant(unlisted, withLexicon([])))).toEqual(['混じり', 'だし']);
  });

  it('joins 得る only to a listed compound (あり|得る)', () => {
    const listed = combineVerbDependant(
      line(['あり', '動詞,非自立可能', 'ある'], ['得る', '動詞,非自立可能', '得る']),
      withLexicon(['あり得る']),
    );
    expect(surfaces(listed)).toEqual(['あり得る']);
    const unlisted = line(['見', '動詞,一般', '見る'], ['得る', '動詞,非自立可能', '得る']);
    expect(surfaces(combineVerbDependant(unlisted, withLexicon([])))).toEqual(['見', '得る']);
  });

  it('joins する after a form ending in た or だ (言いかけた|する)', () => {
    const out = combineVerbDependant(line(['言いかけた', '動詞,一般', '言いかける'], ['する', '動詞,非自立可能']), ctx);
    expect(surfaces(out)).toEqual(['言いかけたする']);
  });

  it('joins する after a past form ending in だ (遊んだ|する)', () => {
    const out = combineVerbDependant(line(['遊んだ', '動詞,一般', '遊ぶ'], ['する', '動詞,非自立可能']), ctx);
    expect(surfaces(out)).toEqual(['遊んだする']);
  });

  it('joins 付く when the り-compound is listed (擦り|付い → 擦り付く)', () => {
    const listed = combineVerbDependant(
      line(['擦り', '動詞,一般', '擦る'], ['付い', '動詞,非自立可能', '付く']),
      withLexicon(['擦り付く']),
    );
    expect(surfaces(listed)).toEqual(['擦り付い']);
    const unlisted = line(['擦り', '動詞,一般', '擦る'], ['付い', '動詞,非自立可能', '付く']);
    expect(surfaces(combineVerbDependant(unlisted, withLexicon([])))).toEqual(['擦り', '付い']);
  });

  it('keeps a classical wa-row te-form apart (し|貰いて)', () => {
    const input = line(['し', '動詞,非自立可能', 'する'], ['貰いて', '動詞,非自立可能', '貰う']);
    expect(surfaces(combineVerbDependant(input, withLexicon([])))).toEqual(['し', '貰いて']);
  });
});

describe('combineVerbDependant: a suru-noun and する', () => {
  it('joins literary す (為る) to a suru-noun (愛|す → 愛する)', () => {
    const out = combineVerbDependant(
      line(['愛', '名詞,普通名詞,サ変可能'], ['す', '動詞,非自立可能', 'す', { n: '為る' }]),
      ctx,
    );
    expect(out[0]).toMatchObject({ s: '愛す', d: '愛する', cls: 'Verb' });
  });

  it('keeps the lemma of a suru-capable word that is no longer a noun (心配|して)', () => {
    const [shinpai, shite] = line(['心配', '名詞,普通名詞,サ変形状詞可能'], ['して', '動詞,非自立可能', 'する']) as [
      Group,
      Group,
    ];
    const out = combineVerbDependant([{ ...shinpai, cls: 'NaAdjective' }, shite], ctx);
    expect(out[0]).toMatchObject({ s: '心配して', d: '心配', cls: 'Verb' });
  });

  it('keeps plain する, しない and すぎ forms apart from the noun (勉強|する, 勉強|しすぎ)', () => {
    for (const [s, d] of [
      ['する', 'する'],
      ['しない', 'する'],
      ['しすぎ', 'する'],
      ['し過ぎ', 'する'],
      ['す', 'す'],
    ]) {
      const input = line(['勉強', '名詞,普通名詞,サ変可能'], [s as string, '動詞,非自立可能', d]);
      expect(surfaces(combineVerbDependant(input, ctx))).toEqual(['勉強', s]);
    }
  });
});

describe('combineVerbDependant: て-forms and subsidiary verbs', () => {
  it('joins a て-form chain verb across a separate て (待っ|て|いる)', () => {
    const out = combineVerbDependant(
      line(['待っ', '動詞,一般', '待つ'], ['て', '助詞,接続助詞'], ['いる', '動詞,非自立可能']),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '待っている', d: '待つ' });
  });

  it('joins これ as the potential stem of 来る after a て-form (戻って|これ|なかっ)', () => {
    const out = combineVerbDependant(
      line(['戻って', '動詞,一般', '戻る'], ['これ', '代名詞'], ['なかっ', '助動詞', 'ない']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['戻ってこれ', 'なかっ']);
  });

  it('keeps a demonstrative after a て-form (夢見て|これ|は)', () => {
    const input = line(['夢見て', '動詞,一般', '夢見る'], ['これ', '代名詞'], ['は', '助詞,係助詞']);
    expect(combineVerbDependant(input, ctx)).toBe(input);
    const last = line(['夢見て', '動詞,一般', '夢見る'], ['これ', '代名詞']);
    expect(combineVerbDependant(last, ctx)).toBe(last);
  });

  it('joins a subsidiary verb found by its normalised form when the lemma is the surface (書いて|呉れ)', () => {
    const out = combineVerbDependant(
      line(['書いて', '動詞,一般', '書く'], ['呉れ', '動詞,一般', '呉れ', { n: '呉れる' }]),
      ctx,
    );
    expect(surfaces(out)).toEqual(['書いて呉れ']);
  });

  it('joins a subsidiary verb found by deconjugating its surface (書いて|あげて)', () => {
    const out = combineVerbDependant(line(['書いて', '動詞,一般', '書く'], ['あげて', '名詞,普通名詞']), ctx);
    expect(surfaces(out)).toEqual(['書いてあげて']);
  });

  it('keeps おる, an adjective and an unrelated verb after a て-form apart', () => {
    const oru = line(['来て', '動詞,一般', '来る'], ['おる', '動詞,一般', 'おる']);
    expect(surfaces(combineVerbDependant(oru, ctx))).toEqual(['来て', 'おる']);
    const adjective = line(['来て', '動詞,一般', '来る'], ['ほしい', '形容詞,非自立可能']);
    expect(combineVerbDependant(adjective, ctx)).toBe(adjective);
    const unrelated = line(['来て', '動詞,一般', '来る'], ['走る', '動詞,一般']);
    expect(combineVerbDependant(unrelated, ctx)).toBe(unrelated);
  });

  it('keeps an i-adjective te-form and a classical wa-row te-form apart (良くて|やり, 来て|もらいて)', () => {
    const kute = line(['良くて', '形容詞,一般', '良い'], ['やり', '動詞,非自立可能', 'やる']);
    expect(combineVerbDependant(kute, ctx)).toBe(kute);
    const classical = line(['来て', '動詞,一般', '来る'], ['もらいて', '動詞,非自立可能', 'もらう']);
    expect(combineVerbDependant(classical, withLexicon([]))).toBe(classical);
  });

  it('joins the dialectal とる after a っ stem (待っ|とる)', () => {
    const out = combineVerbDependant(line(['待っ', '動詞,一般', '待つ'], ['とる', '動詞,非自立可能']), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '待っとる', d: '待つ', flags: { inflected: true } });
  });

  it('keeps a kanji 取る after a っ stem (待っ|取る), since it is not a contracted ておる', () => {
    const input = line(['待っ', '動詞,一般', '待つ'], ['取る', '動詞,一般', 'とる']);
    expect(combineVerbDependant(input, ctx)).toBe(input);
  });
});
