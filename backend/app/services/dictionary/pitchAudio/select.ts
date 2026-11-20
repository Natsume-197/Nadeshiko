import type { DataSource } from 'typeorm';
import { toHiragana } from '../import/entries';
import { type HaPlan, haPlan } from './kana';

/**
 * Which pitch-audio clips to make (task 40): every active dictionary word, or only the `top` most frequent of our
 * corpus (`dict.frequency`); each spelling and reading of theirs that has a pitch in `dict.pitch` (UniDic first, as the
 * card), its first two downsteps (the card draws two), as distinct (reading, downstep) pairs, the most frequent first.
 * Homographs that sound the same share a clip (橋/端 はし²).
 */

export interface SelectedClip {
  /** Hiragana. */
  reading: string;
  downstep: number;
  /** Best frequency rank among the words that use this clip, so a partial run makes the common ones first; null
   * when none of them occurs in the corpus. */
  rank: number | null;
  ha: HaPlan;
}

/** Sorts after every real rank. */
const UNRANKED = 2_147_483_647;

export async function selectClips(dataSource: DataSource, top: number | 'all'): Promise<SelectedClip[]> {
  const rows: Array<{ reading: string; downsteps: number[]; rank: number }> = await dataSource.query(
    `WITH top AS (
       SELECT w.id AS word_id, coalesce(f.rank, ${UNRANKED}) AS rank
         FROM dict.word w
         LEFT JOIN dict.frequency f ON f.word_id = w.id
        WHERE w.active AND ($1::int IS NULL OR f.rank IS NOT NULL)
        ORDER BY f.rank NULLS LAST
        LIMIT $1
     ),
     forms AS (
       SELECT f.word_id, t.rank, f.text, f.kana, f.applies_to_kanji
         FROM dict.form f JOIN top t USING (word_id)
        WHERE f.active
     ),
     pairs AS (
       SELECT r.rank, r.text AS spelling, r.text AS reading FROM forms r WHERE r.kana
       UNION
       SELECT r.rank, s.text, r.text
         FROM forms s
         JOIN forms r ON r.word_id = s.word_id AND r.kana
        WHERE NOT s.kana AND ('*' = ANY (r.applies_to_kanji) OR s.text = ANY (r.applies_to_kanji))
     ),
     pitch AS (
       SELECT DISTINCT ON (p.text, p.reading) p.text, p.reading, p.downsteps
         FROM dict.pitch p
         JOIN (SELECT DISTINCT spelling, reading FROM pairs) x ON p.text = x.spelling AND p.reading = x.reading
        ORDER BY p.text, p.reading, p.source = 'unidic' DESC
     )
     SELECT p.reading, p.downsteps, min(x.rank)::int AS rank
       FROM pitch p
       JOIN pairs x ON x.spelling = p.text AND x.reading = p.reading
      GROUP BY p.reading, p.downsteps`,
    [top === 'all' ? null : top],
  );

  const best = new Map<string, { reading: string; downstep: number; rank: number }>();
  for (const row of rows) {
    const reading = toHiragana(row.reading);
    for (const downstep of row.downsteps.slice(0, 2)) {
      const key = `${reading}\u0000${downstep}`;
      const known = best.get(key);
      if (!known || row.rank < known.rank) best.set(key, { reading, downstep, rank: row.rank });
    }
  }

  const plans = await haPlans(dataSource, [...new Set([...best.values()].map((clip) => clip.reading))]);
  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || a.reading.localeCompare(b.reading) || a.downstep - b.downstep)
    .map((clip) => ({
      ...clip,
      rank: clip.rank === UNRANKED ? null : clip.rank,
      ha: plans.get(clip.reading) ?? new Map(),
    }));
}

/** How each は/へ sounds in the readings that have one, from the ruby of every kanji spelling with that reading. */
async function haPlans(dataSource: DataSource, readings: string[]): Promise<Map<string, HaPlan>> {
  const withHa = readings.filter((reading) => /[はへ]/.test(reading));
  if (withHa.length === 0) return new Map();
  const rows: Array<{ reading: string; segments: Array<{ text: string; ruby?: string }> }> = await dataSource.query(
    `SELECT reading, segments FROM dict.furigana WHERE reading = ANY ($1)`,
    [withHa],
  );
  const byReading = new Map<string, Array<Array<{ text: string; ruby?: string }>>>();
  for (const row of rows) {
    const list = byReading.get(row.reading) ?? [];
    list.push(row.segments);
    byReading.set(row.reading, list);
  }
  return new Map(withHa.map((reading) => [reading, haPlan(reading, byReading.get(reading) ?? [])]));
}
