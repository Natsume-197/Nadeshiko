import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRequestLink } from '@app/services/requests/links';
import { lookupRequestMetadata } from '@app/services/requests/metadata';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lookupRequestMetadata for dramas', () => {
  it('resolves a poster for MyDramaList links via TVMaze when TMDB API key is unset', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://api.tvmaze.com/search/shows')) {
        return new Response(
          JSON.stringify([
            {
              show: {
                name: 'First Love',
                language: 'Japanese',
                image: { medium: 'https://static.tvmaze.com/uploads/images/medium_portrait/431/1078810.jpg' },
              },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const link = parseRequestLink('https://mydramalist.com/682545-first-love');
    expect(link).not.toBeNull();
    if (!link) return;
    const meta = await lookupRequestMetadata(link);
    expect(meta).toEqual({
      title: 'First Love',
      coverUrl: 'https://static.tvmaze.com/uploads/images/medium_portrait/431/1078810.jpg',
    });
  });

  it('falls back to TVMaze for TMDB TV links with a slug or user-supplied title when TMDB API returns nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://api.tvmaze.com/search/shows')) {
        return new Response(
          JSON.stringify([
            {
              show: {
                name: 'Naoki Hanzawa',
                language: 'Japanese',
                image: { medium: 'https://static.tvmaze.com/uploads/images/medium_portrait/44/111597.jpg' },
              },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const withSlug = parseRequestLink('https://www.themoviedb.org/tv/94796-hanzawa-naoki');
    expect(withSlug).not.toBeNull();
    if (!withSlug) return;
    expect(await lookupRequestMetadata(withSlug)).toEqual({
      title: 'Hanzawa naoki',
      coverUrl: 'https://static.tvmaze.com/uploads/images/medium_portrait/44/111597.jpg',
    });

    const noSlug = parseRequestLink('https://www.themoviedb.org/tv/94796');
    expect(noSlug).not.toBeNull();
    if (!noSlug) return;
    expect(await lookupRequestMetadata(noSlug, 'Hanzawa Naoki')).toEqual({
      title: null,
      coverUrl: 'https://static.tvmaze.com/uploads/images/medium_portrait/44/111597.jpg',
    });
  });
});
