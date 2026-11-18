import { getRequestURL } from 'h3';
import { enforceIpRateLimit, shirabeLookupLimit } from '~~/server/utils/v1ProxyPolicy';

// Word-card lookups are proxied through the frontend's own Shirabe key, so this is their only per-IP ceiling.
// Count cache hits too: the cache key covers every hint, and varying hints is how a flood would miss it. The kanji
// view's lookups (`/api/dictionary/`, task 44) share the ceiling: they come from the same card.
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname.toLowerCase();
  if (!path.startsWith('/api/shirabe/') && !path.startsWith('/api/dictionary/')) return;
  await enforceIpRateLimit(event, shirabeLookupLimit);
});
