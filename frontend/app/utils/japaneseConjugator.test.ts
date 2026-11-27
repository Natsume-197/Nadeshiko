import { describe, expect, test } from 'vitest';
import { buildConjugationTable } from './japaneseConjugator';
import type { DictionaryWord } from './wordCard';

function makeWord(headword: string, posCodes: string[], reading = ''): DictionaryWord {
  return {
    id: `jmdict:${headword}`,
    headword,
    reading,
    entries: [
      {
        dictionary: 'jmdict',
        dictionaryName: 'JMdict',
        senses: [
          {
            position: 0,
            definitions: [{ lang: 'en', text: 'test' }],
            tags: posCodes.map((code) => ({ category: 'partOfSpeech', code, label: code })),
          },
        ],
      },
    ],
  } as DictionaryWord;
}

describe('buildConjugationTable', () => {
  test('returns null for non-conjugable nouns and pronouns', () => {
    expect(buildConjugationTable(makeWord('彼女', ['pn', 'n']))).toBeNull();
    expect(buildConjugationTable(makeWord('武勇伝', ['n']))).toBeNull();
  });

  test('conjugates suru nouns like 卒業 with stem and ending split', () => {
    const table = buildConjugationTable(makeWord('卒業', ['n', 'vs', 'vi'], 'ソツギョウ'));
    expect(table?.classKey).toBe('suru');
    const basics = table?.groups[0]?.rows;
    expect(basics?.[0]?.plainAff).toEqual({ stem: '卒業', ending: 'する', full: '卒業する' });
    expect(basics?.[0]?.plainNeg).toEqual({ stem: '卒業', ending: 'しない', full: '卒業しない' });
    expect(basics?.[0]?.politeAff).toEqual({ stem: '卒業', ending: 'します', full: '卒業します' });
    expect(basics?.[1]?.plainAff).toEqual({ stem: '卒業', ending: 'した', full: '卒業した' });
    expect(basics?.[2]?.plainAff).toEqual({ stem: '卒業', ending: 'して', full: '卒業して' });
  });

  test('conjugates ichidan verbs like 食べる', () => {
    const table = buildConjugationTable(makeWord('食べる', ['v1']));
    expect(table?.classKey).toBe('ichidan');
    const basics = table?.groups[0]?.rows;
    expect(basics?.[0]?.plainNeg?.full).toBe('食べない');
    expect(basics?.[1]?.plainAff?.full).toBe('食べた');
    expect(basics?.[2]?.plainAff?.full).toBe('食べて');
    expect(table?.groups[2]?.rows[0]?.plainAff?.full).toBe('食べられる');
  });

  test('conjugates godan verbs including irregular 行く (v5k-s)', () => {
    const iku = buildConjugationTable(makeWord('行く', ['v5k-s']));
    expect(iku?.classKey).toBe('godan');
    expect(iku?.groups[0]?.rows[1]?.plainAff?.full).toBe('行った');
    expect(iku?.groups[0]?.rows[2]?.plainAff?.full).toBe('行って');
    expect(iku?.groups[0]?.rows[0]?.plainNeg?.full).toBe('行かない');

    const nomu = buildConjugationTable(makeWord('飲む', ['v5m']));
    expect(nomu?.groups[0]?.rows[1]?.plainAff?.full).toBe('飲んだ');
    expect(nomu?.groups[0]?.rows[2]?.plainAff?.full).toBe('飲んで');
    expect(nomu?.groups[2]?.rows[0]?.plainAff?.full).toBe('飲める');
  });

  test('conjugates i-adjectives (including いい) and na-adjectives', () => {
    const takai = buildConjugationTable(makeWord('高い', ['adj-i']));
    expect(takai?.classKey).toBe('iAdjective');
    expect(takai?.groups[0]?.rows[0]?.plainNeg?.full).toBe('高くない');
    expect(takai?.groups[0]?.rows[1]?.plainAff?.full).toBe('高かった');

    const ii = buildConjugationTable(makeWord('いい', ['adj-ix']));
    expect(ii?.groups[0]?.rows[0]?.plainAff?.full).toBe('いい');
    expect(ii?.groups[0]?.rows[1]?.plainAff?.full).toBe('よかった');

    const shizuka = buildConjugationTable(makeWord('静か', ['adj-na']));
    expect(shizuka?.classKey).toBe('naAdjective');
    expect(shizuka?.groups[0]?.rows[0]?.plainAff?.full).toBe('静かだ');
    expect(shizuka?.groups[0]?.rows[0]?.politeAff?.full).toBe('静かです');
  });

  test('handles irregular ある (v5r-i), くれる (v1-s), 来る/くる (vk), and 愛する (vs-s)', () => {
    const aru = buildConjugationTable(makeWord('ある', ['v5r-i']));
    expect(aru?.groups[0]?.rows[0]?.plainNeg?.full).toBe('ない');
    expect(aru?.groups[0]?.rows[1]?.plainNeg?.full).toBe('なかった');
    expect(aru?.groups[3]?.rows[0]?.plainNeg?.full).toBe('なければ');
    expect(aru?.groups[3]?.rows[1]?.plainNeg?.full).toBe('なかったら');

    const kureru = buildConjugationTable(makeWord('くれる', ['v1-s']));
    expect(kureru?.groups[1]?.rows[1]?.plainAff?.full).toBe('くれ');

    const kuru = buildConjugationTable(makeWord('くる', ['vk']));
    expect(kuru?.groups[0]?.rows[0]?.plainNeg?.full).toBe('こない');
    expect(kuru?.groups[0]?.rows[0]?.politeAff?.full).toBe('きます');
    expect(kuru?.groups[1]?.rows[1]?.plainAff?.full).toBe('こい');

    const aisuru = buildConjugationTable(makeWord('愛する', ['vs-s']));
    expect(aisuru?.groups[0]?.rows[0]?.plainNeg?.full).toBe('愛さない');
    expect(aisuru?.groups[0]?.rows[0]?.politeAff?.full).toBe('愛します');
    expect(aisuru?.groups[2]?.rows[0]?.plainAff?.full).toBe('愛せる');
  });
});
