import { describe, expect, it } from 'vitest';
import { type CombineContext, fromMorpheme, type Group, InMemoryLexicon } from '@app/services/parser/combine';
import { toKatakana } from '@app/services/parser/combine/kana';
import {
  collapseReduplicatedMimetic,
  recombineHiraganaTokens,
  repairClippedAdjective,
  repairColloquialNegativeNee,
  repairColloquialRanNai,
  repairDanTobashi,
  repairFusedInterjectionParticle,
  repairHasaNoun,
  repairIntensifierKaeru,
  repairNounReadAsTeForm,
  repairOrphanedAuxiliary,
  repairQuotativeTte,
  repairSakkiMoraTheft,
  repairStolenUBeforeSsu,
  repairTankaToTaNKa,
  repairTteNani,
  repairVowelElongation,
} from '@app/services/parser/combine/stages/repair';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { Morpheme } from '@app/services/parser/sudachi';

// UniDic POS heads for the hand-made morphemes.
const NOUN = '名詞,普通名詞,一般';
const NAME = '名詞,固有名詞,一般';
const VERB = '動詞,一般';
const ADJ = '形容詞,一般';
const NA = '形状詞,一般';
const ADV = '副詞';
const CASE = '助詞,格助詞';
const CONJ_PRT = '助詞,接続助詞';
const FINAL = '助詞,終助詞';
const BOUND = '助詞,係助詞';
const AUX = '助動詞';
const INTJ = '感動詞,一般';
const SUFFIX = '接尾辞,名詞的,一般';
const PREFIX = '接頭辞';
const SYMBOL = '補助記号,一般';
const BLANK = '空白';
const PRON = '代名詞';
const CONJ = '接続詞';
const FILLER = 'フィラー';
const EXPR_HEAD = '名詞,普通名詞,一般';

/** One token: surface, POS, then optional dictionary form, katakana reading and normalised form. */
type Tok = [s: string, pos: string, d?: string, r?: string, n?: string];

/** A sentence of hand-made Sudachi morphemes, one group each, with offsets tiling the text. */
function sentence(...tokens: Tok[]): Group[] {
  let b = 0;
  return tokens.map(([s, pos, d = s, r, n = d]) => {
    const e = b + [...s].length;
    const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
    const morpheme: Morpheme = { s, b, e, pos: fields, d, n, r: r ?? toKatakana(s), a: [] };
    b = e;
    return fromMorpheme(morpheme);
  });
}

const cx = (keys: string[] = [], classes: ConstructorParameters<typeof InMemoryLexicon>[1] = {}): CombineContext => ({
  lexicon: new InMemoryLexicon(keys, classes),
  deconjugate,
});
const empty = cx();

const surfaces = (list: readonly Group[]) => list.map((group) => group.s);
const view = (list: readonly Group[]) => list.map((group) => [group.s, group.d, group.cls]);
const pinned = (group: Group, pin = 1): Group => ({ ...group, flags: { ...group.flags, pin } });
/** Sudachi's own class override (stages see Expression and CommonNoun groups built by earlier passes). */
const as = (group: Group, cls: Group['cls']): Group => ({ ...group, cls });

describe('repairHasaNoun', () => {
  it('splits a noun はさ into the particles は and さ (これはさ)', () => {
    const out = repairHasaNoun(sentence(['これ', PRON], ['はさ', NOUN], ['ね', FINAL]), empty);
    expect(view(out)).toEqual([
      ['これ', 'これ', 'Pronoun'],
      ['は', 'は', 'Particle'],
      ['さ', 'さ', 'Particle'],
      ['ね', 'ね', 'Particle'],
    ]);
    expect(out[2]).toMatchObject({ b: 3, e: 4 });
  });

  it('leaves はさ alone when Sudachi did not read it as a noun', () => {
    const input = sentence(['はさ', INTJ]);
    expect(repairHasaNoun(input, empty)).toBe(input);
  });
});

describe('repairVowelElongation: one token at a time', () => {
  it('a small-vowel stretch keeps an already lemmatised dictionary form (すごいぃ → 凄い)', () => {
    const out = repairVowelElongation(sentence(['すごいぃ', ADJ, '凄い']), cx(['すごい']));
    expect(out[0]).toMatchObject({ s: 'すごいぃ', d: '凄い' });
  });

  it.each<[string, Tok, string[]]>([
    ['a two-character token (ねぇ)', ['ねぇ', INTJ], ['ね']],
    ['a digraph, not a stretch (ソファ)', ['ソファ', NOUN], ['ソフ']],
    ['a token with kanji (寒いぃ)', ['寒いぃ', ADJ, '寒い'], ['寒い']],
    ['an attested surface (すげぇ)', ['すげぇ', ADJ, 'すげぇ'], ['すげぇ', 'すげ']],
    ['a stretch whose base is no word (ちょっとぉ, empty lexicon)', ['ちょっとぉ', ADV], []],
  ])('leaves %s alone', (_label, token, keys) => {
    const input = sentence(token);
    expect(repairVowelElongation(input, cx(keys))).toBe(input);
  });

  it('drops a particle’s trailing ー from its dictionary form (行くよー → よ)', () => {
    const out = repairVowelElongation(sentence(['行く', VERB], ['よー', FINAL]), empty);
    expect(out[1]).toMatchObject({ s: 'よー', d: 'よ', cls: 'Particle' });
  });

  it('leaves a particle with ー alone when it is already lemmatised or katakana (よー → よ, ネー)', () => {
    const lemmatised = sentence(['行く', VERB], ['よー', FINAL, 'よ']);
    expect(repairVowelElongation(lemmatised, empty)).toBe(lemmatised);
    const katakana = sentence(['行く', VERB], ['ネー', FINAL]);
    expect(repairVowelElongation(katakana, empty)).toBe(katakana);
  });

  it('drops an emphatic ー before a geminate from the lemma (パワーアーップ → パワーアップ)', () => {
    const out = repairVowelElongation(sentence(['パワーアーップ', NOUN]), cx(['パワーアップ']));
    expect(out[0]).toMatchObject({ s: 'パワーアーップ', d: 'パワーアップ', n: 'パワーアップ' });
  });

  it('keeps パワーアーップ when it is pinned or attested itself', () => {
    const lexicon = cx(['パワーアップ']);
    const pinnedInput = [pinned(sentence(['パワーアーップ', NOUN])[0] as Group)];
    expect(repairVowelElongation(pinnedInput, lexicon)).toBe(pinnedInput);
    const attested = sentence(['パワーアーップ', NOUN]);
    expect(repairVowelElongation(attested, cx(['パワーアップ', 'パワーアーップ']))).toBe(attested);
  });

  it('reads a doubled first mora before と as an emphatic と-adverb (ググンと → グンと)', () => {
    const out = repairVowelElongation(sentence(['ググン', ADV], ['と', CASE], ['伸びる', VERB]), cx(['ぐんと']));
    expect(view(out)).toEqual([
      ['ググンと', 'グンと', 'Adverb'],
      ['伸びる', '伸びる', 'Verb'],
    ]);
    expect(out[0]?.members.map((member) => member.s)).toEqual(['ググン', 'と']);
  });

  it('keeps ググン|と when ググンと itself is a word', () => {
    const input = sentence(['ググン', ADV], ['と', CASE]);
    expect(repairVowelElongation(input, cx(['ぐんと', 'ググンと']))).toBe(input);
  });

  it('reads katakana ケドー as the conjunction けど, not a name', () => {
    const out = repairVowelElongation(sentence(['行く', VERB], ['ケドー', NAME]), empty);
    expect(out[1]).toMatchObject({ s: 'ケドー', d: 'けど', n: 'けど', cls: 'Conjunction' });
  });

  it('drops a mid-word ー from the lemma of a kana spelling of a kanji word (すごーい → すごい)', () => {
    const out = repairVowelElongation(sentence(['すごーい', ADJ, 'すごーい', 'スゴーイ', '凄い']), empty);
    expect(out[0]).toMatchObject({ s: 'すごーい', d: 'すごい' });
  });

  it('keeps a mid-word ー when the normalised form is neither kanji nor the stripped text', () => {
    const kana = sentence(['すごーい', ADJ, 'すごーい', 'スゴーイ', 'すごーい']);
    expect(repairVowelElongation(kana, empty)).toBe(kana);
    const interjection = sentence(['あーあ', INTJ]);
    expect(repairVowelElongation(interjection, empty)).toBe(interjection);
    const mixed = sentence(['すゴーい', ADJ, 'すごーい', 'スゴーイ', '凄い']);
    expect(repairVowelElongation(mixed, empty)).toBe(mixed);
  });
});

describe('repairVowelElongation: neighbouring tokens', () => {
  it('folds a filler んー into the short noun before it (総|ちゃ|んー → ちゃん)', () => {
    const out = repairVowelElongation(sentence(['総', NOUN], ['ちゃ', NOUN], ['んー', FILLER]), empty);
    expect(view(out)).toEqual([
      ['総', '総', 'Noun'],
      ['ちゃんー', 'ちゃん', 'Suffix'],
    ]);
  });

  it('keeps a filler んー after a noun that already ends in ん', () => {
    const input = sentence(['総', NOUN], ['さん', NOUN], ['んー', FILLER]);
    expect(repairVowelElongation(input, empty)).toBe(input);
  });

  it('rebuilds reciprocal あう shredded into interjections (微笑み|あ|う)', () => {
    const out = repairVowelElongation(sentence(['微笑み', VERB, '微笑む'], ['あ', INTJ], ['う', INTJ]), empty);
    expect(view(out)).toEqual([
      ['微笑み', '微笑む', 'Verb'],
      ['あう', 'あう', 'Verb'],
    ]);
    expect(out[1]).toMatchObject({ n: '合う', r: 'アウ' });
  });

  it('joins an intensifying っ-prefix to its verb (すっ|とぼける)', () => {
    const out = repairVowelElongation(sentence(['すっ', ADV], ['とぼける', VERB]), cx([], { kana: ['すっとぼける'] }));
    expect(view(out)).toEqual([['すっとぼける', 'すっとぼける', 'Verb']]);
  });

  it('rebuilds a る-verb an elongating ー split after a suffix (おいし|すぎ|る|ー)', () => {
    const out = repairVowelElongation(
      sentence(['おいし', ADJ, 'おいしい'], ['すぎ', '接尾辞,形容詞的'], ['る', NOUN], ['ー', SYMBOL]),
      empty,
    );
    expect(view(out)).toEqual([
      ['おいし', 'おいしい', 'IAdjective'],
      ['すぎるー', 'すぎる', 'Verb'],
    ]);
    expect(out[1]?.sec[0]).toBe('非自立可能');
  });

  it('rebuilds a る-verb an elongating ー split after a prefix-read stem (来|る|ー)', () => {
    const out = repairVowelElongation(sentence(['来', PREFIX], ['る', NOUN], ['ー', SYMBOL]), empty);
    expect(view(out)).toEqual([['来るー', '来る', 'Verb']]);
    expect(out[0]?.sec[0]).toBe('*');
  });

  it('rebuilds a godan volitional whose う became a separate ー (泳|ご|ー → 泳ぐ)', () => {
    const out = repairVowelElongation(sentence(['泳', NOUN, '泳', 'オヨ'], ['ご', NOUN], ['ー', SYMBOL]), empty);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '泳ごー', d: '泳ぐ', cls: 'Verb', r: 'オヨゴー' });
  });

  it('rebuilds a godan volitional whose ー fused into the kana (遊|ぼー → 遊ぶ)', () => {
    const out = repairVowelElongation(sentence(['遊', VERB, '遊ぶ', 'アソ'], ['ぼー', NOUN]), empty);
    expect(view(out)).toEqual([['遊ぼー', '遊ぶ', 'Verb']]);
  });

  it('rejoins an elongated adjective ending (早|くー → 早い)', () => {
    const out = repairVowelElongation(sentence(['早', ADJ, '早い'], ['くー', INTJ]), empty);
    expect(view(out)).toEqual([['早くー', '早い', 'IAdjective']]);
  });

  it('splits an elongating う off a る-verb (ぶつ|かるう → ぶつかる|う)', () => {
    const out = repairVowelElongation(sentence(['ぶつ', VERB], ['かるう', NOUN]), empty);
    expect(view(out)).toEqual([
      ['ぶつかる', 'ぶつかる', 'Verb'],
      ['う', 'う', 'Interjection'],
    ]);
  });

  it('does not take a symbol as the stem of an elongated る-verb', () => {
    const input = sentence(['「', '補助記号,括弧開'], ['かるう', NOUN]);
    expect(repairVowelElongation(input, empty)).toBe(input);
  });

  it('reads たあ after a verb stem as past た + あ (おき|たあ → おきた|あ)', () => {
    const out = repairVowelElongation(sentence(['おき', VERB, 'おきる'], ['たあ', CASE, 'と']), empty);
    expect(surfaces(out)).toEqual(['おきた', 'あ']);
    expect(out[0]?.cls).toBe('Verb');
    expect(out[1]).toMatchObject({ cls: 'Interjection', r: 'ア' });
  });

  it('turns a past tense misread before ああ back into a verb (いきた|ああ)', () => {
    const out = repairVowelElongation(sentence(['いきた', NA], ['ああ', NA]), empty);
    expect(surfaces(out)).toEqual(['いきた', 'ああ']);
    expect(out[0]?.cls).toBe('Verb');
  });

  it('leaves ああ alone after a word that is no past tense', () => {
    const input = sentence(['そう', ADV], ['ああ', NA]);
    expect(repairVowelElongation(input, empty)).toBe(input);
  });

  it('folds a small-vowel run into the conjugation it trails (来|やが|れぇぇぇ → やがれぇぇぇ)', () => {
    const out = repairVowelElongation(
      sentence(['来', VERB, '来る'], ['やが', AUX, 'やがる'], ['れぇぇぇ', NOUN]),
      empty,
    );
    expect(surfaces(out)).toEqual(['来', 'やがれぇぇぇ']);
    expect(out[1]?.members.map((member) => member.s)).toEqual(['やが', 'れぇぇぇ']);
  });

  it('leaves a small-vowel run after a noun stem or a non-conjugating tail alone (移|れぇぇぇ, 来|やが|れぇ)', () => {
    const noun = sentence(['移', NOUN], ['れぇぇぇ', NOUN]);
    expect(repairVowelElongation(noun, empty)).toBe(noun);
    const single = sentence(['来', VERB, '来る'], ['やが', AUX, 'やがる'], ['ねぇ', NOUN]);
    expect(repairVowelElongation(single, empty)).toBe(single);
    const same = sentence(['やが', AUX, 'やがれ'], ['れぇぇ', INTJ]);
    expect(repairVowelElongation(same, empty)).toBe(same);
  });
});

describe('repairColloquialNegativeNee', () => {
  it('joins ね|え after a て particle (読ん|で|ね|え)', () => {
    const out = repairColloquialNegativeNee(
      sentence(['読ん', VERB, '読む'], ['で', CONJ_PRT], ['ね', FINAL], ['え', INTJ]),
      empty,
    );
    expect(surfaces(out)).toEqual(['読ん', 'で', 'ねえ']);
    expect(out[2]).toMatchObject({ d: 'ない', cls: 'Auxiliary', r: 'ネエ' });
  });

  it('joins ね|え after a verb te-form (知って|ね|え)', () => {
    const out = repairColloquialNegativeNee(sentence(['知って', VERB, '知る'], ['ね', FINAL], ['え', INTJ]), empty);
    expect(surfaces(out)).toEqual(['知って', 'ねえ']);
  });

  it('leaves short sentences, early え and other particles alone', () => {
    const short = sentence(['ね', FINAL], ['え', INTJ]);
    expect(repairColloquialNegativeNee(short, empty)).toBe(short);
    const early = sentence(['ね', FINAL], ['え', INTJ], ['よ', FINAL]);
    expect(repairColloquialNegativeNee(early, empty)).toBe(early);
    // A late え copies the output before checking, so these come back equal rather than identical.
    const yo = sentence(['して', VERB, 'する'], ['よ', FINAL], ['え', INTJ]);
    expect(repairColloquialNegativeNee(yo, empty)).toEqual(yo);
    const noTe = sentence(['犬', NOUN], ['ね', FINAL], ['え', INTJ]);
    expect(repairColloquialNegativeNee(noTe, empty)).toEqual(noTe);
  });
});

describe('repairColloquialRanNai', () => {
  it('joins らん|ねえ after a で te-form (読ん|で|らん|ねえ → らんねえ)', () => {
    const out = repairColloquialRanNai(
      sentence(['読ん', VERB, '読む'], ['で', CONJ_PRT], ['らん', ADV], ['ねえ', AUX, 'ない', 'ネエ']),
      empty,
    );
    expect(out.at(-1)).toMatchObject({ s: 'らんねえ', d: 'られない', cls: 'Auxiliary', r: 'ランネエ' });
  });

  it('leaves らん alone without a negative after it or a te-form before it', () => {
    const noNegative = sentence(['見て', VERB, '見る'], ['らん', ADV], ['よ', FINAL]);
    expect(repairColloquialRanNai(noNegative, empty)).toBe(noNegative);
    const noTe = sentence(['らん', ADV], ['ない', AUX], ['よ', FINAL]);
    expect(repairColloquialRanNai(noTe, empty)).toBe(noTe);
    const short = sentence(['らん', ADV], ['ない', AUX]);
    expect(repairColloquialRanNai(short, empty)).toBe(short);
    const noun = sentence(['犬', NOUN], ['らん', ADV], ['ない', AUX]);
    expect(repairColloquialRanNai(noun, empty)).toBe(noun);
  });
});

describe('repairIntensifierKaeru', () => {
  const nosabaru = cx(['のさばる'], { verb: ['のさばる'] });

  it('splits のさばりかえる into のさばる + 返る without a following て', () => {
    const out = repairIntensifierKaeru(sentence(['のさばりかえる', VERB, 'のさばり返る']), nosabaru);
    expect(view(out)).toEqual([
      ['のさばり', 'のさばる', 'Verb'],
      ['かえる', '返る', 'Verb'],
    ]);
    expect(out[1]?.flags.pin).toBe(1512150);
  });

  it('does not fold a non-て tail into 返っ (のさばりかえっ|ちゃ)', () => {
    const out = repairIntensifierKaeru(sentence(['のさばりかえっ', VERB, 'のさばり返る'], ['ちゃ', AUX]), nosabaru);
    expect(surfaces(out)).toEqual(['のさばり', 'かえっ', 'ちゃ']);
  });

  it.each<[string, Group[], CombineContext]>([
    ['a pinned verb', [pinned(sentence(['のさばりかえる', VERB, 'のさばり返る'])[0] as Group)], nosabaru],
    [
      'a listed compound',
      sentence(['のさばりかえる', VERB, 'のさばり返る']),
      cx(['のさばり返る', 'のさばる'], { verb: ['のさばる'] }),
    ],
    ['an unknown head verb', sentence(['のさばりかえる', VERB, 'のさばり返る']), empty],
    ['a surface not opening with the head', sentence(['ノサバリカエル', VERB, 'のさばり返る']), nosabaru],
    ['a short normalised form', sentence(['かえる', VERB, '返る']), nosabaru],
    ['a noun', sentence(['のさばりかえる', NOUN, 'のさばり返る']), nosabaru],
  ])('leaves %s alone', (_label, input, ctx) => {
    expect(repairIntensifierKaeru(input, ctx)).toBe(input);
  });
});

describe('repairNounReadAsTeForm', () => {
  const asatte = cx([], { common: ['あさって'] });

  it('reads あさっ|て before a copula as the noun あさって (あさっ|て|だ)', () => {
    const out = repairNounReadAsTeForm(sentence(['あさっ', VERB, '漁る'], ['て', CONJ_PRT], ['だ', AUX]), asatte);
    expect(view(out)).toEqual([
      ['あさって', 'あさって', 'Noun'],
      ['だ', 'だ', 'Auxiliary'],
    ]);
    expect(out[0]?.sec[0]).toBe('*');
  });

  it.each<[string, Tok[], CombineContext]>([
    [
      'without a copula',
      [
        ['あさっ', VERB, '漁る'],
        ['て', CONJ_PRT],
        ['いる', VERB],
      ],
      asatte,
    ],
    [
      'when the noun is not common',
      [
        ['あさっ', VERB, '漁る'],
        ['て', CONJ_PRT],
        ['だ', AUX],
      ],
      empty,
    ],
    [
      'when the whole is a verb too',
      [
        ['あさっ', VERB, '漁る'],
        ['て', CONJ_PRT],
        ['だ', AUX],
      ],
      cx([], { common: ['あさって'], verb: ['あさって'] }),
    ],
    [
      'when the stem is no っ-stem',
      [
        ['あさり', VERB, '漁る'],
        ['て', CONJ_PRT],
        ['だ', AUX],
      ],
      asatte,
    ],
  ])('leaves the te-form %s', (_label, tokens, ctx) => {
    const input = sentence(...tokens);
    expect(repairNounReadAsTeForm(input, ctx)).toBe(input);
  });

  it('leaves a pinned stem alone', () => {
    const [stem, te, da] = sentence(['あさっ', VERB, '漁る'], ['て', CONJ_PRT], ['だ', AUX]) as [Group, Group, Group];
    const input = [pinned(stem), te, da];
    expect(repairNounReadAsTeForm(input, asatte)).toBe(input);
  });
});

describe('repairQuotativeTte: particle shapes', () => {
  it('reads nominal + だって|ば as copula だ + ってば (ダルマザメ|だって|ば)', () => {
    const out = repairQuotativeTte(sentence(['ダルマザメ', NOUN], ['だって', CONJ], ['ば', CONJ_PRT]), empty);
    expect(view(out)).toEqual([
      ['ダルマザメ', 'ダルマザメ', 'Noun'],
      ['だ', 'だ', 'Auxiliary'],
      ['ってば', 'ってば', 'Particle'],
    ]);
    expect(out[2]?.flags.pin).toBe(2130420);
  });

  it('reads 将校|だっ(だつ)|て as the particle だって', () => {
    const out = repairQuotativeTte(sentence(['将校', NOUN], ['だっ', VERB, 'だつ'], ['て', CONJ_PRT]), empty);
    expect(view(out)).toEqual([
      ['将校', '将校', 'Noun'],
      ['だって', 'だって', 'Particle'],
    ]);
    expect(out[1]?.sec[0]).toBe('接続助詞');
  });

  it('reads adverb いたって before 言う as いた + って (部署に|いたって|言う)', () => {
    const out = repairQuotativeTte(sentence(['部署', NOUN], ['に', CASE], ['いたって', ADV], ['言う', VERB]), empty);
    expect(view(out)).toEqual([
      ['部署', '部署', 'Noun'],
      ['に', 'に', 'Particle'],
      ['いた', 'いる', 'Verb'],
      ['って', 'って', 'Particle'],
      ['言う', '言う', 'Verb'],
    ]);
  });

  it('reads いたって after a て-form the same way (来て|いたって|いう)', () => {
    const out = repairQuotativeTte(sentence(['来て', VERB, '来る'], ['いたって', ADV], ['いう', VERB]), empty);
    expect(surfaces(out)).toEqual(['来て', 'いた', 'って', 'いう']);
  });

  it('returns a single token as it is', () => {
    const input = sentence(['って', CASE]);
    expect(repairQuotativeTte(input, empty)).toBe(input);
  });
});

describe('repairQuotativeTte: katakana and pronoun thieves', () => {
  it('gives the stolen katakana back to the noun (サナダ|ムシっ|て → サナダムシ|って)', () => {
    const out = repairQuotativeTte(
      sentence(['サナダ', NOUN], ['ムシっ', VERB, 'ムシる'], ['て', CONJ_PRT]),
      cx(['サナダムシ']),
    );
    expect(view(out)).toEqual([
      ['サナダムシ', 'サナダムシ', 'Noun'],
      ['って', 'って', 'Particle'],
    ]);
    expect(out[1]?.r).toBe('ッテ');
  });

  it('handles a thief that already holds って (エリ|アって|の → エリア|って|の)', () => {
    const out = repairQuotativeTte(sentence(['エリ', NAME], ['アって', NOUN], ['の', CASE]), cx(['エリア']));
    expect(surfaces(out)).toEqual(['エリア', 'って', 'の']);
  });

  it('reattaches a mid-katakana cut by shape alone, even for unknown names (デー|トっ|て)', () => {
    const out = repairQuotativeTte(sentence(['デー', NOUN], ['トっ', NOUN], ['て', CONJ_PRT]), empty);
    expect(view(out)).toEqual([
      ['デート', 'デート', 'Noun'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('splits an exclamation それっ|て into the pronoun それ + って', () => {
    const out = repairQuotativeTte(
      sentence(['それっ', INTJ, 'それっ', 'ソレッ', 'それ'], ['て', CONJ_PRT], ['何', PRON]),
      empty,
    );
    expect(view(out)).toEqual([
      ['それ', 'それ', 'Pronoun'],
      ['って', 'って', 'Particle'],
      ['何', '何', 'Pronoun'],
    ]);
  });

  it('keeps a non-pronoun exclamation an interjection (ほらっ|て → ほら|って)', () => {
    const out = repairQuotativeTte(sentence(['ほらっ', INTJ, 'ほらっ', 'ホラッ', 'ほら'], ['て', CONJ_PRT]), empty);
    expect(view(out)).toEqual([
      ['ほら', 'ほら', 'Interjection'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('reads がっ after a pronoun as が + って (何|がっ|て)', () => {
    const out = repairQuotativeTte(sentence(['何', PRON], ['がっ', '接尾辞,動詞的', 'がる'], ['て', CONJ_PRT]), empty);
    expect(view(out)).toEqual([
      ['何', '何', 'Pronoun'],
      ['が', 'が', 'Particle'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('reads 貴方|た|ちっ|て as 貴方|たち|って', () => {
    const out = repairQuotativeTte(
      sentence(['貴方', PRON], ['た', AUX], ['ちっ', AUX, 'ちう'], ['て', CONJ_PRT]),
      empty,
    );
    expect(view(out)).toEqual([
      ['貴方', '貴方', 'Pronoun'],
      ['たち', 'たち', 'Suffix'],
      ['って', 'って', 'Particle'],
    ]);
    expect(out[1]?.n).toBe('達');
  });
});

describe('repairQuotativeTte: verb and noun reattachment', () => {
  it('gives the stolen mora back to the verb (読|むっ|て → 読む|って)', () => {
    const out = repairQuotativeTte(
      sentence(['本', NOUN], ['を', CASE], ['読', NOUN], ['むっ', VERB, 'むく'], ['て', CONJ_PRT]),
      cx(['読む'], { verb: ['読む'] }),
    );
    expect(view(out).slice(2)).toEqual([
      ['読む', '読む', 'Verb'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('reaches back over a suffix to rebuild a compound verb (申し|込|むっ|て)', () => {
    const out = repairQuotativeTte(
      sentence(['申し', NOUN], ['込', SUFFIX], ['むっ', VERB, 'むく'], ['て', CONJ_PRT]),
      cx(['申し込む'], { verb: ['申し込む'] }),
    );
    expect(view(out)).toEqual([
      ['申し込む', '申し込む', 'Verb'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('keeps the verb lemma of an imperative Sudachi agrees on (こ|いっ|て → こい (くる))', () => {
    const out = repairQuotativeTte(
      sentence(['こ', VERB, 'くる'], ['いっ', VERB, 'いく'], ['て', CONJ_PRT]),
      cx(['くる'], { verb: ['くる'] }),
    );
    expect(view(out)).toEqual([
      ['こい', 'くる', 'Verb'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('drops an imperative reading that disagrees with the stem’s lemma (こ[粉]|いっ|て → こい)', () => {
    const out = repairQuotativeTte(
      sentence(['こ', NOUN, '粉'], ['いっ', VERB, 'いく'], ['て', CONJ_PRT]),
      cx(['くる'], { verb: ['くる'] }),
    );
    expect(view(out)).toEqual([
      ['こい', 'こい', 'Verb'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('reattaches う to a non-verb (ありがと|うっ|て → ありがとう|って)', () => {
    const out = repairQuotativeTte(sentence(['ありがと', INTJ], ['うっ', INTJ], ['て', CONJ_PRT]), cx(['ありがとう']));
    expect(view(out)).toEqual([
      ['ありがとう', 'ありがとう', 'Interjection'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('gives a noun its final kanji back from a fake verb (自|意|識っ|て → 自|意|識|って)', () => {
    const out = repairQuotativeTte(
      sentence(['自', PREFIX], ['意', NOUN], ['識っ', VERB, '識る'], ['て', CONJ_PRT]),
      cx(['自意識']),
    );
    expect(view(out)).toEqual([
      ['自', '自', 'Prefix'],
      ['意', '意', 'Noun'],
      ['識', '識', 'Noun'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('does the same before っと (終|了っ|と → 終|了|っと)', () => {
    const out = repairQuotativeTte(sentence(['終', NOUN], ['了っ', VERB, '了う'], ['と', CASE]), cx(['終了']));
    expect(view(out)).toEqual([
      ['終', '終', 'Noun'],
      ['了', '了', 'Noun'],
      ['っと', 'っと', 'Particle'],
    ]);
  });

  it('merges the noun run when the kanji alone does not form a noun (必|要っ|て → 必要|って)', () => {
    const out = repairQuotativeTte(sentence(['必', NOUN], ['要っ', NOUN, '要'], ['て', CONJ_PRT]), cx(['必要']));
    expect(view(out)).toEqual([
      ['必要', '必要', 'Noun'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('gives ん back to the noun run before it (婆|さ|んっ|て → 婆さん|って)', () => {
    const out = repairQuotativeTte(
      sentence(['婆', NOUN], ['さ', NOUN], ['んっ', INTJ], ['て', CONJ_PRT], ['ね', FINAL]),
      cx(['婆さん']),
    );
    expect(view(out)).toEqual([
      ['婆さん', '婆さん', 'Noun'],
      ['って', 'って', 'Particle'],
      ['ね', 'ね', 'Particle'],
    ]);
  });

  it('gives morae back before っつー (びびり|す|ぎっ|つーか → びびりすぎ|っつーか)', () => {
    const out = repairQuotativeTte(
      sentence(['びびり', NOUN], ['す', VERB, 'する'], ['ぎっ', VERB, 'ぎる'], ['つーか', CONJ]),
      cx(['びびりすぎ']),
    );
    expect(view(out)).toEqual([
      ['びびりすぎ', 'びびりすぎ', 'Noun'],
      ['っつーか', 'っつーか', 'Conjunction'],
    ]);
    expect(out[1]?.r).toBe('ッツーカ');
  });

  it('gives a fused kanji back (勉|強って → 勉強|って)', () => {
    const out = repairQuotativeTte(sentence(['勉', NOUN], ['強って', VERB, '強る']), cx(['勉強']));
    expect(view(out)).toEqual([
      ['勉強', '勉強', 'Noun'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('reattaches a kana run to the noun before it (繋|がりっ|て → 繋がり|って)', () => {
    const out = repairQuotativeTte(sentence(['繋', NOUN], ['がりっ', VERB, 'がる'], ['て', CONJ_PRT]), cx(['繋がり']));
    expect(view(out)).toEqual([
      ['繋がり', '繋がり', 'Noun'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('turns an adverbial く run into its adjective (堅|くっ|て → 堅く (堅い))', () => {
    const out = repairQuotativeTte(
      sentence(['堅', ADV], ['くっ', VERB, 'くう'], ['て', CONJ_PRT]),
      cx(['堅く'], { 'adj-i': ['堅い'] }),
    );
    expect(view(out)).toEqual([
      ['堅く', '堅い', 'IAdjective'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('treats a lone stolen mora completing a common word as a shred (し|ばら|くっ|て → しばらく|って)', () => {
    const out = repairQuotativeTte(
      sentence(['し', ADV], ['ばら', NOUN], ['くっ', VERB, 'くる'], ['て', CONJ_PRT]),
      cx(['しばらく', 'し', 'ばら'], { common: ['しばらく'] }),
    );
    expect(surfaces(out)).toEqual(['しばらく', 'って']);
  });

  it('lets で head only the shred です (で|すっ|て → です|って)', () => {
    const out = repairQuotativeTte(
      sentence(['そう', ADV], ['で', CASE], ['すっ', VERB, 'する'], ['て', CONJ_PRT]),
      cx(['です']),
    );
    expect(surfaces(out)).toEqual(['そう', 'です', 'って']);
  });

  it('reattaches after a clause-initial は (は|ずっ|て → はず|って)', () => {
    const out = repairQuotativeTte(
      sentence(['、', '補助記号,読点'], ['は', BOUND], ['ずっ', VERB, 'ずる'], ['て', CONJ_PRT]),
      cx(['はず']),
    );
    expect(surfaces(out)).toEqual(['、', 'はず', 'って']);
  });

  it('does not reattach across a topic は mid-clause (犬|は|ずっ|て)', () => {
    const out = repairQuotativeTte(
      sentence(['犬', NOUN], ['は', BOUND], ['ずっ', VERB, 'ずる'], ['て', CONJ_PRT]),
      cx(['はず']),
    );
    expect(surfaces(out).slice(0, 2)).toEqual(['犬', 'は']);
    expect(surfaces(out)).not.toContain('はず');
  });

  it('does not join two kana words meeting (どう|こうっ|て keeps どう)', () => {
    const out = repairQuotativeTte(
      sentence(['どう', ADV], ['こうっ', VERB, 'こうる'], ['て', CONJ_PRT]),
      cx(['どうこう', 'どう', 'こう']),
    );
    expect(surfaces(out)[0]).toBe('どう');
  });

  it('reattaches an adverb-tagged mora to the noun run (寒|さっ|て → 寒さ|って)', () => {
    const out = repairQuotativeTte(sentence(['寒', NOUN], ['さっ', ADV, 'さっ'], ['て', CONJ_PRT]), cx(['寒さ']));
    expect(view(out)).toEqual([
      ['寒さ', '寒さ', 'Noun'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('refuses a run that would strand a lone kana before it (あ|寒|さっ|て)', () => {
    const input = sentence(['あ', NOUN], ['寒', NOUN], ['さっ', ADV, 'さっ'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(input, cx(['寒さ']))).toBe(input);
  });

  it('stops a run at a non-kana piece (3|さっ|て)', () => {
    const input = sentence(['3', '名詞,数詞'], ['さっ', ADV, 'さっ'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(input, cx(['3さ']))).toBe(input);
  });
});

describe('repairQuotativeTte: sentence-final and particle thieves', () => {
  it('reads のか|なっ|て as のかな|って after a clause-final word', () => {
    const out = repairQuotativeTte(
      sentence(['行く', VERB], ['の', '助詞,準体助詞'], ['か', FINAL], ['なっ', VERB, 'なる'], ['て', CONJ_PRT]),
      empty,
    );
    expect(surfaces(out)).toEqual(['行く', 'の', 'かな', 'って']);
  });

  it('reads 言う|なっ|て as 言う|な|って', () => {
    const out = repairQuotativeTte(sentence(['言う', VERB], ['なっ', VERB, 'なる'], ['て', CONJ_PRT]), empty);
    expect(view(out)).toEqual([
      ['言う', '言う', 'Verb'],
      ['な', 'な', 'Particle'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('reads 行きたい|なっ|て (auxiliary) as 行きたい|な|って', () => {
    const out = repairQuotativeTte(
      sentence(['行き', VERB, '行く'], ['たい', AUX], ['なっ', VERB, 'なる'], ['て', CONJ_PRT]),
      empty,
    );
    expect(surfaces(out)).toEqual(['行き', 'たい', 'な', 'って']);
  });

  it('reads 言|うなっ|て as 言う|な|って', () => {
    const out = repairQuotativeTte(sentence(['言', NOUN], ['うなっ', VERB, 'うなる'], ['て', CONJ_PRT]), cx(['言う']));
    expect(surfaces(out)).toEqual(['言う', 'な', 'って']);
  });

  it('reads 行こ|うなっ|て as 行こう|な|って by the volitional alone', () => {
    const out = repairQuotativeTte(
      sentence(['行こ', VERB, '行く'], ['うなっ', VERB, 'うなる'], ['て', CONJ_PRT]),
      empty,
    );
    expect(surfaces(out)).toEqual(['行こう', 'な', 'って']);
  });

  it('keeps genuine うなる after a particle (犬が|うなっ|て)', () => {
    const input = sentence(['犬', NOUN], ['が', CASE], ['うなっ', VERB, 'うなる'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(input, cx(['うなる'], { verb: ['うなる'] }))).toBe(input);
  });

  it('reads すご|くっ(来る)|て as すごく|って', () => {
    const out = repairQuotativeTte(
      sentence(['すご', ADJ, 'すごい'], ['くっ', VERB, 'くる'], ['て', CONJ_PRT]),
      cx([], { 'adj-i': ['すごい'] }),
    );
    expect(view(out)).toEqual([
      ['すごく', 'すごく', 'IAdjective'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('reads a bare-kanji adverb stem the same way (早|くっ|て → 早く)', () => {
    const out = repairQuotativeTte(sentence(['早', ADV], ['くっ', VERB, 'くる'], ['て', CONJ_PRT]), cx(['早い']));
    expect(view(out)[0]).toEqual(['早く', '早く', 'IAdjective']);
  });

  it('reads と|かっ(買う)|て as と|か|って', () => {
    const out = repairQuotativeTte(
      sentence(['犬', NOUN], ['と', CASE], ['かっ', VERB, '買う'], ['て', CONJ_PRT]),
      empty,
    );
    expect(view(out).slice(1)).toEqual([
      ['と', 'と', 'Particle'],
      ['か', 'か', 'Particle'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('keeps the te-form of a common verb (好きに|なっ|て)', () => {
    const input = sentence(['好き', NA], ['に', CASE], ['なっ', VERB, 'なる'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(input, empty)).toBe(input);
  });

  it('reads わからない|けどっ(気取る)|て as the particle けど + って', () => {
    const out = repairQuotativeTte(
      sentence(['わから', VERB, 'わかる'], ['ない', AUX], ['けどっ', VERB, '気取る'], ['て', CONJ_PRT]),
      empty,
    );
    expect(view(out).slice(2)).toEqual([
      ['けど', 'けど', 'Particle'],
      ['って', 'って', 'Particle'],
    ]);
    expect(out[2]).toMatchObject({ r: 'ケド', sec: ['接続助詞', '*', '*'] });
  });

  it('keeps an auxiliary te-form (食べ|ちゃっ|て)', () => {
    const input = sentence(['食べ', VERB, '食べる'], ['ちゃっ', AUX, 'ちゃう'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(input, empty)).toBe(input);
  });

  it('keeps a one-mora thief after a case particle (家|に|いっ|て)', () => {
    const input = sentence(['家', NOUN], ['に', CASE], ['いっ', VERB, '行く'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(input, empty)).toBe(input);
  });

  it('reattaches い only when the merge is a word (悪|いっ|て → 悪い; ギシギシ|いっ|て stays)', () => {
    const out = repairQuotativeTte(
      sentence(['悪', ADJ, '悪い'], ['いっ', VERB, '言う'], ['て', CONJ_PRT]),
      cx(['悪い'], { 'adj-i': ['悪い'] }),
    );
    expect(view(out)).toEqual([
      ['悪い', '悪い', 'IAdjective'],
      ['って', 'って', 'Particle'],
    ]);
    const onomatopoeia = sentence(['ギシギシ', ADV], ['いっ', VERB, '言う'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(onomatopoeia, empty)).toBe(onomatopoeia);
  });

  it('reads a past merge as its verb lemma (食べ|たっ|て → 食べた (食べる))', () => {
    const out = repairQuotativeTte(
      sentence(['食べ', NOUN], ['たっ', VERB, '立つ'], ['て', CONJ_PRT]),
      cx([], { verb: ['食べる'] }),
    );
    expect(view(out)).toEqual([
      ['食べた', '食べる', 'Verb'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('keeps the merge’s own lemma when it inflects from the head (食べ(食べる)|たっ|て)', () => {
    const out = repairQuotativeTte(
      sentence(['食べ', VERB, '食べる'], ['たっ', VERB, '立つ'], ['て', CONJ_PRT]),
      cx([], { verb: ['食べる'] }),
    );
    expect(view(out)).toEqual([
      ['食べた', '食べる', 'Verb'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('leaves a split compound verb to the compound pass (信じ|きっ|て, ささやき|あっ|て)', () => {
    const shinjiru = sentence(['信じ', VERB, '信じる'], ['きっ', VERB, 'きる'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(shinjiru, cx(['信じきる']))).toBe(shinjiru);
    const sasayaku = sentence(['ささやき', VERB, 'ささやく'], ['あっ', VERB, '合う'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(sasayaku, empty)).toBe(sasayaku);
  });

  it('prefers a clause-final imperative (信|じろっ|て → 信じろ|って)', () => {
    const out = repairQuotativeTte(
      sentence(['信', NOUN], ['じろっ', VERB, 'じろる'], ['て', CONJ_PRT]),
      cx(['信じる'], { verb: ['信じる'] }),
    );
    expect(surfaces(out)).toEqual(['信じろ', 'って']);
    expect(out[0]?.cls).toBe('Verb');
  });

  it('keeps a genuine te-stem (よく|わかっ|て)', () => {
    const input = sentence(['よく', ADV], ['わかっ', VERB, 'わかる'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(input, cx(['わかる'], { verb: ['わかる'] }))).toBe(input);
  });

  it('splits a te-stem when a quote verb follows (寝る|かなっ|て|思った → かな|って)', () => {
    const out = repairQuotativeTte(
      sentence(['寝る', VERB], ['かなっ', VERB, 'かなう'], ['て', CONJ_PRT], ['思った', VERB, '思う']),
      cx(['かなう'], { verb: ['かなう'] }),
    );
    expect(surfaces(out)).toEqual(['寝る', 'かな', 'って', '思った']);
    expect(out[1]?.cls).toBe('Verb');
  });

  it('joins a reduplicated word before って (やれ|やれっ|て → やれやれ|って)', () => {
    const out = repairQuotativeTte(
      sentence(['やれ', INTJ], ['やれっ', VERB, 'やれる'], ['て', CONJ_PRT]),
      cx(['やれ', 'やれやれ']),
    );
    expect(view(out)).toEqual([
      ['やれやれ', 'やれやれ', 'Interjection'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('reads an adverb-tagged するっ|て as する|って', () => {
    const out = repairQuotativeTte(
      sentence(['勉強', NOUN], ['するっ', ADV, 'するっ'], ['て', CONJ_PRT]),
      cx(['する'], { verb: ['する'] }),
    );
    expect(view(out)).toEqual([
      ['勉強', '勉強', 'Noun'],
      ['する', 'する', 'Verb'],
      ['って', 'って', 'Particle'],
    ]);
  });

  it('keeps an adverb-tagged noun thief (ことっ|て)', () => {
    const input = sentence(['その', '連体詞'], ['ことっ', ADV, 'ことっ'], ['て', CONJ_PRT]);
    expect(repairQuotativeTte(input, cx(['こと']))).toBe(input);
  });
});

describe('repairStolenUBeforeSsu', () => {
  it('gives う back to a shred Sudachi lemmatised as the whole (そ(そう)|うっす)', () => {
    const out = repairStolenUBeforeSsu(sentence(['そ', ADV, 'そう', 'ソ'], ['うっす', INTJ]), empty);
    expect(view(out)).toEqual([
      ['そう', 'そう', 'Adverb'],
      ['っす', 'です', 'Auxiliary'],
    ]);
    expect(out[0]?.r).toBe('ソウ');
    expect(out[1]).toMatchObject({ n: 'っす', r: 'ッス' });
  });

  it('handles the う[つ]っ|す cut (違|うっ|す → 違う|っす)', () => {
    const out = repairStolenUBeforeSsu(
      sentence(['違', NOUN, '違', 'チガ'], ['うっ', VERB, 'うつ'], ['す', AUX]),
      cx([], { verb: ['違う'] }),
    );
    expect(view(out)).toEqual([
      ['違う', '違う', 'Verb'],
      ['っす', 'です', 'Auxiliary'],
    ]);
  });

  it('keeps a volitional auxiliary’s lemma (行き|ましょ|うっ|ス → ましょう|っス)', () => {
    const out = repairStolenUBeforeSsu(
      sentence(['行き', VERB, '行く'], ['ましょ', AUX, 'ます'], ['うっ', INTJ], ['ス', AUX]),
      empty,
    );
    expect(view(out)).toEqual([
      ['行き', '行く', 'Verb'],
      ['ましょう', 'ます', 'Auxiliary'],
      ['っス', 'です', 'Auxiliary'],
    ]);
  });

  it('reads the katakana greeting form うッス after a shred the same way (そ|うッス)', () => {
    const out = repairStolenUBeforeSsu(sentence(['そ', ADV, 'そう'], ['うッス', INTJ]), empty);
    expect(surfaces(out)).toEqual(['そう', 'ッス']);
  });

  it.each<[string, Group[]]>([
    ['at the start of a sentence', sentence(['うっす', INTJ])],
    ['after a particle', sentence(['犬', NOUN], ['が', CASE], ['うっす', INTJ])],
    ['after a symbol', sentence(['「', '補助記号,括弧開'], ['うっす', INTJ])],
    ['when the completed word is unknown', sentence(['ぼ', NOUN], ['うっす', INTJ])],
    ['before something that is no copula', sentence(['そ', ADV, 'そう'], ['うっ', VERB, 'うつ'], ['た', AUX])],
    ['for a non-ssu token', sentence(['そ', ADV, 'そう'], ['うん', INTJ])],
  ])('leaves うっす alone %s', (_label, input) => {
    expect(repairStolenUBeforeSsu(input, empty)).toBe(input);
  });

  it('leaves a pinned token alone', () => {
    const [so, ssu] = sentence(['そ', ADV, 'そう'], ['うっす', INTJ]) as [Group, Group];
    const pinnedSsu = [so, pinned(ssu)];
    expect(repairStolenUBeforeSsu(pinnedSsu, empty)).toBe(pinnedSsu);
    const pinnedPrev = [pinned(so), ssu];
    expect(repairStolenUBeforeSsu(pinnedPrev, empty)).toBe(pinnedPrev);
  });
});

describe('recombineHiraganaTokens', () => {
  it('merges kana tokens into an inflected adjective (おいし|かった → おいしかった (おいしい))', () => {
    const out = recombineHiraganaTokens(
      sentence(['おいし', NOUN], ['かった', NOUN]),
      cx([], { 'adj-i': ['おいしい'] }),
    );
    expect(view(out)).toEqual([['おいしかった', 'おいしい', 'IAdjective']]);
    expect(out[0]?.kind).toBe('word');
  });

  it('merges kana tokens into an inflected verb (あそ|ぼう → あそぼう (あそぶ))', () => {
    const out = recombineHiraganaTokens(sentence(['あそ', NOUN], ['ぼう', NOUN], ['よ', FINAL]), cx(['あそぶ']));
    expect(view(out)).toEqual([
      ['あそぼう', 'あそぶ', 'Verb'],
      ['よ', 'よ', 'Particle'],
    ]);
  });

  it('flags a merge JMdict lists as an expression (この|まま)', () => {
    const out = recombineHiraganaTokens(
      sentence(['この', '連体詞'], ['まま', NOUN]),
      cx([], { kana: ['このまま'], exp: ['このまま'] }),
    );
    expect(out[0]).toMatchObject({ s: 'このまま', d: 'このまま', cls: 'CommonNoun', flags: { kind: 'expression' } });
  });

  it('keeps tokens that are each common words (どう|こう)', () => {
    const input = sentence(['どう', ADV], ['こう', ADV]);
    expect(recombineHiraganaTokens(input, cx(['どうこう'], { common: ['どう', 'こう'] }))).toBe(input);
  });

  it.each<[string, Tok[]]>([
    ['a single token', [['このまま', NOUN]]],
    [
      'kanji',
      [
        ['この', '連体詞'],
        ['間', NOUN],
      ],
    ],
    [
      'a blocked class',
      [
        ['この', '連体詞'],
        ['まま', AUX],
      ],
    ],
    [
      'a text under three characters',
      [
        ['こ', NOUN],
        ['の', NOUN],
      ],
    ],
    [
      'repeated interjections',
      [
        ['はい', INTJ],
        ['はい', INTJ],
      ],
    ],
    [
      'an interjection before そう',
      [
        ['えっ', INTJ],
        ['そう', ADV],
      ],
    ],
  ])('leaves %s alone', (_label, tokens) => {
    const input = sentence(...tokens);
    const lexicon = cx([], { kana: ['このまま', 'この間', 'はいはい', 'えっそう'] });
    expect(recombineHiraganaTokens(input, lexicon)).toBe(input);
  });

  it('never merges into the expression だった (あれ|だった)', () => {
    const [are, datta] = sentence(['あれ', PRON], ['だった', AUX]) as [Group, Group];
    const input = [are, as(datta, 'Expression')];
    expect(recombineHiraganaTokens(input, cx([], { kana: ['あれだった'] }))).toBe(input);
  });

  it('skips a text longer than twelve characters', () => {
    const input = sentence(['あいうえおかき', NOUN], ['くけこさしす', NOUN]);
    expect(recombineHiraganaTokens(input, cx([], { kana: ['あいうえおかきくけこさしす'] }))).toBe(input);
  });
});

describe('repairSakkiMoraTheft', () => {
  it('gives み to the next token when that attests (さっ|きみ|ごと → さっき|みごと)', () => {
    const out = repairSakkiMoraTheft(
      sentence(['さっ', ADV], ['きみ', PRON], ['ごと', SUFFIX, 'ごと', '']),
      cx(['みごと']),
    );
    expect(view(out)).toEqual([
      ['さっき', 'さっき', 'Noun'],
      ['みごと', 'みごと', 'Noun'],
    ]);
    expect(out[1]?.r).toBe('ミ');
  });

  it('falls back to み alone when み + the next token is no word (さっ|きみ|が)', () => {
    const out = repairSakkiMoraTheft(sentence(['さっ', ADV], ['きみ', PRON], ['が', CASE]), empty);
    expect(view(out)).toEqual([
      ['さっき', 'さっき', 'Noun'],
      ['み', 'み', 'Noun'],
      ['が', 'が', 'Particle'],
    ]);
  });

  it('leaves さっ alone when きみ does not follow', () => {
    const input = sentence(['さっ', ADV], ['と', CASE]);
    expect(repairSakkiMoraTheft(input, empty)).toBe(input);
  });
});

describe('collapseReduplicatedMimetic', () => {
  const lexicon = cx(['ごろごろ', 'はいはい']);

  it('collapses separate units (ごろ|ごろ|ごろ → ごろごろ)', () => {
    const out = collapseReduplicatedMimetic(
      sentence(['ごろ', ADV], ['ごろ', ADV], ['ごろ', ADV], ['と', CASE]),
      lexicon,
    );
    expect(view(out)).toEqual([
      ['ごろごろごろ', 'ごろごろ', 'Adverb'],
      ['と', 'と', 'Particle'],
    ]);
    expect(out[0]?.flags.kind).toBe('word');
  });

  it.each<[string, Tok[]]>([
    ['a plain 2× word', [['ごろごろ', ADV]]],
    [
      'repeated interjections',
      [
        ['はい', INTJ],
        ['はい', INTJ],
        ['はい', INTJ],
      ],
    ],
    [
      'an unknown mimetic',
      [
        ['ぐるぐる', ADV],
        ['ぐる', ADV],
      ],
    ],
    ['an odd-length token', [['ごろご', ADV]]],
    ['a single character', [['ご', ADV]]],
  ])('leaves %s alone', (_label, tokens) => {
    const input = sentence(...tokens);
    expect(collapseReduplicatedMimetic(input, lexicon)).toBe(input);
  });
});

describe('repairClippedAdjective', () => {
  const lexicon = cx(['隊長'], { 'adj-i': ['寒い', '長い', '短い'] });

  it('reads past a forced blank (寒| |っ → 寒 っ (寒い))', () => {
    const out = repairClippedAdjective(sentence(['寒', NOUN], [' ', BLANK], ['っ', SYMBOL]), lexicon);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '寒 っ', d: '寒い', cls: 'IAdjective' });
  });

  it('accepts katakana ッ (足|短|ッ)', () => {
    const out = repairClippedAdjective(sentence(['足', NOUN], ['短', NOUN], ['ッ', SYMBOL]), lexicon);
    expect(view(out)).toEqual([
      ['足', '足', 'Noun'],
      ['短ッ', '短い', 'IAdjective'],
    ]);
  });

  it.each<[string, Group[]]>([
    ['a vocative noun (隊|長|っ)', sentence(['隊', NOUN], ['長', NOUN], ['っ', SYMBOL])],
    ['a kana stem (さむ|っ)', sentence(['さむ', NOUN], ['っ', SYMBOL])],
    ['a verb (寒|っ as verb)', sentence(['寒', VERB], ['っ', SYMBOL])],
    ['a non-adjective (犬|っ)', sentence(['犬', NOUN], ['っ', SYMBOL])],
    ['a long stem', sentence(['寒寒寒寒寒', NOUN], ['っ', SYMBOL])],
    ['no っ after it', sentence(['寒', NOUN], ['よ', FINAL])],
    [
      'a pinned stem',
      [pinned(sentence(['寒', NOUN])[0] as Group), ...sentence(['っ', SYMBOL]).map((g) => ({ ...g, b: 1, e: 2 }))],
    ],
  ])('leaves %s alone', (_label, input) => {
    expect(repairClippedAdjective(input, lexicon)).toBe(input);
  });
});

describe('repairFusedInterjectionParticle', () => {
  const lexicon = cx(['ごめんなさい', 'ありがと', 'よ']);

  it('peels the longest particle first (ありがとのよ → ありがと + のよ)', () => {
    const out = repairFusedInterjectionParticle(sentence(['ありがとのよ', INTJ]), lexicon);
    expect(view(out)).toEqual([
      ['ありがと', 'ありがと', 'Interjection'],
      ['のよ', 'のよ', 'Particle'],
    ]);
    expect(out[1]?.pos.slice(0, 2)).toEqual(['助詞', '終助詞']);
  });

  it.each<[string, Tok]>([
    ['a known interjection', ['ありがと', INTJ]],
    ['a word too short to split (よね)', ['よね', INTJ]],
    ['an unknown base', ['ふむふむね', INTJ]],
    ['a non-interjection', ['ごめんなさいね', NOUN]],
    ['a one-character base, even a known one (よのよ)', ['よのよ', INTJ]],
  ])('leaves %s alone', (_label, token) => {
    const input = sentence(token);
    expect(repairFusedInterjectionParticle(input, lexicon)).toBe(input);
  });
});

describe('repairOrphanedAuxiliary', () => {
  it('reads a 連用形 noun + た as the whole verb (言い出し|た → 言い出した)', () => {
    const out = repairOrphanedAuxiliary(sentence(['言い出し', NOUN], ['た', AUX]), cx(['言い出す']));
    expect(view(out)).toEqual([['言い出した', '言い出す', 'Verb']]);
  });

  it('keeps a kana 連用形 noun or an unknown verb (てつだい|た, 手伝い|た)', () => {
    const kana = sentence(['てつだい', NOUN], ['た', AUX]);
    expect(repairOrphanedAuxiliary(kana, cx(['てつだう']))).toBe(kana);
    const unknown = sentence(['手伝い', NOUN], ['た', AUX]);
    expect(repairOrphanedAuxiliary(unknown, empty)).toBe(unknown);
    const noEnding = sentence(['手伝え', NOUN], ['た', AUX]);
    expect(repairOrphanedAuxiliary(noEnding, cx(['手伝う']))).toBe(noEnding);
  });

  it('reattaches ろう to an expression ending in だ (そりゃそうだ|ろう)', () => {
    const [expr, rou] = sentence(['そりゃそうだ', EXPR_HEAD, 'そりゃそうだ'], ['ろう', NOUN, '蝋']) as [Group, Group];
    const out = repairOrphanedAuxiliary([as(expr, 'Expression'), rou], empty);
    expect(view(out)).toEqual([['そりゃそうだろう', 'そりゃそうだろう', 'Expression']]);
  });

  it('gives the verb back from a noun before a lone verb ending (投げ売|る → 投げ|売る)', () => {
    const out = repairOrphanedAuxiliary(sentence(['投げ売', NOUN, '投げ売'], ['る', AUX]), cx(['投げ', '売る']));
    expect(view(out)).toEqual([
      ['投げ', '投げ', 'Noun'],
      ['売る', '売る', 'Verb'],
    ]);
  });

  it('keeps the noun’s own lemma when it does not end in the verb stem (首吊|ら|れる)', () => {
    const out = repairOrphanedAuxiliary(
      sentence(['首吊', NOUN, '首吊り', 'クビツリ', '首吊り'], ['られる', AUX, 'られる']),
      cx(['首', '吊る']),
    );
    expect(view(out)).toEqual([
      ['首', '首吊り', 'Noun'],
      ['吊られる', '吊る', 'Verb'],
    ]);
  });

  it.each<[string, Tok[]]>([
    [
      'after a verb',
      [
        ['投げ', VERB, '投げる'],
        ['られる', AUX, 'られる'],
      ],
    ],
    [
      'after a one-character noun',
      [
        ['売', NOUN],
        ['られる', AUX, 'られる'],
      ],
    ],
    [
      'when no split attests',
      [
        ['投げ売', NOUN],
        ['られる', AUX, 'られる'],
      ],
    ],
    [
      'a kana tail',
      [
        ['なげうり', NOUN],
        ['る', AUX],
      ],
    ],
  ])('leaves an auxiliary alone %s', (_label, tokens) => {
    const input = sentence(...tokens);
    expect(repairOrphanedAuxiliary(input, empty)).toBe(input);
  });
});

describe('repairTankaToTaNKa', () => {
  it('reads noun たか after a verb stem as た + か (言い過ぎ|たか)', () => {
    const out = repairTankaToTaNKa(sentence(['言い過ぎ', VERB, '言い過ぎる', 'イイスギ'], ['たか', NOUN, '鷹']), empty);
    expect(view(out)).toEqual([
      ['言い過ぎた', '言い過ぎた', 'Verb'],
      ['か', 'か', 'Particle'],
    ]);
    expect(out[0]?.r).toBe('イイスギタ');
  });

  it('does not read たか after a symbol as a past', () => {
    const input = sentence(['「', '補助記号,括弧開'], ['たか', NOUN, '鷹']);
    expect(repairTankaToTaNKa(input, empty)).toBe(input);
  });

  it('reads 云う|たんか as 云うた|ん|か', () => {
    const out = repairTankaToTaNKa(sentence(['云う', VERB], ['たんか', NOUN, '啖呵']), empty);
    expect(view(out)).toEqual([
      ['云うた', '云うた', 'Verb'],
      ['ん', 'の', 'Particle'],
      ['か', 'か', 'Particle'],
    ]);
  });

  it('reads a て-ending before たんか as てた (怖がって|たんか, tagged an adjective)', () => {
    const out = repairTankaToTaNKa(sentence(['怖がって', ADJ, '怖がる'], ['たんか', NOUN]), empty);
    expect(surfaces(out)).toEqual(['怖がってた', 'ん', 'か']);
  });

  it('reads Kansai てもうた (ハズレて|もう|たんか)', () => {
    const out = repairTankaToTaNKa(sentence(['ハズレて', VERB, 'ハズレる'], ['もう', ADV], ['たんか', NOUN]), empty);
    expect(view(out)).toEqual([
      ['ハズレてもうた', 'ハズレてもうた', 'Verb'],
      ['ん', 'の', 'Particle'],
      ['か', 'か', 'Particle'],
    ]);
  });

  it('reads Kansai てしもた (言うて|し|も|たんか)', () => {
    const out = repairTankaToTaNKa(
      sentence(['言うて', VERB, '言う'], ['し', VERB, 'する'], ['も', BOUND], ['たんか', NOUN]),
      empty,
    );
    expect(surfaces(out)).toEqual(['言うてしもた', 'ん', 'か']);
  });

  it.each<[string, Tok[]]>([
    [
      'before を',
      [
        ['云う', VERB],
        ['たんか', NOUN],
        ['を', CASE],
      ],
    ],
    [
      'after を',
      [
        ['犬', NOUN],
        ['を', CASE],
        ['たんか', NOUN],
      ],
    ],
    [
      'after a possessive の',
      [
        ['お島', NOUN],
        ['の', CASE],
        ['たんか', NOUN],
      ],
    ],
    [
      'after a noun',
      [
        ['犬', NOUN],
        ['たんか', NOUN],
      ],
    ],
    ['at the start', [['たんか', NOUN]]],
    [
      'after a symbol',
      [
        ['云う', VERB],
        ['、', SYMBOL],
        ['たんか', NOUN],
      ],
    ],
    [
      'when Sudachi did not read it as a noun',
      [
        ['云う', VERB],
        ['たんか', INTJ],
      ],
    ],
  ])('leaves たんか alone %s', (_label, tokens) => {
    const input = sentence(...tokens);
    expect(repairTankaToTaNKa(input, empty)).toBe(input);
  });

  it('leaves もう without a て-form and し|も without one', () => {
    const mou = sentence(['犬', NOUN], ['もう', ADV], ['たんか', NOUN]);
    expect(repairTankaToTaNKa(mou, empty)).toBe(mou);
    const shimo = sentence(['犬', NOUN], ['し', VERB, 'する'], ['も', BOUND], ['たんか', NOUN]);
    expect(repairTankaToTaNKa(shimo, empty)).toBe(shimo);
  });
});

describe('repairTteNani', () => {
  it('reads ってな|に as って + なに (pinned 何)', () => {
    const out = repairTteNani(sentence(['だ', AUX], ['ってな', CASE], ['に', CASE]), empty);
    expect(view(out)).toEqual([
      ['だ', 'だ', 'Auxiliary'],
      ['って', 'って', 'Particle'],
      ['なに', 'なに', 'Noun'],
    ]);
    expect(out[2]).toMatchObject({ n: '何', r: 'ナニ', flags: { pin: 1577100 } });
  });

  it('reads って|な|に as って + なに', () => {
    const out = repairTteNani(sentence(['って', CASE], ['な', FINAL], ['に', CASE], ['よ', FINAL]), empty);
    expect(surfaces(out)).toEqual(['って', 'なに', 'よ']);
    expect(out[1]?.members.map((member) => member.s)).toEqual(['な', 'に']);
  });

  it('keeps ってな before a noun head (ってな|具合)', () => {
    const input = sentence(['ってな', CASE], ['具合', NOUN]);
    expect(repairTteNani(input, empty)).toBe(input);
  });
});

describe('repairDanTobashi', () => {
  it('reforms 段飛ばし after a bare 段', () => {
    const out = repairDanTobashi(sentence(['段', SUFFIX], ['飛ばし', NOUN]), empty);
    expect(view(out)).toEqual([['段飛ばし', '段飛ばし', 'Noun']]);
  });

  it('counts 何段 as a numeral head (何段|飛ばし → 何 + 段飛ばし)', () => {
    const out = repairDanTobashi(sentence(['何段', NOUN], ['飛ばし', NOUN]), empty);
    expect(surfaces(out)).toEqual(['何', '段飛ばし']);
  });

  it('keeps a non-numeral head and pinned tokens (階段|飛ばし)', () => {
    const kaidan = sentence(['階段', NOUN], ['飛ばし', NOUN]);
    expect(repairDanTobashi(kaidan, empty)).toBe(kaidan);
    const [w, b] = sentence(['一段', NOUN], ['飛ばし', NOUN]) as [Group, Group];
    const pinnedHead = [pinned(w), b];
    expect(repairDanTobashi(pinnedHead, empty)).toBe(pinnedHead);
    const pinnedTail = [w, pinned(b)];
    expect(repairDanTobashi(pinnedTail, empty)).toBe(pinnedTail);
  });
});
