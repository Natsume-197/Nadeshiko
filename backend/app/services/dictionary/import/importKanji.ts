import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Kanjidic2, Kanjidic2Character, Kradfile } from '@scriptin/jmdict-simplified-types';
import type { DataSource } from 'typeorm';
import { inTransaction, recordSource } from './db';
import { hasKanji } from './entries';

/**
 * The kanji card's data (task 44), one importer per upstream source. Each replaces its own table in one transaction
 * and records its version in `dict.source`, like the JLPT and pitch importers:
 * - KANJIDIC2 (`kanjidic2-all-*.json`) into `dict.kanji`;
 * - KRADFILE (`kradfile-*.json`) into `dict.kanji_component`;
 * - KanjiVG (the `kanji/` folder of `kanjivg-*-main.zip`) into `dict.kanji_strokes`;
 * - Waller's JLPT kanji lists (`kanji.json` of davidluzgouveia/kanji-data, field `jlpt_new`) into `dict.kanji_jlpt`;
 * - Kanji alive's radicals (`language-data/japanese-radicals.csv`) into `dict.radical`;
 * - mimneko/kanji-data's Kanji Kentei levels (`漢検漢字辞典漢字.csv`) into `dict.kanji_kanken`.
 */

export interface KanjiRow {
  character: string;
  stroke_count: number;
  grade: number | null;
  frequency: number | null;
  radical: number | null;
  on_readings: string[];
  kun_readings: string[];
  meanings_en: string[];
  meanings_es: string[];
}

export interface KanjiImportReport {
  source: 'kanjidic2' | 'kradfile' | 'kanjivg' | 'kanji-jlpt' | 'radicals' | 'kanken';
  version: string;
  rows: number;
  dryRun: boolean;
}

/** One KANJIDIC2 character as the card needs it, or null for one with no Japanese reading and no meaning (a character
 * listed only for its Chinese or Korean readings has nothing to show a reader of Japanese). */
export function kanjiRow(character: Kanjidic2Character): KanjiRow | null {
  const onReadings: string[] = [];
  const kunReadings: string[] = [];
  const meaningsEn: string[] = [];
  for (const group of character.readingMeaning?.groups ?? []) {
    for (const reading of group.readings) {
      if (reading.type === 'ja_on') onReadings.push(reading.value);
      else if (reading.type === 'ja_kun') kunReadings.push(reading.value);
    }
    for (const meaning of group.meanings) {
      if (meaning.lang === 'en') meaningsEn.push(meaning.value);
    }
  }
  if (onReadings.length === 0 && kunReadings.length === 0 && meaningsEn.length === 0) return null;

  return {
    character: character.literal,
    // The first count is the accepted one; the rest are common miscounts.
    stroke_count: character.misc.strokeCounts[0] ?? 0,
    grade: character.misc.grade ?? null,
    frequency: character.misc.frequency ?? null,
    radical: character.radicals?.find((radical) => radical.type === 'classical')?.value ?? null,
    on_readings: onReadings,
    kun_readings: kunReadings,
    meanings_en: meaningsEn,
    meanings_es: [],
  };
}

/** The stroke paths of one KanjiVG file, in writing order, and where KanjiVG places each stroke's number (`[x, y]` in
 * its 109×109 view box; empty when the file has none). The stroke ids carry the order, which is checked rather than
 * trusted from element order. */
export function strokePaths(svg: string): { paths: string[]; numbers: Array<[number, number]> } {
  const strokes: Array<{ n: number; d: string }> = [];
  for (const match of svg.matchAll(/<path\b[^>]*\bid="kvg:[0-9a-f]+-s(\d+)"[^>]*\bd="([^"]+)"/g)) {
    strokes.push({ n: Number(match[1]), d: match[2] ?? '' });
  }
  strokes.sort((a, b) => a.n - b.n);

  const numbers: Array<{ n: number; x: number; y: number }> = [];
  for (const match of svg.matchAll(/<text transform="matrix\(1 0 0 1 ([\d.]+) ([\d.]+)\)">(\d+)<\/text>/g)) {
    numbers.push({ n: Number(match[3]), x: Number(match[1]), y: Number(match[2]) });
  }
  numbers.sort((a, b) => a.n - b.n);

  return {
    paths: strokes.map((stroke) => stroke.d),
    // Only a complete set: a number per stroke, or none.
    numbers: numbers.length === strokes.length ? numbers.map(({ x, y }) => [x, y]) : [],
  };
}

/** KanjiVG's main files are named by code point (`0672c.svg`); variants (`0672c-Kaisho.svg`) are skipped. */
export function kanjiVgCharacter(fileName: string): string | null {
  const match = /^([0-9a-f]{5})\.svg$/.exec(fileName);
  if (!match?.[1]) return null;
  const character = String.fromCodePoint(Number.parseInt(match[1], 16));
  // Only CJK ideographs; KanjiVG also draws kana, Latin letters and punctuation.
  return hasKanji(character) ? character : null;
}

async function replaceTable(
  dataSource: DataSource,
  table: 'kanji' | 'kanji_component' | 'kanji_strokes' | 'kanji_jlpt' | 'radical' | 'kanji_kanken',
  insert: string,
  payload: unknown[],
  source: KanjiImportReport['source'],
  version: string,
  dictDate: string | null,
  dryRun: boolean,
): Promise<number> {
  return inTransaction(dataSource, dryRun, async (runner) => {
    await runner.query(`DELETE FROM dict.${table}`);
    const [{ rows } = { rows: 0 }]: Array<{ rows: number }> = await runner.query(
      `WITH inserted AS (${insert} RETURNING 1) SELECT count(*)::int AS rows FROM inserted`,
      [JSON.stringify(payload)],
    );
    await recordSource(runner, source, version, { dictDate });
    return rows;
  });
}

/** Replace `dict.kanji` from a KANJIDIC2 file. `versionLabel` overrides the file's own version (the refresh stores
 * the release tag, so it can tell a new release from the one it has). */
export async function importKanjidic(
  dataSource: DataSource,
  path: string,
  options: { dryRun?: boolean; versionLabel?: string } = {},
): Promise<KanjiImportReport> {
  const file = JSON.parse(await readFile(path, 'utf8')) as Kanjidic2;
  const rows = file.characters.map(kanjiRow).filter((row): row is KanjiRow => row !== null);
  const version = options.versionLabel ?? file.version;
  const dryRun = options.dryRun ?? false;
  const inserted = await replaceTable(
    dataSource,
    'kanji',
    `INSERT INTO dict.kanji (character, stroke_count, grade, frequency, radical, on_readings, kun_readings, meanings_en,
                             meanings_es)
     SELECT x.character, x.stroke_count, x.grade, x.frequency, x.radical, x.on_readings, x.kun_readings, x.meanings_en,
            x.meanings_es
       FROM jsonb_to_recordset($1::jsonb) AS x(character text, stroke_count smallint, grade smallint, frequency smallint,
            radical smallint, on_readings text[], kun_readings text[], meanings_en text[], meanings_es text[])`,
    rows,
    'kanjidic2',
    version,
    file.dictDate ?? null,
    dryRun,
  );
  return { source: 'kanjidic2', version, rows: inserted, dryRun };
}

/**
 * KRADFILE writes a radical that JIS X 0208 has no character for as a kanji that contains it: 込 stands for ⻌ in
 * 運, 化 for 亻 in 伊, 滴 for 啇 in 適. Shown as is, the card would list 込 as a part of 運. Each is replaced by the
 * radical it stands for. Checked against the data (2026-11-17): every one appears in kanji that do not contain it.
 */
export const KRADFILE_SUBSTITUTES: Readonly<Record<string, string>> = {
  化: '亻',
  个: '𠆢',
  并: '丷',
  刈: '刂',
  込: '⻌',
  尚: '⺌',
  忙: '忄',
  扎: '扌',
  汁: '氵',
  犯: '犭',
  艾: '艹',
  邦: '⻏',
  阡: '⻖',
  老: '耂',
  杰: '灬',
  礼: '礻',
  疔: '疒',
  禹: '禸',
  初: '衤',
  買: '罒',
  滴: '啇',
  乞: '𠂉',
};

/** A KRADFILE component list with every substitute replaced by its radical, without duplicates. */
export function realComponents(components: string[]): string[] {
  return [...new Set(components.map((part) => KRADFILE_SUBSTITUTES[part] ?? part))];
}

/** Replace `dict.kanji_component` from a KRADFILE file. */
export async function importKradfile(
  dataSource: DataSource,
  path: string,
  options: { dryRun?: boolean; versionLabel?: string } = {},
): Promise<KanjiImportReport> {
  const file = JSON.parse(await readFile(path, 'utf8')) as Kradfile;
  const rows = Object.entries(file.kanji).map(([character, components]) => ({
    character,
    components: realComponents(components),
  }));
  const version = options.versionLabel ?? file.version;
  const dryRun = options.dryRun ?? false;
  const inserted = await replaceTable(
    dataSource,
    'kanji_component',
    `INSERT INTO dict.kanji_component (character, components)
     SELECT x.character, x.components FROM jsonb_to_recordset($1::jsonb) AS x(character text, components text[])`,
    rows,
    'kradfile',
    version,
    null,
    dryRun,
  );
  return { source: 'kradfile', version, rows: inserted, dryRun };
}

/** Replace `dict.kanji_strokes` from KanjiVG's extracted `kanji/` folder. KanjiVG has no version inside its files, so
 * the release tag (e.g. `r20260714`) is passed in. */
export async function importKanjiVg(
  dataSource: DataSource,
  folder: string,
  version: string,
  options: { dryRun?: boolean } = {},
): Promise<KanjiImportReport> {
  const rows: Array<{ character: string; paths: string[]; numbers: Array<[number, number]> }> = [];
  for (const name of (await readdir(folder)).sort()) {
    const character = kanjiVgCharacter(name);
    if (!character) continue;
    const { paths, numbers } = strokePaths(await readFile(join(folder, name), 'utf8'));
    if (paths.length > 0) rows.push({ character, paths, numbers });
  }
  const dryRun = options.dryRun ?? false;
  const inserted = await replaceTable(
    dataSource,
    'kanji_strokes',
    `INSERT INTO dict.kanji_strokes (character, paths, numbers)
     SELECT x.character, x.paths, x.numbers
       FROM jsonb_to_recordset($1::jsonb) AS x(character text, paths text[], numbers jsonb)`,
    rows,
    'kanjivg',
    version,
    null,
    dryRun,
  );
  return { source: 'kanjivg', version, rows: inserted, dryRun };
}

/** The current (N5-N1) JLPT level of each kanji in davidluzgouveia/kanji-data's `kanji.json`, whose `jlpt_new` comes
 * from Jonathan Waller's lists. Nothing else in that file is read: its WaniKani fields are not ours to use. */
export function kanjiJlptLevels(file: Record<string, { jlpt_new?: number | null }>): Array<{
  character: string;
  level: number;
}> {
  return Object.entries(file)
    .filter(([, entry]) => typeof entry.jlpt_new === 'number' && entry.jlpt_new >= 1 && entry.jlpt_new <= 5)
    .map(([character, entry]) => ({ character, level: entry.jlpt_new as number }));
}

/** Replace `dict.kanji_jlpt`. The file has no version, so the commit it came from is passed in. */
export async function importKanjiJlpt(
  dataSource: DataSource,
  path: string,
  version: string,
  options: { dryRun?: boolean } = {},
): Promise<KanjiImportReport> {
  const rows = kanjiJlptLevels(JSON.parse(await readFile(path, 'utf8')));
  const dryRun = options.dryRun ?? false;
  const inserted = await replaceTable(
    dataSource,
    'kanji_jlpt',
    `INSERT INTO dict.kanji_jlpt (character, level)
     SELECT x.character, x.level FROM jsonb_to_recordset($1::jsonb) AS x(character text, level smallint)`,
    rows,
    'kanji-jlpt',
    version,
    null,
    dryRun,
  );
  return { source: 'kanji-jlpt', version, rows: inserted, dryRun };
}

/** A CSV line split into fields, honouring double quotes ("one, horizontal stroke"). */
export function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (quoted) {
      if (character === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      fields.push(field);
      field = '';
    } else field += character;
  }
  fields.push(field);
  return fields;
}

export interface RadicalRow {
  glyph: string;
  number: number;
  variant_of: string | null;
  reading: string;
  meaning: string;
}

/** The first Kangxi radical, ⼀; the 214 follow it in order, so a radical's number is its distance from here plus one. */
const KANGXI_FIRST = 0x2f00;

/** Kanji alive's `japanese-radicals.csv` as rows: the 214 Kangxi radicals (Origin `Kangxi`) and their variant shapes
 * (Variant-of names the Kangxi radical), each with its Japanese name and English meaning. A variant with no glyph of its
 * own (の as a crown) is skipped; a glyph listed twice keeps its first row. */
export function radicalRows(csv: string): RadicalRow[] {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const header = csvFields(lines[0] ?? '');
  const column = (name: string) => header.indexOf(name);
  const [glyphAt, meaningAt, readingAt, originAt, variantAt] = [
    column('Radical'),
    column('Meaning'),
    column('Reading'),
    column('Origin'),
    column('Variant-of'),
  ];
  const kangxiNumber = (glyph: string) => (glyph.codePointAt(0) ?? 0) - KANGXI_FIRST + 1;

  const rows = new Map<string, RadicalRow>();
  for (const line of lines.slice(1)) {
    const fields = csvFields(line);
    const glyph = fields[glyphAt]?.trim() ?? '';
    if (!glyph || rows.has(glyph)) continue;
    const kangxi = fields[originAt] === 'Kangxi';
    const parent = fields[variantAt]?.trim() || null;
    const number = kangxi ? kangxiNumber(glyph) : parent ? kangxiNumber(parent) : 0;
    if (number < 1 || number > 214) continue;
    rows.set(glyph, {
      glyph,
      number,
      variant_of: kangxi ? null : parent,
      reading: fields[readingAt]?.trim() ?? '',
      meaning: fields[meaningAt]?.trim() ?? '',
    });
  }
  return [...rows.values()];
}

/** Replace `dict.radical`. The file has no version, so the Kanji alive commit it came from is passed in. */
export async function importRadicals(
  dataSource: DataSource,
  path: string,
  version: string,
  options: { dryRun?: boolean } = {},
): Promise<KanjiImportReport> {
  const rows = radicalRows(await readFile(path, 'utf8'));
  const dryRun = options.dryRun ?? false;
  const inserted = await replaceTable(
    dataSource,
    'radical',
    `INSERT INTO dict.radical (glyph, number, variant_of, reading, meaning)
     SELECT x.glyph, x.number, x.variant_of, x.reading, x.meaning
       FROM jsonb_to_recordset($1::jsonb) AS x(glyph text, number smallint, variant_of text, reading text, meaning text)`,
    rows,
    'radicals',
    version,
    null,
    dryRun,
  );
  return { source: 'radicals', version, rows: inserted, dryRun };
}

/** Kanji Kentei levels, easiest first. */
export const KANKEN_LEVELS = [
  '10級',
  '9級',
  '8級',
  '7級',
  '6級',
  '5級',
  '4級',
  '3級',
  '準2級',
  '2級',
  '準1級',
  '1級',
] as const;

/**
 * The Kanji Kentei (漢検) level of each kanji in mimneko/kanji-data's `漢検漢字辞典漢字.csv`, after the official
 * 漢検漢字辞典: a row per character form (the current form and old ones), whose `漢字テキスト` may be empty where the
 * form exists only as an image. `1/準1級` (an old form tested at both top levels) counts as 準1級, `配当外` (not
 * tested) is left out, and a character listed twice keeps its easiest level.
 */
export function kankenLevels(csv: string): Array<{ character: string; level: string }> {
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const header = csvFields(lines[0] ?? '');
  const textAt = header.indexOf('漢字テキスト');
  const levelAt = header.indexOf('漢検級');
  if (textAt === -1 || levelAt === -1) throw new Error('漢検漢字辞典漢字.csv: missing 漢字テキスト or 漢検級 column');

  const easiest = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const fields = csvFields(line);
    const character = fields[textAt]?.trim() ?? '';
    const raw = fields[levelAt]?.trim() ?? '';
    const level = raw === '1/準1級' ? '準1級' : raw;
    const rank = (KANKEN_LEVELS as readonly string[]).indexOf(level);
    if ([...character].length !== 1 || rank === -1) continue;
    const known = easiest.get(character);
    if (known === undefined || rank < known) easiest.set(character, rank);
  }
  return [...easiest].map(([character, rank]) => ({ character, level: KANKEN_LEVELS[rank] as string }));
}

/** Replace `dict.kanji_kanken`. The file has no version, so the commit it came from is passed in. */
export async function importKanken(
  dataSource: DataSource,
  path: string,
  version: string,
  options: { dryRun?: boolean } = {},
): Promise<KanjiImportReport> {
  const rows = kankenLevels(await readFile(path, 'utf8'));
  const dryRun = options.dryRun ?? false;
  const inserted = await replaceTable(
    dataSource,
    'kanji_kanken',
    `INSERT INTO dict.kanji_kanken (character, level)
     SELECT x.character, x.level FROM jsonb_to_recordset($1::jsonb) AS x(character text, level text)`,
    rows,
    'kanken',
    version,
    null,
    dryRun,
  );
  return { source: 'kanken', version, rows: inserted, dryRun };
}
