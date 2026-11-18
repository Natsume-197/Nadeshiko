import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kanjidic2Character } from '@scriptin/jmdict-simplified-types';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import {
  importKanjidic,
  importKanjiVg,
  importKradfile,
  kanjiRow,
  kanjiVgCharacter,
  realComponents,
  strokePaths,
} from '@app/services/dictionary/import/importKanji';

setupTestSuite();

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nadeshiko-kanji-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A KANJIDIC2 character as jmdict-simplified writes it, with only the fields the importer reads filled in. */
function character(
  literal: string,
  readings: Array<[string, string]>,
  meanings: Array<[string, string]>,
  misc: Partial<Kanjidic2Character['misc']> = {},
): Kanjidic2Character {
  return {
    literal,
    codepoints: [],
    radicals: [],
    misc: { grade: null, strokeCounts: [5], variants: [], frequency: null, radicalNames: [], jlptLevel: null, ...misc },
    dictionaryReferences: [],
    queryCodes: [],
    readingMeaning: {
      groups: [
        {
          readings: readings.map(([type, value]) => ({ type, onType: null, status: null, value })),
          meanings: meanings.map(([lang, value]) => ({ lang, value })),
        },
      ],
      nanori: [],
    },
  } as unknown as Kanjidic2Character;
}

const HON = character(
  '本',
  [
    ['pinyin', 'ben3'],
    ['ja_on', 'ホン'],
    ['ja_kun', 'もと'],
  ],
  [
    ['en', 'book'],
    ['en', 'origin'],
    ['fr', 'livre'],
    ['es', 'libro'],
  ],
  { grade: 1, strokeCounts: [5, 4], frequency: 10 },
);

describe('kanjiRow', () => {
  it('keeps the Japanese readings and the English and Spanish meanings', () => {
    expect(kanjiRow(HON)).toEqual({
      character: '本',
      stroke_count: 5,
      grade: 1,
      frequency: 10,
      on_readings: ['ホン'],
      kun_readings: ['もと'],
      meanings_en: ['book', 'origin'],
      meanings_es: ['libro'],
    });
  });

  it('drops a character with nothing for a reader of Japanese', () => {
    expect(kanjiRow(character('丂', [['pinyin', 'kao3']], [['fr', 'souffle']]))).toBeNull();
  });
});

describe('strokePaths', () => {
  it('reads one path per stroke, in the order KanjiVG numbers them', () => {
    const svg = `<svg><g id="kvg:StrokePaths_04e00">
      <path id="kvg:04e00-s2" kvg:type="㇐" d="M2,2"/>
      <path id="kvg:04e00-s1" kvg:type="㇐" d="M1,1"/>
    </g><g id="kvg:StrokeNumbers_04e00"><text>1</text></g></svg>`;

    expect(strokePaths(svg)).toEqual(['M1,1', 'M2,2']);
  });
});

describe('realComponents', () => {
  it('replaces the kanji KRADFILE writes for radicals it has no character for', () => {
    // 適 is listed as 口 込 十 并 立 亠 冂 滴.
    expect(realComponents(['口', '込', '十', '并', '立', '亠', '冂', '滴'])).toEqual([
      '口',
      '⻌',
      '十',
      '丷',
      '立',
      '亠',
      '冂',
      '啇',
    ]);
  });
});

describe('kanjiVgCharacter', () => {
  it('names the kanji of a main file and skips variants and non-kanji', () => {
    expect(kanjiVgCharacter('0672c.svg')).toBe('本');
    expect(kanjiVgCharacter('0672c-Kaisho.svg')).toBeNull();
    expect(kanjiVgCharacter('03042.svg')).toBeNull(); // あ
  });
});

describe('importing', () => {
  it('replaces dict.kanji from KANJIDIC2 and records the version', async () => {
    const path = join(dir, 'kanjidic2.json');
    writeFileSync(path, JSON.stringify({ version: '3.6.2', dictDate: '2026-11-16', characters: [HON] }), 'utf8');

    const report = await importKanjidic(TestDataSource, path, { versionLabel: '3.6.2+20261116' });

    expect(report).toEqual({ source: 'kanjidic2', version: '3.6.2+20261116', rows: 1, dryRun: false });
    expect(await TestDataSource.query(`SELECT character, stroke_count, meanings_es FROM dict.kanji`)).toEqual([
      { character: '本', stroke_count: 5, meanings_es: ['libro'] },
    ]);
    expect(await TestDataSource.query(`SELECT version FROM dict.source WHERE name = 'kanjidic2'`)).toEqual([
      { version: '3.6.2+20261116' },
    ]);
  });

  it('writes nothing on a dry run', async () => {
    const path = join(dir, 'kanjidic2-dry.json');
    writeFileSync(path, JSON.stringify({ version: '3.6.2', dictDate: null, characters: [HON] }), 'utf8');

    const report = await importKanjidic(TestDataSource, path, { dryRun: true });

    expect(report.rows).toBe(1);
    expect(await TestDataSource.query(`SELECT count(*)::int AS n FROM dict.kanji`)).toEqual([{ n: 0 }]);
  });

  it('replaces dict.kanji_component from KRADFILE', async () => {
    const path = join(dir, 'kradfile.json');
    writeFileSync(path, JSON.stringify({ version: '3.6.2', kanji: { 本: ['一', '木'] } }), 'utf8');

    await importKradfile(TestDataSource, path);

    expect(await TestDataSource.query(`SELECT character, components FROM dict.kanji_component`)).toEqual([
      { character: '本', components: ['一', '木'] },
    ]);
  });

  it('replaces dict.kanji_strokes from a KanjiVG folder', async () => {
    const folder = join(dir, 'kanji');
    mkdirSync(folder);
    writeFileSync(join(folder, '04e00.svg'), '<path id="kvg:04e00-s1" d="M11,54"/>', 'utf8');
    writeFileSync(join(folder, '04e00-Kaisho.svg'), '<path id="kvg:04e00-Kaisho-s1" d="M0,0"/>', 'utf8');

    const report = await importKanjiVg(TestDataSource, folder, 'r20260714');

    expect(report.rows).toBe(1);
    expect(await TestDataSource.query(`SELECT character, paths FROM dict.kanji_strokes`)).toEqual([
      { character: '一', paths: ['M11,54'] },
    ]);
    expect(await TestDataSource.query(`SELECT version FROM dict.source WHERE name = 'kanjivg'`)).toEqual([
      { version: 'r20260714' },
    ]);
  });
});
