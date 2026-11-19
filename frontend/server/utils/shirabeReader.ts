import { getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { SESSION_COOKIE, hasSessionCookie, ssrAuthFetch } from '~~/server/utils/ssrAuthCache';
import { logger } from '~~/server/utils/logger';

// Resolve linked-stack status before choosing the cache; fetch the secret token separately only on a cache miss.

// Share one session read between cache decision and handler per request.
const CONTEXT_KEY = 'shirabeReaderStack';
const CUSTOM_DICT_CONTEXT_KEY = 'nadeshikoCustomDictStack';

// Nitro cached handlers copy context, not request headers. Stash the cookie during shouldBypassCache
// so credential/report/lookup calls inside the handler can authenticate the reader.
const COOKIE_KEY = 'shirabeReaderCookie';

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
    shirabe?: { linked?: boolean; stackFingerprint?: string | null } | null;
    customDictionaries?: { count?: number; stackFingerprint?: string | null } | null;
  } | null;
}

export interface ReaderStack {
  linked: boolean;
  // Compare the stored fingerprint with lookup responses to notice dictionary reconfiguration.
  fingerprint: string | null;
}

export interface CustomDictionaryStack {
  hasStack: boolean;
  fingerprint: string | null;
}

const UNLINKED: ReaderStack = { linked: false, fingerprint: null };
const NO_CUSTOM_STACK: CustomDictionaryStack = { hasStack: false, fingerprint: null };

async function fetchReaderSession(event: H3Event): Promise<SessionResponse | null> {
  stashCookie(event);

  if (!hasSessionCookie(event)) return null;

  const config = useRuntimeConfig();
  // Use a separate scope from identity-auth: raw get-session and identity bundles have different shapes.
  return await ssrAuthFetch(
    event,
    () =>
      // Disable session refresh here: a shared-cacheable lookup cannot safely forward renewed session cookies.
      // Leave renewal to identity-auth on personal HTML.
      $fetch<SessionResponse>(internalBackendUrl(config, '/v1/auth/get-session?disableRefresh=true'), {
        headers: buildInternalBackendHeaders(config, { cookie: getRequestHeader(event, 'cookie') || '' }, event),
        timeout: 2000,
      }),
    'shirabe',
  );
}

// Resolve stack status server-side, never from client claims: it controls shared-cache eligibility.
// Backend failures degrade to default dictionaries rather than break word cards.
export async function readerStack(event: H3Event): Promise<ReaderStack> {
  const cached = event.context[CONTEXT_KEY] as ReaderStack | undefined;
  if (cached !== undefined) return cached;

  const resolved = await resolveStack(event);
  event.context[CONTEXT_KEY] = resolved;
  return resolved;
}

export async function readerHasOwnStack(event: H3Event): Promise<boolean> {
  return (await readerStack(event)).linked;
}

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

async function resolveStack(event: H3Event): Promise<ReaderStack> {
  try {
    const session = await fetchReaderSession(event);
    const shirabe = session?.user?.shirabe;
    if (!shirabe?.linked) return UNLINKED;

    return { linked: true, fingerprint: shirabe.stackFingerprint ?? null };
  } catch (error) {
    logger.warn({ err: error }, 'Could not resolve the reader Shirabe stack; answering with the default dictionaries');
    return UNLINKED;
  }
}

// Report asynchronously: this lookup already has fresh data; the next uses the updated session fingerprint.
export async function reportStackFingerprint(event: H3Event, fingerprint: string): Promise<void> {
  try {
    const config = useRuntimeConfig();
    await $fetch(internalBackendUrl(config, '/v1/user/connections/shirabe/resync'), {
      method: 'POST',

      headers: buildInternalBackendHeaders(config, { cookie: readerCookie(event) }, event),
      body: { stackFingerprint: fingerprint },
      timeout: 2000,
    });
  } catch (error) {
    logger.warn({ err: error }, 'Could not report a Shirabe stack fingerprint');
  }
}

// Report refusals asynchronously; the backend owns link state and interprets 401/403. Reporting failures
// must not turn a recovered lookup into an error.
export async function reportShirabeRefusal(event: H3Event, status: number): Promise<void> {
  try {
    const config = useRuntimeConfig();
    await $fetch(internalBackendUrl(config, '/v1/user/connections/shirabe/refused'), {
      method: 'POST',
      headers: buildInternalBackendHeaders(config, { cookie: readerCookie(event) }, event),
      body: { status },
      timeout: 2000,
    });
  } catch (error) {
    logger.warn({ err: error }, 'Could not report a refused Shirabe key');
  }
}

// Fetch credentials only on a miss, through the server-only backend route. Never return the token to the browser.
export async function readerToken(event: H3Event): Promise<string | null> {
  const cookie = readerCookie(event);
  if (!cookie.includes(SESSION_COOKIE)) return null;

  try {
    const config = useRuntimeConfig();
    const credential = await $fetch<{ token?: string }>(
      internalBackendUrl(config, '/v1/user/connections/shirabe/credential'),
      {
        headers: buildInternalBackendHeaders(config, { cookie }, event),
        timeout: 2000,
      },
    );

    return credential?.token ?? null;
  } catch (error) {
    // Missing/revoked credentials and backend failures all fall back to service dictionaries.
    logger.warn({ err: error }, 'No Shirabe credential for this reader; falling back to the service key');
    return null;
  }
}
