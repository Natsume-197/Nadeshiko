import { describe, expect, it } from 'vitest';
import { type CombineContext, type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import { combineInflections, tryGodanDictForm } from '@app/services/parser/combine/stages/inflections';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { Morpheme } from '@app/services/parser/sudachi';

/** A hand-made morpheme: surface, start offset, UniDic POS (comma-separated), lemma, reading, normalised form. */
function m(s: string, b: number, pos: string, d = s, r = s, n = d): Morpheme {
  const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
  return { s, b, e: b + [...s].length, pos: fields, d, n, r, a: [] };
}

/** Morphemes laid end to end: each entry is [surface, pos, lemma?, normalised?]. */
function line(...parts: Array<[string, string, string?, string?]>): Group[] {
  let b = 0;
  return toGroups(
    parts.map(([s, pos, d, n]) => {
      const morpheme = m(s, b, pos, d ?? s, s, n ?? d ?? s);
      b = morpheme.e;
      return morpheme;
    }),
  );
}

const VERB_REN = '動詞,一般,*,*,五段,連用形-一般';
const AUX = '助動詞';
const CONJ_PARTICLE = '助詞,接続助詞';
const SURU_NOUN = '名詞,普通名詞,サ変可能';
const NA_ADJ = '形状詞,一般';

const lexicon = new InMemoryLexicon(
  [
    '書く',
    '食べる',
    '行く',
    '来る',
    '言う',
    '待つ',
    'わかる',
    '知る',
    'やる',
    '良い',
    '静か',
    '卑下',
    '帰投',
    '愛',
    '愛す',
    '心配',
    'がる',
    '読む',
  ],
  { verb: ['読みまくる'], 'adj-i': ['読みづらい'] },
);
const ctx: CombineContext = { lexicon, deconjugate };

const surfaces = (groups: readonly Group[]) => groups.map((group) => group.s);
const run = (groups: Group[]) => combineInflections(groups, ctx);

describe('tryGodanDictForm', () => {
  it.each([
    ['切り', '切る'],
    ['回り', '回る'],
    ['話し', '話す'],
    ['持ち', '持つ'],
    ['飛び', '飛ぶ'],
    ['読み', '読む'],
    ['死に', '死ぬ'],
    ['書き', '書く'],
    ['泳ぎ', '泳ぐ'],
    ['買い', '買う'],
  ])('reads the 連用形 %s back to %s', (stem, dict) => {
    expect(tryGodanDictForm(stem)).toBe(dict);
  });

  it('has no godan form for an ichidan stem (食べ) or a single kana (り)', () => {
    expect(tryGodanDictForm('食べ')).toBeNull();
    expect(tryGodanDictForm('り')).toBeNull();
  });
});

describe('CombineInflections: what may start a merge', () => {
  it('leaves a single group alone', () => {
    const input = line(['書く', '動詞,一般', '書く']);
    expect(run(input)).toBe(input);
  });

  it('does not start from the 助動詞語幹 そう (降る|そう|だ keeps そう|だ apart)', () => {
    const input = line(['降る', '動詞,一般', '降る'], ['そう', '形状詞,助動詞語幹'], ['だ', AUX]);
    expect(surfaces(run(input))).toEqual(['降る', 'そう', 'だ']);
  });

  it('starts from a verb-like suffix: 怖|がっ|て joins がって (がる)', () => {
    const input = line(['怖', '形容詞,一般', '怖い'], ['がっ', '接尾辞,動詞的', 'がる'], ['て', CONJ_PARTICLE]);
    const out = run(input);
    expect(surfaces(out)).toEqual(['怖', 'がって']);
    expect(out[1]).toMatchObject({ d: 'がる', cls: 'Suffix', flags: { inflected: true, via: 'CombineInflections' } });
  });
});

describe('CombineInflections: where a merge stops', () => {
  it.each([
    [
      'a sentence-final よ',
      [
        ['行く', '動詞,一般', '行く'],
        ['よ', '助詞,終助詞'],
      ],
      ['行く', 'よ'],
    ],
    [
      'the prohibitive な',
      [
        ['行く', '動詞,一般', '行く'],
        ['な', '助詞,終助詞'],
      ],
      ['行く', 'な'],
    ],
    [
      'standalone よう (様)',
      [
        ['食べる', '動詞,一般', '食べる'],
        ['よう', '形状詞,助動詞語幹'],
      ],
      ['食べる', 'よう'],
    ],
    [
      'いけ after ちゃ (食べちゃ|いけ|ない)',
      [
        ['食べ', '動詞,一般', '食べる'],
        ['ちゃ', CONJ_PARTICLE],
        ['いけ', '動詞,非自立可能', 'いける'],
        ['ない', AUX],
      ],
      ['食べちゃ', 'いけ', 'ない'],
    ],
    [
      'quotative って after an imperative (来い|って)',
      [
        ['来い', '動詞,非自立可能,*,*,カ行変格,命令形', '来る'],
        ['って', '助詞,副助詞'],
      ],
      ['来い', 'って'],
    ],
    [
      'って before ん (言う|って|ん|だ)',
      [
        ['言う', '動詞,一般', '言う'],
        ['って', '助詞,副助詞'],
        ['ん', '助詞,準体助詞', 'の'],
        ['だ', AUX],
      ],
      ['言う', 'って', 'ん', 'だ'],
    ],
    [
      'って before a quote verb (行く|って|思う)',
      [
        ['行く', '動詞,一般', '行く'],
        ['って', '助詞,副助詞'],
        ['思う', '動詞,一般', '思う'],
      ],
      ['行く', 'って', '思う'],
    ],
    [
      'って at the end of the sentence',
      [
        ['行く', '動詞,一般', '行く'],
        ['って', '助詞,副助詞'],
      ],
      ['行く', 'って'],
    ],
    [
      'って before a noun (行く|って|話)',
      [
        ['行く', '動詞,一般', '行く'],
        ['って', '助詞,副助詞'],
        ['話', '名詞,普通名詞,一般'],
      ],
      ['行く', 'って', '話'],
    ],
    [
      'って before a sentence-ending さ (待つ|って|さ)',
      [
        ['待つ', '動詞,一般', '待つ'],
        ['って', '助詞,副助詞'],
        ['さ', '助詞,終助詞'],
      ],
      ['待つ', 'って', 'さ'],
    ],
    [
      'a benefactive after て (書いて|いただき)',
      [
        ['書い', '動詞,一般,*,*,五段-カ行,連用形-イ音便', '書く'],
        ['て', CONJ_PARTICLE],
        ['いただき', '動詞,非自立可能', 'いただく'],
        ['ます', AUX],
      ],
      ['書いて', 'いただき', 'ます'],
    ],
    [
      'a verb after an adjective くて (良くて|やりたい)',
      [
        ['良く', '形容詞,非自立可能,*,*,形容詞,連用形-一般', '良い'],
        ['て', CONJ_PARTICLE],
        ['やり', VERB_REN, 'やる'],
        ['たい', AUX],
      ],
      ['良くて', 'やりたい'],
    ],
    [
      'じゃ after a na-adjective (静か|じゃ)',
      [
        ['静か', NA_ADJ],
        ['じゃ', AUX, 'だ'],
      ],
      ['静か', 'じゃ'],
    ],
    [
      'the copula で after a na-adjective (静か|で)',
      [
        ['静か', NA_ADJ],
        ['で', AUX, 'だ'],
      ],
      ['静か', 'で'],
    ],
  ] as Array<[string, Array<[string, string, string?]>, string[]]>)('stops before %s', (_label, parts, expected) => {
    expect(surfaces(run(line(...parts)))).toEqual(expected);
  });

  it('lets the negative stem な through before すぎる: わから|な|すぎる is one word (わかる)', () => {
    const input = line(
      ['わから', '動詞,一般,*,*,五段-ラ行,未然形-一般', 'わかる'],
      ['な', AUX, 'ない'],
      ['すぎる', '動詞,非自立可能', 'すぎる'],
    );
    const out = run(input);
    expect(surfaces(out)).toEqual(['わからなすぎる']);
    expect(out[0]).toMatchObject({ d: 'わかる', cls: 'Verb', flags: { inflected: true } });
  });

  it('stops before a part that is no inflection (書く|本)', () => {
    expect(surfaces(run(line(['書く', '動詞,一般', '書く'], ['本', '名詞,普通名詞,一般'])))).toEqual(['書く', '本']);
  });
});

describe('CombineInflections: parts Sudachi mis-tags', () => {
  it('takes the interjection やれ after a て-form as auxiliary やる (書いてやれ)', () => {
    const out = run(
      line(['書い', '動詞,一般,*,*,五段-カ行,連用形-イ音便', '書く'], ['て', CONJ_PARTICLE], ['やれ', '感動詞,一般']),
    );
    expect(surfaces(out)).toEqual(['書いてやれ']);
    expect(out[0]).toMatchObject({ d: '書く', cls: 'Verb' });
  });

  it('takes the noun ねえ (姉) after a て-form as the colloquial negative (知ってねえ)', () => {
    const out = run(
      line(
        ['知っ', '動詞,一般,*,*,五段-ラ行,連用形-促音便', '知る'],
        ['て', CONJ_PARTICLE],
        ['ねえ', '名詞,普通名詞,一般', '姉'],
      ),
    );
    expect(surfaces(out)).toEqual(['知ってねえ']);
    expect(out[0]?.d).toBe('知る');
  });

  it('keeps the noun ねえ apart after a form that is no て-form (書く|ねえ)', () => {
    expect(surfaces(run(line(['書く', '動詞,一般', '書く'], ['ねえ', '名詞,普通名詞,一般', '姉'])))).toEqual([
      '書く',
      'ねえ',
    ]);
  });

  it('joins なさそう, tagged a na-adjective, to a negative stem and stops there (食べなさそう|だ)', () => {
    const out = run(
      line(['食べ', '動詞,一般,*,*,下一段-バ行,未然形-一般', '食べる'], ['なさそう', NA_ADJ], ['だ', AUX]),
    );
    expect(surfaces(out)).toEqual(['食べなさそう', 'だ']);
    expect(out[0]).toMatchObject({ d: '食べる', cls: 'Verb', flags: { inflected: true } });
  });

  it('leaves なさそう apart when the whole does not deconjugate to the base', () => {
    const input = line(['勉強', SURU_NOUN], ['なさそう', NA_ADJ]);
    expect(surfaces(run(input))).toEqual(['勉強', 'なさそう']);
  });

  it('takes Kansai せん after a suru noun as its negative (卑下せん → 卑下する)', () => {
    const out = run(line(['卑下', SURU_NOUN], ['せん', '名詞,普通名詞,一般', '千'], ['か', '助詞,終助詞']));
    expect(surfaces(out)).toEqual(['卑下せん', 'か']);
    expect(out[0]).toMatchObject({ d: '卑下する', cls: 'Verb' });
  });
});

describe('CombineInflections: suru nouns and na-adjectives', () => {
  it('keeps す before べき apart from a suru noun (帰投|す|べき is する + べき)', () => {
    const input = line(
      ['帰投', SURU_NOUN],
      ['す', '動詞,非自立可能,*,*,サ行変格,終止形-一般', 'する'],
      ['べき', AUX, 'べし'],
    );
    expect(surfaces(run(input))).toEqual(['帰投', 'す', 'べき']);
  });

  it('still joins す before べき when JMdict has the godan す verb (愛す)', () => {
    const input = line(
      ['愛', SURU_NOUN],
      ['す', '動詞,非自立可能,*,*,サ行変格,終止形-一般', 'する'],
      ['べき', AUX, 'べし'],
    );
    const out = run(input);
    expect(surfaces(out)[0]).toBe('愛す');
    expect(out[0]).toMatchObject({ d: '愛する', cls: 'Verb' });
  });

  it('joins a na-adjective and すぎる, keeping the adjective as its base (静かすぎる)', () => {
    const out = run(line(['静か', NA_ADJ], ['すぎる', '動詞,非自立可能', 'すぎる']));
    expect(surfaces(out)).toEqual(['静かすぎる']);
    expect(out[0]).toMatchObject({ d: '静か', cls: 'NaAdjective', flags: { inflected: true } });
  });

  it('does not join a na-adjective and the conjunctive で when only a verb reading would explain it', () => {
    expect(surfaces(run(line(['静か', NA_ADJ], ['で', CONJ_PARTICLE])))).toEqual(['静か', 'で']);
  });

  it('joins a suru/na noun and すぎる as a na-adjective (心配すぎる)', () => {
    const out = run(line(['心配', '名詞,普通名詞,サ変形状詞可能'], ['すぎる', '動詞,非自立可能', 'すぎる']));
    expect(surfaces(out)).toEqual(['心配すぎる']);
    expect(out[0]).toMatchObject({ d: '心配', cls: 'NaAdjective' });
  });

  it('leaves a suru/na noun and a conjunctive で apart (心配|で)', () => {
    expect(surfaces(run(line(['心配', '名詞,普通名詞,サ変形状詞可能'], ['で', CONJ_PARTICLE])))).toEqual([
      '心配',
      'で',
    ]);
  });

  it('needs the base itself in JMdict for the na reading (安心 unknown: 安心|すぎる stays)', () => {
    expect(
      surfaces(run(line(['安心', '名詞,普通名詞,サ変形状詞可能'], ['すぎる', '動詞,非自立可能', 'すぎる']))),
    ).toEqual(['安心', 'すぎる']);
  });
});

describe('CombineInflections: compound verbs and suffixes', () => {
  it('joins a 連用形 and a dependent verb into a compound JMdict lists (読みまくる)', () => {
    const out = run(line(['読み', VERB_REN, '読む'], ['まくる', '動詞,非自立可能', 'まくる']));
    expect(surfaces(out)).toEqual(['読みまくる']);
    expect(out[0]).toMatchObject({ d: '読みまくる', cls: 'Verb', flags: { inflected: true } });
  });

  it('leaves the compound apart when JMdict does not list it (書き|まくる)', () => {
    expect(surfaces(run(line(['書き', VERB_REN, '書く'], ['まくる', '動詞,非自立可能', 'まくる'])))).toEqual([
      '書き',
      'まくる',
    ]);
  });

  it('turns a 連用形 + adjectival suffix into an i-adjective and keeps inflecting it (読みづらくて)', () => {
    const out = run(
      line(
        ['読み', VERB_REN, '読む'],
        ['づらく', '接尾辞,形容詞的,*,*,形容詞,連用形-一般', 'づらい'],
        ['て', CONJ_PARTICLE],
      ),
    );
    expect(surfaces(out)).toEqual(['読みづらくて']);
    expect(out[0]).toMatchObject({ d: '読みづらい', cls: 'IAdjective' });
  });

  it('tries the godan dictionary form of a suffix lemma (話し|ぶり: 振る), and stays apart without a match', () => {
    expect(surfaces(run(line(['話し', VERB_REN, '話す'], ['ぶり', '接尾辞,名詞的,一般', '振り'])))).toEqual([
      '話し',
      'ぶり',
    ]);
  });

  it('stays apart after a suffix whose lemma has no godan form (割れ|目)', () => {
    expect(
      surfaces(run(line(['割れ', '動詞,一般,*,*,下一段-ラ行,連用形-一般', '割れる'], ['目', '接尾辞,名詞的,一般']))),
    ).toEqual(['割れ', '目']);
  });

  it('does not compound after a て-form (書いて|まくる)', () => {
    expect(
      surfaces(
        run(
          line(
            ['書い', '動詞,一般,*,*,五段-カ行,連用形-イ音便', '書く'],
            ['て', CONJ_PARTICLE],
            ['まくる', '動詞,非自立可能', 'まくる'],
          ),
        ),
      ),
    ).toEqual(['書いて', 'まくる']);
  });
});
