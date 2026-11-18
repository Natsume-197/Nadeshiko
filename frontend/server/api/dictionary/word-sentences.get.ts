import { createError, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { logger } from '~~/server/utils/logger';
import { interleave, type SearchAnswer, SENTENCES, PER_WORD, wordsOf } from '~~/server/utils/readingSentences';

// Sentences for one reading of a kanji, on the kanji's page (task 44): the reading's example words (食事, 給食, 夕食
// for 食 read ショク), each searched as a word so every sentence uses that reading, then interleaved one word at a
// time so no single word fills the list. Same rules as the page's other sentences: SAFE and SUGGESTIVE only, cached
// a day, an outage never cached.

const CACHE_SECONDS = 60 * 60 * 24;
const RETRY_AFTER_SECONDS = 5;
const handler = defineEventHandler(async (event) => {
  const words = wordsOf(event);
  if (!words) throw createError({ statusCode: 400, statusMessage: 'One to three words are required' });

  const sdk = useServerSdk(event);
  try {
    const answers = (await Promise.all(
      words.map((word) =>
        sdk.search({
          query: { search: word },
          take: PER_WORD,
          filters: { contentRating: ['SAFE', 'SUGGESTIVE'] },
          include: ['media'],
        }),
      ),
    )) as unknown as SearchAnswer[];
    const merged = interleave(answers, SENTENCES);
    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return {
      ...merged,
      pagination: {
        hasMore: false,
        cursor: '',
        estimatedTotalHits: merged.segments.length,
        estimatedTotalHitsRelation: 'EXACT',
      },
    };
  } catch (error: unknown) {
    logger.warn({ words, err: error }, 'Reading sentences lookup failed');
    setResponseHeader(event, 'cache-control', 'no-store');
    setResponseHeader(event, 'retry-after', RETRY_AFTER_SECONDS);
    throw createError({ statusCode: 503, statusMessage: 'Sentences temporarily unavailable' });
  }
});

export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: CACHE_SECONDS,
  getKey: (event) => {
    const words = wordsOf(event);
    return words ? stableCacheKey('word-sentences', ...words) : 'invalid-words';
  },
});
