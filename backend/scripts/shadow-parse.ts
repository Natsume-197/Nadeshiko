/**
 * Shadow comparison of our parser against the stored Shirabe tokens (task 40, phase 3). Parses segments that
 * already have Shirabe tokens with `nadeshikoParser`, writes nothing, and reports per-field agreement on the tokens
 * whose span both parsers agree on, plus sample differences. Needs SUDACHI_URL and the `dict` schema.
 *
 *   node --env-file=.env --import tsx scripts/shadow-parse.ts [--limit 5000] [--samples out.txt]
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AppDataSource } from '@config/database';
import type { SlimToken } from '@app/models/Segment';
import { nadeshikoParser } from '@app/services/parser';

const { values } = parseArgs({
  options: { limit: { type: 'string', default: '5000' }, samples: { type: 'string' } },
});
const LIMIT = Number(values.limit);
const PAGE = 500;

const FIELDS = ['d', 'r', 'kind', 'p', 'pt', 'posLabel', 'f', 'inflection'] as const;
type Field = (typeof FIELDS)[number];

const show = (value: unknown) => (value === undefined ? '∅' : JSON.stringify(value));
const furigana = (token: SlimToken) =>
  token.f?.map((piece) => (piece.r ? `${piece.t}(${piece.r})` : piece.t)).join('') ?? undefined;
// Shirabe reads whitespace as キゴウ and rewrites ... as …: known bugs we fix rather than copy, so a symbol's reading
// is not compared.
const fieldOf = (token: SlimToken, field: Field): unknown =>
  field === 'r' && token.posLabel === 'Symbol'
    ? 'symbol'
    : field === 'f'
      ? furigana(token)
      : field === 'inflection'
        ? token.inflection?.labels.join(' > ')
        : token[field];

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const agree: Record<Field, number> = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<Field, number>;
  const diffs = Object.fromEntries(FIELDS.map((f) => [f, [] as string[]])) as unknown as Record<Field, string[]>;
  let segments = 0;
  let exactSegments = 0;
  let theirs = 0;
  let ours = 0;
  let sameSpan = 0;
  let cursor = 0;
  const startedAt = Date.now();

  while (segments < LIMIT) {
    const rows: Array<{ id: number; content: string; tokens: SlimToken[] }> = await AppDataSource.query(
      `SELECT id, content, tokens FROM "Segment"
        WHERE tokens IS NOT NULL AND jsonb_array_length(tokens) > 0 AND id > $1
        ORDER BY id LIMIT $2`,
      [cursor, Math.min(PAGE, LIMIT - segments)],
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    const parsed = await nadeshikoParser.parse(rows.map((row) => row.content));
    rows.forEach((row, index) => {
      const mine = parsed[index] ?? [];
      theirs += row.tokens.length;
      ours += mine.length;
      const bySpan = new Map(row.tokens.map((token) => [`${token.b}:${token.e}`, token]));
      let matchedAll = mine.length === row.tokens.length;
      for (const token of mine) {
        const other = bySpan.get(`${token.b}:${token.e}`);
        if (!other) {
          matchedAll = false;
          continue;
        }
        sameSpan += 1;
        for (const field of FIELDS) {
          const a = fieldOf(token, field);
          const b = fieldOf(other, field);
          if (show(a) === show(b)) agree[field] += 1;
          else if (diffs[field].length < 40)
            diffs[field].push(`${row.content}\n  ${token.s}: ours ${show(a)} | shirabe ${show(b)}`);
        }
      }
      if (matchedAll) exactSegments += 1;
    });
    segments += rows.length;
    process.stderr.write(`\r${segments} segments`);
  }
  process.stderr.write('\n');

  const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
  const report = {
    segments,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    tokens: { shirabe: theirs, ours, sameSpan, sameSpanShareOfShirabe: pct(sameSpan, theirs) },
    segmentsWithIdenticalSpans: pct(exactSegments, segments),
    fieldAgreementOnSameSpan: Object.fromEntries(FIELDS.map((field) => [field, pct(agree[field], sameSpan)])),
  };
  console.log(JSON.stringify(report, null, 2));
  if (values.samples) {
    writeFileSync(
      values.samples,
      FIELDS.map((field) => `## ${field}\n${diffs[field].join('\n')}`).join('\n\n'),
      'utf8',
    );
  }
  await AppDataSource.destroy();
}

main().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
