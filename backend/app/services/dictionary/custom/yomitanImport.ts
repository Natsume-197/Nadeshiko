import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { toHiragana } from '../import/entries';
import { normalizeGlossary } from './structuredContent';
import { ZipReader } from './zipReader';

/**
 * Parses a Yomitan v3 `.zip` archive into a standalone read-only-optimized SQLite database.
 *
 * Streams one JSON bank file at a time (skipping images and unsupported banks) inside batched transactions so large
 * monolingual dictionaries (50–95 MB compressed, ~200k terms) stay well under the staging container's memory budget.
 */

export interface YomitanIndex {
  title: string;
  revision: string;
  format: number;
  author: string | null;
  description: string | null;
  url: string | null;
  frequencyMode: string | null;
}

export interface YomitanImportResult {
  index: YomitanIndex;
  hasTerms: boolean;
  hasFrequency: boolean;
  hasPitch: boolean;
  termCount: number;
  frequencyCount: number;
  pitchCount: number;
  sqliteBytes: number;
}

export class YomitanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YomitanValidationError';
  }
}

/**
 * Version of what an import writes into the SQLite file (schema, normalization, `structured-content` sanitizing). Bump
 * it whenever any of that changes: artifacts are shared by SHA-256 and never rebuilt on their own, so an upload of an
 * artifact built by an older version re-indexes it instead of reusing it (`service.ts`).
 */
export const IMPORTER_VERSION = 1;

const MAX_INDEX_BYTES = 1 * 1024 * 1024; // 1 MB
// 32 MB per JSON bank file: parsing one has to fit in the import thread's heap (`IMPORT_THREAD_HEAP_MB`). Yomitan's
// builders split banks at a few thousand entries, so real banks are a few MB.
const MAX_BANK_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 600 * 1024 * 1024; // 600 MB total JSON cap (zip-bomb defense)
const MAX_ROWS_PER_ARTIFACT = 1_500_000;

const TERM_BANK_RE = /^(?:.*\/)?term_bank_(\d+)\.json$/;
const TERM_META_BANK_RE = /^(?:.*\/)?term_meta_bank_(\d+)\.json$/;
const TAG_BANK_RE = /^(?:.*\/)?tag_bank_(\d+)\.json$/;

function clampString(val: unknown, maxLen: number): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

export function parseYomitanIndexJson(rawText: string): YomitanIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new YomitanValidationError('index.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new YomitanValidationError('index.json must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const format = typeof obj.format === 'number' ? obj.format : typeof obj.version === 'number' ? obj.version : 0;
  if (format !== 3) {
    throw new YomitanValidationError(
      `Unsupported Yomitan dictionary format (${format || 'missing'}); only format 3 is supported`,
    );
  }
  const title = clampString(obj.title, 200);
  if (!title) {
    throw new YomitanValidationError('index.json is missing a dictionary title');
  }
  const revision = clampString(obj.revision, 120) ?? '1';
  const frequencyMode =
    obj.frequencyMode === 'occurrence-based' || obj.frequencyMode === 'rank-based' ? obj.frequencyMode : null;

  return {
    title,
    revision,
    format,
    author: clampString(obj.author, 200),
    description: clampString(obj.description, 2000),
    url: clampString(obj.url, 500),
    frequencyMode,
  };
}

/**
 * Quickly inspects `index.json` and verifies the archive contains at least one supported bank (`term_bank_*.json` or
 * `term_meta_bank_*.json`) without decompressing any bank files.
 */
export async function inspectYomitanZip(zipPath: string): Promise<YomitanIndex> {
  const reader = await ZipReader.open(zipPath);
  try {
    const entries = reader.listEntries();
    const indexEntry = reader.getEntry('index.json') ?? entries.find((e) => e.name.endsWith('/index.json'));
    if (!indexEntry) {
      throw new YomitanValidationError('Archive is missing index.json');
    }

    const indexText = await reader.readEntryText(indexEntry, MAX_INDEX_BYTES);
    const index = parseYomitanIndexJson(indexText);

    const hasSupportedBank = entries.some((e) => TERM_BANK_RE.test(e.name) || TERM_META_BANK_RE.test(e.name));
    if (!hasSupportedBank) {
      throw new YomitanValidationError(
        'Archive contains no supported Yomitan banks (term_bank_*.json or term_meta_bank_*.json)',
      );
    }

    return index;
  } finally {
    await reader.close();
  }
}

interface ParsedFreqMeta {
  reading: string;
  value: number | null;
  displayValue: string;
}

function parseFrequencyPayload(raw: unknown): ParsedFreqMeta | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { reading: '', value: raw, displayValue: String(raw) };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed.replace(/[^\d.-]/g, ''));
    return { reading: '', value: Number.isFinite(numeric) ? numeric : null, displayValue: trimmed.slice(0, 64) };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.reading === 'string' && obj.frequency !== undefined) {
    const inner = parseFrequencyPayload(obj.frequency);
    if (!inner) return null;
    return { ...inner, reading: obj.reading.trim() };
  }

  const value = typeof obj.value === 'number' && Number.isFinite(obj.value) ? obj.value : null;
  const displayValue =
    typeof obj.displayValue === 'string' && obj.displayValue.trim()
      ? obj.displayValue.trim().slice(0, 64)
      : value !== null
        ? String(value)
        : '';
  if (!displayValue) return null;
  return { reading: '', value, displayValue };
}

interface ParsedPitchEntry {
  position: number;
  nasal?: number[];
  devoice?: number[];
  tags?: string[];
}

interface ParsedPitchMeta {
  reading: string;
  pitches: ParsedPitchEntry[];
}

function toNumberArray(raw: unknown): number[] | undefined {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return [raw];
  if (!Array.isArray(raw)) return undefined;
  const nums = raw.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0);
  return nums.length > 0 ? nums : undefined;
}

function parsePitchPayload(raw: unknown): ParsedPitchMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const reading = typeof obj.reading === 'string' ? obj.reading.trim() : '';
  if (!reading || !Array.isArray(obj.pitches)) return null;

  const pitches: ParsedPitchEntry[] = [];
  for (const p of obj.pitches) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const item = p as Record<string, unknown>;
    const position =
      typeof item.position === 'number' && Number.isInteger(item.position) && item.position >= 0 ? item.position : null;
    if (position === null) continue;
    const nasal = toNumberArray(item.nasal);
    const devoice = toNumberArray(item.devoice);
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 8)
      : undefined;
    pitches.push({
      position,
      ...(nasal ? { nasal } : {}),
      ...(devoice ? { devoice } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    });
  }

  if (pitches.length === 0) return null;
  return { reading, pitches };
}

function bankNumber(name: string, re: RegExp): number {
  const match = re.exec(name);
  return match ? Number(match[1]) : 0;
}

/**
 * Builds a complete SQLite database for a Yomitan `.zip` at `targetSqlitePath` atomically (writing to a temporary file
 * first and renaming only on success).
 */
export async function importYomitanZipToSqlite(
  zipPath: string,
  targetSqlitePath: string,
): Promise<YomitanImportResult> {
  await mkdir(dirname(targetSqlitePath), { recursive: true });
  const tempSqlitePath = join(
    dirname(targetSqlitePath),
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sqlite`,
  );

  const reader = await ZipReader.open(zipPath);
  let db: DatabaseSync | null = null;

  try {
    const entries = reader.listEntries();
    const indexEntry = reader.getEntry('index.json') ?? entries.find((e) => e.name.endsWith('/index.json'));
    if (!indexEntry) {
      throw new YomitanValidationError('Archive is missing index.json');
    }

    const indexText = await reader.readEntryText(indexEntry, MAX_INDEX_BYTES);
    const index = parseYomitanIndexJson(indexText);

    const tagBanks = entries
      .filter((e) => TAG_BANK_RE.test(e.name))
      .sort((a, b) => bankNumber(a.name, TAG_BANK_RE) - bankNumber(b.name, TAG_BANK_RE));
    const termBanks = entries
      .filter((e) => TERM_BANK_RE.test(e.name))
      .sort((a, b) => bankNumber(a.name, TERM_BANK_RE) - bankNumber(b.name, TERM_BANK_RE));
    const metaBanks = entries
      .filter((e) => TERM_META_BANK_RE.test(e.name))
      .sort((a, b) => bankNumber(a.name, TERM_META_BANK_RE) - bankNumber(b.name, TERM_META_BANK_RE));

    if (termBanks.length === 0 && metaBanks.length === 0) {
      throw new YomitanValidationError(
        'Archive contains no supported Yomitan banks (term_bank_*.json or term_meta_bank_*.json)',
      );
    }

    db = new DatabaseSync(tempSqlitePath);
    db.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = MEMORY;

      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE tag_meta (
        name TEXT PRIMARY KEY,
        category TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        score INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expression TEXT NOT NULL,
        reading TEXT NOT NULL,
        expression_hira TEXT NOT NULL,
        reading_hira TEXT NOT NULL,
        definition_tags TEXT NOT NULL DEFAULT '',
        rules TEXT NOT NULL DEFAULT '',
        score INTEGER NOT NULL DEFAULT 0,
        glossary_json TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        term_tags TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE term_meta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expression TEXT NOT NULL,
        expression_hira TEXT NOT NULL,
        mode TEXT NOT NULL,
        reading TEXT NOT NULL DEFAULT '',
        reading_hira TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL
      );
    `);

    const insertMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    insertMeta.run('title', index.title);
    insertMeta.run('revision', index.revision);
    if (index.frequencyMode) insertMeta.run('frequencyMode', index.frequencyMode);

    let totalUncompressed = indexEntry.uncompressedSize;
    let totalRows = 0;

    // 1. Tag banks
    const insertTag = db.prepare(
      'INSERT OR REPLACE INTO tag_meta (name, category, sort_order, notes, score) VALUES (?, ?, ?, ?, ?)',
    );
    for (const entry of tagBanks) {
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new YomitanValidationError('Uncompressed dictionary data exceeds safety limit');
      }
      const rawText = await reader.readEntryText(entry, MAX_BANK_BYTES);
      const rows = JSON.parse(rawText);
      if (!Array.isArray(rows)) continue;

      db.exec('BEGIN');
      try {
        for (const row of rows) {
          if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
          const name = row[0].trim();
          if (!name) continue;
          const category = typeof row[1] === 'string' ? row[1].trim() : '';
          const sortOrder = typeof row[2] === 'number' && Number.isFinite(row[2]) ? Math.trunc(row[2]) : 0;
          const notes = typeof row[3] === 'string' ? row[3].trim().slice(0, 300) : '';
          const score = typeof row[4] === 'number' && Number.isFinite(row[4]) ? Math.trunc(row[4]) : 0;
          insertTag.run(name, category, sortOrder, notes, score);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    // 2. Term banks
    const insertTerm = db.prepare(`
      INSERT INTO terms (
        expression, reading, expression_hira, reading_hira,
        definition_tags, rules, score, glossary_json, sequence, term_tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let termCount = 0;
    for (const entry of termBanks) {
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new YomitanValidationError('Uncompressed dictionary data exceeds safety limit');
      }
      const rawText = await reader.readEntryText(entry, MAX_BANK_BYTES);
      const rows = JSON.parse(rawText);
      if (!Array.isArray(rows)) continue;

      db.exec('BEGIN');
      try {
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 6) continue;
          const expression = typeof row[0] === 'string' ? row[0].trim() : '';
          if (!expression) continue;
          const reading = typeof row[1] === 'string' ? row[1].trim() : '';
          const defTags = typeof row[2] === 'string' ? row[2].trim() : '';
          const rules = typeof row[3] === 'string' ? row[3].trim() : '';
          const score = typeof row[4] === 'number' && Number.isFinite(row[4]) ? Math.trunc(row[4]) : 0;
          const glossary = normalizeGlossary(row[5]);
          if (glossary.length === 0) continue;
          const sequence = typeof row[6] === 'number' && Number.isFinite(row[6]) ? Math.trunc(row[6]) : 0;
          const termTags = typeof row[7] === 'string' ? row[7].trim() : '';

          totalRows += 1;
          if (totalRows > MAX_ROWS_PER_ARTIFACT) {
            throw new YomitanValidationError('Dictionary exceeds maximum supported entry count');
          }

          insertTerm.run(
            expression,
            reading,
            toHiragana(expression),
            toHiragana(reading),
            defTags,
            rules,
            score,
            JSON.stringify(glossary),
            sequence,
            termTags,
          );
          termCount += 1;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    // 3. Term meta banks (frequency & pitch)
    const insertTermMeta = db.prepare(`
      INSERT INTO term_meta (
        expression, expression_hira, mode, reading, reading_hira, data_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    let frequencyCount = 0;
    let pitchCount = 0;
    for (const entry of metaBanks) {
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new YomitanValidationError('Uncompressed dictionary data exceeds safety limit');
      }
      const rawText = await reader.readEntryText(entry, MAX_BANK_BYTES);
      const rows = JSON.parse(rawText);
      if (!Array.isArray(rows)) continue;

      db.exec('BEGIN');
      try {
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 3) continue;
          const expression = typeof row[0] === 'string' ? row[0].trim() : '';
          const mode = typeof row[1] === 'string' ? row[1].trim() : '';
          if (!expression) continue;

          if (mode === 'freq') {
            const parsed = parseFrequencyPayload(row[2]);
            if (!parsed) continue;
            totalRows += 1;
            if (totalRows > MAX_ROWS_PER_ARTIFACT) {
              throw new YomitanValidationError('Dictionary exceeds maximum supported entry count');
            }
            insertTermMeta.run(
              expression,
              toHiragana(expression),
              'freq',
              parsed.reading,
              toHiragana(parsed.reading),
              JSON.stringify({ value: parsed.value, displayValue: parsed.displayValue }),
            );
            frequencyCount += 1;
          } else if (mode === 'pitch') {
            const parsed = parsePitchPayload(row[2]);
            if (!parsed) continue;
            totalRows += 1;
            if (totalRows > MAX_ROWS_PER_ARTIFACT) {
              throw new YomitanValidationError('Dictionary exceeds maximum supported entry count');
            }
            insertTermMeta.run(
              expression,
              toHiragana(expression),
              'pitch',
              parsed.reading,
              toHiragana(parsed.reading),
              JSON.stringify(parsed.pitches),
            );
            pitchCount += 1;
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    if (termCount === 0 && frequencyCount === 0 && pitchCount === 0) {
      throw new YomitanValidationError('No usable term, frequency, or pitch entries were found in the dictionary');
    }

    // Create lookup indexes after bulk inserts for speed and compact B-trees.
    db.exec(`
      CREATE INDEX idx_terms_expr ON terms(expression, reading_hira);
      CREATE INDEX idx_terms_expr_hira ON terms(expression_hira);
      CREATE INDEX idx_term_meta_expr ON term_meta(expression, mode);
      CREATE INDEX idx_term_meta_hira ON term_meta(expression_hira, mode);
      PRAGMA optimize;
    `);

    db.close();
    db = null;

    await rename(tempSqlitePath, targetSqlitePath);
    const info = await stat(targetSqlitePath);

    return {
      index,
      hasTerms: termCount > 0,
      hasFrequency: frequencyCount > 0,
      hasPitch: pitchCount > 0,
      termCount,
      frequencyCount,
      pitchCount,
      sqliteBytes: info.size,
    };
  } catch (error) {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore close failure during rollback
      }
    }
    await unlink(tempSqlitePath).catch(() => {});
    throw error;
  } finally {
    await reader.close();
  }
}
