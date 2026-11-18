import { describe, test, expect, beforeEach, vi } from 'vitest';

// Sentences for one reading of a kanji: its example words searched as words, interleaved, public ratings only.
const { search, logger } = vi.hoisted(() => ({
  search: vi.fn(),
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
vi.stubGlobal('useServerSdk', () => ({ search }));

const handler = (await import('./word-sentences.get')).default as unknown as (event: FakeEvent) => Promise<{
  segments: Array<{ publicId: string }>;
  includes: { media: Record<string, unknown> };
}>;
const { interleave, wordsOf } = await import('~~/server/utils/readingSentences');

const event = (words: unknown): FakeEvent => ({ query: { words }, headers: {} });
const answer = (ids: string[], media: string) => ({
  segments: ids.map((publicId) => ({ publicId })),
  includes: { media: { [media]: { publicId: media } } },
});

beforeEach(() => {
  search.mockReset();
});

describe('reading sentences', () => {
  test('search each word as a word, safe for a public page', async () => {
    search.mockResolvedValue(answer([], 'm'));

    await handler(event('食事,給食'));

    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledWith({
      query: { search: '食事' },
      take: 4,
      filters: { contentRating: ['SAFE', 'SUGGESTIVE'] },
      include: ['media'],
    });
  });

  test('take the words in turn, without repeating a sentence, up to eight, with every title they name', async () => {
    search
      .mockResolvedValueOnce(answer(['a1', 'a2', 'a3', 'a4'], 'A'))
      .mockResolvedValueOnce(answer(['b1', 'a2', 'b3', 'b4'], 'B'))
      .mockResolvedValueOnce(answer(['c1'], 'C'));

    const body = await handler(event('食事,給食,夕食'));

    expect(body.segments.map((segment) => segment.publicId)).toEqual(['a1', 'b1', 'c1', 'a2', 'a3', 'b3', 'a4', 'b4']);
    expect(Object.keys(body.includes.media)).toEqual(['A', 'B', 'C']);
  });

  test('a failed search is a 503 that nothing caches', async () => {
    search.mockRejectedValue(new Error('down'));
    const request = event('食事');

    await expect(handler(request)).rejects.toMatchObject({ statusCode: 503 });
    expect(request.headers['cache-control']).toBe('no-store');
  });

  test('take one to three short words only', async () => {
    expect(wordsOf(event('食事, 給食 ,食事') as never)).toEqual(['食事', '給食']);
    expect(wordsOf(event('') as never)).toBeNull();
    expect(wordsOf(event('a,b,c,d') as never)).toBeNull();
    expect(wordsOf(event('食'.repeat(21)) as never)).toBeNull();
    expect(wordsOf(event(['食事']) as never)).toBeNull();
    await expect(handler(event('a,b,c,d'))).rejects.toMatchObject({ statusCode: 400 });
  });

  test('stops when every word has run out', () => {
    expect(interleave([answer(['x'], 'X'), answer([], 'Y')], 8).segments).toEqual([{ publicId: 'x' }]);
  });
});
