import { createError, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { logger } from '~~/server/utils/logger';
import { MAX_COUNTED_WORDS, wordsOf } from '~~/server/utils/readingSentences';

// How many sentences each word has, for the reading tabs on a kanji's page (task 44): every example word of every
// reading in one batch search, SAFE and SUGGESTIVE only like the sentences the tabs show. Cached a day.

const CACHE_SECONDS = 60 * 60 * 24;

const handler = defineEventHandler(async (event) => {
  const words = wordsOf(event, MAX_COUNTED_WORDS);
  if (!words) throw createError({ statusCode: 400, statusMessage: `One to ${MAX_COUNTED_WORDS} words are required` });

  try {
    const answer = await useServerSdk(event).searchWords({
      query: { words },
      filters: { contentRating: ['SAFE', 'SUGGESTIVE'] },
    });
    const counts: Record<string, number> = {};
    for (const result of answer.results) counts[result.word] = result.matchCount;
    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return { counts };
  } catch (error: unknown) {
    logger.warn({ words, err: error }, 'Reading word counts failed');
    setResponseHeader(event, 'cache-control', 'no-store');
    throw createError({ statusCode: 503, statusMessage: 'Counts temporarily unavailable' });
  }
});

export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: CACHE_SECONDS,
  getKey: (event) => {
    const words = wordsOf(event, MAX_COUNTED_WORDS);
    return words ? stableCacheKey('word-counts', ...words) : 'invalid-words';
  },
});
