import { createError, getQuery, type H3Event, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { logger } from '~~/server/utils/logger';
import { kanjiIndexGroups, type KanjiIndexGrouping } from '~~/server/utils/kanjiIndex';
import { fetchKanjiIndexList } from '~~/server/utils/kanjiIndexList';
import {
  DICTIONARY_CACHE_SECONDS,
  type DictionaryLocale,
  dictionaryLocale,
  dictionaryUnavailable,
} from '~~/server/utils/dictionaryRoute';

// The kanji index page (task 44): one group of kanji at a time (JLPT N5, or school grade 1, …) with how many each
// group holds, so the page carries the group it shows and not all 2,383 kanji. Cached a day; the list only changes
// with a dictionary import.

function input(event: H3Event): { locale: DictionaryLocale; by: KanjiIndexGrouping; level: string | null } {
  const params = getQuery(event);
  return {
    locale: dictionaryLocale(params.locale),
    by: params.by === 'grade' ? 'grade' : 'jlpt',
    level: typeof params.level === 'string' && params.level ? params.level : null,
  };
}

const handler = defineEventHandler(async (event) => {
  const { locale, by, level } = input(event);
  try {
    const groups = kanjiIndexGroups(await fetchKanjiIndexList(locale), by);
    const selected = groups.find((group) => group.id === level) ?? groups[0];
    if (!selected) throw createError({ statusCode: 404, statusMessage: 'No kanji' });
    setResponseHeader(event, 'cache-control', `public, max-age=${DICTIONARY_CACHE_SECONDS}`);
    return {
      by,
      level: selected.id,
      groups: groups.map((group) => ({ id: group.id, count: group.kanji.length })),
      kanji: selected.kanji,
    };
  } catch (error: unknown) {
    if ((error as { statusCode?: number })?.statusCode === 404) throw error;
    logger.warn({ by, level, err: error }, 'Kanji index lookup failed');
    throw dictionaryUnavailable(event, 'Dictionary temporarily unavailable');
  }
});

export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: DICTIONARY_CACHE_SECONDS,
  getKey: (event) => {
    const { locale, by, level } = input(event);
    return stableCacheKey('kanji-index', locale, by, level ?? '');
  },
});
