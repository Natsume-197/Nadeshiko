import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Kanjidic2, Kanjidic2Character, Kradfile } from '@scriptin/jmdict-simplified-types';
import type { DataSource } from 'typeorm';

/**
 * The kanji card's data (task 44), one importer per upstream source. Each replaces its own table in one transaction
 * and records its version in `dict.source`, like the JLPT and pitch importers:
 * - KANJIDIC2 (`kanjidic2-all-*.json`) into `dict.kanji`;
 * - KRADFILE (`kradfile-*.json`) into `dict.kanji_component`;
 * - KanjiVG (the `kanji/` folder of `kanjivg-*-main.zip`) into `dict.kanji_strokes`.
 */

export interface KanjiRow {
  character: string;
  stroke_count: number;
  grade: number | null;
  frequency: number | null;
  on_readings: string[];
  kun_readings: string[];
  meanings_en: string[];
  meanings_es: string[];
}

export interface KanjiImportReport {
  source: 'kanjidic2' | 'kradfile' | 'kanjivg';
  version: string;
  rows: number;
  dryRun: boolean;
}

/** One KANJIDIC2 character as the card needs it, or null for one with no Japanese reading and no meaning (a character
 * listed only for its Chinese or Korean readings has nothing to show a reader of Japanese). */
export function kanjiRow(character: Kanjidic2Character): KanjiRow | null {
  const onReadings: string[] = [];
  const kunReadings: string[] = [];
  const meanings: Record<'en' | 'es', string[]> = { en: [], es: [] };
  for (const group of character.readingMeaning?.groups ?? []) {
    for (const reading of group.readings) {
      if (reading.type === 'ja_on') onReadings.push(reading.value);
      else if (reading.type === 'ja_kun') kunReadings.push(reading.value);
    }
    for (const meaning of group.meanings) {
      if (meaning.lang === 'en' || meaning.lang === 'es') meanings[meaning.lang].push(meaning.value);
    }
  }
  if (onReadings.length === 0 && kunReadings.length === 0 && meanings.en.length === 0) return null;

  return {
    character: character.literal,
    // The first count is the accepted one; the rest are common miscounts.
    stroke_count: character.misc.strokeCounts[0] ?? 0,
    grade: character.misc.grade ?? null,
    frequency: character.misc.frequency ?? null,
    on_readings: onReadings,
    kun_readings: kunReadings,
    meanings_en: meanings.en,
    meanings_es: meanings.es,
  };
}

/** The stroke paths of one KanjiVG file, in writing order. KanjiVG numbers every stroke `kvg:<code>-s<n>`; the order of
 * the elements already is the writing order, and the number is checked so a file that breaks that is caught. */
export function strokePaths(svg: string): string[] {
  const strokes: Array<{ n: number; d: string }> = [];
  for (const match of svg.matchAll(/<path\b[^>]*\bid="kvg:[0-9a-f]+-s(\d+)"[^>]*\bd="([^"]+)"/g)) {
    strokes.push({ n: Number(match[1]), d: match[2] ?? '' });
  }
  strokes.sort((a, b) => a.n - b.n);
  return strokes.map((stroke) => stroke.d);
}

/** KanjiVG's main files are named by code point (`0672c.svg`); variants (`0672c-Kaisho.svg`) are skipped. */
export function kanjiVgCharacter(fileName: string): string | null {
  const match = /^([0-9a-f]{5})\.svg$/.exec(fileName);
  if (!match?.[1]) return null;
  const character = String.fromCodePoint(Number.parseInt(match[1], 16));
  // Only CJK ideographs; KanjiVG also draws kana, Latin letters and punctuation.
  return /\p{Script=Han}/u.test(character) ? character : null;
}

async function replaceTable(
  dataSource: DataSource,
  table: 'kanji' | 'kanji_component' | 'kanji_strokes',
  insert: string,
  payload: unknown[],
  source: KanjiImportReport['source'],
  version: string,
  dictDate: string | null,
  dryRun: boolean,
): Promise<number> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`DELETE FROM dict.${table}`);
    const [{ rows } = { rows: 0 }]: Array<{ rows: number }> = await runner.query(
      `WITH inserted AS (${insert} RETURNING 1) SELECT count(*)::int AS rows FROM inserted`,
      [JSON.stringify(payload)],
    );
    await runner.query(
      `INSERT INTO dict.source (name, version, dict_date, imported_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (name) DO UPDATE SET version = EXCLUDED.version, dict_date = EXCLUDED.dict_date, imported_at = now()`,
      [source, version, dictDate],
    );
    if (dryRun) await runner.rollbackTransaction();
    else await runner.commitTransaction();
    return rows;
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
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
    `INSERT INTO dict.kanji (character, stroke_count, grade, frequency, on_readings, kun_readings, meanings_en, meanings_es)
     SELECT x.character, x.stroke_count, x.grade, x.frequency, x.on_readings, x.kun_readings, x.meanings_en, x.meanings_es
       FROM jsonb_to_recordset($1::jsonb) AS x(character text, stroke_count smallint, grade smallint, frequency smallint,
            on_readings text[], kun_readings text[], meanings_en text[], meanings_es text[])`,
    rows,
    'kanjidic2',
    version,
    file.dictDate ?? null,
    dryRun,
  );
  return { source: 'kanjidic2', version, rows: inserted, dryRun };
}

/** Replace `dict.kanji_component` from a KRADFILE file. */
export async function importKradfile(
  dataSource: DataSource,
  path: string,
  options: { dryRun?: boolean; versionLabel?: string } = {},
): Promise<KanjiImportReport> {
  const file = JSON.parse(await readFile(path, 'utf8')) as Kradfile;
  const rows = Object.entries(file.kanji).map(([character, components]) => ({ character, components }));
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
  const rows: Array<{ character: string; paths: string[] }> = [];
  for (const name of (await readdir(folder)).sort()) {
    const character = kanjiVgCharacter(name);
    if (!character) continue;
    const paths = strokePaths(await readFile(join(folder, name), 'utf8'));
    if (paths.length > 0) rows.push({ character, paths });
  }
  const dryRun = options.dryRun ?? false;
  const inserted = await replaceTable(
    dataSource,
    'kanji_strokes',
    `INSERT INTO dict.kanji_strokes (character, paths)
     SELECT x.character, x.paths FROM jsonb_to_recordset($1::jsonb) AS x(character text, paths text[])`,
    rows,
    'kanjivg',
    version,
    null,
    dryRun,
  );
  return { source: 'kanjivg', version, rows: inserted, dryRun };
}
