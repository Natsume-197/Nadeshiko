import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { logger } from '@config/log';
import { decodeGlossary } from './glossaryCodec';
import type { NormalizedGlossaryItem } from './structuredContent';

/**
 * Bounded read-only LRU pool of per-artifact SQLite handles.
 *
 * Content-addressed artifacts (`<sha256>.sqlite`) are write-once and immutable once renamed into place, so concurrent
 * read-only handles across requests (and across overlapping containers during Kamal rolling deploys) need no write
 * locks. A lookup is a few indexed reads plus decoding the rows it keeps; fast once the file's pages are in memory.
 *
 * Reads both artifact formats: importer version 1 stored the glossary as JSON text (`glossary_json`), version 2 as a
 * tagged, usually deflated BLOB (`glossary`, see `glossaryCodec.ts`).
 */

export interface CustomTermRow {
  expression: string;
  reading: string;
  definitionTags: string;
  rules: string;
  score: number;
  glossary: NormalizedGlossaryItem[];
  sequence: number;
  termTags: string;
}

export interface CustomTagMeta {
  name: string;
  category: string;
  notes: string;
}

export interface CustomFrequencyRow {
  expression: string;
  reading: string;
  value: number | null;
  displayValue: string;
}

export interface CustomPitchRow {
  expression: string;
  reading: string;
  pitches: Array<{
    position: number;
    nasal?: number[];
    devoice?: number[];
    tags?: string[];
  }>;
}

interface PooledHandle {
  db: DatabaseSync;
  /** Version 2 files store `glossary` as a BLOB; version 1 files `glossary_json` as text. */
  glossaryBlob: boolean;
  byExpr: StatementSync;
  byExprHira: StatementSync;
  metaByExpr: StatementSync;
  metaByExprHira: StatementSync;
  tags: Map<string, CustomTagMeta>;
}

const MAX_OPEN_HANDLES = 64;
const pool = new Map<string, PooledHandle>();

export function artifactSqlitePath(baseDir: string, sha256: string): string {
  return join(baseDir, `${sha256}.sqlite`);
}

function openHandle(filePath: string): PooledHandle | null {
  const existing = pool.get(filePath);
  if (existing) {
    // Refresh LRU order.
    pool.delete(filePath);
    pool.set(filePath, existing);
    return existing;
  }

  if (!existsSync(filePath)) return null;

  let handle: PooledHandle;
  try {
    handle = prepareHandle(filePath);
  } catch (error) {
    // One unreadable file must cost its own dictionary, not the whole word card. A corrupt cached copy is removed so
    // the next lookup fetches it again from R2.
    logger.warn({ err: error, filePath }, 'Could not open a custom dictionary file; skipping it');
    if (isCorruptFileError(error)) void unlink(filePath).catch(() => {});
    return null;
  }

  if (pool.size >= MAX_OPEN_HANDLES) {
    const oldestKey = pool.keys().next().value;
    if (oldestKey) {
      const oldest = pool.get(oldestKey);
      pool.delete(oldestKey);
      try {
        oldest?.db.close();
      } catch {
        // ignore close error on eviction
      }
    }
  }

  pool.set(filePath, handle);
  return handle;
}

function isCorruptFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /not a database|malformed|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(message);
}

function prepareHandle(filePath: string): PooledHandle {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    return buildHandle(db);
  } catch (error) {
    try {
      db.close();
    } catch {
      // already unusable
    }
    throw error;
  }
}

/** Map the file instead of copying its pages into SQLite's own cache: the page cache already holds them. */
const MMAP_BYTES = 256 * 1024 * 1024;

function buildHandle(db: DatabaseSync): PooledHandle {
  db.exec(`PRAGMA mmap_size = ${MMAP_BYTES}`);
  const columns = db.prepare('PRAGMA table_info(terms)').all() as Array<{ name: string }>;
  const glossaryBlob = columns.some((column) => column.name === 'glossary');
  const glossary = glossaryBlob ? 'glossary' : 'glossary_json';
  const tags = new Map<string, CustomTagMeta>();
  try {
    const tagRows = db.prepare('SELECT name, category, notes FROM tag_meta').all() as Array<{
      name: string;
      category: string;
      notes: string;
    }>;
    for (const row of tagRows) {
      tags.set(row.name, { name: row.name, category: row.category, notes: row.notes });
    }
  } catch {
    // Older/minimal DBs without tag_meta still work cleanly.
  }

  return {
    db,
    glossaryBlob,
    byExpr: db.prepare(`
      SELECT expression, reading, definition_tags, rules, score, ${glossary} AS glossary, sequence, term_tags
      FROM terms
      WHERE expression = ?
      ORDER BY score DESC, id ASC
      LIMIT 30
    `),
    byExprHira: db.prepare(`
      SELECT expression, reading, definition_tags, rules, score, ${glossary} AS glossary, sequence, term_tags
      FROM terms
      WHERE expression_hira = ?
      ORDER BY score DESC, id ASC
      LIMIT 30
    `),
    metaByExpr: db.prepare(`
      SELECT expression, reading, reading_hira, data_json
      FROM term_meta
      WHERE expression = ? AND mode = ?
      ORDER BY id ASC
      LIMIT 30
    `),
    metaByExprHira: db.prepare(`
      SELECT expression, reading, reading_hira, data_json
      FROM term_meta
      WHERE expression_hira = ? AND mode = ?
      ORDER BY id ASC
      LIMIT 30
    `),
    tags,
  };
}

export function closeArtifactHandle(filePath: string): void {
  const existing = pool.get(filePath);
  if (!existing) return;
  pool.delete(filePath);
  try {
    existing.db.close();
  } catch {
    // ignore
  }
}

export async function removeArtifactFile(baseDir: string, sha256: string): Promise<void> {
  const filePath = artifactSqlitePath(baseDir, sha256);
  closeArtifactHandle(filePath);
  await unlink(filePath).catch(() => {});
}

export function closeAllArtifactHandles(): void {
  for (const [, handle] of pool) {
    try {
      handle.db.close();
    } catch {
      // ignore
    }
  }
  pool.clear();
}

interface RawTermRow {
  expression: string;
  reading: string;
  definition_tags: string;
  rules: string;
  score: number;
  glossary: string | Uint8Array;
  sequence: number;
  term_tags: string;
}

/**
 * Decodes rows until they hold `maxSenses` glossary items: the card shows a handful of senses, and decoding a
 * structured-content article costs more than reading it, so the rest of the 30 rows are left alone.
 */
function hydrateTermRows(rows: RawTermRow[], glossaryBlob: boolean, maxSenses: number): CustomTermRow[] {
  const out: CustomTermRow[] = [];
  let senses = 0;
  for (const row of rows) {
    if (senses >= maxSenses) break;
    try {
      const glossary =
        glossaryBlob && typeof row.glossary !== 'string'
          ? decodeGlossary(row.glossary)
          : (JSON.parse(String(row.glossary)) as NormalizedGlossaryItem[]);
      if (!Array.isArray(glossary) || glossary.length === 0) continue;
      senses += glossary.length;
      out.push({
        expression: row.expression,
        reading: row.reading,
        definitionTags: row.definition_tags,
        rules: row.rules,
        score: row.score,
        glossary,
        sequence: row.sequence,
        termTags: row.term_tags,
      });
    } catch {}
  }
  return out;
}

/**
 * Looks up terms in one artifact SQLite file matching `expression` and, when given, `readingHira`.
 *
 * With a reading, only rows with that reading or none (monolingual kana headwords often leave `reading` empty) are
 * kept. There is no fallback to the spelling's other readings: for a homograph that is another word, and 生(なま)
 * must not show 生(せい)'s definitions. The meta lookups below follow the same rule.
 */
export function queryArtifactTerms(
  filePath: string,
  expression: string,
  expressionHira: string,
  readingHira: string | null,
  maxSenses = Number.POSITIVE_INFINITY,
): { rows: CustomTermRow[]; tags: Map<string, CustomTagMeta> } {
  const handle = openHandle(filePath);
  if (!handle) return { rows: [], tags: new Map() };

  let raw = handle.byExpr.all(expression) as unknown as RawTermRow[];
  if (raw.length === 0 && expressionHira && expressionHira !== expression) {
    raw = handle.byExprHira.all(expressionHira) as unknown as RawTermRow[];
  }
  if (raw.length === 0) return { rows: [], tags: handle.tags };

  // The reading filter runs on the raw rows, before anything is decoded.
  const kept = readingHira ? raw.filter((row) => !row.reading || toHira(row.reading) === readingHira) : raw;
  return { rows: hydrateTermRows(kept, handle.glossaryBlob, maxSenses), tags: handle.tags };
}

interface RawMetaRow {
  expression: string;
  reading: string;
  reading_hira: string;
  data_json: string;
}

function toHira(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
  }
  return out;
}

/** Meta rows for `readingHira`, or with no reading; all of them when the lookup has no reading. No fallback to other
 * readings, as in `queryArtifactTerms`. */
function matchingReading(rows: RawMetaRow[], readingHira: string | null): RawMetaRow[] {
  if (!readingHira) return rows;
  return rows.filter((row) => !row.reading_hira || row.reading_hira === readingHira);
}

export function queryArtifactFrequencies(
  filePath: string,
  expression: string,
  expressionHira: string,
  readingHira: string | null,
): CustomFrequencyRow[] {
  const handle = openHandle(filePath);
  if (!handle) return [];

  let raw = handle.metaByExpr.all(expression, 'freq') as unknown as RawMetaRow[];
  if (raw.length === 0 && expressionHira && expressionHira !== expression) {
    raw = handle.metaByExprHira.all(expressionHira, 'freq') as unknown as RawMetaRow[];
  }
  if (raw.length === 0) return [];

  const chosen = matchingReading(raw, readingHira);

  const out: CustomFrequencyRow[] = [];
  for (const row of chosen) {
    try {
      const parsed = JSON.parse(row.data_json) as { value: number | null; displayValue: string };
      if (parsed?.displayValue) {
        out.push({
          expression: row.expression,
          reading: row.reading,
          value: parsed.value ?? null,
          displayValue: parsed.displayValue,
        });
      }
    } catch {}
  }
  return out;
}

export function queryArtifactPitches(
  filePath: string,
  expression: string,
  expressionHira: string,
  readingHira: string | null,
): CustomPitchRow[] {
  const handle = openHandle(filePath);
  if (!handle) return [];

  let raw = handle.metaByExpr.all(expression, 'pitch') as unknown as RawMetaRow[];
  if (raw.length === 0 && expressionHira && expressionHira !== expression) {
    raw = handle.metaByExprHira.all(expressionHira, 'pitch') as unknown as RawMetaRow[];
  }
  if (raw.length === 0) return [];

  const chosen = matchingReading(raw, readingHira);

  const out: CustomPitchRow[] = [];
  for (const row of chosen) {
    try {
      const pitches = JSON.parse(row.data_json) as CustomPitchRow['pitches'];
      if (Array.isArray(pitches) && pitches.length > 0) {
        out.push({ expression: row.expression, reading: row.reading, pitches });
      }
    } catch {}
  }
  return out;
}
