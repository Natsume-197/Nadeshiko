// The kanji index page's groups (task 44).

export interface KanjiIndexEntry {
  character: string;
  grade: number | null;
  jlpt: number | null;
  frequency: number | null;
  reading: string | null;
  meaning: string | null;
}

export type KanjiIndexGrouping = 'jlpt' | 'grade';

export interface KanjiIndexGroup {
  /** `n5`…`n1` and `none` by JLPT; `g1`…`g6`, `secondary` (the rest of the jōyō list) and `other` by grade. */
  id: string;
  kanji: KanjiIndexEntry[];
}

/** The list split into groups, easiest first, keeping the list's order (grade, then frequency) inside each. Empty
 *  groups are left out. */
export function kanjiIndexGroups(list: KanjiIndexEntry[], by: KanjiIndexGrouping): KanjiIndexGroup[] {
  const groups: KanjiIndexGroup[] =
    by === 'jlpt'
      ? [5, 4, 3, 2, 1].map((level) => ({ id: `n${level}`, kanji: list.filter((k) => k.jlpt === level) }))
      : [1, 2, 3, 4, 5, 6].map((grade) => ({ id: `g${grade}`, kanji: list.filter((k) => k.grade === grade) }));
  if (by === 'jlpt') groups.push({ id: 'none', kanji: list.filter((k) => k.jlpt === null) });
  else {
    groups.push({ id: 'secondary', kanji: list.filter((k) => k.grade === 8) });
    groups.push({ id: 'other', kanji: list.filter((k) => k.grade === null || k.grade > 8) });
  }
  return groups.filter((group) => group.kanji.length > 0);
}
