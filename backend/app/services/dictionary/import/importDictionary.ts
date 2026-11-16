import type { DataSource, QueryRunner } from 'typeorm';
import type { JMdictDictionaryMetadata } from '@scriptin/jmdict-simplified-types';
import { assignFormIndexes, type DictionarySource, type ExistingForm, type ImportEntry, lookupKeys } from './entries';
import type { FuriganaEntry } from './readers';

/** Writes upstream entries into `dict.*`. Each batch is its own transaction, so readers never wait on a whole
 * import; a dry run wraps everything in one transaction and rolls it back, which makes its report exact. */

const BATCH_SIZE = 2_000;
const FURIGANA_BATCH_SIZE = 5_000;

/** Refuse to deactivate words when an upstream file looks truncated: fewer entries than this share of the words
 * already active for that source. */
const MIN_SHARE_TO_DEACTIVATE = 0.9;

export interface ImportReport {
  source: DictionarySource;
  version: string | null;
  entries: number;
  wordsAdded: number;
  wordsReactivated: number;
  wordsDeactivated: number;
  formsAdded: number;
  formsReactivated: number;
  formsDeactivated: number;
  senses: number;
  /** JMnedict entries left alone because JMdict has the same entry (same ent_seq) active. */
  skippedOwnedByJmdict: number;
  /** Set when the deactivation pass was skipped because the file looked short. */
  deactivationSkipped: string | null;
  dryRun: boolean;
}

export interface ImportOptions {
  dryRun?: boolean;
  /** Recorded in `dict.source.version` instead of the file's own version, e.g. the upstream release tag, which
   * changes weekly while the file's version only changes with the format. */
  versionLabel?: string;
  batchSize?: number;
  onProgress?: (report: ImportReport) => void;
}

type Json = Record<string, unknown>;

/** Run `work` on one connection: inside a transaction that commits, or rolls back for a dry run. */
async function inTransaction<T>(
  dataSource: DataSource,
  rollback: boolean,
  work: (runner: QueryRunner) => Promise<T>,
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const result = await work(runner);
    if (rollback) await runner.rollbackTransaction();
    else await runner.commitTransaction();
    return result;
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

async function writeBatch(runner: QueryRunner, batch: ImportEntry[], report: ImportReport): Promise<void> {
  const words: Array<{ id: number; active: boolean; source: DictionarySource }> = await runner.query(
    `SELECT id, active, source FROM dict.word WHERE id = ANY($1::int[])`,
    [batch.map((entry) => entry.id)],
  );
  const known = new Map(words.map((word) => [word.id, word.active]));

  // ~7,300 names are in both files under the same ent_seq; JMdict's copy is the richer one and wins. JMnedict only
  // takes such a word over once JMdict has dropped it.
  const ownedByJmdict = new Set(words.filter((word) => word.source === 'jmdict' && word.active).map((word) => word.id));
  const entries = batch.filter((entry) => !(entry.source === 'jmnedict' && ownedByJmdict.has(entry.id)));
  report.skippedOwnedByJmdict += batch.length - entries.length;
  if (entries.length === 0) return;
  const ids = entries.map((entry) => entry.id);

  const storedForms: Array<ExistingForm & { word_id: number }> = await runner.query(
    `SELECT word_id, idx, text, kana, active FROM dict.form WHERE word_id = ANY($1::int[])`,
    [ids],
  );
  const formsByWord = new Map<number, ExistingForm[]>();
  for (const form of storedForms) {
    const list = formsByWord.get(form.word_id) ?? [];
    list.push(form);
    formsByWord.set(form.word_id, list);
  }

  const wordRows: Json[] = [];
  const formRows: Json[] = [];
  const deactivateRows: Json[] = [];
  const senseRows: Json[] = [];
  const lookupRows: Json[] = [];

  for (const entry of entries) {
    const wasActive = known.get(entry.id);
    if (wasActive === undefined) report.wordsAdded += 1;
    else if (!wasActive) report.wordsReactivated += 1;
    wordRows.push({ id: entry.id, source: entry.source, common: entry.common });

    const existing = formsByWord.get(entry.id) ?? [];
    const assigned = assignFormIndexes(existing, entry.forms);
    report.formsAdded += assigned.added;
    report.formsReactivated += assigned.reactivated;
    report.formsDeactivated += assigned.deactivate.length;

    for (const form of assigned.rows) {
      formRows.push({
        word_id: entry.id,
        idx: form.idx,
        text: form.text,
        kana: form.kana,
        common: form.common,
        tags: form.tags,
        applies_to_kanji: form.appliesToKanji,
      });
    }
    for (const idx of assigned.deactivate) deactivateRows.push({ word_id: entry.id, idx });

    // Inactive spellings stay findable, so lookups cover every stored form, not only this file's.
    const assignedIdx = new Set(assigned.rows.map((form) => form.idx));
    const allForms = [
      ...assigned.rows.map(({ idx, text }) => ({ idx, text })),
      ...existing.filter((form) => !assignedIdx.has(form.idx)).map(({ idx, text }) => ({ idx, text })),
    ];
    for (const form of allForms) {
      for (const key of lookupKeys(form.text)) lookupRows.push({ key, word_id: entry.id, form_idx: form.idx });
    }

    entry.senses.forEach((sense, idx) => {
      senseRows.push({
        word_id: entry.id,
        idx,
        lang: sense.lang,
        pos: sense.pos,
        misc: sense.misc,
        field: sense.field,
        dialect: sense.dialect,
        info: sense.info,
        applies_to_kanji: sense.appliesToKanji,
        applies_to_kana: sense.appliesToKana,
        related: sense.related,
        antonym: sense.antonym,
        glosses: sense.glosses,
      });
    });
    report.senses += entry.senses.length;
  }

  await runner.query(
    `INSERT INTO dict.word (id, source, common, active, updated_at)
     SELECT id, source, common, true, now()
       FROM jsonb_to_recordset($1::jsonb) AS x(id int, source varchar, common boolean)
     ON CONFLICT (id) DO UPDATE
        SET source = EXCLUDED.source, common = EXCLUDED.common, active = true, updated_at = now()`,
    [JSON.stringify(wordRows)],
  );

  await runner.query(
    `INSERT INTO dict.form (word_id, idx, text, kana, common, tags, applies_to_kanji, active)
     SELECT word_id, idx, text, kana, common, tags, applies_to_kanji, true
       FROM jsonb_to_recordset($1::jsonb)
         AS x(word_id int, idx smallint, text varchar, kana boolean, common boolean, tags text[],
              applies_to_kanji text[])
     ON CONFLICT (word_id, idx) DO UPDATE
        SET common = EXCLUDED.common, tags = EXCLUDED.tags, applies_to_kanji = EXCLUDED.applies_to_kanji,
            active = true`,
    [JSON.stringify(formRows)],
  );

  if (deactivateRows.length > 0) {
    await runner.query(
      `UPDATE dict.form AS f SET active = false
         FROM jsonb_to_recordset($1::jsonb) AS x(word_id int, idx smallint)
        WHERE f.word_id = x.word_id AND f.idx = x.idx`,
      [JSON.stringify(deactivateRows)],
    );
  }

  await runner.query(`DELETE FROM dict.sense WHERE word_id = ANY($1::int[])`, [ids]);
  if (senseRows.length > 0) {
    await runner.query(
      `INSERT INTO dict.sense (word_id, idx, lang, pos, misc, field, dialect, info, applies_to_kanji, applies_to_kana,
                               related, antonym, glosses)
       SELECT word_id, idx, lang, pos, misc, field, dialect, info, applies_to_kanji, applies_to_kana,
              related, antonym, glosses
         FROM jsonb_to_recordset($1::jsonb)
           AS x(word_id int, idx smallint, lang char(3), pos text[], misc text[], field text[], dialect text[],
                info text[], applies_to_kanji text[], applies_to_kana text[], related jsonb, antonym jsonb,
                glosses jsonb)`,
      [JSON.stringify(senseRows)],
    );
  }

  await runner.query(`DELETE FROM dict.lookup WHERE word_id = ANY($1::int[])`, [ids]);
  await runner.query(
    `INSERT INTO dict.lookup (key, word_id, form_idx)
     SELECT key, word_id, form_idx FROM jsonb_to_recordset($1::jsonb) AS x(key varchar, word_id int, form_idx smallint)
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(lookupRows)],
  );
}

/** Words of this source that the file no longer has: flagged inactive with their forms, never deleted. */
async function deactivateMissing(
  runner: QueryRunner,
  source: DictionarySource,
  seen: number[],
  report: ImportReport,
): Promise<void> {
  const counted: Array<{ count: string }> = await runner.query(
    `SELECT count(*) FROM dict.word WHERE source = $1 AND active`,
    [source],
  );
  const active = Number(counted[0]?.count ?? 0);
  // Every `seen` word is active by now, so a short file shows up as many active words it never mentioned.
  if (active > 0 && seen.length < active * MIN_SHARE_TO_DEACTIVATE) {
    report.deactivationSkipped = `the file has ${seen.length} entries for ${active} active words`;
    return;
  }

  // A CTE, because TypeORM hands back a raw `UPDATE ... RETURNING` as [rows, count] rather than rows.
  const gone: Array<{ id: number }> = await runner.query(
    `WITH gone AS (
       UPDATE dict.word SET active = false, updated_at = now()
        WHERE source = $1 AND active AND NOT (id = ANY($2::int[]))
        RETURNING id
     ), forms AS (
       UPDATE dict.form SET active = false WHERE active AND word_id IN (SELECT id FROM gone)
     )
     SELECT id FROM gone`,
    [source, seen],
  );
  report.wordsDeactivated = gone.length;
}

async function recordSource(
  runner: QueryRunner,
  name: string,
  version: string,
  dictDate: string | null,
  tags: Record<string, string>,
): Promise<void> {
  await runner.query(
    `INSERT INTO dict.source (name, version, dict_date, tags, imported_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (name) DO UPDATE
        SET version = EXCLUDED.version, dict_date = EXCLUDED.dict_date, tags = EXCLUDED.tags, imported_at = now()`,
    [name, version, dictDate, JSON.stringify(tags)],
  );
}

/**
 * Import one jmdict-simplified file. `entries` must come from `readDictionary`, which reports the file's metadata
 * through `metadata()` once the first entry has been read.
 */
export async function importDictionary(
  dataSource: DataSource,
  source: DictionarySource,
  entries: AsyncIterable<ImportEntry>,
  metadata: () => JMdictDictionaryMetadata | null,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const report: ImportReport = {
    source,
    version: null,
    entries: 0,
    wordsAdded: 0,
    wordsReactivated: 0,
    wordsDeactivated: 0,
    formsAdded: 0,
    formsReactivated: 0,
    formsDeactivated: 0,
    senses: 0,
    skippedOwnedByJmdict: 0,
    deactivationSkipped: null,
    dryRun,
  };
  const seen: number[] = [];

  const run = async (shared: QueryRunner | null) => {
    const write = (work: (runner: QueryRunner) => Promise<void>) =>
      shared ? work(shared) : inTransaction(dataSource, false, work);

    let batch: ImportEntry[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const current = batch;
      batch = [];
      await write((runner) => writeBatch(runner, current, report));
      options.onProgress?.(report);
    };

    for await (const entry of entries) {
      seen.push(entry.id);
      report.entries += 1;
      batch.push(entry);
      if (batch.length >= batchSize) await flush();
    }
    await flush();

    const meta = metadata();
    if (!meta) throw new Error(`The ${source} file had no metadata; is it a jmdict-simplified file?`);
    const version = options.versionLabel ?? meta.version;
    report.version = version;

    await write(async (runner) => {
      await deactivateMissing(runner, source, seen, report);
      await recordSource(runner, source, version, meta.dictDate ?? null, meta.tags);
    });
  };

  if (dryRun) await inTransaction(dataSource, true, (runner) => run(runner));
  else await run(null);

  return report;
}

export interface FuriganaReport {
  source: string;
  rows: number;
  dryRun: boolean;
}

/** Replace one source's furigana in a single transaction, so lookups never see it half loaded. */
export async function importFurigana(
  dataSource: DataSource,
  source: 'jmdict-furigana' | 'jmnedict-furigana',
  version: string,
  entries: AsyncIterable<FuriganaEntry>,
  options: { dryRun?: boolean } = {},
): Promise<FuriganaReport> {
  const report: FuriganaReport = { source, rows: 0, dryRun: options.dryRun ?? false };

  await inTransaction(dataSource, report.dryRun, async (runner) => {
    await runner.query(`DELETE FROM dict.furigana WHERE source = $1`, [source]);

    let batch: Json[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await runner.query(
        `INSERT INTO dict.furigana (text, reading, source, segments)
         SELECT text, reading, $2, segments FROM jsonb_to_recordset($1::jsonb) AS x(text varchar, reading varchar,
                                                                                    segments jsonb)
         ON CONFLICT (text, reading, source) DO UPDATE SET segments = EXCLUDED.segments`,
        [JSON.stringify(batch), source],
      );
      batch = [];
    };

    for await (const entry of entries) {
      // Same shape as the word card's ruby: the kanji (or kana) run, and its reading when it has one.
      const segments = entry.furigana.map((piece) =>
        piece.rt ? { text: piece.ruby, ruby: piece.rt } : { text: piece.ruby },
      );
      batch.push({ text: entry.text, reading: entry.reading, segments });
      report.rows += 1;
      if (batch.length >= FURIGANA_BATCH_SIZE) await flush();
    }
    await flush();

    await recordSource(runner, source, version, null, {});
  });

  return report;
}
