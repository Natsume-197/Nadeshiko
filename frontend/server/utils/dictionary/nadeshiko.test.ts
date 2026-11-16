import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DictionaryError } from '~~/server/utils/dictionary/types';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);
vi.stubGlobal('useRuntimeConfig', () => ({
  backendInternalUrl: 'http://backend:5000',
  internalProxySecret: 'secret',
}));

const { nadeshikoDictionary } = await import('~~/server/utils/dictionary/nadeshiko');

beforeEach(() => {
  fetchMock.mockReset();
});

describe('nadeshikoDictionary', () => {
  test('asks our backend with the token’s hints and the internal secret', async () => {
    fetchMock.mockResolvedValue({ candidates: [{ id: 'jmdict:1202440', headword: '開く' }] });

    const answer = await nadeshikoDictionary.identify(
      { lemma: '開く', surface: '開いた', reading: 'ヒライタ', pos: 'verb', locale: 'es' },
      { readerKey: 'ignored' },
    );

    expect(answer).toEqual({ candidates: [{ id: 'jmdict:1202440', headword: '開く' }] });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://backend:5000/v1/dictionary/identify');
    expect(options.query).toEqual({ lemma: '開く', surface: '開いた', reading: 'ヒライタ', pos: 'verb', locale: 'es' });
    expect(options.headers['x-internal-proxy-auth']).toBe('secret');
  });

  test('leaves out hints the token does not have', async () => {
    fetchMock.mockResolvedValue({ candidates: [] });

    await nadeshikoDictionary.identify({ lemma: '兄', locale: 'en' });

    expect(fetchMock.mock.calls[0]![1].query).toEqual({ lemma: '兄', locale: 'en' });
  });

  test('a refused secret is our misconfiguration', async () => {
    fetchMock.mockRejectedValue({ response: { status: 403 } });

    const error = await nadeshikoDictionary.identify({ lemma: '兄', locale: 'en' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DictionaryError);
    expect(error).toMatchObject({ kind: 'misconfigured', status: 403 });
  });

  test('anything else is an outage', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await nadeshikoDictionary.identify({ lemma: '兄', locale: 'en' }).catch((e: unknown) => e)).toMatchObject({
      kind: 'unavailable',
    });
  });
});
