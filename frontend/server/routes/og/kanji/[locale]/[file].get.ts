import { createError, getRouterParam, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { type KanjiOgCard, type KanjiOgLocale, kanjiOgRequest, renderKanjiOgImage } from '~~/server/utils/kanjiOgImage';
import { logger } from '~~/server/utils/logger';

// `/og/kanji/es/食.png`: the share image of a kanji page (task 44). Only the jōyō kanji have one (they are the
// indexed pages, and the font holds them), so there are at most 2,136 × 2 images; each is drawn once and kept a week.

const CACHE_SECONDS = 60 * 60 * 24 * 7;
const TIMEOUT_MS = 3000;

const drawImage = defineCachedFunction(
  async (character: string, locale: KanjiOgLocale): Promise<string> => {
    const config = useRuntimeConfig();
    const card = await $fetch<KanjiOgCard>(
      internalBackendUrl(config, `/v1/dictionary/kanji/${encodeURIComponent(character)}`),
      { query: { locale, related: 'short' }, headers: buildInternalBackendHeaders(config), timeout: TIMEOUT_MS },
    );
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
