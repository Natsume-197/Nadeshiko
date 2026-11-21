import { createError, getQuery, getRouterParam, type H3Event, setResponseHeader } from 'h3';
import { brief, isWordQuery, pickEntries } from '#shared/utils/wordEntry';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { DictionaryError } from '~~/server/utils/dictionary';
import { nadeshikoDictionary } from '~~/server/utils/dictionary/nadeshiko';
import { kanjiBriefs } from '~~/server/utils/kanjiBriefs';
import { logger } from '~~/server/utils/logger';
import { DICTIONARY_CACHE_SECONDS, dictionaryUnavailable } from '~~/server/utils/dictionaryRoute';

// The dictionary entry above a word search (`/search/食べる`), from Nadeshiko's own dictionary whatever card provider
// the reader picked: it is the page's own content, server-rendered for every reader and for search engines alike.
// `{ entry: null }` when the query is not a dictionary word, so that answer is cached too. With it: `others`, the
// other words the query can be (はし: 箸, 端), `inflected` when the query is a conjugated form of the entry, and `kanji`,
// each kanji's first reading and meaning. Same for every reader:
// cached a day here and in the browser, like the kanji card.

type Locale = 'en' | 'es';

function input(event: H3Event): { word: string; locale: Locale } | null {
  const word = getRouterParam(event, 'word')?.trim();
  if (!word || !isWordQuery(word)) return null;
  const locale: Locale = getQuery(event).locale === 'es' ? 'es' : 'en';
  return { word, locale };
}

const handler = defineEventHandler(async (event) => {
  const query = input(event);
  if (!query) throw createError({ statusCode: 400, statusMessage: 'One Japanese word is required' });

  try {
    const { candidates } = await nadeshikoDictionary.identify({ lemma: query.word, locale: query.locale });
    setResponseHeader(event, 'cache-control', `public, max-age=${DICTIONARY_CACHE_SECONDS}`);
    const { entry, others, inflected } = pickEntries(candidates, query.word);
    // Each kanji's reading and meaning, for the entry's kanji rows, for every word the box can show.
    const kanji = await kanjiBriefs([entry, ...others].flatMap((word) => (word ? [word.headword] : [])));
    // The other words carry their whole entry too: the box switches between them in place (はし: 端, 橋, 箸).
    return {
      entry,
      inflected,
      others: others.map((other) => ({ ...brief(other), entry: other })),
      kanji,
    };
  } catch (error: unknown) {
    const status = error instanceof DictionaryError ? error.status : undefined;
    logger.warn({ word: query.word, status, err: error }, 'Word entry lookup failed');
    // An outage is not an answer: never cache it.
    throw dictionaryUnavailable(event, 'Dictionary temporarily unavailable');
  }
});

export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: DICTIONARY_CACHE_SECONDS,
  getKey: (event) => {
    const query = input(event);
    return query ? stableCacheKey('word-entry-v4', query.locale, query.word) : 'invalid-word';
  },
});
