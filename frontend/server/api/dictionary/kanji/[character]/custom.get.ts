import { createError, getRouterParam, setResponseHeader } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { customDictionaryStack, readerCookie } from '~~/server/utils/dictionaryReader';
import { DICTIONARY_CACHE_SECONDS, dictionaryUnavailable } from '~~/server/utils/dictionaryRoute';
import { logger } from '~~/server/utils/logger';

// The reader's own part of the kanji card (task 48): entries and frequencies from their uploaded kanji dictionaries.
// Kept apart from `../[character].get.ts` so the shared card stays cached for everyone; this one is per reader and is
// never cached here, only privately in the browser.

const TIMEOUT_MS = 3000;

export interface CustomKanjiAnswer {
  entries: unknown[];
  frequencies: unknown[];
  stackFingerprint?: string | null;
  customDictionariesPending?: boolean;
}

const EMPTY = { entries: [], frequencies: [] };

export default defineEventHandler(async (event) => {
  const character = getRouterParam(event, 'character');
  // One character: a kanji outside the BMP is two UTF-16 units, so count code points.
  if (!character || [...character].length !== 1) {
    throw createError({ statusCode: 400, statusMessage: 'One kanji is required' });
  }

  const custom = await customDictionaryStack(event);
  const cookie = custom.hasStack ? readerCookie(event) : '';
  if (!cookie) {
    setResponseHeader(event, 'cache-control', 'private, no-store');
    return EMPTY;
  }

  try {
    const config = useRuntimeConfig();
    const answer = await $fetch<CustomKanjiAnswer>(
      internalBackendUrl(config, `/v1/dictionary/kanji/${encodeURIComponent(character)}/custom`),
      { headers: buildInternalBackendHeaders(config, { cookie }), timeout: TIMEOUT_MS },
    );
    const pending = Boolean(answer.customDictionariesPending);
    setResponseHeader(event, 'cache-control', pending ? 'no-store' : `private, max-age=${DICTIONARY_CACHE_SECONDS}`);
    return {
      entries: answer.entries ?? [],
      frequencies: answer.frequencies ?? [],
      ...(answer.stackFingerprint ? { stackFingerprint: answer.stackFingerprint } : {}),
      ...(pending ? { pending: true } : {}),
    };
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    logger.warn({ character, status, err: error }, 'Custom kanji lookup failed');
    throw dictionaryUnavailable(event, 'Dictionary temporarily unavailable');
  }
});
