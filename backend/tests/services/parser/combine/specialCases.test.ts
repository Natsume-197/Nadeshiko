import { describe, expect, it } from 'vitest';
import { type Group, toGroups } from '@app/services/parser/combine';
import { processSpecialCases } from '@app/services/parser/combine/stages/specialCases';
import type { Morpheme } from '@app/services/parser/sudachi';
import { ctx } from './testLexicon';

/** Real sidecar output (split mode B, SudachiDict full 20260116), captured 2026-11-19. */
const m = (s: string, b: number, pos: string[], d: string, n: string, r: string): Morpheme => ({
  s,
  b,
  e: b + [...s].length,
  pos: pos as Morpheme['pos'],
  d,
  n,
  r,
  a: [],
});
const KANOJO = m('彼女', 0, ['代名詞', '*', '*', '*', '*', '*'], '彼女', '彼女', 'カノジョ');
const NA = (b: number) => m('な', b, ['助動詞', '*', '*', '*', '助動詞-ダ', '連体形-一般'], 'だ', 'だ', 'ナ');
const N = (b: number) => m('ん', b, ['助詞', '準体助詞', '*', '*', '*', '*'], 'ん', 'の', 'ン');
const Q = (b: number) => m('?', b, ['補助記号', '句点', '*', '*', '*', '*'], '?', '?', '?');

const SUDACHI: Record<string, Morpheme[]> = {
  '彼女なの?': [KANOJO, NA(2), m('の', 3, ['助詞', '終助詞', '*', '*', '*', '*'], 'の', 'の', 'ノ'), Q(4)],
  '彼女なんですか?': [
    KANOJO,
    NA(2),
    N(3),
    m('です', 4, ['助動詞', '*', '*', '*', '助動詞-デス', '終止形-一般'], 'です', 'です', 'デス'),
    m('か', 6, ['助詞', '終助詞', '*', '*', '*', '*'], 'か', 'か', 'カ'),
    Q(7),
  ],
  そうなんじゃない: [
    m('そう', 0, ['副詞', '*', '*', '*', '*', '*'], 'そう', 'そう', 'ソウ'),
    NA(2),
    N(3),
    m('じゃ', 4, ['助動詞', '*', '*', '*', '助動詞-ダ', '連用形-融合'], 'だ', 'だ', 'ジャ'),
    m('ない', 6, ['形容詞', '非自立可能', '*', '*', '形容詞', '終止形-一般'], 'ない', '無い', 'ナイ'),
  ],
};

const run = (text: string) => processSpecialCases(toGroups(SUDACHI[text] as Morpheme[]), ctx);
const view = (groups: Group[]) => groups.map((group) => `${group.s}:${group.cls}`);

describe('ProcessSpecialCases', () => {
  it('reads な|の after a noun as なの at the end of a clause (彼女なの?)', () => {
    expect(view(run('彼女なの?'))).toEqual(['彼女:Pronoun', 'なの:Expression', '?:SupplementarySymbol']);
  });

  it('forms explanatory なん and SpecialCases2 ですか (彼女なんですか?)', () => {
    expect(view(run('彼女なんですか?'))).toEqual([
      '彼女:Pronoun',
      'なん:Auxiliary',
      'ですか:Expression',
      '?:SupplementarySymbol',
    ]);
  });

  it('keeps upstream’s そう|なん|じゃない', () => {
    expect(run('そうなんじゃない').map((group) => group.s)).toEqual(['そう', 'なん', 'じゃない']);
  });

  it('keeps the offsets and members of every group', () => {
    const groups = run('彼女なんですか?');
    expect(groups.map((group) => [group.b, group.e])).toEqual([
      [0, 2],
      [2, 4],
      [4, 7],
      [7, 8],
    ]);
    expect(groups[1]?.members.map((member) => member.s)).toEqual(['な', 'ん']);
  });
});
