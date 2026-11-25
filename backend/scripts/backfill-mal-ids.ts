/** Backfills `MediaExternalId` MAL rows from AniList's `idMal` for media that has an AniList id and no MAL id, then
 * links any unmatched MyAnimeList tracker rows to that media. It only inserts missing rows, is safe to rerun or
 * interrupt, and is a dry run unless `--write` is passed; production goes through `scripts/remote-db.sh ... --allow-prod`.
 *
 *   node --env-file-if-exists=.env --import tsx scripts/backfill-mal-ids.ts            # dry run
 *   node --env-file-if-exists=.env --import tsx scripts/backfill-mal-ids.ts --write    # insert rows
 */

// Load dotenv/boot before config so local values fill the schema while the remote wrapper overrides only Postgres
// settings.
import '@config/boot';
import { Pool } from 'pg';
import { config } from '@config/config';
import { logger } from '@config/log';

/** AniList's maximum page size. */
const BATCH_SIZE = 50;
/** AniList allows 90 requests a minute (30 while degraded); one page every 2.5 s stays under both. */
const PAUSE_MS = 2_500;

interface AniListPage {
  data?: { Page?: { media?: Array<{ id?: number | null; idMal?: number | null }> | null } | null };
}

async function fetchMalIds(anilistIds: number[]): Promise<Map<number, number>> {
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      query: `query ($ids: [Int]) { Page(perPage: ${BATCH_SIZE}) { media(id_in: $ids, type: ANIME) { id idMal } } }`,
      variables: { ids: anilistIds },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`AniList answered ${response.status}`);

  const result = new Map<number, number>();
  for (const media of ((await response.json()) as AniListPage).data?.Page?.media ?? []) {
    if (typeof media.id === 'number' && typeof media.idMal === 'number' && media.idMal > 0) {
      result.set(media.id, media.idMal);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');

  const pool = new Pool({
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
  });

  const { rows: pending } = await pool.query<{ media_id: number; anilist_id: string }>(
    `SELECT a.media_id, a.external_id AS anilist_id
     FROM "MediaExternalId" a
     WHERE a.source = 'ANILIST'
       AND a.external_id ~ '^[0-9]+$'
       AND NOT EXISTS (SELECT 1 FROM "MediaExternalId" m WHERE m.media_id = a.media_id AND m.source = 'MAL')
     ORDER BY a.media_id`,
  );
  logger.info(
    `${pending.length} media with an AniList id and no MAL id${write ? '' : ' (dry run, nothing will be written)'}`,
  );

  let found = 0;
  let inserted = 0;
  let linked = 0;
  const withoutMal: string[] = [];

  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    const malByAniList = await fetchMalIds(batch.map((row) => Number(row.anilist_id)));

    const pairs = batch.flatMap((row) => {
      const malId = malByAniList.get(Number(row.anilist_id));
      if (!malId) {
        withoutMal.push(row.anilist_id);
        return [];
      }
      return [{ mediaId: row.media_id, malId: String(malId) }];
    });
    found += pairs.length;

    if (write && pairs.length > 0) {
      const insert = await pool.query(
        `INSERT INTO "MediaExternalId" (media_id, source, external_id)
         SELECT v.media_id, 'MAL', v.external_id
         FROM (SELECT unnest($1::int[]) AS media_id, unnest($2::text[]) AS external_id) AS v
         ON CONFLICT DO NOTHING`,
        [pairs.map((pair) => pair.mediaId), pairs.map((pair) => pair.malId)],
      );
      inserted += insert.rowCount ?? 0;

      const link = await pool.query(
        `UPDATE "UserMediaProgress" AS p SET media_id = v.media_id
         FROM (SELECT unnest($1::int[]) AS media_id, unnest($2::text[]) AS external_id) AS v
         WHERE p.external_source = 'MAL' AND p.external_id = v.external_id AND p.media_id IS NULL`,
        [pairs.map((pair) => pair.mediaId), pairs.map((pair) => pair.malId)],
      );
      linked += link.rowCount ?? 0;
    }

    logger.info(`  ${Math.min(offset + BATCH_SIZE, pending.length)}/${pending.length} checked, ${found} MAL ids found`);
    if (offset + BATCH_SIZE < pending.length) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }

  logger.info(
    `${found} MAL ids found, ${inserted} rows inserted, ${linked} tracker rows linked; ` +
      `${withoutMal.length} AniList entries have no MAL id${withoutMal.length ? `: ${withoutMal.join(', ')}` : ''}`,
  );

  await pool.end();
}

main().catch((error) => {
  logger.error({ err: error }, 'MAL id backfill failed');
  process.exit(1);
});
