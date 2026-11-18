import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kanjidic2Character } from '@scriptin/jmdict-simplified-types';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import {
  csvFields,
  importKanjidic,
  importKanjiJlpt,
  importKanjiVg,
  importKradfile,
  importRadicals,
  kanjiJlptLevels,
  kanjiRow,
  radicalRows,
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
    radicals: [
      { type: 'classical', value: 75 },
      { type: 'nelson_c', value: 2 },
    ],
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
      radical: 75,
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
  it('reads one path per stroke and where its number goes, in the order KanjiVG numbers them', () => {
    const svg = `<svg><g id="kvg:StrokePaths_04e8c">
      <path id="kvg:04e8c-s2" kvg:type="㇐" d="M2,2"/>
      <path id="kvg:04e8c-s1" kvg:type="㇐" d="M1,1"/>
    </g><g id="kvg:StrokeNumbers_04e8c" style="font-size:8;fill:#808080">
      <text transform="matrix(1 0 0 1 20.50 70.25)">2</text>
      <text transform="matrix(1 0 0 1 13.50 34.50)">1</text>
    </g></svg>`;

    expect(strokePaths(svg)).toEqual({
      paths: ['M1,1', 'M2,2'],
      numbers: [
        [13.5, 34.5],
        [20.5, 70.25],
      ],
    });
  });

  it('keeps no numbers when they do not match the strokes', () => {
    const svg = `<path id="kvg:04e00-s1" d="M1,1"/>`;

    expect(strokePaths(svg)).toEqual({ paths: ['M1,1'], numbers: [] });
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

describe('radicals', () => {
  const CSV = [
    'Stroke#,Radical,Meaning,Reading,Reading-R,Position-J,Position-R,Importance,Origin,Variant-of,Variant-of-Reading',
    '1,⼀,"one, horizontal stroke",いち,ichi,,,,Kangxi,,',
    '1,,diagonal sweeping stroke,のかんむり,nokanmuri,かんむり,kanmuri,,,⼃,の',
    '9,⾷,"food, to eat",しょく,shoku,,,,Kangxi,,',
    '8,⻟,"food, to eat",しょくへん,shokuhen,へん,hen,,,⾷,しょく',
  ].join('\n');

  it('splits quoted fields', () => {
    expect(csvFields('1,⼀,"one, horizontal stroke",いち')).toEqual(['1', '⼀', 'one, horizontal stroke', 'いち']);
  });

  it('numbers each Kangxi radical and gives a variant its radical number; a variant with no glyph is skipped', () => {
    expect(radicalRows(CSV)).toEqual([
      { glyph: '⼀', number: 1, variant_of: null, reading: 'いち', meaning: 'one, horizontal stroke' },
      { glyph: '⾷', number: 184, variant_of: null, reading: 'しょく', meaning: 'food, to eat' },
      { glyph: '⻟', number: 184, variant_of: '⾷', reading: 'しょくへん', meaning: 'food, to eat' },
    ]);
  });

  it('replaces dict.radical', async () => {
    const path = join(dir, 'japanese-radicals.csv');
    writeFileSync(path, CSV, 'utf8');

    expect((await importRadicals(TestDataSource, path, 'e1e24d3')).rows).toBe(3);
    expect(
      await TestDataSource.query(
        `SELECT glyph, variant_of FROM dict.radical WHERE number = 184 ORDER BY variant_of NULLS FIRST`,
      ),
    ).toEqual([
      { glyph: '⾷', variant_of: null },
      { glyph: '⻟', variant_of: '⾷' },
    ]);
  });
});

describe('kanji JLPT levels', () => {
  it('reads only the current level, and only where there is one', () => {
    expect(
      kanjiJlptLevels({
        食: { jlpt_new: 5, wk_level: 3 } as never,
        飢: { jlpt_new: 1 },
        丂: { jlpt_new: null },
      }),
    ).toEqual([
      { character: '食', level: 5 },
      { character: '飢', level: 1 },
    ]);
  });

  it('replaces dict.kanji_jlpt', async () => {
    const path = join(dir, 'kanji.json');
    writeFileSync(path, JSON.stringify({ 食: { jlpt_new: 5 } }), 'utf8');

    await importKanjiJlpt(TestDataSource, path, '00fd707');

    expect(await TestDataSource.query(`SELECT character, level FROM dict.kanji_jlpt`)).toEqual([
      { character: '食', level: 5 },
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
    writeFileSync(
      join(folder, '04e00.svg'),
      '<path id="kvg:04e00-s1" d="M11,54"/><text transform="matrix(1 0 0 1 5.00 50.00)">1</text>',
      'utf8',
    );
    writeFileSync(join(folder, '04e00-Kaisho.svg'), '<path id="kvg:04e00-Kaisho-s1" d="M0,0"/>', 'utf8');

    const report = await importKanjiVg(TestDataSource, folder, 'r20260714');

    expect(report.rows).toBe(1);
    expect(await TestDataSource.query(`SELECT character, paths, numbers FROM dict.kanji_strokes`)).toEqual([
      { character: '一', paths: ['M11,54'], numbers: [[5, 50]] },
    ]);
    expect(await TestDataSource.query(`SELECT version FROM dict.source WHERE name = 'kanjivg'`)).toEqual([
      { version: 'r20260714' },
    ]);
  });
});
