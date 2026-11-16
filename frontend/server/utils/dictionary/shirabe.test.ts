import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DictionaryError } from '~~/server/utils/dictionary/types';

// The route's own tests cover the card end to end; these pin what any Dictionary must hand the route.
const { callShirabe } = vi.hoisted(() => ({ callShirabe: vi.fn() }));

vi.mock('~~/server/utils/shirabeCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~~/server/utils/shirabeCall')>()),
  callShirabe: (...a: unknown[]) => callShirabe(...a),
}));

const { shirabeDictionary } = await import('~~/server/utils/dictionary/shirabe');

function httpError(status: number, contentType = 'application/json') {
  return { response: { status, headers: { get: (key: string) => (key === 'content-type' ? contentType : null) } } };
}

async function failure(options?: { readerKey?: string }): Promise<DictionaryError> {
  const error = await shirabeDictionary.identify({ lemma: '兄', locale: 'en' }, options).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DictionaryError);
  return error as DictionaryError;
}

beforeEach(() => {
  callShirabe.mockReset();
});

describe('shirabeDictionary', () => {
  test('answers with the first token’s candidates', async () => {
    callShirabe.mockResolvedValue({ words: [{ candidates: [{ id: 'jmdict:1', headword: '兄' }] }] });

    const answer = await shirabeDictionary.identify({ lemma: '兄', locale: 'en' });

    expect(answer).toEqual({ candidates: [{ id: 'jmdict:1', headword: '兄' }] });
  });

  test('a missing word is an empty answer, not an error', async () => {
    callShirabe.mockResolvedValue({ words: [null] });

    expect(await shirabeDictionary.identify({ lemma: 'ドラミちゃん', locale: 'en' })).toEqual({ candidates: [] });
  });

  test.each([[401], [403], [429]])('a reader key answered %i is refused', async (status) => {
    callShirabe.mockRejectedValue(httpError(status));

    expect(await failure({ readerKey: 'k' })).toMatchObject({ kind: 'refused', status });
  });

  test('the same statuses on the service key are an outage, not a refusal', async () => {
    callShirabe.mockRejectedValue(httpError(429));

    expect(await failure()).toMatchObject({ kind: 'unavailable', status: 429 });
  });

  test('an HTML 404 is our wrong path', async () => {
    callShirabe.mockRejectedValue(httpError(404, 'text/html'));

    expect((await failure()).kind).toBe('misconfigured');
  });

  test('a timeout keeps the original error for the logs', async () => {
    const timeout = new Error('ETIMEDOUT');
    callShirabe.mockRejectedValue(timeout);

    expect(await failure()).toMatchObject({ kind: 'unavailable', upstream: timeout });
  });
});
