import { createError, getQuery, getRouterParam, type H3Event, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { logger } from '~~/server/utils/logger';

// The word card's kanji view (task 44). The backend's kanji route is server-only, so the browser asks here and this
// carries the request on with the internal secret. The answer is the same for every reader, so it is cached for a
// day here and in the browser; it only changes with the weekly dictionary refresh.

const CACHE_SECONDS = 60 * 60 * 24;
const RETRY_AFTER_SECONDS = 5;
const TIMEOUT_MS = 3000;

type Locale = 'en' | 'es';
/** `all` for the kanji's own page, which lists every related kanji; the word card asks for the first few. */
type Related = 'short' | 'all';

function input(event: H3Event): { character: string; locale: Locale; related: Related } | null {
  const character = getRouterParam(event, 'character');
  // One character: a kanji outside the BMP is two UTF-16 units, so count code points.
  if (!character || [...character].length !== 1) return null;
  const params = getQuery(event);
  const locale: Locale = params.locale === 'es' ? 'es' : 'en';
  const related: Related = params.related === 'all' ? 'all' : 'short';
  return { character, locale, related };
}

const handler = defineEventHandler(async (event) => {
  const query = input(event);
  if (!query) throw createError({ statusCode: 400, statusMessage: 'One kanji is required' });

  const config = useRuntimeConfig();
  try {
    const card = await $fetch(
      internalBackendUrl(config, `/v1/dictionary/kanji/${encodeURIComponent(query.character)}`),
      {
        query: { locale: query.locale, related: query.related },
        headers: buildInternalBackendHeaders(config),
        timeout: TIMEOUT_MS,
      },
    );
    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return card;
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) throw createError({ statusCode: 404, statusMessage: 'No card for this kanji' });

    logger.warn({ character: query.character, status, err: error }, 'Kanji card lookup failed');
    // An outage is not an answer: never cache it.
    setResponseHeader(event, 'cache-control', 'no-store');
    setResponseHeader(event, 'retry-after', RETRY_AFTER_SECONDS);
    throw createError({ statusCode: 503, statusMessage: 'Dictionary temporarily unavailable' });
  }
});

export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: CACHE_SECONDS,
  getKey: (event) => {
    const query = input(event);
    return query ? stableCacheKey('kanji', query.locale, query.character, query.related) : 'invalid-kanji';
  },
});
