import { describe, expect, it } from 'vitest';
import { type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import type { RewriteRule } from '@app/services/parser/combine/data/rewriteRules';
import { cutMorpheme, recut, sliceReading } from '@app/services/parser/combine/recut';
import {
  applyTokenRewriteRulesCleanup,
  applyTokenRewriteRulesEarly,
  applyTokenRewriteRulesLate,
  buildRewriteIndex,
  runRewriteRules,
  validateRewriteRules,
} from '@app/services/parser/combine/stages/rewrite';
import { combineNounCompounds } from '@app/services/parser/combine/stages/sentence';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { Morpheme } from '@app/services/parser/sudachi';
import { morphemes } from './fixtures';

const groups = (text: string) => toGroups(morphemes(text));
const surfaces = (list: readonly Group[]) => list.map((group) => group.s);

describe('re-cutting groups (recut.ts)', () => {
  it('slices a morpheme reading along its kana, and gives up inside a kanji run', () => {
    expect(sliceReading('のさばりかえっ', 'ノサバリカエッ', 0, 4)).toBe('ノサバリ');
    expect(sliceReading('戦い方', 'タタカイカタ', 0, 2)).toBe('タタカイ');
    expect(sliceReading('戦い方', 'タタカイカタ', 2, 3)).toBe('カタ');
    expect(sliceReading('投げ売', 'ナゲウリ', 0, 1)).toBe('ナ');
    expect(sliceReading('人前', 'ヒトマエ', 0, 1)).toBeUndefined();
  });

  it('cuts a synthetic morpheme with its own offsets, reading and A units', () => {
    const tawake = morphemes('帰ってきたたわけ').at(-1) as Morpheme;
    expect(cutMorpheme(tawake, 5, 6)).toMatchObject({ s: 'た', b: 5, e: 6, r: 'タ', synthetic: true, a: [] });
    expect(cutMorpheme(tawake, 4, 9)).toBe(tawake);
  });

  it('re-tiles the members of a span, keeping whole morphemes and cutting the one a boundary falls in', () => {
    const input = groups('帰ってきたたわけ');
    const out = recut(input, 4, 1, [
      { s: 'た', fresh: true, cls: 'Auxiliary' },
      { s: 'わけ', fresh: true, cls: 'Noun' },
    ]);
    expect(out.map((group) => [group.s, group.b, group.e, group.r, group.d])).toEqual([
      ['た', 5, 6, 'タ', 'た'],
      ['わけ', 6, 8, 'ワケ', 'わけ'],
    ]);
    expect(out[0]?.pos[0]).toBe('助動詞');
    expect(out[1]?.members[0]?.synthetic).toBe(true);
    expect(() => recut(input, 4, 1, [{ s: 'たわ' }])).toThrow(/conserve/);
  });
});

/** JMdict words the engine tests read through. */
function engineLexicon() {
  const lexicon = new InMemoryLexicon(['逆', '逆に', 'いい', 'いいか', '損害', 'あいつ', 'いつも', 'こいつ']);
  lexicon.addWord(
    1484340,
    [
      { text: '被る', kana: false },
      { text: 'こうむる', kana: true },
    ],
    { keepForms: true },
  );
  lexicon.add('被る', 2);
  return lexicon;
}
const ctx = { lexicon: engineLexicon(), deconjugate };

describe('the rewrite-rule engine on the Early, Late and Cleanup phases', () => {
  it('validates every copied row, including re-cut conservation and readings', () => {
    const merge: RewriteRule = {
      id: 'x',
      phase: 'Early',
      match: [{ text: '逆' }, { text: 'に' }],
      replace: [{ text: '逆に' }],
    };
    expect(() => validateRewriteRules([merge])).toThrow(/Reading/);
    expect(() => validateRewriteRules([{ ...merge, replace: [{ text: '逆', reading: 'ギャク' }] }])).toThrow(
      /conserve/,
    );
  });

  it('merges N:1 with context (Early gyaku-ni: 逆|に → 逆に), keeping both morphemes as members', () => {
    const out = applyTokenRewriteRulesEarly(groups('逆にいい'), ctx);
    expect(surfaces(out)).toEqual(['逆に', 'いい']);
    expect(out[0]).toMatchObject({ d: '逆に', cls: 'Adverb', r: 'ギャクニ', b: 0, e: 2 });
    expect(out[0]?.members.map((member) => member.s)).toEqual(['逆', 'に']);
    expect(out[0]?.pos[0]).toBe('副詞');
  });

  it('checks Prev and Next context (Early iika-listen: only a clause-initial いいか before 、)', () => {
    expect(surfaces(applyTokenRewriteRulesEarly(groups('いいか、絶対壊すなよ'), ctx)).slice(0, 2)).toEqual([
      'いいか',
      '、',
    ]);
  });

  it('re-cuts 2:2 in the Late phase (aitsu-mo: あ|いつも → あいつ|も), cutting the morpheme in two', () => {
    const out = applyTokenRewriteRulesLate(groups('あいつもこいつも'), ctx);
    expect(out.slice(0, 2).map((group) => [group.s, group.b, group.e, group.r, group.cls])).toEqual([
      ['あいつ', 0, 3, 'アイツ', 'Pronoun'],
      ['も', 3, 4, 'モ', 'Particle'],
    ]);
    expect(out[0]?.members.map((member) => [member.s, member.synthetic ?? false])).toEqual([
      ['あ', false],
      ['いつ', true],
    ]);
  });

  it('pins in a window with RecoverConjugations (Cleanup koumutta: 損害を被った reads こうむった)', () => {
    const [songai, wo, kabu, ta] = groups('損害を被った') as [Group, Group, Group, Group];
    // The Cleanup phase runs after CombineInflections, which has joined 被っ|た.
    const verb: Group = { ...kabu, s: '被った', e: 5, r: 'カブッタ', members: [...kabu.members, ...ta.members] };
    const out = applyTokenRewriteRulesCleanup([songai, wo, verb], ctx);
    expect(out[2]).toMatchObject({ s: '被った', d: '被る', r: 'コウムッタ', flags: { pin: 1484340 } });
    expect(out[2]?.deconjugation?.process).toContain('past');
    const noDamage = [wo, verb];
    expect(applyTokenRewriteRulesCleanup(noDamage, ctx)).toBe(noDamage);
  });

  it('gates on a lookup guard and keeps hard pins out of the compound passes', () => {
    const rules: RewriteRule[] = [
      {
        id: 'guarded',
        phase: 'Early',
        match: [{ text: '逆' }, { text: 'に' }],
        replace: [{ text: '逆に', reading: 'ギャクニ', pin: 1, hardPin: true }],
        guard: { kind: 'CompoundExists', pattern: '{0}{1}' },
      },
    ];
    const index = buildRewriteIndex(rules);
    const out = runRewriteRules(groups('逆にいい'), index, ctx);
    expect(out[0]?.flags).toMatchObject({ pin: 1, hardPin: true });
    const unknown = { ...ctx, lexicon: new InMemoryLexicon(['いい']) };
    const input = groups('逆にいい');
    expect(runRewriteRules(input, index, unknown)).toBe(input);

    // 逆に (hard-pinned) + いい: a noun compound may not swallow it even when the whole is a word.
    const asNoun = out.map((group) => ({ ...group, cls: 'Noun' as const }));
    const withWhole = { ...ctx, lexicon: new InMemoryLexicon(['逆にいい']) };
    expect(surfaces(combineNounCompounds(asNoun, withWhole))).toEqual(['逆に', 'いい']);
    const soft = asNoun.map((group) => ({ ...group, flags: { ...group.flags, hardPin: undefined } }));
    expect(surfaces(combineNounCompounds(soft, withWhole))).toEqual(['逆にいい']);
  });
});
