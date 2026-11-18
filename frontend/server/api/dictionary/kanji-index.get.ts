import { createError, getQuery, type H3Event, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { logger } from '~~/server/utils/logger';
import { type KanjiIndexEntry, kanjiIndexGroups, type KanjiIndexGrouping } from '~~/server/utils/kanjiIndex';

// The kanji index page (task 44): one group of kanji at a time (JLPT N5, or school grade 1, …) with how many each
// group holds, so the page carries the group it shows and not all 2,383 kanji. Cached a day; the list only changes
// with a dictionary import.

const CACHE_SECONDS = 60 * 60 * 24;
const TIMEOUT_MS = 5000;

type Locale = 'en' | 'es';

function input(event: H3Event): { locale: Locale; by: KanjiIndexGrouping; level: string | null } {
  const params = getQuery(event);
  return {
    locale: params.locale === 'es' ? 'es' : 'en',
    by: params.by === 'grade' ? 'grade' : 'jlpt',
    level: typeof params.level === 'string' && params.level ? params.level : null,
  };
}

const handler = defineEventHandler(async (event) => {
  const { locale, by, level } = input(event);
  const config = useRuntimeConfig();
  try {
    const answer = await $fetch<{ kanji: KanjiIndexEntry[] }>(internalBackendUrl(config, '/v1/dictionary/kanji'), {
      query: { locale },
      headers: buildInternalBackendHeaders(config),
      timeout: TIMEOUT_MS,
    });
    const groups = kanjiIndexGroups(answer.kanji, by);
    const selected = groups.find((group) => group.id === level) ?? groups[0];
    if (!selected) throw createError({ statusCode: 404, statusMessage: 'No kanji' });
    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return {
      by,
      level: selected.id,
      groups: groups.map((group) => ({ id: group.id, count: group.kanji.length })),
      kanji: selected.kanji,
    };
  } catch (error: unknown) {
    if ((error as { statusCode?: number })?.statusCode === 404) throw error;
    logger.warn({ by, level, err: error }, 'Kanji index lookup failed');
    setResponseHeader(event, 'cache-control', 'no-store');
    throw createError({ statusCode: 503, statusMessage: 'Dictionary temporarily unavailable' });
  }
});

export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: CACHE_SECONDS,
  getKey: (event) => {
    const { locale, by, level } = input(event);
    return stableCacheKey('kanji-index', locale, by, level ?? '');
  },
});
