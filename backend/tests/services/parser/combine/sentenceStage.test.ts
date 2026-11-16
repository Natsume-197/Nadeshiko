import { describe, expect, it } from 'vitest';
import { type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import {
  combineCompounds,
  combineExpressions,
  combineLexicalAdverbs,
  combineNounCompounds,
} from '@app/services/parser/combine/stages/sentence';
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

describe('combineNounCompounds', () => {
  it('joins a verb stem and the noun after it when the whole is a word (飛び|道具)', () => {
    const out = combineNounCompounds(
      line(['飛び', '動詞,一般', '飛ぶ'], ['道具', '名詞,普通名詞']),
      withLexicon(['飛び道具']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '飛び道具', d: '飛び道具', cls: 'Noun', flags: { via: 'CombineNounCompounds' } });
  });

  it('joins a kanji adverb and a noun (一向|一揆)', () => {
    const out = combineNounCompounds(line(['一向', '副詞'], ['一揆', '名詞,普通名詞']), withLexicon(['一向一揆']));
    expect(out[0]).toMatchObject({ s: '一向一揆', d: '一向一揆', cls: 'Noun' });
  });

  it('joins a mis-tagged single kanji and the noun after it (偶|然)', () => {
    const out = combineNounCompounds(line(['偶', '連体詞'], ['然', '名詞,普通名詞']), withLexicon(['偶然']));
    expect(out[0]).toMatchObject({ s: '偶然', cls: 'Noun' });
  });

  it('leaves a verb stem and noun that are not a word, or a hard-pinned noun, alone', () => {
    const unknown = line(['飛び', '動詞,一般', '飛ぶ'], ['道具', '名詞,普通名詞']);
    expect(combineNounCompounds(unknown, withLexicon([]))).toBe(unknown);
    const [tobi, dougu] = line(['飛び', '動詞,一般', '飛ぶ'], ['道具', '名詞,普通名詞']) as [Group, Group];
    const pinned = [tobi, { ...dougu, flags: { pin: 1, hardPin: true } }];
    expect(combineNounCompounds(pinned, withLexicon(['飛び道具']))).toBe(pinned);
  });

  it('does not let a prefix eat the head of the compound below it (お|母|上 → お, 母上)', () => {
    const out = combineNounCompounds(
      line(['お', '接頭辞'], ['母', '名詞,普通名詞'], ['上', '名詞,普通名詞']),
      withLexicon(['母上']),
    );
    expect(surfaces(out)).toEqual(['お', '母上']);
  });

  it('joins prefix and compound when all three are one word (お|母|上 → お母上)', () => {
    const out = combineNounCompounds(
      line(['お', '接頭辞'], ['母', '名詞,普通名詞'], ['上', '名詞,普通名詞']),
      withLexicon(['母上', 'お母上']),
    );
    expect(surfaces(out)).toEqual(['お母上']);
  });

  it('skips a compound on the exclusion list (もの|たち)', () => {
    const input = line(['もの', '名詞,普通名詞'], ['たち', '接尾辞,名詞的']);
    expect(combineNounCompounds(input, withLexicon(['ものたち']))).toBe(input);
  });

  it('takes the head POS when no member has any section (甲|乙)', () => {
    const out = combineNounCompounds(line(['甲', '名詞'], ['乙', '名詞']), withLexicon(['甲乙']));
    expect(out[0]).toMatchObject({ s: '甲乙', d: '甲乙', sec: ['*', '*', '*'] });
    expect(out[0]?.pos[0]).toBe('名詞');
  });
});

describe('combineCompounds', () => {
  it('joins a reduplicated verb (泣く|泣く) but not a reduplication ending in an inflected form (泣く|泣い)', () => {
    const lexicon = withLexicon([], { exp: ['泣く泣く'] });
    const out = combineCompounds(line(['泣く', '動詞,一般'], ['泣く', '動詞,一般']), lexicon);
    expect(out[0]).toMatchObject({ s: '泣く泣く', d: '泣く泣く', cls: 'Expression' });
    const inflected = line(['泣く', '動詞,一般'], ['泣い', '動詞,一般', '泣く']);
    expect(combineCompounds(inflected, lexicon)).toBe(inflected);
  });

  it('never opens a window with a one-character conjunction (又|会う)', () => {
    const input = line(['又', '接続詞'], ['会う', '動詞,一般']);
    expect(combineCompounds(input, withLexicon([], { verb: ['又会う'] }))).toBe(input);
  });

  it('never opens a window with a suffix that was turned into a noun (たち|去る)', () => {
    const lexicon = withLexicon([], { verb: ['たち去る'] });
    const [tachi, saru] = line(['たち', '接尾辞,名詞的'], ['去る', '動詞,一般']) as [Group, Group];
    const reclassified = [{ ...tachi, cls: 'CommonNoun' as const, flags: { reclassifiedSuffix: true } }, saru];
    expect(combineCompounds(reclassified, lexicon)).toBe(reclassified);
    const plain = [{ ...tachi, cls: 'CommonNoun' as const }, saru];
    expect(surfaces(combineCompounds(plain, lexicon))).toEqual(['たち去る']);
  });

  it('does not read a pronoun as a suru-noun stem (私|してない)', () => {
    const input = line(['私', '代名詞'], ['してない', '動詞,非自立可能', 'する']);
    expect(combineCompounds(input, withLexicon([], { verb: ['私する'] }))).toBe(input);
  });

  it('drops a dictionary form the surface cannot reach (役|に|立って with 立てる)', () => {
    const input = line(['役', '名詞,普通名詞'], ['に', '助詞,格助詞'], ['立って', '動詞,一般', '立てる']);
    expect(combineCompounds(input, withLexicon([], { verb: ['役に立てる'] }))).toBe(input);
  });

  it('falls back to another base of the surface (役|に|立ちます with lemma 立てる → 役に立つ)', () => {
    const out = combineCompounds(
      line(['役', '名詞,普通名詞'], ['に', '助詞,格助詞'], ['立ちます', '動詞,一般', '立てる']),
      withLexicon([], { exp: ['役に立つ'] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '役に立ちます', d: '役に立つ', cls: 'Expression' });
  });

  it('matches the surface itself when the entry is keyed that way (恐れ|入り)', () => {
    const out = combineCompounds(
      line(['恐れ', '名詞,普通名詞'], ['入り', '動詞,一般', '入る']),
      withLexicon([], { exp: ['恐れ入り'] }),
    );
    expect(out[0]).toMatchObject({ s: '恐れ入り', d: '恐れ入り' });
  });

  it('reaches a classical adjective by its modern normalised form (気|高き → 気高い)', () => {
    const out = combineCompounds(
      line(['気', '名詞,普通名詞'], ['高き', '形容詞,一般', '高し', { n: '高い' }]),
      withLexicon([], { 'adj-i': ['気高い'] }),
    );
    expect(out[0]).toMatchObject({ s: '気高き', d: '気高い', cls: 'Expression' });
  });

  it('retries a slurred negative as its ない form (一筋縄|では|いかん → 一筋縄ではいかない)', () => {
    const out = combineCompounds(
      line(['一筋縄', '名詞,普通名詞'], ['では', '助詞,格助詞'], ['いかん', '動詞,非自立可能', 'いく']),
      withLexicon([], { exp: ['一筋縄ではいかない'] }),
    );
    expect(out[0]).toMatchObject({ s: '一筋縄ではいかん', d: '一筋縄ではいかない' });
  });

  it('retries a negative ある as ない (しょう|が|ありません → しょうがない)', () => {
    const out = combineCompounds(
      line(['しょう', '名詞,普通名詞'], ['が', '助詞,格助詞'], ['ありません', '動詞,非自立可能', 'ある']),
      withLexicon([], { exp: ['しょうがない'] }),
    );
    expect(out[0]).toMatchObject({ s: 'しょうがありません', d: 'しょうがない' });
  });

  it('retries a colloquial ねぇ as ない (ろくでも|ねぇ → ろくでもない)', () => {
    const out = combineCompounds(
      line(['ろくでも', '副詞'], ['ねぇ', '形容詞,非自立可能', 'ねぇ', { n: '無い' }]),
      withLexicon([], { exp: ['ろくでもない'] }),
    );
    expect(out[0]).toMatchObject({ s: 'ろくでもねぇ', d: 'ろくでもない' });
  });

  it('tries the intermediate forms of a long inflection (呆気|に|取られました → 呆気に取られる)', () => {
    const out = combineCompounds(
      line(['呆気', '名詞,普通名詞'], ['に', '助詞,格助詞'], ['取られました', '動詞,一般', '取る']),
      withLexicon([], { exp: ['呆気に取られる'] }),
    );
    expect(out[0]).toMatchObject({ s: '呆気に取られました', d: '呆気に取られる' });
  });

  it('tries the normalised spelling of an uninflected verb (気|を|つける → 気を付ける)', () => {
    const out = combineCompounds(
      line(['気', '名詞,普通名詞'], ['を', '助詞,格助詞'], ['つける', '動詞,一般', 'つける', { n: '付ける' }]),
      withLexicon([], { exp: ['気を付ける'] }),
    );
    expect(out[0]).toMatchObject({ s: '気をつける', d: '気を付ける' });
  });

  it('leaves 嘘|が|ばれる (normalised バレる) alone when no spelling is an entry', () => {
    const input = line(
      ['嘘', '名詞,普通名詞'],
      ['が', '助詞,格助詞'],
      ['ばれる', '動詞,一般', 'ばれる', { n: 'バレる' }],
    );
    expect(combineCompounds(input, withLexicon([]))).toBe(input);
  });

  it('deconjugates an unlemmatised kanji stem (手|に|入れ → 手に入れる)', () => {
    const out = combineCompounds(
      line(['手', '名詞,普通名詞'], ['に', '助詞,格助詞'], ['入れ', '動詞,一般', '入れ']),
      withLexicon([], { exp: ['手に入れる'] }),
    );
    expect(out[0]).toMatchObject({ s: '手に入れ', d: '手に入れる' });
  });

  it('with no dictionary form, tries only the shortest deconjugated base (手|に|入れ, lemma missing)', () => {
    const input = line(['手', '名詞,普通名詞'], ['に', '助詞,格助詞'], ['入れ', '動詞,一般', '']);
    expect(combineCompounds(input, withLexicon([], { exp: ['手に入れる'] }))).toBe(input);
    const out = combineCompounds(input, withLexicon([], { exp: ['手に入'] }));
    expect(out[0]).toMatchObject({ s: '手に入れ', d: '手に入' });
  });
});

describe('combineExpressions: whitelisted pairs', () => {
  it('joins とは|いえ, but not when a negative follows (とは|いえ|ない)', () => {
    const out = combineExpressions(line(['とは', '助詞,格助詞'], ['いえ', '動詞,一般', 'いう'], ['彼', '代名詞']), ctx);
    expect(surfaces(out)).toEqual(['とはいえ', '彼']);
    expect(out[0]).toMatchObject({ d: 'とはいえ', cls: 'Expression' });
    const negated = line(['とは', '助詞,格助詞'], ['いえ', '動詞,一般', 'いう'], ['ない', '助動詞']);
    expect(combineExpressions(negated, ctx)).toBe(negated);
  });

  it('joins いい|や only at the start of a clause (いいや vs 天気|も|いい|や)', () => {
    const initial = combineExpressions(
      line(['いい', '形容詞,非自立可能'], ['や', '助詞,終助詞'], ['それ', '代名詞']),
      ctx,
    );
    expect(surfaces(initial)).toEqual(['いいや', 'それ']);
    const inside = line(
      ['天気', '名詞,普通名詞'],
      ['も', '助詞,係助詞'],
      ['いい', '形容詞,非自立可能'],
      ['や', '助詞,終助詞'],
    );
    expect(combineExpressions(inside, ctx)).toBe(inside);
  });

  it('joins rhetorical もの|か after a predicate, skipping punctuation (負ける|、|もの|か)', () => {
    const out = combineExpressions(
      line(['負ける', '動詞,一般'], ['、', '補助記号,読点'], ['もの', '名詞,普通名詞'], ['か', '助詞,終助詞']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['負ける', '、', 'ものか']);
  });

  it('keeps もの|か apart after a nominal or at the start (どのような|もの|か, もの|か|よ)', () => {
    const nominal = line(['どのような', '連体詞'], ['もの', '名詞,普通名詞'], ['か', '助詞,終助詞']);
    expect(combineExpressions(nominal, ctx)).toBe(nominal);
    const initial = line(['もの', '名詞,普通名詞'], ['か', '助詞,終助詞'], ['よ', '助詞,終助詞']);
    expect(combineExpressions(initial, ctx)).toBe(initial);
  });

  it('joins a noun-verb idiom with its を left out (カマ|かけ|て → カマをかける)', () => {
    const out = combineExpressions(
      line(['カマ', '名詞,普通名詞'], ['かけ', '動詞,一般', 'かける'], ['て', '助詞,接続助詞']),
      ctx,
    );
    expect(surfaces(out)).toEqual(['カマかけ', 'て']);
    expect(out[0]).toMatchObject({ d: 'カマをかける', cls: 'Expression' });
  });

  it('does not take a pair whose last word forms a function word with the next (どちら|も|し, もし)', () => {
    const input = line(['どちら', '代名詞'], ['も', '助詞,係助詞'], ['し', '動詞,非自立可能', 'する']);
    expect(combineExpressions(input, withLexicon([], { adv: ['もし'] }))).toBe(input);
  });
});

describe('combineExpressions: longer windows', () => {
  it('does not steal a name’s honorific (ヴァレリア|様|に|言わせれば)', () => {
    const lexicon = withLexicon([], { exp: ['様に言わせれば'] });
    const named = line(
      ['ヴァレリア', '名詞,固有名詞,人名'],
      ['様', '接尾辞,名詞的'],
      ['に', '助詞,格助詞'],
      ['言わせれば', '動詞,一般', '言う'],
    );
    expect(combineExpressions(named, lexicon)).toBe(named);
    const bare = line(['様', '接尾辞,名詞的'], ['に', '助詞,格助詞'], ['言わせれば', '動詞,一般', '言う']);
    expect(surfaces(combineExpressions(bare, lexicon))).toEqual(['様に言わせれば']);
  });

  it('skips an excluded window (こと|を|好む)', () => {
    const input = line(['こと', '名詞,普通名詞'], ['を', '助詞,格助詞'], ['好む', '動詞,一般']);
    expect(combineExpressions(input, withLexicon([], { exp: ['ことを好む'] }))).toBe(input);
  });

  it('matches with the last verb in its dictionary form (気|に|入っ|た → 気に入る)', () => {
    const out = combineExpressions(
      line(['気', '名詞,普通名詞'], ['に', '助詞,格助詞'], ['入っ', '動詞,一般', '入る'], ['た', '助動詞']),
      withLexicon([], { exp: ['気に入る'] }),
    );
    expect(surfaces(out)).toEqual(['気に入っ', 'た']);
    expect(out[0]).toMatchObject({ d: '気に入る', flags: { via: 'CombineExpressions' } });
  });

  it('matches a passive the lemma skips over (呆気|に|取られ → 呆気に取られる)', () => {
    const out = combineExpressions(
      line(['呆気', '名詞,普通名詞'], ['に', '助詞,格助詞'], ['取られ', '動詞,一般', '取る']),
      withLexicon([], { exp: ['呆気に取られる'] }),
    );
    expect(out[0]).toMatchObject({ s: '呆気に取られ', d: '呆気に取られる' });
  });

  it('rebuilds the ない tail of a lexicalised なくなる (元|も|子|も|なくなる → 元も子もない)', () => {
    const input = line(
      ['元', '名詞,普通名詞'],
      ['も', '助詞,係助詞'],
      ['子', '名詞,普通名詞'],
      ['も', '助詞,係助詞'],
      ['なくなる', '動詞,一般'],
    );
    const out = combineExpressions(input, withLexicon([], { exp: ['元も子もない'] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '元も子もなくなる', d: '元も子もない' });
    expect(combineExpressions(input, withLexicon([]))).toBe(input);
  });

  it('joins an adverb and と that the dictionary lists (ぱっ|と|立つ)', () => {
    const input = line(['ぱっ', '副詞'], ['と', '助詞,格助詞'], ['立つ', '動詞,一般']);
    const out = combineExpressions(input, withLexicon([], { adv: ['ぱっと'] }));
    expect(surfaces(out)).toEqual(['ぱっと', '立つ']);
    expect(out[0]).toMatchObject({ d: 'ぱっと', cls: 'Expression' });
    expect(combineExpressions(input, withLexicon([]))).toBe(input);
  });
});

describe('combineLexicalAdverbs', () => {
  it('leaves a single group alone', () => {
    const input = line(['犬', '名詞,普通名詞']);
    expect(combineLexicalAdverbs(input, ctx)).toBe(input);
  });

  it.each([
    ['ため|と|したら', 'ため', '名詞,普通名詞', 'したら', 'する'],
    ['言う|と|すれば', '言う', '動詞,一般', 'すれば', '為る'],
  ])('joins the suppositional と + する form (%s)', (_name, head, headPos, verb, d) => {
    const input = line([head, headPos], ['と', '助詞,格助詞'], [verb, '動詞,非自立可能', d]);
    const out = combineLexicalAdverbs(input, withLexicon([], { conj: [`と${verb}`] }));
    expect(surfaces(out)).toEqual([head, `と${verb}`]);
    expect(out[1]).toMatchObject({ cls: 'Conjunction', d: `と${verb}`, flags: { via: 'CombineLexicalAdverbs' } });
  });

  it('joins としたら at the start and after a one-character word (だ|と|したら)', () => {
    const lexicon = withLexicon([], { conj: ['としたら'] });
    const initial = combineLexicalAdverbs(line(['と', '助詞,格助詞'], ['したら', '動詞,非自立可能', 'する']), lexicon);
    expect(surfaces(initial)).toEqual(['としたら']);
    const da = combineLexicalAdverbs(
      line(['だ', '助動詞'], ['と', '助詞,格助詞'], ['したら', '動詞,非自立可能', 'する']),
      lexicon,
    );
    expect(surfaces(da)).toEqual(['だ', 'としたら']);
  });

  it('keeps と|したら apart after a volitional ("try to": 押そう|と|したら)', () => {
    const input = line(['押そう', '動詞,一般', '押す'], ['と', '助詞,格助詞'], ['したら', '動詞,非自立可能', 'する']);
    expect(combineLexicalAdverbs(input, withLexicon([], { conj: ['としたら'] }))).toBe(input);
  });

  it('keeps と|したら apart when the dictionary does not list it, or when the verb is not する', () => {
    const unlisted = line(['ため', '名詞,普通名詞'], ['と', '助詞,格助詞'], ['したら', '動詞,非自立可能', 'する']);
    expect(combineLexicalAdverbs(unlisted, withLexicon([]))).toBe(unlisted);
    const other = line(['ため', '名詞,普通名詞'], ['と', '助詞,格助詞'], ['したら', '動詞,一般', 'したる']);
    expect(combineLexicalAdverbs(other, withLexicon([], { conj: ['としたら'] }))).toBe(other);
  });

  it.each([
    ['具体的|に (particle)', '具体的', '形状詞,一般', 'に', '助詞,格助詞'],
    ['具体的|に (copula)', '具体的', '形状詞,一般', 'に', '助動詞'],
    ['絶対|に', '絶対', '名詞,普通名詞', 'に', '助詞,格助詞'],
    ['意地|でも', '意地', '名詞,普通名詞', 'でも', '助詞,副助詞'],
    ['山|ほど', '山', '名詞,普通名詞', 'ほど', '助詞,副助詞'],
    ['一足|先に', '一足', '名詞,普通名詞', '先に', '副詞'],
    ['時|には at the start', '時', '名詞,普通名詞', 'には', '助詞,格助詞'],
  ])('joins the adverb %s', (_name, noun, nounPos, tail, tailPos) => {
    const text = noun + tail;
    const out = combineLexicalAdverbs(line([noun, nounPos], [tail, tailPos]), withLexicon([], { adv: [text] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: text, d: text, cls: 'Adverb', flags: { via: 'CombineLexicalAdverbs' } });
  });

  it('joins 時|には after punctuation but not mid-clause (、|時|には vs その|時|には)', () => {
    const lexicon = withLexicon([], { adv: ['時には'] });
    const afterComma = combineLexicalAdverbs(
      line(['、', '補助記号,読点'], ['時', '名詞,普通名詞'], ['には', '助詞,格助詞']),
      lexicon,
    );
    expect(surfaces(afterComma)).toEqual(['、', '時には']);
    const midClause = line(['その', '連体詞'], ['時', '名詞,普通名詞'], ['には', '助詞,格助詞']);
    expect(combineLexicalAdverbs(midClause, lexicon)).toBe(midClause);
  });

  it('keeps a noun and に apart when neither rule applies or the dictionary lacks the adverb', () => {
    const plain = line(['外', '名詞,普通名詞'], ['に', '助詞,格助詞']);
    expect(combineLexicalAdverbs(plain, withLexicon([], { adv: ['外に'] }))).toBe(plain);
    const unlisted = line(['具体的', '形状詞,一般'], ['に', '助詞,格助詞']);
    expect(combineLexicalAdverbs(unlisted, withLexicon([]))).toBe(unlisted);
    const hodoNotParticle = line(['山', '名詞,普通名詞'], ['ほど', '名詞,普通名詞']);
    expect(combineLexicalAdverbs(hodoNotParticle, withLexicon([], { adv: ['山ほど'] }))).toBe(hodoNotParticle);
  });
});
