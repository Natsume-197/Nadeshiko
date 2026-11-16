import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DictionaryError } from '~~/server/utils/dictionary/types';

// The reader's choice of dictionary, and failing over to the other one when theirs is down.
const { logger, shirabe, nadeshiko, readerStack, readerToken } = vi.hoisted(() => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  shirabe: vi.fn(),
  nadeshiko: vi.fn(),
  readerStack: vi.fn(),
  readerToken: vi.fn(),
}));

vi.mock('~~/server/utils/logger', () => ({ logger }));
vi.mock('~~/server/utils/dictionary/shirabe', () => ({ shirabeDictionary: { name: 'shirabe', identify: shirabe } }));
vi.mock('~~/server/utils/dictionary/nadeshiko', () => ({
  nadeshikoDictionary: { name: 'nadeshiko', identify: nadeshiko },
}));
vi.mock('~~/server/utils/shirabeReader', () => ({
  readerStack: (...a: unknown[]) => readerStack(...a),
  readerToken: (...a: unknown[]) => readerToken(...a),
  reportShirabeRefusal: vi.fn(),
  reportStackFingerprint: vi.fn(),
}));

type FakeEvent = { params: Record<string, string>; query: Record<string, unknown>; headers: Record<string, string> };

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>();
  return {
    ...actual,
    getRouterParam: (event: FakeEvent, name: string) => event.params[name],
    getQuery: (event: FakeEvent) => event.query,
    setResponseHeader: (event: FakeEvent, name: string, value: string | number) => {
      event.headers[name] = String(value);
    },
  };
});

let runtime: Record<string, unknown> = {};
vi.stubGlobal('useRuntimeConfig', () => runtime);
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
let cacheOptions:
  | { getKey: (event: FakeEvent) => string; shouldBypassCache: (event: FakeEvent) => Promise<boolean> }
  | undefined;
vi.stubGlobal('defineCachedEventHandler', (handler: unknown, options: typeof cacheOptions) => {
  cacheOptions = options;
  return handler;
});

const { default: handler } = (await import('./[lemma].get')) as unknown as {
  default: (event: FakeEvent) => Promise<Record<string, unknown>>;
};

const answer = (id: string) => ({ candidates: [{ id, headword: '食べる' }] });
const event = (query: Record<string, unknown> = {}): FakeEvent => ({ params: { lemma: '食べる' }, query, headers: {} });

beforeEach(() => {
  vi.clearAllMocks();
  runtime = { shirabeApiKey: 'service-key', backendInternalUrl: 'http://backend', dictionaryProvider: 'shirabe' };
  readerStack.mockResolvedValue({ linked: false, fingerprint: null });
  readerToken.mockResolvedValue(null);
  shirabe.mockResolvedValue(answer('shirabe:1'));
  nadeshiko.mockResolvedValue(answer('jmdict:1358280'));
});

describe('which dictionary answers', () => {
  test('the site default when the reader has not chosen', async () => {
    runtime.dictionaryProvider = 'nadeshiko';

    const body = await handler(event());

    expect(body.candidates).toEqual(answer('jmdict:1358280').candidates);
    expect(shirabe).not.toHaveBeenCalled();
  });

  test('the reader’s choice over the default', async () => {
    await handler(event({ provider: 'nadeshiko' }));

    expect(nadeshiko).toHaveBeenCalled();
    expect(shirabe).not.toHaveBeenCalled();
  });

  test('an unknown choice is the default, not an error', async () => {
    await handler(event({ provider: 'jisho' }));

    expect(shirabe).toHaveBeenCalled();
  });

  test('a linked Shirabe stack is not consulted, nor its key fetched, when ours answers', async () => {
    readerStack.mockResolvedValue({ linked: true, fingerprint: 'abc' });

    await handler(event({ provider: 'nadeshiko' }));

    expect(readerToken).not.toHaveBeenCalled();
    expect(await cacheOptions!.shouldBypassCache(event({ provider: 'nadeshiko' }))).toBe(false);
    expect(await cacheOptions!.shouldBypassCache(event({ provider: 'shirabe' }))).toBe(true);
  });

  test('each provider has its own cache entry, and Shirabe keeps the key it always had', () => {
    const plain = cacheOptions!.getKey(event());

    expect(cacheOptions!.getKey(event({ provider: 'shirabe' }))).toBe(plain);
    expect(cacheOptions!.getKey(event({ provider: 'nadeshiko' }))).not.toBe(plain);
  });
});

describe('failover', () => {
  test('a Shirabe outage is answered from our dictionary, uncached', async () => {
    shirabe.mockRejectedValue(new DictionaryError('unavailable', 503, new Error('timeout')));
    const ev = event();

    const body = await handler(ev);

    expect(body.candidates).toEqual(answer('jmdict:1358280').candidates);
    expect(ev.headers['cache-control']).toBe('no-store');
    expect(ev.headers['x-dictionary-failover']).toBe('nadeshiko');
  });

  test('and an outage of ours from Shirabe', async () => {
    nadeshiko.mockRejectedValue(new DictionaryError('unavailable', undefined, new Error('ECONNREFUSED')));

    const body = await handler(event({ provider: 'nadeshiko' }));

    expect(body.candidates).toEqual(answer('shirabe:1').candidates);
  });

  test('a word the dictionary does not have is not an outage', async () => {
    shirabe.mockResolvedValue({ candidates: [] });

    await expect(handler(event())).rejects.toMatchObject({ statusCode: 404 });
    expect(nadeshiko).not.toHaveBeenCalled();
  });

  test('no failover to a provider that is not configured', async () => {
    runtime.backendInternalUrl = '';
    shirabe.mockRejectedValue(new DictionaryError('unavailable', 503, new Error('timeout')));

    await expect(handler(event())).rejects.toMatchObject({ statusCode: 503 });
    expect(nadeshiko).not.toHaveBeenCalled();
  });

  test('both down: the reader’s own dictionary’s failure stands', async () => {
    shirabe.mockRejectedValue(new DictionaryError('unavailable', 503, new Error('timeout')));
    nadeshiko.mockRejectedValue(new DictionaryError('unavailable', undefined, new Error('ECONNREFUSED')));

    await expect(handler(event())).rejects.toMatchObject({ statusCode: 503 });
  });
});
