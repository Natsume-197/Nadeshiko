import '@config/boot';
import { logger } from '@config/log';
import { AppDataSource } from '@config/database';
import { segmentParser } from '@app/services/parser';

/** Re-tokenizes the corpus in ordered, durable pages with the parser SEGMENT_PARSER selects. Await each page write
 * before advancing `--after`; parsing may parallelize inside a page but ordered results make the cursor resumable
 * without gaps.
 *
 * `--stale` skips rows the active parser already wrote (same `parser_version`), so a switch of parser, or a revision
 * of ours, reparses only what is left and can be stopped and rerun at will. Search serves the stored tokens, so follow
 * a reparse with `npm run es:reindex`. */
const PAGE_SIZE = Math.max(1, Number(process.env.REPARSE_PAGE_SIZE ?? 1000) || 1000);

/** `PARSE_RATE` paces requests; concurrency alone allowed Shirabe heap growth, while sleeping only for the unused
 * page budget avoids slowing pages already delayed. */
const TARGET_RATE = Math.max(0, Number(process.env.REPARSE_TARGET_RATE ?? 0) || 0);

/** Retry transient restart/network failures, but throw for 4xx and missing credentials so a permanent configuration
 * error does not spin. */
const MAX_ATTEMPTS = 5;

function isTransient(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? (error as { code?: string })?.code;

  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_SOCKET' ||
    /\b(502|503|504)\b/.test(String((error as Error)?.message ?? ''))
  );
}

async function parseWithRetry(texts: string[]): Promise<Awaited<ReturnType<typeof segmentParser.parse>>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await segmentParser.parse(texts);
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) throw error;

      // Backs off so a parser restart (a Shirabe container swap, or the Sudachi sidecar rebooting) is ridden out
      // rather than burning all the attempts in a few seconds.
      const delayMs = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
      logger.warn({ err: error, attempt, delayMs, parser: segmentParser.version }, 'Parse failed, retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function parseArgs(): { after: number; stale: boolean } {
  const args = process.argv.slice(2);
  let after = 0;
  let stale = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--after') {
      after = Number(args[i + 1]);
      if (!Number.isFinite(after)) {
        throw new Error(`--after expects a number, got: ${args[i + 1]}`);
      }
      i++;
    } else if (args[i] === '--stale') {
      stale = true;
    } else {
      throw new Error(`Unknown argument: ${args[i]} (expected --after <id> or --stale)`);
    }
  }

  return { after, stale };
}

async function main(): Promise<void> {
  const { after, stale } = parseArgs();
  const version = segmentParser.version;

  await AppDataSource.initialize();

  // With --stale, `$3` is the active version and rows already carrying it are left alone; without it `$3` is null and
  // `IS DISTINCT FROM NULL` matches every row, including rows never parsed.
  const skipVersion = stale ? version : null;
  const [count]: Array<{ total: number }> = await AppDataSource.query(
    `SELECT count(*)::int AS total FROM "Segment" WHERE id > $1 AND ($2::text IS NULL OR parser_version IS DISTINCT FROM $2)`,
    [after, skipVersion],
  );
  const total = count?.total ?? 0;

  logger.info({ after, total, stale, parser: version, pageSize: PAGE_SIZE }, 'reparse starting');

  let cursor = after;
  let written = 0;
  const startedAt = Date.now();

  for (;;) {
    const rows: Array<{ id: number; uuid: string; content: string }> = await AppDataSource.query(
      `SELECT id, uuid, content
         FROM "Segment"
        WHERE id > $1
          AND ($3::text IS NULL OR parser_version IS DISTINCT FROM $3)
        ORDER BY id
        LIMIT $2`,
      [cursor, PAGE_SIZE, skipVersion],
    );

    if (rows.length === 0) break;

    const pageStartedAt = Date.now();
    const tokens = await parseWithRetry(rows.map((row) => row.content));

    await AppDataSource.query(
      `UPDATE "Segment" AS s
          SET tokens = incoming.payload::jsonb,
              parser_version = $3
         FROM (SELECT unnest($1::text[]) AS uuid, unnest($2::text[]) AS payload) AS incoming
        WHERE s.uuid = incoming.uuid`,
      [rows.map((row) => row.uuid), tokens.map((token) => JSON.stringify(token)), version],
    );

    cursor = rows[rows.length - 1]!.id;
    written += rows.length;

    const rate = Math.round(written / Math.max(1, (Date.now() - startedAt) / 1000));
    logger.info({ written, total, rate, lastId: cursor }, 'reparse progress');

    if (TARGET_RATE > 0) {
      const budgetMs = (rows.length / TARGET_RATE) * 1000;
      const spentMs = Date.now() - pageStartedAt;
      if (spentMs < budgetMs) {
        await new Promise((resolve) => setTimeout(resolve, budgetMs - spentMs));
      }
    }
  }

  logger.info({ written, lastId: cursor }, 'reparse finished');
}

main()
  .then(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, 'reparse failed');
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exit(1);
  });
