import { createError, getQuery, getRouterParam, type H3Event, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { fetchKanjiCard } from '~~/server/utils/kanjiIndexList';
import { logger } from '~~/server/utils/logger';
import {
  DICTIONARY_CACHE_SECONDS,
  type DictionaryLocale,
  dictionaryLocale,
  dictionaryUnavailable,
} from '~~/server/utils/dictionaryRoute';

// The word card's kanji view (task 44). The backend's kanji route is server-only, so the browser asks here and this
// carries the request on with the internal secret. The answer is the same for every reader, so it is cached for a
// day here and in the browser; it only changes with the weekly dictionary refresh.

/** `all` for the kanji's own page, which lists every related kanji; the word card asks for the first few. */
type Related = 'short' | 'all';

function input(event: H3Event): { character: string; locale: DictionaryLocale; related: Related } | null {
  const character = getRouterParam(event, 'character');
  // One character: a kanji outside the BMP is two UTF-16 units, so count code points.
  if (!character || [...character].length !== 1) return null;
  const params = getQuery(event);
  const locale = dictionaryLocale(params.locale);
  const related: Related = params.related === 'all' ? 'all' : 'short';
  return { character, locale, related };
}

const handler = defineEventHandler(async (event) => {
  const query = input(event);
  if (!query) throw createError({ statusCode: 400, statusMessage: 'One kanji is required' });

  try {
    const card = await fetchKanjiCard<unknown>(query.character, query.locale, query.related);
    setResponseHeader(event, 'cache-control', `public, max-age=${DICTIONARY_CACHE_SECONDS}`);
    return card;
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) throw createError({ statusCode: 404, statusMessage: 'No card for this kanji' });

    logger.warn({ character: query.character, status, err: error }, 'Kanji card lookup failed');
    // An outage is not an answer: never cache it.
    throw dictionaryUnavailable(event, 'Dictionary temporarily unavailable');
  }
});

export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: DICTIONARY_CACHE_SECONDS,
  getKey: (event) => {
    const query = input(event);
    return query ? stableCacheKey('kanji', query.locale, query.character, query.related) : 'invalid-kanji';
  },
});
