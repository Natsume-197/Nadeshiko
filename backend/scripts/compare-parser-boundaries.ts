/**
 * How closely each Sudachi split mode cuts sentences where Shirabe's stored tokens do (task 40, phase 3): the
 * measurement that picks the split mode our parser starts from. For every parsed segment, compares the word
 * boundaries (token starts and ends, ignoring the sentence edges) of Sudachi A, B and C against Shirabe's tokens,
 * and against Shirabe's inner `parts` boundaries too. Reads only; needs SUDACHI_URL.
 *
 *   node --env-file=.env --import tsx scripts/compare-parser-boundaries.ts [--limit 5000]
 */

import { parseArgs } from 'node:util';
import { AppDataSource } from '@config/database';
import type { SlimToken } from '@app/models/Segment';
import { analyse, type Morpheme, type SplitMode } from '@app/services/parser/sudachi';

const { values } = parseArgs({ options: { limit: { type: 'string', default: '5000' } } });
const LIMIT = Number(values.limit);
const PAGE = 500;

/** Inner boundaries of a sentence of length `length`: every cut point except 0 and the end. */
function cuts(spans: Array<{ b: number; e: number }>, length: number): Set<number> {
  const set = new Set<number>();
  for (const span of spans) {
    if (span.b > 0 && span.b < length) set.add(span.b);
    if (span.e > 0 && span.e < length) set.add(span.e);
  }
  return set;
}

interface Tally {
  agreed: number;
  extra: number;
  missed: number;
  exactSentences: number;
}

const blank = (): Tally => ({ agreed: 0, extra: 0, missed: 0, exactSentences: 0 });

function compare(tally: Tally, ours: Set<number>, theirs: Set<number>): void {
  let agreed = 0;
  for (const cut of ours) if (theirs.has(cut)) agreed += 1;
  tally.agreed += agreed;
  tally.extra += ours.size - agreed;
  tally.missed += theirs.size - agreed;
  if (agreed === ours.size && agreed === theirs.size) tally.exactSentences += 1;
}

function summary(tally: Tally, sentences: number) {
  const precision = tally.agreed / Math.max(1, tally.agreed + tally.extra);
  const recall = tally.agreed / Math.max(1, tally.agreed + tally.missed);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  const pct = (value: number) => `${(100 * value).toFixed(1)}%`;
  return {
    precision: pct(precision),
    recall: pct(recall),
    f1: pct(f1),
    exactSentences: pct(tally.exactSentences / Math.max(1, sentences)),
  };
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const modes: SplitMode[] = ['A', 'B', 'C'];
  const vsTokens = Object.fromEntries(modes.map((mode) => [mode, blank()])) as Record<SplitMode, Tally>;
  const vsParts = Object.fromEntries(modes.map((mode) => [mode, blank()])) as Record<SplitMode, Tally>;
  let sentences = 0;
  let cursor = 0;

  while (sentences < LIMIT) {
    const rows: Array<{ id: number; content: string; tokens: SlimToken[] }> = await AppDataSource.query(
      `SELECT id, content, tokens FROM "Segment"
        WHERE tokens IS NOT NULL AND jsonb_array_length(tokens) > 0 AND id > $1
        ORDER BY id LIMIT $2`,
      [cursor, Math.min(PAGE, LIMIT - sentences)],
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    const texts = rows.map((row) => row.content);
    const byMode = Object.fromEntries(
      await Promise.all(modes.map(async (mode) => [mode, await analyse(texts, mode)] as const)),
    ) as Record<SplitMode, Morpheme[][]>;

    rows.forEach((row, index) => {
      // Both sides count code points (Sudachi is Python, Shirabe Ruby), not UTF-16 units.
      const length = [...row.content].length;
      const shirabe = cuts(row.tokens, length);
      const shirabeParts = cuts(
        row.tokens.flatMap((token) => (token.parts?.length ? token.parts : [token])),
        length,
      );
      for (const mode of modes) {
        const sudachi = cuts(byMode[mode][index] ?? [], length);
        compare(vsTokens[mode], sudachi, shirabe);
        compare(vsParts[mode], sudachi, shirabeParts);
      }
    });
    sentences += rows.length;
    process.stderr.write(`\r${sentences} segments`);
  }

  process.stderr.write('\n');
  console.log(
    JSON.stringify(
      { sentences, vsShirabeTokens: mapValues(vsTokens, sentences), vsShirabeParts: mapValues(vsParts, sentences) },
      null,
      2,
    ),
  );
  await AppDataSource.destroy();
}

function mapValues(tallies: Record<SplitMode, Tally>, sentences: number) {
  return Object.fromEntries(Object.entries(tallies).map(([mode, tally]) => [mode, summary(tally, sentences)]));
}

main().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
