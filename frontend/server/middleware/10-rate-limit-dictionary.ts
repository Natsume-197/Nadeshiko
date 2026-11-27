import { getRequestHeader, getRequestURL } from 'h3';
import { dictionaryLookupLimit, enforceIpRateLimit } from '~~/server/utils/v1ProxyPolicy';

// Word-card and kanji-card lookups (`/api/dictionary/`) share one per-IP ceiling.
// Count cache hits too: the cache key covers every hint, and varying hints is how a flood would miss it.
// Skip internal Nitro SSR sub-requests (no TCP peer or forwarded client IP): the outer page already passed
// the HTML rate limiter and SSR admission gate, and counting them would collapse all SSR traffic into one
// shared `unknown` bucket.
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname.toLowerCase();
  if (!path.startsWith('/api/dictionary/')) return;
  const hasExternalClient = Boolean(
    event.node?.req?.socket?.remoteAddress ||
      getRequestHeader(event, 'cf-connecting-ip') ||
      getRequestHeader(event, 'x-forwarded-for'),
  );
  if (!hasExternalClient) return;
  await enforceIpRateLimit(event, dictionaryLookupLimit);
});
