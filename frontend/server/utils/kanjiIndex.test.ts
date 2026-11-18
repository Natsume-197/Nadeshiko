import { describe, expect, it } from 'vitest';
import { kanjiIndexGroups } from './kanjiIndex';

const kanji = (character: string, grade: number | null, jlpt: number | null) => ({
  character,
  grade,
  jlpt,
  frequency: null,
  reading: null,
  meaning: null,
});

const LIST = [
  kanji('日', 1, 5),
  kanji('本', 1, 5),
  kanji('食', 2, 5),
  kanji('憂', 8, 1),
  kanji('鬱', 8, null),
  kanji('飢', null, 1),
];

describe('kanjiIndexGroups', () => {
  it('splits by JLPT, easiest first, with the jōyō kanji no list names last', () => {
    expect(kanjiIndexGroups(LIST, 'jlpt').map((g) => [g.id, g.kanji.map((k) => k.character).join('')])).toEqual([
      ['n5', '日本食'],
      ['n1', '憂飢'],
      ['none', '鬱'],
    ]);
  });

  it('splits by school grade, then the rest of the jōyō list, then everything else', () => {
    expect(kanjiIndexGroups(LIST, 'grade').map((g) => [g.id, g.kanji.map((k) => k.character).join('')])).toEqual([
      ['g1', '日本'],
      ['g2', '食'],
      ['secondary', '憂鬱'],
      ['other', '飢'],
    ]);
  });
});
