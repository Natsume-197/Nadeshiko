import { describe, test, expect, beforeEach, vi } from 'vitest';

// The kanji page's sentences: a "contains" search for the kanji, public ratings only, cached unless it failed.
const { search, getSearchStats, logger } = vi.hoisted(() => ({
  search: vi.fn(),
  getSearchStats: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('~~/server/utils/logger', () => ({ logger }));

type FakeEvent = { params: Record<string, string>; headers: Record<string, string> };

vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('h3')>()),
  getRouterParam: (event: FakeEvent, name: string) => event.params[name],
  setResponseHeader: (event: FakeEvent, name: string, value: string | number) => {
    event.headers[name] = String(value);
  },
}));

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
// The cache wrapper is Nitro's; here the handler runs as is, with the key function kept for its own test.
let cacheKey: ((event: FakeEvent) => string) | null = null;
vi.stubGlobal('defineCachedEventHandler', (fn: unknown, options: { getKey: (event: FakeEvent) => string }) => {
  cacheKey = options.getKey;
  return fn;
});
vi.stubGlobal('useServerSdk', () => ({ search, getSearchStats }));

const handler = (await import('./[character].get')).default as unknown as (event: FakeEvent) => Promise<unknown>;
const event = (character: string): FakeEvent => ({ params: { character }, headers: {} });

beforeEach(() => {
  search.mockReset();
  getSearchStats.mockReset();
  getSearchStats.mockResolvedValue({ media: [], categories: [] });
});

describe('the kanji page sentences', () => {
  test('search for the kanji inside words, safe for a public page, with their titles', async () => {
    search.mockResolvedValue({ segments: [], includes: { media: {} } });
    const request = event('食');

    await handler(request);

    expect(search).toHaveBeenCalledWith({
      query: { search: '食', matchMode: 'CONTAINS' },
      take: 8,
      filters: { contentRating: ['SAFE', 'SUGGESTIVE'] },
      include: ['media'],
    });
    expect(request.headers['cache-control']).toBe('public, max-age=86400');
  });

  test('counts the sentences and titles with the kanji, from the same search', async () => {
    search.mockResolvedValue({ segments: [], includes: { media: {} } });
    getSearchStats.mockResolvedValue({
      media: [{ mediaPublicId: 'a' }, { mediaPublicId: 'b' }, { mediaPublicId: 'c' }],
      categories: [
        { category: 'ANIME', count: 3000, realCount: 3000 },
        { category: 'JDRAMA', count: 412, realCount: 412 },
      ],
    });

    const body = (await handler(event('食'))) as { totals: unknown };

    expect(getSearchStats).toHaveBeenCalledWith({
      query: { search: '食', matchMode: 'CONTAINS' },
      filters: { contentRating: ['SAFE', 'SUGGESTIVE'] },
    });
    expect(body.totals).toEqual({ sentences: 3412, titles: 3 });
  });

  test('without the counts the sentences still come back', async () => {
    search.mockResolvedValue({ segments: [], includes: { media: {} } });
    getSearchStats.mockRejectedValue(new Error('stats down'));

    const body = (await handler(event('食'))) as { totals: unknown; segments: unknown[] };

    expect(body.totals).toBeNull();
    expect(body.segments).toEqual([]);
  });

  test('a failed search is a 503 that nothing caches', async () => {
    search.mockRejectedValue(new Error('down'));
    const request = event('食');

    await expect(handler(request)).rejects.toMatchObject({ statusCode: 503 });
    expect(request.headers['cache-control']).toBe('no-store');
  });

  test('takes one kanji only, and keys the cache by it', async () => {
    await expect(handler(event('食べ'))).rejects.toMatchObject({ statusCode: 400 });
    expect(search).not.toHaveBeenCalled();
    expect(cacheKey?.(event('食'))).not.toBe(cacheKey?.(event('飯')));
  });
});
