import { getRequestURL } from 'h3';
import { dictionaryLookupLimit, enforceIpRateLimit } from '~~/server/utils/v1ProxyPolicy';

// Word-card and kanji-card lookups (`/api/dictionary/`) share one per-IP ceiling.
// Count cache hits too: the cache key covers every hint, and varying hints is how a flood would miss it.
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname.toLowerCase();
  if (!path.startsWith('/api/dictionary/')) return;
  await enforceIpRateLimit(event, dictionaryLookupLimit);
});
