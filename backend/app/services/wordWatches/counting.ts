import type { estypes } from '@elastic/elasticsearch';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { ALL_CATEGORIES, Episode, Media } from '@app/models';
import type { User } from '@app/models';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import type { MatchMode } from '@app/services/search/segmentDocument/SegmentQuery';
import { resolveMediaFilterIds } from '@app/controllers/searchFilters';
import { DEFAULT_FILTERS, type ResolvedFilters } from '@app/services/search/segmentDocument/searchInputs';
import { normalizeMediaPreferences } from '@app/controllers/preferencesController';
import { WORD_ALERT_EXAMPLES } from '@app/mailers/emailTemplates';
import type { SearchFiltersOutput } from 'generated/outputTypes';
import { logger } from '@config/log';

/**
 * Counting for word alerts (task 52), on the search's own word query (`SegmentDocument.buildWordMatchQuery`), so a
 * count is exactly what the reader's search would return. This module only batches, paces and samples.
 */

export interface WordKey {
  query: string;
  matchMode: MatchMode;
}

/** The step-1 global count runs the search's own unfiltered default: live sentences in every category. */
export const GLOBAL_FILTERS = DEFAULT_FILTERS;

/** Words per `_msearch`. Each is a `size: 0` count, so the batch is cheap; the pause keeps the sweep from crowding the
 * search traffic on a single shared node. */
const COUNT_BATCH_SIZE = 50;
let batchPauseMs = 250;

/** Tests run the sweep without the pause. */
export function setCountBatchPauseForTests(ms: number): void {
  batchPauseMs = ms;
}

/**
 * The filters the reader's own search applies, from their saved preferences: NSFW hidden, hidden categories, hidden
 * titles. Null when they narrow nothing, so callers reuse the global count instead of asking again. Language filters
 * are not saved per account and stay at the search's default.
 */
export async function readerFilters(
  preferences: User['preferences'] | null | undefined,
): Promise<ResolvedFilters | null> {
  const normalized = normalizeMediaPreferences(preferences ?? {});
  const hiddenCategories = normalized.hiddenCategories ?? [];
  const visible = ALL_CATEGORIES.filter((category) => !hiddenCategories.includes(category));
  const hideNsfw = normalized.contentRatingPreferences?.nsfw === 'HIDE';
  const hiddenMedia = normalized.hiddenMedia ?? [];

  if (!hideNsfw && hiddenMedia.length === 0 && (visible.length === ALL_CATEGORIES.length || visible.length === 0)) {
    return null;
  }

  return (await resolveMediaFilterIds({
    ...DEFAULT_FILTERS,
    ...(hideNsfw ? { contentRating: ['SAFE', 'SUGGESTIVE'] } : {}),
    ...(visible.length > 0 ? { category: visible } : {}),
    ...(hiddenMedia.length > 0 ? { media: { exclude: hiddenMedia } } : {}),
  } as SearchFiltersOutput)) as ResolvedFilters;
}

export function countKey(key: WordKey): string {
  return `${key.matchMode}\u0000${key.query}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Counts many words under the same filters, `COUNT_BATCH_SIZE` per `_msearch`, pausing between batches. Keyed by
 * `countKey`; a word whose count failed is left out, and the sweep skips it until the next run.
 */
export async function countWords(keys: readonly WordKey[], filters: ResolvedFilters): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (let start = 0; start < keys.length; start += COUNT_BATCH_SIZE) {
    if (start > 0 && batchPauseMs > 0) await sleep(batchPauseMs);
    const batch = keys.slice(start, start + COUNT_BATCH_SIZE);
    const totals = await SegmentDocument.countWordMatches(batch, filters);
    for (const [i, key] of batch.entries()) {
      const total = totals[i];
      if (total !== null && total !== undefined) counts.set(countKey(key), total);
    }
  }

  return counts;
}

export async function countWord(key: WordKey, filters: ResolvedFilters): Promise<number | null> {
  return (await countWords([key], filters)).get(countKey(key)) ?? null;
}

/** Episodes registered since a date, as the `(mediaId, episode)` pairs of the index. Capped: a week of ingest is far
 * below it, and past it the examples simply come from the first ones. */
const NEW_EPISODES_CAP = 2000;

/** The new-episodes filter for one `since`, built once per sweep: most digest alerts share last week's sweep time. */
export type NewEpisodesCache = Map<number, Promise<estypes.QueryDslQueryContainer | null>>;

function episodesSince(since: Date, cache?: NewEpisodesCache): Promise<estypes.QueryDslQueryContainer | null> {
  const cached = cache?.get(since.getTime());
  if (cached) return cached;
  const built = Episode.query(
    `SELECT "media_id" AS "mediaId", "episode_number" AS "episode" FROM "Episode" WHERE "created_at" > $1 LIMIT $2`,
    [since, NEW_EPISODES_CAP],
  ).then((rows: Array<{ mediaId: number; episode: number }>) =>
    rows.length === 0
      ? null
      : {
          bool: {
            should: rows.map((row) => ({
              bool: { filter: [{ term: { mediaId: row.mediaId } }, { term: { episode: row.episode } }] },
            })),
            minimum_should_match: 1,
          },
        },
  );
  cache?.set(since.getTime(), built);
  return built;
}

/**
 * A few sentences of the word for the notice, one per title, and the titles they come from. With `since`, only from
 * episodes registered after that date (the new sentences of a digest); without it, from anywhere (a first appearance).
 * Empty when nothing matches, for example when a count grew because old sentences were re-tokenised.
 */
export async function wordExamples(
  key: WordKey,
  filters: ResolvedFilters,
  options: { since?: Date | null; episodesCache?: NewEpisodesCache } = {},
): Promise<{ examples: Array<{ text: string; title: string }>; titles: string[] }> {
  const extraFilters: estypes.QueryDslQueryContainer[] = [];
  if (options.since) {
    const newEpisodes = await episodesSince(options.since, options.episodesCache);
    if (!newEpisodes) return { examples: [], titles: [] };
    extraFilters.push(newEpisodes);
  }

  try {
    const response = await client.search<{ textJa: string; mediaId: number }>({
      index: INDEX_NAME,
      size: WORD_ALERT_EXAMPLES,
      query: await SegmentDocument.buildWordMatchQuery(key.query, key.matchMode, filters, 'safe', extraFilters),
      collapse: { field: 'mediaId' },
      _source: ['textJa', 'mediaId'],
      aggs: { titles: { terms: { field: 'mediaId', size: 5 } } },
    });

    const media = (await Media.getMediaInfoMap()).results;
    const nameOf = (mediaId: number) => {
      const info = media.get(mediaId);
      return info ? info.nameEn || info.nameRomaji || info.nameJa : '';
    };

    const examples = response.hits.hits.flatMap((hit) =>
      hit._source ? [{ text: hit._source.textJa, title: nameOf(hit._source.mediaId) }] : [],
    );
    const buckets = (response.aggregations?.titles as estypes.AggregationsLongTermsAggregate | undefined)?.buckets;
    const titles = (Array.isArray(buckets) ? buckets : []).map((bucket) => nameOf(Number(bucket.key))).filter(Boolean);

    return { examples, titles };
  } catch (err) {
    // Examples decorate a notice; a failure here must not stop the notice itself.
    logger.warn({ err, query: key.query }, 'Could not load examples for a word alert');
    return { examples: [], titles: [] };
  }
}
