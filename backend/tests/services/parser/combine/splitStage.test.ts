import { describe, expect, it } from 'vitest';
import { type CombineContext, type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import {
  splitCompoundAuxiliaryVerbs,
  splitDoushiteContraction,
  splitEmphaticMoSuru,
  splitLexicalisedKaratte,
  splitTanSuffix,
  splitTatteParticle,
  splitTawakeNoun,
  splitUnattestedToAdverbs,
  splitUnresolvableSuruCompounds,
} from '@app/services/parser/combine/stages/split';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { Morpheme } from '@app/services/parser/sudachi';

/** One morpheme: [surface, UniDic POS (comma-separated), lemma?, katakana reading?, normalised form?]. */
type Spec = [string, string, string?, string?, string?];

/** Morphemes laid end to end, one group each. */
function line(...specs: Spec[]): Group[] {
  let b = 0;
  return toGroups(
    specs.map(([s, pos, d = s, r = s, n = d]) => {
      const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
      const morpheme: Morpheme = { s, b, e: b + [...s].length, pos: fields, d, n, r, a: [] };
      b = morpheme.e;
      return morpheme;
    }),
  );
}

const pinned = (group: Group, pin: number): Group => ({ ...group, flags: { ...group.flags, pin } });

const lexicon = new InMemoryLexicon(['凛', '堂々と', '思い出', '思い出す', '話し', '滲み出す', '田中', '気'], {
  exp: ['病は気から'],
  verb: ['見学', 'いく'],
});
const ctx: CombineContext = { lexicon, deconjugate };

const surfaces = (groups: readonly Group[]) => groups.map((group) => group.s);
const shape = (groups: readonly Group[]) => groups.map((group) => [group.s, group.d, group.cls, group.r]);

const ADVERB = '副詞';
const AUX = '助動詞';
const CONJ_PARTICLE = '助詞,接続助詞';

describe('SplitCompoundAuxiliaryVerbs', () => {
  it('splits 読み終わっ (no 読み終わる in JMdict) into 読み + 終わっ (終わる)', () => {
    const out = splitCompoundAuxiliaryVerbs(
      line(['読み終わっ', '動詞,一般,*,*,五段-ラ行,連用形-促音便', '読み終わる', 'ヨミオワッ'], ['た', AUX]),
      ctx,
    );
    expect(shape(out)).toEqual([
      ['読み', '読み', 'Verb', 'ヨミ'],
      ['終わっ', '終わる', 'Verb', 'オワッ'],
      ['た', 'た', 'Auxiliary', 'た'],
    ]);
    expect(out[0]?.pos).toEqual(['動詞', '一般', '*', '*', '*', '連用形-一般']);
    expect(out[1]?.sec).toEqual(['非自立可能', '*', '*']);
  });

  it('splits 見合っ by its stem 合 (合う)', () => {
    const out = splitCompoundAuxiliaryVerbs(line(['見合っ', '動詞,一般', '見合う', 'ミアッ']), ctx);
    expect(surfaces(out)).toEqual(['見', '合っ']);
    expect(out[1]?.d).toBe('合う');
  });

  it('keeps an attested compound whole for its own reading (滲み出す)', () => {
    const input = line(['滲み出す', '動詞,一般', '滲み出す']);
    expect(splitCompoundAuxiliaryVerbs(input, ctx)).toBe(input);
  });

  it.each([
    ['a noun', ['終わり', '名詞,普通名詞,一般', '終わり']],
    ['a lemma under three characters', ['出す', '動詞,一般', '出す']],
    ['a verb with no auxiliary tail', ['食べる', '動詞,一般', '食べる']],
    ['a lemma that is the auxiliary itself (続ける)', ['続ける', '動詞,一般', '続ける']],
    ['a surface no longer than the main verb (読み for 読み終わる)', ['読み', '動詞,一般', '読み終わる']],
    ['an auxiliary without a stem to cut at (勉強し for 勉強する)', ['勉強し', '動詞,一般', '勉強する']],
    ['an auxiliary surface not in its stem spelling (書きだし for 書き出す)', ['書きだし', '動詞,一般', '書き出す']],
  ] as Array<[string, Spec]>)('leaves %s alone', (_label, spec) => {
    const input = line(spec);
    expect(splitCompoundAuxiliaryVerbs(input, ctx)).toBe(input);
  });
});

describe('SplitTatteParticle', () => {
  it('leaves a single group alone', () => {
    const input = line(['だな', '名詞,普通名詞,一般', '棚', 'タナ', '棚']);
    expect(splitTatteParticle(input, ctx)).toBe(input);
  });

  it('splits だな read as 棚 into だ + な (これだな)', () => {
    const out = splitTatteParticle(line(['これ', '代名詞'], ['だな', '名詞,普通名詞,一般', '棚', 'タナ', '棚']), ctx);
    expect(shape(out)).toEqual([
      ['これ', 'これ', 'Pronoun', 'これ'],
      ['だ', 'だ', 'Auxiliary', 'ダ'],
      ['な', 'な', 'Particle', 'ナ'],
    ]);
    expect(out[2]?.sec).toEqual(['終助詞', '*', '*']);
  });

  it('keeps 棚 when Sudachi normalised it to something else', () => {
    const input = line(['この', '連体詞'], ['だな', '名詞,普通名詞,一般', 'だな', 'ダナ', 'だな']);
    expect(splitTatteParticle(input, ctx)).toBe(input);
  });

  it('splits かって after a predicate into か + って (飲むかって)', () => {
    const out = splitTatteParticle(line(['飲む', '動詞,一般'], ['かって', ADVERB, 'かつて', 'カツテ']), ctx);
    expect(shape(out).slice(1)).toEqual([
      ['か', 'か', 'Particle', 'カ'],
      ['って', 'って', 'Particle', 'ッテ'],
    ]);
  });

  it('keeps かつて after a noun (昔かって)', () => {
    const input = line(['昔', '名詞,普通名詞,一般'], ['かって', ADVERB, 'かつて', 'カツテ']);
    expect(splitTatteParticle(input, ctx)).toBe(input);
  });

  it('splits いたって after a て 接続助詞 into い (いる) + た + って (見ていたって)', () => {
    const out = splitTatteParticle(
      line(
        ['見', '動詞,非自立可能', '見る', 'ミ'],
        ['て', CONJ_PARTICLE, 'て', 'テ'],
        ['いたって', ADVERB, '至って', 'イタッテ'],
      ),
      ctx,
    );
    expect(shape(out)).toEqual([
      ['見', '見る', 'Verb', 'ミ'],
      ['て', 'て', 'Particle', 'テ'],
      ['い', 'いる', 'Verb', 'イ'],
      ['た', 'た', 'Auxiliary', 'タ'],
      ['って', 'って', 'Particle', 'ッテ'],
    ]);
  });

  it('splits いたって after で too (読んでいたって)', () => {
    const out = splitTatteParticle(
      line(['読ん', '動詞,一般', '読む'], ['で', CONJ_PARTICLE], ['いたって', ADVERB, '至って', 'イタッテ']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['読ん', 'で', 'い', 'た', 'って']);
  });

  it.each([
    ['after は', ['は', '助詞,係助詞']],
    ['after a case particle で', ['で', '助詞,格助詞']],
    ['after a particle that is not て/で', ['が', CONJ_PARTICLE]],
  ] as Array<[string, Spec]>)('keeps 至って %s', (_label, prev) => {
    const input = line(prev, ['いたって', ADVERB, '至って', 'イタッテ']);
    expect(splitTatteParticle(input, ctx)).toBe(input);
  });

  it.each([
    ['an adjective (高くたって)', ['高く', '形容詞,一般', '高い']],
    ['an auxiliary (なくたって)', ['なく', AUX, 'ない']],
  ] as Array<[string, Spec]>)('splits たって after %s into た + って', (_label, prev) => {
    const out = splitTatteParticle(line(prev, ['たって', CONJ_PARTICLE]), ctx);
    expect(shape(out).slice(1)).toEqual([
      ['た', 'た', 'Auxiliary', 'タ'],
      ['って', 'って', 'Particle', 'ッテ'],
    ]);
  });

  it('splits だって after a verb into だ + って (読んだって)', () => {
    const out = splitTatteParticle(line(['読ん', '動詞,一般', '読む'], ['だって', CONJ_PARTICLE]), ctx);
    expect(surfaces(out)).toEqual(['読ん', 'だ', 'って']);
    expect(out[1]?.cls).toBe('Auxiliary');
  });

  it('keeps だって after a noun (猫だって)', () => {
    const input = line(['猫', '名詞,普通名詞,一般'], ['だって', CONJ_PARTICLE]);
    expect(splitTatteParticle(input, ctx)).toBe(input);
  });

  it('keeps a だって that is not a 接続助詞 (読んだって as a 副助詞)', () => {
    const input = line(['読ん', '動詞,一般', '読む'], ['だって', '助詞,副助詞']);
    expect(splitTatteParticle(input, ctx)).toBe(input);
  });
});

describe('SplitUnattestedToAdverbs', () => {
  it('splits 凛と (JMdict lists only 凛) into 凛 + と', () => {
    const out = splitUnattestedToAdverbs(
      line(['凛と', ADVERB, '凛と', 'リント'], ['し', '動詞,非自立可能', 'する']),
      ctx,
    );
    expect(shape(out)).toEqual([
      ['凛', '凛', 'Adverb', 'リン'],
      ['と', 'と', 'Particle', 'ト'],
      ['し', 'する', 'Verb', 'し'],
    ]);
    expect(out[1]?.sec).toEqual(['格助詞', '*', '*']);
  });

  it.each([
    ['a noun', ['凛と', '名詞,普通名詞,一般', '凛と', 'リント']],
    ['a single と', ['と', ADVERB, 'と', 'ト']],
    ['an adverb not ending in と', ['凛', ADVERB, '凛', 'リン']],
    ['a hiragana mimetic (ひっしと)', ['ひっしと', ADVERB, 'ひっしと', 'ヒッシト']],
    ['a reading under two kana', ['凛と', ADVERB, '凛と', 'ト']],
    ['a reading not ending in ト', ['凛と', ADVERB, '凛と', 'リンド']],
    ['an attested whole (堂々と)', ['堂々と', ADVERB, '堂々と', 'ドウドウト']],
    ['an unknown head (颯と)', ['颯と', ADVERB, '颯と', 'サット']],
  ] as Array<[string, Spec]>)('leaves %s alone', (_label, spec) => {
    const input = line(spec);
    expect(splitUnattestedToAdverbs(input, ctx)).toBe(input);
  });

  it('accepts a hiragana と at the end of the reading', () => {
    expect(surfaces(splitUnattestedToAdverbs(line(['凛と', ADVERB, '凛と', 'りんと']), ctx))).toEqual(['凛', 'と']);
  });

  it('leaves a pinned adverb alone', () => {
    const input = [pinned(line(['凛と', ADVERB, '凛と', 'リント'])[0] as Group, 1)];
    expect(splitUnattestedToAdverbs(input, ctx)).toBe(input);
  });
});

describe('SplitTanSuffix', () => {
  it('re-cuts イッ|たん|だ as イッた + ん + だ (a past the deconjugator reads)', () => {
    const out = splitTanSuffix(
      line(['イッ', '動詞,一般', '行く', 'イッ'], ['たん', '接尾辞,名詞的,一般', 'たん', 'タン'], ['だ', AUX]),
      ctx,
    );
    expect(out.map((group) => [group.s, group.cls, group.r])).toEqual([
      ['イッた', 'Verb', 'イッタ'],
      ['ん', 'Particle', 'ン'],
      ['だ', 'Auxiliary', 'だ'],
    ]);
    expect(out[1]).toMatchObject({ d: 'の', n: 'ん', sec: ['準体助詞', '*', '*'] });
  });

  it('keeps a name + たん (るみ|たん|だ): the past must be of a real verb', () => {
    const input = line(['るみ', '名詞,固有名詞,人名'], ['たん', '接尾辞,名詞的,一般', 'たん', 'タン'], ['だ', AUX]);
    expect(splitTanSuffix(input, ctx)).toBe(input);
  });

  it('re-cuts after a て-form: 見|て|たん|です → 見 + てた + ん + です', () => {
    const out = splitTanSuffix(
      line(['見', '動詞,非自立可能', '見る'], ['て', CONJ_PARTICLE], ['たん', '接尾辞,名詞的,一般'], ['です', AUX]),
      ctx,
    );
    expect(surfaces(out)).toEqual(['見', 'てた', 'ん', 'です']);
  });

  it('re-cuts after a で-form: 読んで|たん|だ', () => {
    const out = splitTanSuffix(line(['読んで', '動詞,一般', '読む'], ['たん', '接尾辞,名詞的,一般'], ['だ', AUX]), ctx);
    expect(surfaces(out)).toEqual(['読んでた', 'ん', 'だ']);
  });

  it('leaves a single group alone', () => {
    const input = line(['たん', '接尾辞,名詞的,一般']);
    expect(splitTanSuffix(input, ctx)).toBe(input);
  });

  it.each([
    [
      'at the start of the sentence',
      [
        ['たん', '接尾辞,名詞的,一般'],
        ['だ', AUX],
      ],
    ],
    [
      'when たん is a noun (反)',
      [
        ['イッ', '動詞,一般', '行く'],
        ['たん', '名詞,普通名詞,一般'],
        ['だ', AUX],
      ],
    ],
    [
      'when nothing follows',
      [
        ['イッ', '動詞,一般', '行く'],
        ['たん', '接尾辞,名詞的,一般'],
      ],
    ],
    [
      'before a particle',
      [
        ['イッ', '動詞,一般', '行く'],
        ['たん', '接尾辞,名詞的,一般'],
        ['が', '助詞,格助詞'],
      ],
    ],
    [
      'before an auxiliary that is no copula',
      [
        ['イッ', '動詞,一般', '行く'],
        ['たん', '接尾辞,名詞的,一般'],
        ['ます', AUX],
      ],
    ],
    [
      'after a blank',
      [
        ['　', '空白'],
        ['たん', '接尾辞,名詞的,一般'],
        ['だ', AUX],
      ],
    ],
    [
      'when the surface is not たん',
      [
        ['イッ', '動詞,一般', '行く'],
        ['たんと', '接尾辞,名詞的,一般'],
        ['だ', AUX],
      ],
    ],
  ] as Array<[string, Spec[]]>)('leaves たん alone %s', (_label, specs) => {
    const input = line(...specs);
    expect(splitTanSuffix(input, ctx)).toBe(input);
  });
});

describe('SplitTawakeNoun', () => {
  it.each([
    ['a particle', ['て', CONJ_PARTICLE]],
    ['an adverb', ['こう', ADVERB]],
    ['the small っ', ['っ', '補助記号,一般']],
  ] as Array<[string, Spec]>)('splits たわけ after %s into た + わけ', (_label, prev) => {
    const out = splitTawakeNoun(line(prev, ['たわけ', '名詞,普通名詞,一般', 'たわける', 'タワケ']), ctx);
    expect(shape(out).slice(1)).toEqual([
      ['た', 'た', 'Auxiliary', 'タ'],
      ['わけ', 'わけ', 'Noun', 'ワケ'],
    ]);
  });

  it.each([
    [
      'after a noun (この|馬鹿|たわけ)',
      [
        ['馬鹿', '名詞,普通名詞,一般'],
        ['たわけ', '名詞,普通名詞,一般', 'たわけ'],
      ],
    ],
    ['at the start', [['たわけ', '名詞,普通名詞,一般', 'たわけ']]],
    [
      'after a symbol other than っ',
      [
        ['！', '補助記号,句点'],
        ['たわけ', '名詞,普通名詞,一般', 'たわけ'],
      ],
    ],
    [
      'when the lemma is another word',
      [
        ['て', CONJ_PARTICLE],
        ['たわけ', '名詞,普通名詞,一般', '戯け'],
      ],
    ],
    [
      'for another surface',
      [
        ['て', CONJ_PARTICLE],
        ['たわけた', '名詞,普通名詞,一般', 'たわけ'],
      ],
    ],
  ] as Array<[string, Spec[]]>)('keeps 戯け %s', (_label, specs) => {
    const input = line(...specs);
    expect(splitTawakeNoun(input, ctx)).toBe(input);
  });
});

describe('SplitLexicalisedKaratte', () => {
  it('splits からって when から ends an expression: 病|は|気|からって → … 気 + から + って', () => {
    const out = splitLexicalisedKaratte(
      line(
        ['病', '名詞,普通名詞,一般'],
        ['は', '助詞,係助詞'],
        ['気', '名詞,普通名詞,一般'],
        ['からって', CONJ_PARTICLE],
      ),
      ctx,
    );
    expect(shape(out).slice(3)).toEqual([
      ['から', 'から', 'Particle', 'カラ'],
      ['って', 'って', 'Particle', 'ッテ'],
    ]);
  });

  it('finds the expression over fewer tokens when it starts closer (病は|気|からって)', () => {
    const out = splitLexicalisedKaratte(
      line(['病は', '名詞,普通名詞,一般'], ['気', '名詞,普通名詞,一般'], ['からって', CONJ_PARTICLE]),
      ctx,
    );
    expect(surfaces(out)).toEqual(['病は', '気', 'から', 'って']);
  });

  it('keeps からって when no expression ends in から (寒い|からって)', () => {
    const input = line(['寒い', '形容詞,一般'], ['からって', CONJ_PARTICLE]);
    expect(splitLexicalisedKaratte(input, ctx)).toBe(input);
  });

  it('keeps からって at the start of a sentence', () => {
    const input = line(['からって', CONJ_PARTICLE]);
    expect(splitLexicalisedKaratte(input, ctx)).toBe(input);
  });

  it('keeps a pinned からって', () => {
    const groups = line(['病は', '名詞,普通名詞,一般'], ['気', '名詞,普通名詞,一般'], ['からって', CONJ_PARTICLE]);
    const input = [groups[0] as Group, groups[1] as Group, pinned(groups[2] as Group, 1)];
    expect(splitLexicalisedKaratte(input, ctx)).toBe(input);
  });
});

describe('SplitDoushiteContraction', () => {
  it('re-cuts どうして before た as どう + し (する) + て (どうしてた)', () => {
    const out = splitDoushiteContraction(line(['どうして', ADVERB, 'どうして', 'ドウシテ'], ['た', AUX]), ctx);
    expect(shape(out)).toEqual([
      ['どう', 'どう', 'Adverb', 'ドウ'],
      ['し', 'する', 'Verb', 'シ'],
      ['て', 'てる', 'Auxiliary', 'テ'],
      ['た', 'た', 'Auxiliary', 'た'],
    ]);
  });

  it.each([
    [
      'before a verb (どうして|来た)',
      [
        ['どうして', ADVERB],
        ['来', '動詞,非自立可能', '来る'],
        ['た', AUX],
      ],
    ],
    ['at the end', [['どうして', ADVERB]]],
    [
      'when た is not an auxiliary',
      [
        ['どうして', ADVERB],
        ['た', '名詞,普通名詞,一般', '田'],
      ],
    ],
    [
      'when どうして is a conjunction',
      [
        ['どうして', '接続詞'],
        ['た', AUX],
      ],
    ],
  ] as Array<[string, Spec[]]>)('keeps どうして %s', (_label, specs) => {
    const input = line(...specs);
    expect(splitDoushiteContraction(input, ctx)).toBe(input);
  });
});

describe('SplitEmphaticMoSuru', () => {
  it.each(['ない', 'ませ', 'なかっ', 'ねえ'])('re-cuts かすり|もし|%s as も + し (する, pinned)', (tail) => {
    const out = splitEmphaticMoSuru(
      line(['かすり', '動詞,一般,*,*,五段-ラ行,連用形-一般', 'かする'], ['もし', ADVERB, 'もし', 'モシ'], [tail, AUX]),
      ctx,
    );
    expect(shape(out).slice(1, 3)).toEqual([
      ['も', 'も', 'Particle', 'モ'],
      ['し', 'する', 'Verb', 'シ'],
    ]);
    expect(out[2]?.flags.pin).toBe(1157170);
  });

  it.each([
    [
      'after a dictionary form (かする|もし)',
      [
        ['かする', '動詞,一般', 'かする'],
        ['もし', ADVERB],
        ['ない', AUX],
      ],
    ],
    [
      'after a noun',
      [
        ['夢', '名詞,普通名詞,一般'],
        ['もし', ADVERB],
        ['ない', AUX],
      ],
    ],
    [
      'at the start (もし雨なら)',
      [
        ['もし', ADVERB],
        ['雨', '名詞,普通名詞,一般'],
      ],
    ],
    [
      'before a past (かすり|もし|た)',
      [
        ['かすり', '動詞,一般', 'かする'],
        ['もし', ADVERB],
        ['た', AUX],
      ],
    ],
    [
      'at the end',
      [
        ['かすり', '動詞,一般', 'かする'],
        ['もし', ADVERB],
      ],
    ],
    [
      'when もし is no adverb',
      [
        ['かすり', '動詞,一般', 'かする'],
        ['もし', '接続詞'],
        ['ない', AUX],
      ],
    ],
  ] as Array<[string, Spec[]]>)('keeps もし %s', (_label, specs) => {
    const input = line(...specs);
    expect(splitEmphaticMoSuru(input, ctx)).toBe(input);
  });
});

describe('SplitUnresolvableSuruCompounds', () => {
  it('splits 話ししません: the normalised 話す cannot be reached from the surface', () => {
    const out = splitUnresolvableSuruCompounds(
      line(['話ししません', '動詞,一般', '話ししません', 'ハナシシマセン', '話す']),
      ctx,
    );
    expect(out.map((group) => [group.s, group.d, group.cls])).toEqual([
      ['話し', '話し', 'Noun'],
      ['しません', 'する', 'Verb'],
    ]);
    expect(out[0]?.pos).toEqual(['名詞', '普通名詞', 'サ変可能', '*', '*', '*']);
    expect(out[1]?.pos).toEqual(['動詞', '非自立可能', '*', '*', 'サ行変格', '*']);
  });

  it('keeps 思い出して: its lemma 思い出す is a word the deconjugator reaches', () => {
    const input = line(['思い出して', '動詞,一般', '思い出す']);
    expect(splitUnresolvableSuruCompounds(input, ctx)).toBe(input);
  });

  it('keeps 思い出せる: its normalised form 思い出す is reachable', () => {
    const input = line(['思い出せる', '動詞,一般', '思い出せる', 'オモイダセル', '思い出す']);
    expect(splitUnresolvableSuruCompounds(input, ctx)).toBe(input);
  });

  it('keeps 見学させて: JMdict has 見学 as a suru verb', () => {
    const input = line(['見学させて', '動詞,一般', '見学する']);
    expect(splitUnresolvableSuruCompounds(input, ctx)).toBe(input);
  });

  it.each([
    ['an adverb', ['話しします', ADVERB]],
    ['a surface under three characters', ['話し', '名詞,普通名詞,一般']],
    ['a kana-only surface', ['はなしします', '動詞,一般']],
    ['a surface JMdict has whole (思い出す)', ['思い出す', '動詞,一般']],
    ['a surface with no known noun before し/さ/す/せ', ['走らせる', '動詞,一般', '走る']],
    ['a tail that is no form of する (田中さま)', ['田中さま', '名詞,固有名詞,人名']],
  ] as Array<[string, Spec]>)('leaves %s alone', (_label, spec) => {
    const input = line(spec);
    expect(splitUnresolvableSuruCompounds(input, ctx)).toBe(input);
  });
});
