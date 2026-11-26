import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { logger } from '@config/log';
import { toHiragana } from '@app/services/parser/combine/kana';
import { decodeGlossary, inflateBlock, parseGlossaryJson } from './glossaryCodec';
import type { NormalizedGlossaryItem } from './structuredContent';

/**
 * Bounded read-only LRU pool of per-artifact SQLite handles.
 *
 * Content-addressed artifacts (`<sha256>.sqlite`) are write-once and immutable once renamed into place, so concurrent
 * read-only handles across requests (and across overlapping containers during Kamal rolling deploys) need no write
 * locks. A lookup is a few indexed reads plus decoding the rows it keeps; fast once the file's pages are in memory.
 *
 * Reads every artifact format: version 1 stored the glossary as JSON text (`glossary_json`), version 2 as a tagged,
 * usually deflated BLOB per row (`glossary`), version 3 in deflated blocks (`glossary_block`, see `glossaryCodec.ts`).
 * Version 4 added the `kanji` and `kanji_meta` tables; older files have none, and their kanji lookups find nothing.
 */

type GlossaryFormat = 'json' | 'blob' | 'block';

/** Inflated glossary blocks of version 3 files, shared by all handles, least recently used out first. */
const BLOCK_CACHE_BYTES = 32 * 1024 * 1024;
const blockCache = new Map<string, Buffer>();
let blockCacheBytes = 0;

function cachedBlock(filePath: string, id: number, read: () => Uint8Array | undefined): Buffer | null {
  const key = `${filePath}#${id}`;
  const hit = blockCache.get(key);
  if (hit) {
    blockCache.delete(key);
    blockCache.set(key, hit);
    return hit;
  }
  const data = read();
  if (!data) return null;
  const block = inflateBlock(data);
  blockCache.set(key, block);
  blockCacheBytes += block.length;
  while (blockCacheBytes > BLOCK_CACHE_BYTES) {
    const oldest = blockCache.keys().next().value;
    if (oldest === undefined) break;
    blockCacheBytes -= blockCache.get(oldest)?.length ?? 0;
    blockCache.delete(oldest);
  }
  return block;
}

function dropCachedBlocks(filePath: string): void {
  const prefix = `${filePath}#`;
  for (const [key, block] of blockCache) {
    if (!key.startsWith(prefix)) continue;
    blockCacheBytes -= block.length;
    blockCache.delete(key);
  }
}

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

export interface CustomKanjiRow {
  character: string;
  onyomi: string[];
  kunyomi: string[];
  tags: string;
  meanings: string[];
  stats: Record<string, string>;
}

interface PooledHandle {
  db: DatabaseSync;
  filePath: string;
  glossaryFormat: GlossaryFormat;
  /** Version 3 only: one glossary block by id. */
  blockById: StatementSync | null;
  byExpr: StatementSync;
  byExprHira: StatementSync;
  metaByExpr: StatementSync;
  metaByExprHira: StatementSync;
  /** Version 4 and later: null for older files, which have no kanji tables. */
  kanjiByChar: StatementSync | null;
  kanjiMetaByChar: StatementSync | null;
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
      if (oldest) closeQuietly(oldest.db);
    }
  }

  pool.set(filePath, handle);
  return handle;
}

function isCorruptFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /not a database|malformed|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(message);
}

/** Closes a handle that may already be unusable; a failure to close changes nothing for the caller. */
function closeQuietly(db: DatabaseSync): void {
  try {
    db.close();
  } catch {
    // already closed or unusable
  }
}

function prepareHandle(filePath: string): PooledHandle {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    return buildHandle(db, filePath);
  } catch (error) {
    closeQuietly(db);
    throw error;
  }
}

/** Map the file instead of copying its pages into SQLite's own cache: the page cache already holds them. */
const MMAP_BYTES = 256 * 1024 * 1024;

function buildHandle(db: DatabaseSync, filePath: string): PooledHandle {
  db.exec(`PRAGMA mmap_size = ${MMAP_BYTES}`);
  const columns = new Set(
    (db.prepare('PRAGMA table_info(terms)').all() as Array<{ name: string }>).map((column) => column.name),
  );
  const glossaryFormat: GlossaryFormat = columns.has('block') ? 'block' : columns.has('glossary') ? 'blob' : 'json';
  const glossary =
    glossaryFormat === 'block'
      ? 'block, block_offset, block_length'
      : glossaryFormat === 'blob'
        ? 'glossary'
        : 'glossary_json AS glossary';
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
  const hasKanjiTables =
    (
      db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'kanji'").get() as {
        n: number;
      }
    ).n > 0;

  return {
    db,
    filePath,
    glossaryFormat,
    blockById: glossaryFormat === 'block' ? db.prepare('SELECT data FROM glossary_block WHERE id = ?') : null,
    byExpr: db.prepare(`
      SELECT expression, reading, definition_tags, rules, score, ${glossary}, sequence, term_tags
      FROM terms
      WHERE expression = ?
      ORDER BY score DESC, id ASC
      LIMIT 30
    `),
    byExprHira: db.prepare(`
      SELECT expression, reading, definition_tags, rules, score, ${glossary}, sequence, term_tags
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
    kanjiByChar: hasKanjiTables
      ? db.prepare(`
          SELECT character, onyomi, kunyomi, tags, meanings_json, stats_json
          FROM kanji
          WHERE character = ?
          ORDER BY id ASC
          LIMIT 5
        `)
      : null,
    kanjiMetaByChar: hasKanjiTables
      ? db.prepare('SELECT data_json FROM kanji_meta WHERE character = ? AND mode = ? ORDER BY id ASC LIMIT 5')
      : null,
    tags,
  };
}

export function closeArtifactHandle(filePath: string): void {
  dropCachedBlocks(filePath);
  const existing = pool.get(filePath);
  if (!existing) return;
  pool.delete(filePath);
  closeQuietly(existing.db);
}

export async function removeArtifactFile(baseDir: string, sha256: string): Promise<void> {
  const filePath = artifactSqlitePath(baseDir, sha256);
  closeArtifactHandle(filePath);
  await unlink(filePath).catch(() => {});
}

export function closeAllArtifactHandles(): void {
  for (const [, handle] of pool) closeQuietly(handle.db);
  pool.clear();
  blockCache.clear();
  blockCacheBytes = 0;
}

interface RawTermRow {
  expression: string;
  reading: string;
  definition_tags: string;
  rules: string;
  score: number;
  /** Versions 1 and 2. */
  glossary?: string | Uint8Array;
  /** Version 3. */
  block?: number;
  block_offset?: number;
  block_length?: number;
  sequence: number;
  term_tags: string;
}

/**
 * Decodes rows until they hold `maxSenses` glossary items: the card shows a handful of senses, and decoding a
 * structured-content article costs more than reading it, so the rest of the 30 rows are left alone.
 */
function rowGlossary(handle: PooledHandle, row: RawTermRow): NormalizedGlossaryItem[] {
  if (handle.glossaryFormat === 'block') {
    const { blockById } = handle;
    if (!blockById || row.block === undefined || row.block_offset === undefined || row.block_length === undefined) {
      return [];
    }
    const block = cachedBlock(handle.filePath, row.block, () => {
      const found = blockById.get(row.block as number) as { data: Uint8Array } | undefined;
      return found?.data;
    });
    if (!block) return [];
    return parseGlossaryJson(block.subarray(row.block_offset, row.block_offset + row.block_length));
  }
  if (handle.glossaryFormat === 'blob' && row.glossary !== undefined && typeof row.glossary !== 'string') {
    return decodeGlossary(row.glossary);
  }
  return JSON.parse(String(row.glossary)) as NormalizedGlossaryItem[];
}

function hydrateTermRows(handle: PooledHandle, rows: RawTermRow[], maxSenses: number): CustomTermRow[] {
  const out: CustomTermRow[] = [];
  let senses = 0;
  for (const row of rows) {
    if (senses >= maxSenses) break;
    try {
      const glossary = rowGlossary(handle, row);
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
  const kept = readingHira ? raw.filter((row) => !row.reading || toHiragana(row.reading) === readingHira) : raw;
  return { rows: hydrateTermRows(handle, kept, maxSenses), tags: handle.tags };
}

interface RawMetaRow {
  expression: string;
  reading: string;
  reading_hira: string;
  data_json: string;
}

/** Meta rows for `readingHira`, or with no reading; all of them when the lookup has no reading. No fallback to other
 * readings, as in `queryArtifactTerms`. */
function matchingReading(rows: RawMetaRow[], readingHira: string | null): RawMetaRow[] {
  if (!readingHira) return rows;
  return rows.filter((row) => !row.reading_hira || row.reading_hira === readingHira);
}

/** One artifact's `mode` meta rows for `expression` (falling back to its hiragana form), kept to `readingHira`. */
function metaRows(
  filePath: string,
  expression: string,
  expressionHira: string,
  readingHira: string | null,
  mode: 'freq' | 'pitch',
): RawMetaRow[] {
  const handle = openHandle(filePath);
  if (!handle) return [];

  let raw = handle.metaByExpr.all(expression, mode) as unknown as RawMetaRow[];
  if (raw.length === 0 && expressionHira && expressionHira !== expression) {
    raw = handle.metaByExprHira.all(expressionHira, mode) as unknown as RawMetaRow[];
  }
  return matchingReading(raw, readingHira);
}

export function queryArtifactFrequencies(
  filePath: string,
  expression: string,
  expressionHira: string,
  readingHira: string | null,
): CustomFrequencyRow[] {
  const out: CustomFrequencyRow[] = [];
  for (const row of metaRows(filePath, expression, expressionHira, readingHira, 'freq')) {
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
  const out: CustomPitchRow[] = [];
  for (const row of metaRows(filePath, expression, expressionHira, readingHira, 'pitch')) {
    try {
      const pitches = JSON.parse(row.data_json) as CustomPitchRow['pitches'];
      if (Array.isArray(pitches) && pitches.length > 0) {
        out.push({ expression: row.expression, reading: row.reading, pitches });
      }
    } catch {}
  }
  return out;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** One artifact's `kanji_bank` rows for `character`, and its tag definitions (for tags and stat names). */
export function queryArtifactKanji(
  filePath: string,
  character: string,
): { rows: CustomKanjiRow[]; tags: Map<string, CustomTagMeta> } {
  const handle = openHandle(filePath);
  if (!handle?.kanjiByChar) return { rows: [], tags: new Map() };
  const raw = handle.kanjiByChar.all(character) as Array<{
    character: string;
    onyomi: string;
    kunyomi: string;
    tags: string;
    meanings_json: string;
    stats_json: string;
  }>;
  const rows = raw.map((row) => ({
    character: row.character,
    onyomi: row.onyomi ? row.onyomi.split(' ') : [],
    kunyomi: row.kunyomi ? row.kunyomi.split(' ') : [],
    tags: row.tags,
    meanings: parseJson<string[]>(row.meanings_json, []),
    stats: parseJson<Record<string, string>>(row.stats_json, {}),
  }));
  return { rows, tags: handle.tags };
}

/** One artifact's `kanji_meta_bank` frequencies for `character`. */
export function queryArtifactKanjiFrequencies(
  filePath: string,
  character: string,
): Array<{ value: number | null; displayValue: string }> {
  const handle = openHandle(filePath);
  if (!handle?.kanjiMetaByChar) return [];
  const out: Array<{ value: number | null; displayValue: string }> = [];
  for (const row of handle.kanjiMetaByChar.all(character, 'freq') as Array<{ data_json: string }>) {
    const parsed = parseJson<{ value?: number | null; displayValue?: string } | null>(row.data_json, null);
    if (parsed?.displayValue) out.push({ value: parsed.value ?? null, displayValue: parsed.displayValue });
  }
  return out;
}
