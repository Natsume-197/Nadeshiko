import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DictionaryError } from '~~/server/utils/dictionary/types';

// Guard homograph hints, private custom-dictionary caching, pending answers, name filtering, and error statuses.
const { logger, identify, customDictionaryStack, readerCookie } = vi.hoisted(() => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  identify: vi.fn(),
  customDictionaryStack: vi.fn(),
  readerCookie: vi.fn(),
}));

vi.mock('~~/server/utils/logger', () => ({ logger }));
vi.mock('~~/server/utils/dictionary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~~/server/utils/dictionary')>()),
  nadeshikoDictionary: { name: 'nadeshiko', identify: (...a: unknown[]) => identify(...a) },
}));
vi.mock('~~/server/utils/dictionaryReader', () => ({
  customDictionaryStack: (...a: unknown[]) => customDictionaryStack(...a),
  readerCookie: (...a: unknown[]) => readerCookie(...a),
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

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
let cacheOptions:
  | { getKey: (event: FakeEvent) => string; shouldBypassCache: (event: FakeEvent) => Promise<boolean> }
  | undefined;
vi.stubGlobal('defineCachedEventHandler', (handler: unknown, options: typeof cacheOptions) => {
  cacheOptions = options;
  return handler;
});

const candidate = (over: Record<string, unknown> = {}) => ({
  id: 'jmdict:1',
  headword: '兄',
  reading: 'あに',
  ...over,
});

let handler: (event: FakeEvent) => Promise<Record<string, unknown>>;
let lastEvent: FakeEvent | undefined;

async function lookup(lemma: string | undefined, query: Record<string, unknown> = {}) {
  handler ??= ((await import('./[lemma].get')) as unknown as { default: typeof handler }).default;
  const event: FakeEvent = { params: lemma === undefined ? {} : { lemma }, query, headers: {} };
  lastEvent = event;
  const body = await handler(event);
  return { body, headers: event.headers };
}

beforeEach(() => {
  vi.clearAllMocks();
  lastEvent = undefined;
  customDictionaryStack.mockResolvedValue({ hasStack: false, fingerprint: null });
  readerCookie.mockReturnValue('');
  identify.mockResolvedValue({ candidates: [candidate()] });
});

describe('the question it asks', () => {
  test('refuses a request with no word in it', async () => {
    await expect(lookup(undefined)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('sends the lemma and hints to the dictionary', async () => {
    await lookup('開く', { surface: '開いた', reading: 'ヒライタ', pos: 'verb', locale: 'es' });

    expect(identify).toHaveBeenCalledWith(
      { lemma: '開く', surface: '開いた', reading: 'ヒライタ', pos: 'verb', locale: 'es' },
      {},
    );
  });

  test('drops empty hints rather than forwarding them', async () => {
    await lookup('兄', { surface: '', reading: '   ', pos: '' });

    expect(identify).toHaveBeenCalledWith({ lemma: '兄', locale: 'en' }, {});
  });

  test.each([['fr'], ['ja'], ['../en'], ['']])('clamps an unshipped locale like %s to English', async (locale) => {
    await lookup('兄', { locale });

    expect(identify).toHaveBeenCalledWith({ lemma: '兄', locale: 'en' }, {});
  });
});

describe('custom dictionaries and caching', () => {
  test('default lookups get public cache headers and omit stackFingerprint', async () => {
    identify.mockResolvedValue({ candidates: [candidate()], stackFingerprint: 'ignored' });

    const { body, headers } = await lookup('兄');

    expect(headers['cache-control']).toBe('public, max-age=86400');
    expect(body).not.toHaveProperty('stackFingerprint');
    expect(await cacheOptions!.shouldBypassCache({ params: { lemma: '兄' }, query: {}, headers: {} })).toBe(false);
  });

  test('custom Nadeshiko dictionaries bypass shared cache, forward the session cookie, and set private caching', async () => {
    customDictionaryStack.mockResolvedValue({ hasStack: true, fingerprint: 'custom-fp-1' });
    readerCookie.mockReturnValue('nadeshiko.session_token=abc');
    identify.mockResolvedValue({ candidates: [candidate()], stackFingerprint: 'custom-fp-1' });

    const reqEvent: FakeEvent = { params: { lemma: '食べる' }, query: {}, headers: {} };
    handler ??= ((await import('./[lemma].get')) as unknown as { default: typeof handler }).default;
    expect(await cacheOptions!.shouldBypassCache(reqEvent)).toBe(true);

    const body = await handler(reqEvent);
    expect(identify).toHaveBeenCalledWith(expect.objectContaining({ lemma: '食べる' }), {
      readerCookie: 'nadeshiko.session_token=abc',
    });
    expect(reqEvent.headers['cache-control']).toBe('private, max-age=86400');
    expect(body.stackFingerprint).toBe('custom-fp-1');
  });

  test('an answer still missing one of the reader’s dictionaries is cached nowhere', async () => {
    customDictionaryStack.mockResolvedValue({ hasStack: true, fingerprint: 'custom-fp-1' });
    readerCookie.mockReturnValue('nadeshiko.session_token=abc');
    identify.mockResolvedValue({ candidates: [candidate()], stackFingerprint: 'custom-fp-1', pending: true });

    const { body, headers } = await lookup('食べる');

    expect(headers['cache-control']).toBe('no-store');
    expect(body.pending).toBe(true);
  });

  test('a pending answer with no entry is an empty answer, not a 404 the browser would keep', async () => {
    customDictionaryStack.mockResolvedValue({ hasStack: true, fingerprint: 'custom-fp-1' });
    readerCookie.mockReturnValue('nadeshiko.session_token=abc');
    identify.mockResolvedValue({ candidates: [], stackFingerprint: 'custom-fp-1', pending: true });

    const { body, headers } = await lookup('食べる');

    expect(body).toMatchObject({ candidates: [], pending: true });
    expect(headers['cache-control']).toBe('no-store');
  });
});

describe('a token with no entry', () => {
  test('an empty candidate list answers 404 without logging an error', async () => {
    identify.mockResolvedValue({ candidates: [] });

    await expect(lookup('ドラミちゃん')).rejects.toMatchObject({ statusCode: 404 });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('names', () => {
  const person = (id: string, headword: string, gloss = headword) =>
    candidate({
      id,
      headword,
      name: true,
      entries: [{ senses: [{ definitions: [{ lang: 'en', text: gloss }] }] }],
    });

  test('are dropped while there is a real word to show', async () => {
    identify.mockResolvedValue({ candidates: [candidate({ id: 'w', headword: '一' }), person('n1', '一', 'Hajime')] });

    const { body } = await lookup('一');

    expect(body.candidates).toHaveLength(1);
    expect((body.candidates as { id: string }[])[0]!.id).toBe('w');
  });

  test('many distinct names are flagged nameOnly', async () => {
    identify.mockResolvedValue({
      candidates: [person('n1', '明日香', 'Asuka'), person('n2', '飛鳥', 'Asuka (place)')],
    });

    const { body } = await lookup('明日香');

    expect(body.candidates).toHaveLength(2);
    expect(body.nameOnly).toBe(true);
  });

  test('a single name or identical glosses are not flagged nameOnly', async () => {
    const gloss = 'Doraemon (manga by Fujiko F. Fujio; media franchise)';
    identify.mockResolvedValue({
      candidates: [person('n1', 'ドラえもん', gloss), person('n2', 'ドラエモン', gloss)],
    });

    const { body } = await lookup('ドラえもん');

    expect(body.nameOnly).toBe(false);
  });
});

describe('when the dictionary fails', () => {
  test('a misconfigured backend call answers 502 and logs an error', async () => {
    identify.mockRejectedValue(new DictionaryError('misconfigured', 403, new Error('Forbidden')));

    await expect(lookup('兄')).rejects.toMatchObject({ statusCode: 502 });
    expect(logger.error).toHaveBeenCalled();
  });

  test('an unavailable backend answers retryable uncached 503', async () => {
    identify.mockRejectedValue(new DictionaryError('unavailable', 503, new Error('timeout')));

    await expect(lookup('兄')).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Dictionary temporarily unavailable',
    });
    expect(lastEvent?.headers).toMatchObject({
      'cache-control': 'no-store',
      'retry-after': '5',
    });
  });
});

describe('the shared cache key', () => {
  async function keyFor(lemma: string, query: Record<string, unknown>) {
    handler ??= ((await import('./[lemma].get')) as unknown as { default: typeof handler }).default;
    return cacheOptions!.getKey({ params: { lemma }, query, headers: {} });
  }

  test('ignores query parameters the lookup never reads', async () => {
    const plain = await keyFor('兄', { locale: 'en', reading: 'あに' });

    expect(await keyFor('兄', { locale: 'en', reading: 'あに', junk: '1', stack: 'abc' })).toBe(plain);
    expect(await keyFor('兄', { locale: 'xx', reading: 'あに ' })).toBe(plain);
  });

  test('separates every input that changes the answer', async () => {
    const base = await keyFor('兄', { locale: 'en' });

    expect(await keyFor('姉', { locale: 'en' })).not.toBe(base);
    expect(await keyFor('兄', { locale: 'es' })).not.toBe(base);
    expect(await keyFor('兄', { locale: 'en', reading: 'けい' })).not.toBe(base);
    expect(await keyFor('兄', { locale: 'en', pos: 'n' })).not.toBe(base);
    expect(await keyFor('兄', { locale: 'en', surface: '兄さん' })).not.toBe(base);
  });
});
