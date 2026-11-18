import { describe, test, expect, beforeEach, vi } from 'vitest';

const { searchWords, logger } = vi.hoisted(() => ({
  searchWords: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('~~/server/utils/logger', () => ({ logger }));

type FakeEvent = { query: Record<string, unknown>; headers: Record<string, string> };

vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('h3')>()),
  getQuery: (event: FakeEvent) => event.query,
  setResponseHeader: (event: FakeEvent, name: string, value: string | number) => {
    event.headers[name] = String(value);
  },
}));

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('defineCachedEventHandler', (fn: unknown) => fn);
vi.stubGlobal('useServerSdk', () => ({ searchWords }));

const handler = (await import('./word-counts.get')).default as unknown as (event: FakeEvent) => Promise<{
  counts: Record<string, number>;
}>;
const event = (words: string): FakeEvent => ({ query: { words }, headers: {} });

beforeEach(() => {
  searchWords.mockReset();
});

describe('reading word counts', () => {
  test('one batch search for every word, public ratings only, counted per word', async () => {
    searchWords.mockResolvedValue({
      results: [
        { word: '食事', matchCount: 13 },
        { word: '食べる', matchCount: 138 },
      ],
    });

    const body = await handler(event('食事,食べる'));

    expect(searchWords).toHaveBeenCalledWith({
      query: { words: ['食事', '食べる'] },
      filters: { contentRating: ['SAFE', 'SUGGESTIVE'] },
    });
    expect(body.counts).toEqual({ 食事: 13, 食べる: 138 });
  });

  test('a failed search is a 503 that nothing caches', async () => {
    searchWords.mockRejectedValue(new Error('down'));
    const request = event('食事');

    await expect(handler(request)).rejects.toMatchObject({ statusCode: 503 });
    expect(request.headers['cache-control']).toBe('no-store');
  });

  test('takes up to forty words', async () => {
    const many = Array.from({ length: 41 }, (_, i) => `w${i}`).join(',');
    await expect(handler(event(many))).rejects.toMatchObject({ statusCode: 400 });
  });
});
