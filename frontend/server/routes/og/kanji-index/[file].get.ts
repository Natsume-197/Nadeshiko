import { createError, getRouterParam, setResponseHeader } from 'h3';
import { stableCacheKey } from '~~/server/utils/cacheKey';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { type KanjiIndexEntry, kanjiIndexGroups } from '~~/server/utils/kanjiIndex';
import { kanjiIndexOgRequest, kanjiIndexOgTree, renderOgTree } from '~~/server/utils/kanjiOgImage';
import { logger } from '~~/server/utils/logger';

// `/og/kanji-index/jlpt-n3.png`: the share image of a kanji index group (task 44). Thirteen images in all, drawn once
// and kept a week.

const CACHE_SECONDS = 60 * 60 * 24 * 7;
const TIMEOUT_MS = 5000;

const drawImage = defineCachedFunction(
  async (by: 'jlpt' | 'grade', level: string): Promise<string | null> => {
    const config = useRuntimeConfig();
    const answer = await $fetch<{ kanji: KanjiIndexEntry[] }>(internalBackendUrl(config, '/v1/dictionary/kanji'), {
      query: { locale: 'en' },
      headers: buildInternalBackendHeaders(config),
      timeout: TIMEOUT_MS,
    });
    const group = kanjiIndexGroups(answer.kanji, by).find((candidate) => candidate.id === level);
    if (!group) return null;
    const png = await renderOgTree(kanjiIndexOgTree({ id: group.id, kanji: group.kanji.map((k) => k.character) }));
    // Kept as base64: the cache stores strings.
    return Buffer.from(png).toString('base64');
  },
  {
    name: 'kanji-index-og',
    maxAge: CACHE_SECONDS,
    swr: true,
    getKey: (by: string, level: string) => stableCacheKey('kanji-index-og', by, level),
  },
);

export default defineEventHandler(async (event) => {
  const input = kanjiIndexOgRequest(getRouterParam(event, 'file'));
  if (!input) throw createError({ statusCode: 404, statusMessage: 'No image for this group' });
  let image: string | null;
  try {
    image = await drawImage(input.by, input.level);
  } catch (error: unknown) {
    logger.warn({ ...input, err: error }, 'Kanji index share image failed');
    setResponseHeader(event, 'cache-control', 'no-store');
    throw createError({ statusCode: 503, statusMessage: 'Image temporarily unavailable' });
  }
  if (!image) throw createError({ statusCode: 404, statusMessage: 'No image for this group' });
  setResponseHeader(event, 'content-type', 'image/png');
  setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
  return Buffer.from(image, 'base64');
});
