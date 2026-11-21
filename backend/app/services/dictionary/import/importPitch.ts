import { open, readFile } from 'node:fs/promises';
import type { DataSource } from 'typeorm';
import { inTransaction, insertChunks, recordSource } from './db';
import { toHiragana } from './entries';

/**
 * Pitch accent from UniDic (cwj, the MeCab package NINJAL publishes). That package ships only the compiled
 * `sys.dic`, but MeCab keeps every entry's features as plain CSV text at the end of it: the header gives the sizes
 * of the double array and token table, and what follows them is one NUL-terminated CSV line per entry.
 *
 * Feature columns used (0-based, UniDic 2023+ layout of 29 fields): 0 POS, 5 conjugation form, 6 lexeme reading
 * (katakana), 8 spelling, 20 the spelling's own reading (katakana), 24 accent type (`0` flat, `n` drop after mora n, `"1,0"` when two are accepted).
 */

const HEADER_BYTES = 72;
/** MeCab stores the file size xor'd with this as its magic number. */
const MECAB_MAGIC_KEY = 0xef718f77;
const CHUNK_BYTES = 16 * 1024 * 1024;
const BATCH = 5_000;

const NOT_WORDS = new Set(['補助記号', '記号', '空白']);

/** Split one MeCab feature line: CSV whose fields may be double-quoted when they contain commas. */
export function splitFeature(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(current);
      current = '';
    } else current += char;
  }
  fields.push(current);
  return fields;
}

/** The (spelling, hiragana reading, downsteps) a feature line contributes, or null when it carries no usable
 * accent: symbols, conjugated forms other than the dictionary form, and entries with no accent type. */
export function pitchOf(
  fields: string[],
): { text: string; reading: string; downsteps: number[]; proper: boolean } | null {
  if (fields.length < 29) return null;
  const pos = fields[0] ?? '';
  const form = fields[5] ?? '';
  // The spelling's own reading, not the lexeme's: いい is a spelling of the lexeme 良い (ヨイ) but reads イイ, and the
  // card asks for いい read いい. The lexeme reading only when the other is missing.
  const own = fields[20] ?? '';
  const reading = own && own !== '*' ? own : (fields[6] ?? '');
  const text = fields[8] ?? '';
  const accent = fields[24] ?? '';
  if (NOT_WORDS.has(pos) || !text || !reading || reading === '*') return null;
  if (form !== '*' && !form.startsWith('終止形')) return null;
  const downsteps = accent
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value))
    .map(Number);
  if (downsteps.length === 0) return null;
  return { text, reading: toHiragana(reading), downsteps, proper: fields[1] === '固有名詞' };
}

/** Every feature line of a MeCab `sys.dic`, read in chunks so the 245 MB feature table is never one string. */
export async function* readFeatures(path: string): AsyncGenerator<string> {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    await file.read(header, 0, HEADER_BYTES, 0);
    const { size } = await file.stat();
    if ((header.readUInt32LE(0) ^ MECAB_MAGIC_KEY) >>> 0 !== size) {
      throw new Error(`${path} is not a MeCab dictionary`);
    }
    const doubleArray = header.readUInt32LE(24);
    const tokens = header.readUInt32LE(28);
    const featureBytes = header.readUInt32LE(32);
    const charset = header.subarray(40, 72).toString('ascii').replace(/\0.*$/s, '');
    if (!/utf-?8/i.test(charset)) throw new Error(`${path} is ${charset}, not UTF-8`);

    let position = HEADER_BYTES + doubleArray + tokens;
    const end = position + featureBytes;
    let carry = Buffer.alloc(0);
    while (position < end) {
      const length = Math.min(CHUNK_BYTES, end - position);
      const chunk = Buffer.alloc(length);
      await file.read(chunk, 0, length, position);
      position += length;
      const buffer = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      let start = 0;
      for (let i = buffer.indexOf(0, start); i !== -1; i = buffer.indexOf(0, start)) {
        if (i > start) yield buffer.toString('utf8', start, i);
        start = i + 1;
      }
      carry = buffer.subarray(start);
    }
    if (carry.length > 0) yield carry.toString('utf8');
  } finally {
    await file.close();
  }
}

export interface PitchReport {
  version: string;
  lines: number;
  pairs: number;
  dryRun: boolean;
}

type PitchRow = { text: string; reading: string; downsteps: number[] };

/** Add `found` under `key`, or add its downsteps the known row lacks, in the order they come. */
function mergeInto(map: Map<string, PitchRow>, key: string, found: PitchRow): void {
  const known = map.get(key);
  if (!known) map.set(key, found);
  else for (const step of found.downsteps) if (!known.downsteps.includes(step)) known.downsteps.push(step);
}

/** Replace one source's rows of `dict.pitch` and record its version, in one transaction (rolled back for a dry run). */
async function writePitch(
  dataSource: DataSource,
  source: 'unidic' | 'kanjium',
  sourceName: 'unidic-pitch' | 'kanjium-pitch',
  version: string,
  rows: PitchRow[],
  dryRun: boolean,
): Promise<void> {
  await inTransaction(dataSource, dryRun, async (runner) => {
    await runner.query(`DELETE FROM dict.pitch WHERE source = $1`, [source]);
    await insertChunks(
      runner,
      `INSERT INTO dict.pitch (text, reading, downsteps, source)
       SELECT text, reading, downsteps, $2 FROM jsonb_to_recordset($1::jsonb)
         AS x(text varchar, reading varchar, downsteps smallint[])`,
      rows,
      BATCH,
      source,
    );
    await recordSource(runner, sourceName, version);
  });
}

/** Replace UniDic's rows of `dict.pitch` from a UniDic `sys.dic`, in one transaction. Accents several UniDic entries give the same
 * (spelling, reading) are merged, in the order UniDic lists them; a proper noun's only counts when no ordinary
 * entry has that spelling and reading (橋 the word is はし², 橋 the surname はし¹). */
export async function importPitch(
  dataSource: DataSource,
  path: string,
  version: string,
  options: { dryRun?: boolean } = {},
): Promise<PitchReport> {
  const ordinary = new Map<string, PitchRow>();
  const proper = new Map<string, PitchRow>();
  let lines = 0;
  for await (const line of readFeatures(path)) {
    lines += 1;
    const found = pitchOf(splitFeature(line));
    if (!found) continue;
    const { text, reading, downsteps } = found;
    mergeInto(found.proper ? proper : ordinary, `${text}\u0000${reading}`, {
      text,
      reading,
      downsteps: [...downsteps],
    });
  }
  const pitch = new Map(ordinary);
  for (const [key, row] of proper) if (!pitch.has(key)) pitch.set(key, row);

  const report: PitchReport = { version, lines, pairs: pitch.size, dryRun: options.dryRun ?? false };
  await writePitch(dataSource, 'unidic', 'unidic-pitch', version, [...pitch.values()], report.dryRun);
  return report;
}

/**
 * One line of Kanjium's `data/source_files/raw/accents.txt`: spelling, hiragana reading (empty when the spelling is
 * the reading: ああ), and accents separated by commas, some labelled by part of speech (`(副)0,(名)3`). The labels are
 * dropped; accents keep their order, without repeats. Null for a line with no usable accent.
 */
export function kanjiumPitchOf(line: string): { text: string; reading: string; downsteps: number[] } | null {
  const [text = '', reading = '', accents = ''] = line.replace(/\r$/, '').split('\t');
  if (!text.trim()) return null;
  const downsteps: number[] = [];
  for (const match of accents.matchAll(/\d+/g)) {
    const step = Number(match[0]);
    if (!downsteps.includes(step)) downsteps.push(step);
  }
  if (downsteps.length === 0) return null;
  return { text: text.trim(), reading: toHiragana((reading.trim() || text).trim()), downsteps };
}

/**
 * Replace Kanjium's rows of `dict.pitch` from its accents.txt (Uros O.'s database, CC BY-SA 4.0), in one
 * transaction. The card reads UniDic first, so Kanjium only fills what UniDic lacks, mostly compounds.
 */
export async function importKanjiumPitch(
  dataSource: DataSource,
  path: string,
  version: string,
  options: { dryRun?: boolean } = {},
): Promise<PitchReport> {
  const pitch = new Map<string, PitchRow>();
  let lines = 0;
  for (const line of (await readFile(path, 'utf8')).replace(/^\uFEFF/, '').split('\n')) {
    if (!line.trim()) continue;
    lines += 1;
    const found = kanjiumPitchOf(line);
    if (!found) continue;
    mergeInto(pitch, `${found.text}\u0000${found.reading}`, found);
  }

  const report: PitchReport = { version, lines, pairs: pitch.size, dryRun: options.dryRun ?? false };
  await writePitch(dataSource, 'kanjium', 'kanjium-pitch', version, [...pitch.values()], report.dryRun);
  return report;
}
