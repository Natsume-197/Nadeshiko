import { describe, expect, it } from 'vitest';
import { combine, type Group, scanFeatures, STAGES, toGroups } from '@app/services/parser/combine';
import { morphemes } from './fixtures';
import { ctx } from './testLexicon';

const surfaces = (groups: Group[]) => groups.map((group) => group.s);
const run = (text: string) => combine(morphemes(text), ctx);

describe('combine: grouping examples', () => {
  // Each sentence with the grouping we expect. Where we differ from the previous parser, the upstream combine stages
  // group the same way we do.
  it.each([
    ['やります', ['やります']],
    ['なかったです', ['なかった', 'です']],
    ['待ってて', ['待ってて']],
    ['ですか', ['ですか']],
    ['手に入って', ['手に入って']],
    ['よかった', ['よかった']],
    ['1つ', ['1つ']],
    ['んだ', ['んだ']],
    ['押して', ['押して']],
    ['やってやる', ['やってやる']],
    ['ご注文はうさぎですか', ['ご注文', 'は', 'うさぎ', 'ですか']],
    ['勉強した', ['勉強した']],
    ['食べさせられた', ['食べさせられた']],
    ['かもしれない', ['かもしれない']],
    ['食べちゃった', ['食べちゃった']],
    ['書いてある', ['書いてある']],
  ])('%s → %j', (text, expected) => {
    expect(surfaces(run(text))).toEqual(expected);
  });

  it('groups 言わ|れる and お|方, but keeps さすが|は apart (previous parser: さすがは)', () => {
    expect(surfaces(run('さすがは内家拳の達人と言われるお方'))).toEqual([
      'さすが',
      'は',
      '内家拳',
      'の',
      '達人',
      'と',
      '言われる',
      'お方',
    ]);
  });

  it('keeps 何|これ apart: JMdict lists 何これ as an interjection and two-group windows merge only from a whitelist', () => {
    expect(surfaces(run('何これ'))).toEqual(['何', 'これ']);
  });
});

describe('combine: dictionary forms, kinds and deconjugations', () => {
  it('names the base and the deconjugation chain of an inflected group', () => {
    const [group] = run('食べさせられた') as [Group];
    expect(group).toMatchObject({
      kind: 'inflected',
      d: '食べる',
      pos: ['動詞', '一般', '*', '*', '下一段-バ行', '連用形-一般'],
    });
    expect(group.deconjugation?.text).toBe('食べる');
    expect(group.deconjugation?.process).toContain('causative');
    expect(group.r).toBe('タベサセラレタ');
  });

  it('turns a suru-noun and its する into the verb, mined as the noun (勉強)', () => {
    expect(run('勉強した')[0]).toMatchObject({ s: '勉強した', d: '勉強', kind: 'inflected', cls: 'Verb' });
  });

  it('gives an expression its dictionary entry as d', () => {
    const [group] = run('手に入って') as [Group];
    expect(group).toMatchObject({ kind: 'expression', d: '手に入る' });
    expect(group.deconjugation?.text).toBe('手に入る');
  });

  it.each([
    ['1つ', 'counter'],
    ['三枚', 'counter'],
    ['二十日', 'counter'],
    ['総合格闘技', 'compound'],
    ['ですか', 'expression'],
    ['んだ', 'expression'],
    ['には', 'expression'],
    ['本当に', 'expression'],
    ['だから', 'expression'],
    ['よかった', 'inflected'],
    ['高くて', 'inflected'],
  ])('%s is a %s', (text, kind) => {
    const groups = run(text);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe(kind);
  });

  it('marks particles left alone as function words and the rest as words', () => {
    const groups = run('ご注文はうさぎですか');
    expect(groups.map((group) => group.kind)).toEqual(['word', 'function', 'word', 'expression']);
  });

  it('keeps a name and its honorific apart (さん and たち never merge)', () => {
    expect(surfaces(run('田中さん'))).toEqual(['田中', 'さん']);
    expect(surfaces(run('田中さんたち'))).toEqual(['田中', 'さん', 'たち']);
    expect(run('田中さん').map((group) => group.cls)).toEqual(['Noun', 'Suffix']);
  });
});

describe('combine: members and offsets', () => {
  it('keeps every original morpheme, in order, with its offsets', () => {
    const input = morphemes('さすがは内家拳の達人と言われるお方');
    const groups = combine(input, ctx);
    expect(groups.flatMap((group) => group.members)).toEqual(input);
    const iwareru = groups.find((group) => group.s === '言われる') as Group;
    expect(iwareru.members.map((m) => [m.s, m.b, m.e])).toEqual([
      ['言わ', 11, 13],
      ['れる', 13, 15],
    ]);
    expect([iwareru.b, iwareru.e]).toEqual([11, 15]);
    const okata = groups.at(-1) as Group;
    expect([okata.b, okata.e, okata.r, okata.d]).toEqual([15, 17, 'オカタ', 'お方']);
  });

  it('tiles the sentence: each group starts where the last ended and spells its members', () => {
    for (const text of ['手に入って', 'ご注文はうさぎですか', '犬っていう動物', '待ってて']) {
      const groups = run(text);
      let at = 0;
      for (const group of groups) {
        expect(group.b).toBe(at);
        expect(group.s).toBe(group.members.map((m) => m.s).join(''));
        expect(group.e - group.b).toBe([...group.s].length);
        at = group.e;
      }
      expect(at).toBe([...text].length);
    }
  });
});

describe('stage list', () => {
  it('runs the split, repair, combine, cleanup and reading stages in the upstream order, then the sentence-level merges', () => {
    expect(STAGES.map((stage) => stage.name)).toEqual([
      'SplitCompoundAuxiliaryVerbs',
      'SplitTatteParticle',
      'SplitUnattestedToAdverbs',
      'SplitTanSuffix',
      'SplitTawakeNoun',
      'SplitLexicalisedKaratte',
      'SplitDoushiteContraction',
      'SplitEmphaticMoSuru',
      'RepairHasaNoun',
      'RepairNTokenisation',
      'RepairVowelElongation',
      'ApplyTokenRewriteRulesEarly',
      'RepairTeOkuRequest',
      'ProcessSpecialCases',
      'RepairColloquialNegativeNee',
      'RepairColloquialRanNai',
      'RepairIntensifierKaeru',
      'RepairQuotativeTte',
      'RepairNounReadAsTeForm',
      'RepairStolenUBeforeSsu',
      'RecombineHiraganaTokens',
      'ApplyTokenRewriteRulesLate',
      'RepairSakkiMoraTheft',
      'CollapseReduplicatedMimetic',
      'RepairClippedAdjective',
      'RepairSplitMimeticAdverb',
      'RepairEmphaticKanaSpelling',
      'CombinePrefixes',
      'CombineInflections',
      'CombineCompletionAuxVerb',
      'CombineAmounts',
      'CombineTte',
      'CombineAuxiliaryVerbStem',
      'CombineSuffix',
      'ReclassifyOrphanedSuffixes',
      'CombineConjunctiveParticle',
      'CombineAuxiliary',
      'CombineToNaru',
      'RepairFusedInterjectionParticle',
      'RepairOrphanedAuxiliary',
      'CombineAdverbialParticle',
      'CombineVerbDependant',
      'CombineParticles',
      'CombineQuotativeToIu',
      'CombineFinal',
      'SplitUnresolvableSuruCompounds',
      'RepairTankaToTaNKa',
      'RepairTteNani',
      'ApplyTokenRewriteRulesCleanup',
      'RepairDanTobashi',
      'ApplyContextPins',
      'ApplyTokenRewriteRulesReading',
      'FixReadingAmbiguity',
      'CombineNounCompounds',
      'CombineCompounds',
      'JoinNounStemCompounds',
      'CombineExpressions',
      'CombineLexicalAdverbs',
      'ResolveOrphanDeverbalNoun',
      'ApplyCollocations',
      'ReadAmounts',
      'LinkReadings',
      'AbsorbStretchedVowel',
      'AssignKinds',
      'RepairLemmas',
    ]);
  });

  it('skips a gated stage when no group has its feature, and reports each stage that ran', () => {
    const ran: string[] = [];
    combine(morphemes('ですか'), { ...ctx, debug: (stage) => ran.push(stage) });
    expect(ran).not.toContain('CombinePrefixes');
    expect(ran).not.toContain('CombineAmounts');
    expect(ran).toContain('CombineFinal');
    expect([...scanFeatures(toGroups(morphemes('1つ')))]).toContain('NumericAmount');
  });
});
