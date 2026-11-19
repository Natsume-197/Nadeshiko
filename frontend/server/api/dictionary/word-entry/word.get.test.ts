import { beforeEach, describe, expect, test, vi } from 'vitest';

// The dictionary entry above a word search: always our own dictionary, null when the query is not a dictionary word.
const { identify, logger } = vi.hoisted(() => ({
  identify: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('~~/server/utils/logger', () => ({ logger }));
vi.mock('~~/server/utils/kanjiBriefs', () => ({
  kanjiBriefs: async (words: string[]) =>
    words.some((word) => word.includes('食')) ? { 食: { reading: 'ショク', meaning: 'eat' } } : {},
}));
vi.mock('~~/server/utils/dictionary/nadeshiko', () => ({ nadeshikoDictionary: { identify } }));
vi.mock('~~/server/utils/dictionary', async () => ({
  DictionaryError: (await import('~~/server/utils/dictionary/types')).DictionaryError,
}));

type FakeEvent = { params: Record<string, string>; query: Record<string, unknown>; headers: Record<string, string> };

vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('h3')>()),
  getQuery: (event: FakeEvent) => event.query,
  getRouterParam: (event: FakeEvent, name: string) => event.params[name],
  setResponseHeader: (event: FakeEvent, name: string, value: string | number) => {
    event.headers[name] = String(value);
  },
}));

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('defineCachedEventHandler', (fn: unknown) => fn);

const handler = (await import('./[word].get')).default as unknown as (event: FakeEvent) => Promise<{
  entry: { headword: string } | null;
  others: Array<{ headword: string; reading: string | null; gloss: string | null }>;
  inflected: boolean;
}>;
const { DictionaryError } = await import('~~/server/utils/dictionary/types');

const event = (word: string, locale?: string): FakeEvent => ({
  params: { word },
  query: locale ? { locale } : {},
  headers: {},
});

beforeEach(() => {
  identify.mockReset();
});

describe('word entry', () => {
  test('asks our dictionary for the word and keeps the candidate spelled like it, cached a day', async () => {
    identify.mockResolvedValue({
      candidates: [
        { headword: '食う', forms: [{ text: '食う' }] },
        { headword: '食べる', forms: [{ text: '食べる' }] },
      ],
    });
    const request = event('食べる', 'es');

    const answer = await handler(request);

    expect(identify).toHaveBeenCalledWith({ lemma: '食べる', locale: 'es' });
    expect(answer.entry?.headword).toBe('食べる');
    expect((answer as { kanji?: unknown }).kanji).toEqual({ 食: { reading: 'ショク', meaning: 'eat' } });
    expect(request.headers['cache-control']).toBe('public, max-age=86400');
  });

  test('null, not an error, when no candidate is the word searched', async () => {
    identify.mockResolvedValue({ candidates: [{ headword: '食べる', forms: [{ text: '食べる' }] }] });

    expect((await handler(event('食べた'))).entry).toBeNull();
  });

  test('the other words spelled the same come along, cut down to a name and a meaning', async () => {
    const word = (headword: string, gloss: string) => ({
      headword,
      reading: 'ハシ',
      forms: [{ text: headword }, { text: 'はし' }],
      entries: [{ senses: [{ definitions: [{ lang: 'en', text: gloss }] }] }],
    });
    identify.mockResolvedValue({ candidates: [word('橋', 'bridge'), word('箸', 'chopsticks')] });

    const answer = await handler(event('はし'));

    expect(answer.entry?.headword).toBe('橋');
    expect(answer.others).toEqual([
      { headword: '箸', reading: 'ハシ', gloss: 'chopsticks', entry: expect.objectContaining({ headword: '箸' }) },
    ]);
    expect(answer.inflected).toBe(false);
  });

  test('a conjugated search answers with the word it is a form of', async () => {
    identify.mockResolvedValue({ candidates: [{ headword: '食べる', baseForm: true, forms: [{ text: '食べる' }] }] });

    const answer = await handler(event('食べた'));

    expect(answer.entry?.headword).toBe('食べる');
    expect(answer.inflected).toBe(true);
  });

  test('a phrase or a non-Japanese query is refused without asking', async () => {
    await expect(handler(event('eat'))).rejects.toMatchObject({ statusCode: 400 });
    expect(identify).not.toHaveBeenCalled();
  });

  test('an outage is a 503 that is never cached', async () => {
    identify.mockRejectedValue(new DictionaryError('unavailable', 502));
    const request = event('食べる');

    await expect(handler(request)).rejects.toMatchObject({ statusCode: 503 });
    expect(request.headers['cache-control']).toBe('no-store');
  });
});
