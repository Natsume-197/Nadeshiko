import { describe, expect, it } from 'vitest';
import { TrackerProviderType } from '@app/models/TrackerConnection';
import { WatchStatus } from '@app/models/UserMediaProgress';
import { anilistProvider, normalizeAniListCollection } from '@app/services/tracker/anilistProvider';

describe('normalizeAniListCollection', () => {
  it('merges duplicates across standard and custom lists and preserves sorted custom list names', () => {
    const entries = normalizeAniListCollection({
      data: {
        MediaListCollection: {
          lists: [
            {
              name: 'Watching',
              isCustomList: false,
              entries: [
                {
                  status: 'CURRENT',
                  progress: 6,
                  media: { id: 154587, title: { romaji: 'Sousou no Frieren', english: 'Frieren' } },
                },
              ],
            },
            {
              name: 'Completed',
              isCustomList: false,
              entries: [
                {
                  status: 'REPEATING',
                  progress: 12,
                  media: { id: 9253, title: { romaji: 'Steins;Gate', english: 'Steins;Gate' } },
                },
              ],
            },
            {
              name: 'Favorites',
              isCustomList: true,
              entries: [
                {
                  status: 'CURRENT',
                  progress: 6,
                  media: { id: 154587, title: { romaji: 'Sousou no Frieren' } },
                },
              ],
            },
            {
              name: 'Easy Slice of Life',
              isCustomList: true,
              entries: [
                {
                  status: 'CURRENT',
                  progress: 4,
                  media: { id: 154587, title: { romaji: 'Sousou no Frieren' } },
                },
              ],
            },
          ],
        },
      },
    });

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.externalId === '154587')).toEqual({
      externalSource: TrackerProviderType.ANILIST,
      externalId: '154587',
      title: 'Sousou no Frieren',
      status: WatchStatus.WATCHING,
      progress: 6,
      customLists: ['Easy Slice of Life', 'Favorites'],
    });
    expect(entries.find((e) => e.externalId === '9253')).toEqual({
      externalSource: TrackerProviderType.ANILIST,
      externalId: '9253',
      title: 'Steins;Gate',
      status: WatchStatus.COMPLETED,
      progress: 12,
      customLists: [],
    });
  });

  it('skips entries without a valid media id or status and falls back cleanly on missing titles', () => {
    const entries = normalizeAniListCollection({
      data: {
        MediaListCollection: {
          lists: [
            {
              name: 'Planning',
              isCustomList: false,
              entries: [
                { status: 'PLANNING', progress: -3, media: { id: 100, title: {} } },
                { status: 'UNKNOWN_STATUS', progress: 1, media: { id: 200, title: { romaji: 'Bad' } } },
                { status: 'COMPLETED', progress: 10, media: { id: null, title: { romaji: 'Missing' } } },
              ],
            },
          ],
        },
      },
    });

    expect(entries).toEqual([
      {
        externalSource: TrackerProviderType.ANILIST,
        externalId: '100',
        title: 'AniList #100',
        status: WatchStatus.PLANNING,
        progress: 0,
        customLists: [],
      },
    ]);
  });

  it('builds canonical AniList anime URLs', () => {
    expect(anilistProvider.externalUrl('154587')).toBe('https://anilist.co/anime/154587');
  });
});
