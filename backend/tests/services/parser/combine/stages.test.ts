import { describe, expect, it } from 'vitest';
import { fromMorpheme, type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import { isAmountCombination, combineAmounts } from '@app/services/parser/combine/stages/amounts';
import {
  combineAuxiliary,
  combineAuxiliaryVerbStem,
  combineCompletionAuxVerb,
  combineConjunctiveParticle,
  combineTte,
  combineVerbDependant,
} from '@app/services/parser/combine/stages/auxiliaries';
import { combineInflections } from '@app/services/parser/combine/stages/inflections';
import { combineFinal, combineParticles, combineQuotativeToIu } from '@app/services/parser/combine/stages/particles';
import { combinePrefixes } from '@app/services/parser/combine/stages/prefixes';
import { repairNdaPastTense } from '@app/services/parser/combine/stages/repairNda';
import {
  combineCompounds,
  combineExpressions,
  combineNounCompounds,
} from '@app/services/parser/combine/stages/sentence';
import { combineSuffix, reclassifyOrphanedSuffixes } from '@app/services/parser/combine/stages/suffix';
import type { Morpheme } from '@app/services/parser/sudachi';
import { morphemes } from './fixtures';
import { ctx } from './testLexicon';

const surfaces = (groups: Group[]) => groups.map((group) => group.s);
const groups = (text: string) => toGroups(morphemes(text));

/** A hand-made morpheme, for shapes the fixtures do not cover. */
function m(s: string, b: number, pos: string, d = s, r = s): Morpheme {
  const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
  return { s, b, e: b + [...s].length, pos: fields, d, n: d, r, a: [] };
}

describe('CombinePrefixes', () => {
  it('joins お and a noun when JMdict has the whole', () => {
    const out = combinePrefixes(groups('さすがは内家拳の達人と言われるお方'), ctx);
    const okata = out.at(-1) as Group;
    expect(okata).toMatchObject({
      s: 'お方',
      d: 'お方',
      cls: 'Noun',
      pos: ['名詞', '普通名詞', '助数詞可能', '*', '*', '*'],
    });
    expect(okata.members.map((member) => member.s)).toEqual(['お', '方']);
    expect(surfaces(combinePrefixes(groups('ご注文はうさぎですか'), ctx))[0]).toBe('ご注文');
  });

  it('leaves the prefix alone when the whole is not a word', () => {
    const lexicon = new InMemoryLexicon(['方']);
    const input = groups('さすがは内家拳の達人と言われるお方');
    expect(combinePrefixes(input, { ...ctx, lexicon })).toBe(input);
  });

  it('does not take the head of a compound the prefix does not belong to (お|母|上)', () => {
    const lexicon = new InMemoryLexicon(['お母', '母上']);
    const input = toGroups([
      m('お', 0, '接頭辞'),
      m('母', 1, '名詞,普通名詞,一般'),
      m('上', 2, '名詞,普通名詞,副詞可能'),
    ]);
    expect(surfaces(combinePrefixes(input, { ...ctx, lexicon }))).toEqual(['お', '母', '上']);
  });
});

describe('CombineInflections', () => {
  it.each([
    ['やります', ['やります'], 'やる'],
    ['よかった', ['よかった'], 'よい'],
    ['押して', ['押して'], '押す'],
    ['待ってて', ['待ってて'], '待つ'],
    ['食べさせられた', ['食べさせられた'], '食べる'],
    ['行かなきゃ', ['行かなきゃ'], '行く'],
  ])('%s → %j (base %s)', (text, expected, base) => {
    const out = combineInflections(groups(text), ctx);
    expect(surfaces(out)).toEqual(expected);
    expect(out[0]?.d).toBe(base);
    expect(out[0]?.flags.inflected).toBe(true);
  });

  it('stops before a copula after a past form (なかった|です)', () => {
    expect(surfaces(combineInflections(groups('なかったです'), ctx))).toEqual(['なかった', 'です']);
  });

  it('merges only when the base is a known word', () => {
    const lexicon = new InMemoryLexicon([]);
    expect(surfaces(combineInflections(groups('やります'), { ...ctx, lexicon }))).toEqual(['やり', 'ます']);
  });

  it('stops before だ after a stem in ん; RepairNTokenisation joins a real past tense first (読ん|だ)', () => {
    const input = toGroups([m('読ん', 0, '動詞,一般,*,*,五段-マ行,連用形-撥音便', '読む'), m('だ', 2, '助動詞')]);
    const yomu = { ...ctx, lexicon: new InMemoryLexicon(['読む']) };
    expect(surfaces(combineInflections(input, yomu))).toEqual(['読ん', 'だ']);
    const repaired = repairNdaPastTense(input, yomu);
    expect(surfaces(repaired)).toEqual(['読んだ']);
    expect(repaired[0]).toMatchObject({ d: '読む', cls: 'Verb' });
    // さん|だ and たくさん|で take the copula.
    const copula = toGroups([m('たくさん', 0, '副詞'), m('で', 4, '助動詞', 'だ')]);
    expect(repairNdaPastTense(copula, ctx)).toBe(copula);
    const particleN = toGroups([
      m('行く', 0, '動詞,非自立可能', '行く'),
      m('ん', 2, '助詞,準体助詞', 'の'),
      m('だ', 3, '助動詞'),
    ]);
    expect(surfaces(combineInflections(particleN, ctx))).toEqual(['行く', 'ん', 'だ']);
  });
});

describe('CombineCompletionAuxVerb', () => {
  it('joins 逃げ|切った when JMdict has 逃げ切る', () => {
    const input = combineInflections(groups('逃げ切った'), ctx);
    expect(surfaces(input)).toEqual(['逃げ', '切った']);
    const out = combineCompletionAuxVerb(input, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '逃げ切った', d: '逃げ切る', flags: { inflected: true } });
  });

  it('leaves 切る alone when the compound is unknown', () => {
    const input = toGroups([m('紙', 0, '名詞'), m('切る', 1, '動詞,一般', '切る')]);
    expect(combineCompletionAuxVerb(input, ctx)).toBe(input);
  });
});

describe('CombineAmounts', () => {
  it.each([
    ['1つ', '1つ'],
    ['三枚', '三枚'],
    ['二十日', '二十日'],
  ])('%s is one counter group', (text, surface) => {
    const out = combineAmounts(groups(text), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: surface, d: surface, cls: 'Noun', flags: { kind: 'counter' } });
    expect(out[0]?.pos.slice(0, 2)).toEqual(['名詞', '数詞']);
  });

  it.each([
    ['16', '人', '接尾辞,名詞的,一般'],
    ['30万', '人', '接尾辞,名詞的,一般'],
    ['5', '枚', '接尾辞,名詞的,助数詞'],
  ])('counts %s%s, which the AmountCombinations table leaves out, by its UniDic tags', (numeral, counter, pos) => {
    const input = toGroups([m(numeral, 0, '名詞,数詞'), m(counter, numeral.length, pos)]);

    expect(surfaces(combineAmounts(input, ctx))).toEqual([numeral + counter]);
  });

  it.each([
    ['猫', '名詞,普通名詞,一般'],
    ['円', '名詞,普通名詞,助数詞可能'],
  ])('leaves a numeral before %s (a noun, even one that can count) alone, as the current parser does', (noun, pos) => {
    const input = toGroups([m('5', 0, '名詞,数詞'), m(noun, 1, pos)]);

    expect(surfaces(combineAmounts(input, ctx))).toEqual(['5', noun]);
  });

  it('uses the AmountCombinations table with ASCII digits widened', () => {
    expect(isAmountCombination('1', 'つ')).toBe(true);
    expect(isAmountCombination('１', 'つ')).toBe(true);
    expect(isAmountCombination('7', '匹')).toBe(false);
  });
});

describe('CombineTte and CombineConjunctiveParticle', () => {
  it('joins a っ stem and the て after it', () => {
    const input = toGroups([m('言っ', 0, '名詞,普通名詞'), m('て', 2, '助詞,接続助詞')]);
    expect(surfaces(combineTte(input, ctx))).toEqual(['言って']);
  });

  it('joins て/ば to an adjective or verb', () => {
    expect(surfaces(combineConjunctiveParticle(groups('高くて'), ctx))).toEqual(['高くて']);
    expect(surfaces(combineConjunctiveParticle(groups('行けば'), ctx))).toEqual(['行けば']);
  });
});

describe('CombineAuxiliaryVerbStem', () => {
  it('joins そう to a verb stem', () => {
    expect(surfaces(combineAuxiliaryVerbStem(groups('降りそう'), ctx))).toEqual(['降りそう']);
  });
});

describe('CombineSuffix and ReclassifyOrphanedSuffixes', () => {
  it('joins さ, がる and ら after a pronoun, not さん or たち', () => {
    expect(surfaces(combineSuffix(groups('高さ'), ctx))).toEqual(['高さ']);
    expect(surfaces(combineSuffix(groups('彼ら'), ctx))).toEqual(['彼ら']);
    expect(surfaces(combineSuffix(groups('怖がる'), ctx))).toEqual(['怖がる']);
    expect(surfaces(combineSuffix(groups('田中さんたち'), ctx))).toEqual(['田中', 'さん', 'たち']);
  });

  it('keeps honorifics as suffixes and turns a hostless suffix into a noun', () => {
    expect(reclassifyOrphanedSuffixes(groups('田中さん'), ctx)[1]?.cls).toBe('Suffix');
    const orphan = toGroups([m('よ', 0, '助詞,終助詞'), m('たち', 1, '接尾辞,名詞的,一般', '達')]);
    const out = reclassifyOrphanedSuffixes(orphan, ctx);
    expect(out[1]).toMatchObject({ cls: 'CommonNoun', flags: { reclassifiedSuffix: true } });
    expect(out[1]?.pos[0]).toBe('接尾辞');
  });
});

describe('CombineAuxiliary', () => {
  it('joins auxiliaries to a verb but not です', () => {
    const input = toGroups([
      m('食べ', 0, '動詞,一般', '食べる'),
      m('ちゃっ', 2, '助動詞', 'ちゃう'),
      m('た', 4, '助動詞'),
    ]);
    expect(surfaces(combineAuxiliary(input, ctx))).toEqual(['食べちゃった']);
    const desu = toGroups([m('食べる', 0, '動詞,一般', '食べる'), m('です', 3, '助動詞')]);
    expect(surfaces(combineAuxiliary(desu, ctx))).toEqual(['食べる', 'です']);
  });

  it('joins copula で and ある into である', () => {
    const input = toGroups([m('で', 0, '助動詞', 'だ'), m('ある', 1, '動詞,非自立可能', 'ある')]);
    expect(combineAuxiliary(input, ctx)[0]).toMatchObject({ s: 'である', d: 'である', flags: { kind: 'expression' } });
  });
});

describe('CombineVerbDependant', () => {
  it('joins a て-form and a subsidiary verb (やって|やる, 書い|て|ある)', () => {
    const yatte = toGroups([m('やって', 0, '動詞,非自立可能', 'やる'), m('やる', 3, '動詞,非自立可能', 'やる')]);
    expect(surfaces(combineVerbDependant(yatte, ctx))).toEqual(['やってやる']);
    expect(surfaces(combineVerbDependant(groups('書いてある'), ctx))).toEqual(['書いてある']);
  });

  it('joins a suru-noun and する into the suru verb', () => {
    const shita = combineAuxiliary(groups('勉強した'), ctx);
    expect(surfaces(shita)).toEqual(['勉強', 'した']);
    const out = combineVerbDependant(shita, ctx);
    expect(out[0]).toMatchObject({ s: '勉強した', d: '勉強する', cls: 'Verb' });
  });
});

describe('CombineParticles, CombineQuotativeToIu, CombineFinal', () => {
  it('builds compound particles and かもしれない', () => {
    expect(combineParticles(groups('には'), ctx)[0]).toMatchObject({ s: 'には', d: 'には' });
    const kamo = combineParticles(combineInflections(groups('かもしれない'), ctx), ctx);
    expect(kamo).toHaveLength(1);
    expect(kamo[0]).toMatchObject({ cls: 'Expression', d: 'かもしれない' });
  });

  it('joins って + kana いう', () => {
    const out = combineQuotativeToIu(groups('犬っていう動物'), ctx);
    expect(surfaces(out)).toEqual(['犬', 'っていう', '動物']);
    expect(out[1]).toMatchObject({ d: 'っていう', cls: 'Conjunction' });
  });

  it('joins the curated special cases (ん|だ, です|か, だ|から, 本当|に) with their class', () => {
    expect(combineFinal(groups('んだ'), ctx)[0]).toMatchObject({ s: 'んだ', cls: 'Expression' });
    expect(combineFinal(groups('ですか'), ctx)[0]).toMatchObject({ s: 'ですか', cls: 'Expression' });
    expect(combineFinal(groups('だから'), ctx)[0]).toMatchObject({ s: 'だから', cls: 'Conjunction' });
    expect(combineFinal(groups('本当に'), ctx)[0]).toMatchObject({ s: '本当に', cls: 'Adverb' });
  });
});

describe('sentence-level dictionary windows', () => {
  it('CombineNounCompounds joins nouns JMdict lists as one word', () => {
    const out = combineNounCompounds(groups('総合格闘技'), ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ d: '総合格闘技', flags: { via: 'CombineNounCompounds' } });
  });

  it('CombineNounCompounds never joins a name and its honorific', () => {
    const lexicon = new InMemoryLexicon(['田中さん']);
    expect(surfaces(combineNounCompounds(groups('田中さん'), { ...ctx, lexicon }))).toEqual(['田中', 'さん']);
  });

  it('CombineCompounds anchors on the verb and matches its dictionary form (手|に|入って → 手に入る)', () => {
    const inflected = combineInflections(groups('手に入って'), ctx);
    expect(surfaces(inflected)).toEqual(['手', 'に', '入って']);
    const out = combineCompounds(inflected, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ s: '手に入って', d: '手に入る', cls: 'Expression' });
    expect(out[0]?.members).toHaveLength(4);
  });

  it('CombineCompounds lets a noun anchor form expressions only (その|ため)', () => {
    expect(surfaces(combineCompounds(groups('そのため'), ctx))).toEqual(['そのため']);
    const lexicon = new InMemoryLexicon(['そのため'], { verb: ['そのため'] });
    expect(surfaces(combineCompounds(groups('そのため'), { ...ctx, lexicon }))).toEqual(['その', 'ため']);
  });

  it('CombineExpressions takes two-group windows only from the whitelist', () => {
    // さすがは is a JMdict expression, but a pair needs the whitelist (JMdict also lists のです, それを, 外に).
    const sasuga = toGroups([m('さすが', 0, '副詞'), m('は', 3, '助詞,係助詞'), m('強い', 4, '形容詞,一般', '強い')]);
    expect(combineExpressions(sasuga, ctx)).toBe(sasuga);
    const dochira = toGroups([
      m('どちら', 0, '代名詞'),
      m('も', 3, '助詞,係助詞'),
      m('いい', 4, '形容詞,非自立可能', 'いい'),
    ]);
    expect(surfaces(combineExpressions(dochira, ctx))).toEqual(['どちらも', 'いい']);
  });

  it('CombineExpressions matches a longer window holding a particle', () => {
    const lexicon = new InMemoryLexicon([], { exp: ['元も子もない'] });
    const input = toGroups([
      m('元', 0, '名詞,普通名詞'),
      m('も', 1, '助詞,係助詞'),
      m('子', 2, '名詞,普通名詞'),
      m('も', 3, '助詞,係助詞'),
      m('ない', 4, '形容詞,非自立可能', 'ない'),
    ]);
    const out = combineExpressions(input, { ...ctx, lexicon });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ d: '元も子もない', flags: { via: 'CombineExpressions' } });
  });
});

describe('fromMorpheme', () => {
  it('maps Sudachi’s POS to word classes and a starting kind', () => {
    expect(fromMorpheme(m('、', 0, '補助記号,読点'))).toMatchObject({ cls: 'SupplementarySymbol', kind: 'symbol' });
    expect(fromMorpheme(m(' ', 0, '空白'))).toMatchObject({ cls: 'BlankSpace', kind: 'symbol' });
    expect(fromMorpheme(m('は', 0, '助詞,係助詞'))).toMatchObject({ cls: 'Particle', kind: 'function' });
    expect(fromMorpheme(m('これ', 0, '代名詞'))).toMatchObject({ cls: 'Pronoun', kind: 'word', sec: ['*', '*', '*'] });
  });
});
