import { describe, it, expect, vi, beforeEach } from 'vitest';

const $fetch = vi.fn();
vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useRuntimeConfig', () => ({
  backendInternalUrl: 'http://backend.internal',
  internalProxySecret: 'shh',
}));

vi.mock('~~/server/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('~~/server/utils/internalBackend', () => ({
  internalBackendUrl: (_config: unknown, path: string) => `http://backend.internal${path}`,
  buildInternalBackendHeaders: (_config: unknown, headers: Record<string, string>) => headers,
}));

const { customDictionaryStack, readerCookie } = await import('./dictionaryReader');
const { _resetSsrAuthCacheForTests } = await import('./ssrAuthCache');

function fakeEvent(cookieHeader?: string) {
  return {
    context: {} as Record<string, unknown>,
    node: { req: { socket: { remoteAddress: '1.2.3.4' }, headers: { cookie: cookieHeader } } },
    headers: { cookie: cookieHeader },
  } as never;
}

const SIGNED_IN = 'nadeshiko.session_token=tok1';

describe('customDictionaryStack', () => {
  beforeEach(() => {
    $fetch.mockReset();
    _resetSsrAuthCacheForTests();
  });

  it('answers for a reader with no session without asking the backend', async () => {
    expect(await customDictionaryStack(fakeEvent())).toEqual({ hasStack: false, fingerprint: null });
    expect($fetch).not.toHaveBeenCalled();
  });

  it('reads the custom dictionary stack off the session', async () => {
    $fetch.mockResolvedValue({ user: { customDictionaries: { count: 2, stackFingerprint: 'fp-1' } } });

    expect(await customDictionaryStack(fakeEvent(SIGNED_IN))).toEqual({ hasStack: true, fingerprint: 'fp-1' });
    expect($fetch).toHaveBeenCalledWith(expect.stringContaining('disableRefresh=true'), expect.anything());
  });

  it('treats a signed-in reader with no custom dictionaries as having no stack', async () => {
    $fetch.mockResolvedValue({ user: { id: 1, customDictionaries: null } });

    expect(await customDictionaryStack(fakeEvent(SIGNED_IN))).toEqual({ hasStack: false, fingerprint: null });
  });

  it('falls back to built-in JMdict when the session cannot be read', async () => {
    $fetch.mockRejectedValue(new Error('backend is down'));

    expect(await customDictionaryStack(fakeEvent(SIGNED_IN))).toEqual({ hasStack: false, fingerprint: null });
  });

  it('resolves once per request', async () => {
    $fetch.mockResolvedValue({ user: { customDictionaries: { count: 1, stackFingerprint: 'fp-1' } } });
    const event = fakeEvent(SIGNED_IN);

    await customDictionaryStack(event);
    await customDictionaryStack(event);

    expect($fetch).toHaveBeenCalledTimes(1);
  });

  it('stashes the cookie on event.context so a cached handler keeps access after headers are stripped', async () => {
    const event = fakeEvent(SIGNED_IN) as unknown as { context: Record<string, unknown> };
    $fetch.mockResolvedValue({ user: { customDictionaries: { count: 1, stackFingerprint: 'fp-1' } } });

    await customDictionaryStack(event as never);

    const stripped = { context: event.context, node: { req: { headers: {} } }, headers: {} } as never;
    expect(readerCookie(stripped)).toBe(SIGNED_IN);
  });
});
