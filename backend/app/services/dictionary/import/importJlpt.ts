import { readFile } from 'node:fs/promises';
import type { DataSource } from 'typeorm';
import { inTransaction, recordSource } from './db';

/** JLPT levels from stephenmk/yomitan-jlpt-vocab's `original_data/n1.csv`..`n5.csv` (columns
 * `jmdict_seq,kana,kanji,waller_definition`). The level belongs to the word its JMdict id names.
 *
 * One widening, measured against Shirabe's cards (2026-11-10): a row Waller wrote in kana only also gives its level to
 * the words usually written in that kana. stephenmk ties Waller's N5 それ to a rare entry (2216210) and leaves the
 * それ readers meet (1006970, 其れ, usually kana) at N1; Shirabe, matching Waller by text, says N5. Each word keeps
 * the easiest level it gets either way. */

export interface JlptReport {
  version: string;
  /** Rows with a JMdict id, across all files. */
  rows: number;
  /** Rows Waller listed that stephenmk could not tie to a JMdict entry. */
  rowsWithoutId: number;
  /** Distinct words given a level. */
  words: number;
  /** Words listed at more than one level; each keeps the easiest. */
  multiLevel: number;
  /** Words given an easier level through a kana-only row than their own id has (or than none). */
  widenedByKana: number;
  /** Listed ids with no row in `dict.word`, active or not (JMdict must be imported first); skipped. */
  unknownIds: number[];
  dryRun: boolean;
}

/** The JMdict ids of one level's CSV. The id is the first column and never quoted, so the rest of the line (where
 * definitions carry quoted commas) can be ignored. */
export function parseJlptCsv(text: string): { ids: number[]; withoutId: number; kanaOnly: string[] } {
  const ids: number[] = [];
  const kanaOnly: string[] = [];
  let withoutId = 0;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (index === 0 || line.trim() === '') continue; // header
    const comma = line.indexOf(',');
    const first = comma === -1 ? line : line.slice(0, comma);
    if (/^\d+$/.test(first)) ids.push(Number(first));
    else withoutId += 1;
    // kana and kanji are never quoted; a row with no kanji is a word Waller wrote in kana. Hiragana only: katakana
    // rows are loanwords, whose homographs are different words (カラー collar and color, ライター writer and lighter).
    const [, kana = '', kanji = ''] = line.split(',', 3);
    if (!kanji.trim() && /^[\p{Script=Hiragana}ー]+$/u.test(kana.trim())) kanaOnly.push(kana.trim());
  }
  return { ids, withoutId, kanaOnly };
}

/** One level per word: the easiest it is listed at (N5 is the easiest, so the highest number). */
export function easiestLevels(lists: Array<{ level: number; ids: number[] }>): {
  levels: Map<number, number>;
  multiLevel: number;
} {
  const seenAt = new Map<number, Set<number>>();
  for (const { level, ids } of lists) {
    for (const id of ids) {
      const set = seenAt.get(id) ?? new Set<number>();
      set.add(level);
      seenAt.set(id, set);
    }
  }
  const levels = new Map<number, number>();
  let multiLevel = 0;
  for (const [id, set] of seenAt) {
    levels.set(id, Math.max(...set));
    if (set.size > 1) multiLevel += 1;
  }
  return { levels, multiLevel };
}

/** Replace all JLPT levels in one transaction. `files` maps a level (1-5) to its CSV. */
export async function importJlpt(
  dataSource: DataSource,
  files: Array<{ level: number; path: string }>,
  version: string,
  options: { dryRun?: boolean } = {},
): Promise<JlptReport> {
  const lists: Array<{ level: number; ids: number[] }> = [];
  const kanaRows: Array<{ kana: string; level: number }> = [];
  let rows = 0;
  let rowsWithoutId = 0;
  for (const { level, path } of files) {
    const { ids, withoutId, kanaOnly } = parseJlptCsv(await readFile(path, 'utf8'));
    lists.push({ level, ids });
    for (const kana of kanaOnly) kanaRows.push({ kana, level });
    rows += ids.length;
    rowsWithoutId += withoutId;
  }
  const { levels, multiLevel } = easiestLevels(lists);
  const payload = JSON.stringify([...levels].map(([word_id, level]) => ({ word_id, level })));
  const report: JlptReport = {
    version,
    rows,
    rowsWithoutId,
    words: 0,
    multiLevel,
    widenedByKana: 0,
    unknownIds: [],
    dryRun: options.dryRun ?? false,
  };

  await inTransaction(dataSource, report.dryRun, async (runner) => {
    const unknown: Array<{ word_id: number }> = await runner.query(
      `SELECT x.word_id FROM jsonb_to_recordset($1::jsonb) AS x(word_id int, level smallint)
        WHERE NOT EXISTS (SELECT 1 FROM dict.word w WHERE w.id = x.word_id)
        ORDER BY x.word_id`,
      [payload],
    );
    report.unknownIds = unknown.map((row) => row.word_id);

    await runner.query(`DELETE FROM dict.jlpt`);
    // Usually written in that kana: the kana is the word's first kana form and marked common (which keeps homographs
    // such as パン "pan" or 謂 いい out), and the word either has no kanji form or its first English sense is marked
    // `uk`. JMdict words only; names have no JLPT level.
    const [counts]: Array<{ words: number; widened: number }> = await runner.query(
      `WITH own AS (
         SELECT x.word_id, x.level FROM jsonb_to_recordset($1::jsonb) AS x(word_id int, level smallint)
           JOIN dict.word w ON w.id = x.word_id
       ), kana_rows AS (
         SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(kana text, level smallint)
       ), first_kana AS (
         SELECT DISTINCT ON (f.word_id) f.word_id, f.text, f.common
           FROM dict.form f
          WHERE f.kana AND f.active
            AND f.word_id IN (SELECT g.word_id FROM dict.form g JOIN kana_rows r ON r.kana = g.text)
          ORDER BY f.word_id, f.idx
       ), first_sense AS (
         SELECT DISTINCT ON (s.word_id) s.word_id, s.misc
           FROM dict.sense s
          WHERE s.lang = 'eng' AND s.word_id IN (SELECT word_id FROM first_kana)
          ORDER BY s.word_id, s.idx
       ), by_kana AS (
         SELECT k.word_id, max(r.level) AS level
           FROM first_kana k
           JOIN kana_rows r ON r.kana = k.text AND k.common
           JOIN dict.word w ON w.id = k.word_id AND w.active AND w.source = 'jmdict'
           LEFT JOIN first_sense fs ON fs.word_id = k.word_id
          WHERE 'uk' = ANY (fs.misc)
             OR NOT EXISTS (SELECT 1 FROM dict.form j WHERE j.word_id = k.word_id AND NOT j.kana AND j.active)
          GROUP BY k.word_id
       ), merged AS (
         SELECT word_id, max(level) AS level FROM (SELECT * FROM own UNION ALL SELECT * FROM by_kana) u GROUP BY word_id
       ), inserted AS (
         INSERT INTO dict.jlpt (word_id, level) SELECT word_id, level FROM merged RETURNING word_id, level
       )
       SELECT count(*)::int AS words,
              count(*) FILTER (WHERE i.level > coalesce(o.level, 0))::int AS widened
         FROM inserted i LEFT JOIN own o ON o.word_id = i.word_id`,
      [payload, JSON.stringify(kanaRows)],
    );
    const { words, widened } = counts ?? { words: 0, widened: 0 };
    report.words = words;
    report.widenedByKana = widened;

    await recordSource(runner, 'jlpt', version);
  });

  return report;
}
