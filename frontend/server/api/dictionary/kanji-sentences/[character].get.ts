import { createError, getRouterParam, type H3Event, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { logger } from '~~/server/utils/logger';
import {
  DICTIONARY_CACHE_SECONDS,
  dictionaryUnavailable,
  PUBLIC_CONTENT_RATINGS,
} from '~~/server/utils/dictionaryRoute';

// Example sentences on a kanji's own page (task 44): the corpus searched in the "contains" mode for the kanji, so
// every word written with it counts. Relevance order already comes in rounds by title, so the first few are spread
// across shows. Shared by every reader and crawler, so cached for a day like the kanji card; the page is public and
// indexed, so only SAFE and SUGGESTIVE sentences, as in the sitemap. Also how many sentences and titles have the
// kanji in all, for the page's header: from the same search's stats, so the counts match what "see all" shows.

/** How many sentences the page shows. */
const KANJI_SENTENCES = 8;

function character(event: H3Event): string | null {
  const value = getRouterParam(event, 'character');
  return value && [...value].length === 1 ? value : null;
}

const handler = defineEventHandler(async (event) => {
  const kanji = character(event);
  if (!kanji) throw createError({ statusCode: 400, statusMessage: 'One kanji is required' });

  const sdk = useServerSdk(event);
  const query = { search: kanji, matchMode: 'CONTAINS' as const };
  const filters = { contentRating: PUBLIC_CONTENT_RATINGS };
  try {
    const [response, stats] = await Promise.all([
      sdk.search({ query, take: KANJI_SENTENCES, filters, include: ['media'] }),
      // The counts are a nicety: without them the sentences still show.
      sdk.getSearchStats({ query, filters }).catch((error: unknown) => {
        logger.warn({ kanji, err: error }, 'Kanji sentence counts failed');
        return null;
      }),
    ]);
    const totals = stats
      ? {
          sentences: stats.categories.reduce((sum, category) => sum + category.count, 0),
          titles: stats.media.length,
        }
      : null;
    setResponseHeader(event, 'cache-control', `public, max-age=${DICTIONARY_CACHE_SECONDS}`);
    return { ...response, totals };
  } catch (error: unknown) {
    logger.warn({ kanji, err: error }, 'Kanji sentences lookup failed');
    // An outage is not an answer: never cache it. The page still renders without the sentences.
    throw dictionaryUnavailable(event, 'Sentences temporarily unavailable');
  }
});

export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: DICTIONARY_CACHE_SECONDS,
  getKey: (event) => {
    const kanji = character(event);
    return kanji ? stableCacheKey('kanji-sentences', kanji) : 'invalid-kanji';
  },
});
