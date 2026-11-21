import { getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { hasSessionCookie, ssrAuthFetch } from '~~/server/utils/ssrAuthCache';
import { logger } from '~~/server/utils/logger';

// Resolve custom-dictionary stack status before choosing the cache, and stash the session cookie so the cached
// handler can forward it on cache misses.

// Share one session read between cache decision and handler per request.
const CUSTOM_DICT_CONTEXT_KEY = 'nadeshikoCustomDictStack';

// Nitro cached handlers copy context, not request headers. Stash the cookie during shouldBypassCache
// so lookups inside the handler can authenticate the reader.
const COOKIE_KEY = 'dictionaryReaderCookie';

function stashCookie(event: H3Event): string {
  const cookie = getRequestHeader(event, 'cookie') || '';
  if (cookie) event.context[COOKIE_KEY] = cookie;
  return cookie;
}

export function readerCookie(event: H3Event): string {
  return (event.context[COOKIE_KEY] as string | undefined) || getRequestHeader(event, 'cookie') || '';
}

interface SessionResponse {
  user?: {
    customDictionaries?: { count?: number; stackFingerprint?: string | null } | null;
  } | null;
}

export interface CustomDictionaryStack {
  hasStack: boolean;
  fingerprint: string | null;
}

const NO_CUSTOM_STACK: CustomDictionaryStack = { hasStack: false, fingerprint: null };

async function fetchReaderSession(event: H3Event): Promise<SessionResponse | null> {
  const cookie = stashCookie(event);

  if (!hasSessionCookie(event)) return null;

  const config = useRuntimeConfig();
  // Use a separate scope from identity-auth: raw get-session and identity bundles have different shapes.
  return await ssrAuthFetch(
    event,
    () =>
      // Disable session refresh here: a shared-cacheable lookup cannot safely forward renewed session cookies.
      // Leave renewal to identity-auth on personal HTML.
      $fetch<SessionResponse>(internalBackendUrl(config, '/v1/auth/get-session?disableRefresh=true'), {
        headers: buildInternalBackendHeaders(config, { cookie }, event),
        timeout: 2000,
      }),
    'dictionary',
  );
}

// Resolve stack status server-side, never from client claims: it controls shared-cache eligibility.
// Backend failures degrade to built-in JMdict rather than break word cards.
export async function customDictionaryStack(event: H3Event): Promise<CustomDictionaryStack> {
  const cached = event.context[CUSTOM_DICT_CONTEXT_KEY] as CustomDictionaryStack | undefined;
  if (cached !== undefined) return cached;

  try {
    const session = await fetchReaderSession(event);
    const custom = session?.user?.customDictionaries;
    const resolved: CustomDictionaryStack = custom?.stackFingerprint
      ? { hasStack: true, fingerprint: custom.stackFingerprint }
      : NO_CUSTOM_STACK;
    event.context[CUSTOM_DICT_CONTEXT_KEY] = resolved;
    return resolved;
  } catch (error) {
    logger.warn({ err: error }, 'Could not resolve custom dictionary stack; answering with built-in JMdict');
    event.context[CUSTOM_DICT_CONTEXT_KEY] = NO_CUSTOM_STACK;
    return NO_CUSTOM_STACK;
  }
}
