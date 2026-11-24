import { createError, getRouterParam, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { fetchKanjiCard } from '~~/server/utils/kanjiIndexList';
import { type KanjiOgCard, type KanjiOgLocale, kanjiOgRequest, renderKanjiOgImage } from '~~/server/utils/kanjiOgImage';
import { logger } from '~~/server/utils/logger';

// `/og/kanji/es/食.png`: the share image of a kanji page (task 44). Only the jōyō kanji have one (they are the
// indexed pages, and the font holds them), so there are at most 2,136 × 2 images; each is drawn once and kept a week.

const CACHE_SECONDS = 60 * 60 * 24 * 7;

const drawImage = defineCachedFunction(
  async (character: string, locale: KanjiOgLocale): Promise<string> => {
    const card = await fetchKanjiCard<KanjiOgCard>(character, locale, 'short');
    // Kept as base64: the cache stores strings.
    return Buffer.from(await renderKanjiOgImage(card)).toString('base64');
  },
  {
    name: 'kanji-og',
    maxAge: CACHE_SECONDS,
    swr: true,
    getKey: (character: string, locale: KanjiOgLocale) => stableCacheKey('kanji-og', locale, character),
  },
);

export default defineEventHandler(async (event) => {
  const input = kanjiOgRequest(getRouterParam(event, 'locale'), getRouterParam(event, 'file'));
  if (!input) throw createError({ statusCode: 404, statusMessage: 'No image for this kanji' });
  try {
    const png = Buffer.from(await drawImage(input.character, input.locale), 'base64');
    setResponseHeader(event, 'content-type', 'image/png');
    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return png;
  } catch (error: unknown) {
    logger.warn({ ...input, err: error }, 'Kanji share image failed');
    setResponseHeader(event, 'cache-control', 'no-store');
    throw createError({ statusCode: 503, statusMessage: 'Image temporarily unavailable' });
  }
});
