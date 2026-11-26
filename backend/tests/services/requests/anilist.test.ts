import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAniListMediaMetadata, getAniListMediaMetadataByMalId } from '@app/services/requests/anilist';

afterEach(() => vi.restoreAllMocks());

describe('getAniListMediaMetadata', () => {
  it('loads a canonical title and cover for an AniList anime URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Media: {
              title: { english: 'Cowboy Bebop', romaji: 'Cowboy Bebop' },
              coverImage: {
                extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg',
              },
              siteUrl: 'https://anilist.co/anime/1',
            },
          },
        }),
        { status: 200 },
      ),
    );

    await expect(getAniListMediaMetadata('https://anilist.co/anime/1/Cowboy-Bebop')).resolves.toEqual({
      title: 'Cowboy Bebop',
      coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg',
      siteUrl: 'https://anilist.co/anime/1',
      totalEpisodes: null,
      finished: false,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).variables).toEqual({ value: 1 });
  });

  it('does not contact AniList for other URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(getAniListMediaMetadata('https://myanimelist.net/anime/1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open when the metadata request is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(getAniListMediaMetadata('https://anilist.co/anime/1')).resolves.toBeNull();
  });

  it('looks up a MyAnimeList id through AniList idMal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Media: {
              title: { english: null, romaji: 'Sousou no Frieren' },
              coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587.jpg' },
              siteUrl: 'https://anilist.co/anime/154587',
            },
          },
        }),
        { status: 200 },
      ),
    );

    await expect(getAniListMediaMetadataByMalId('52991')).resolves.toMatchObject({ title: 'Sousou no Frieren' });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.query).toContain('Media(idMal: $value');
    expect(body.variables).toEqual({ value: 52991 });
    await expect(getAniListMediaMetadataByMalId('abc')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
