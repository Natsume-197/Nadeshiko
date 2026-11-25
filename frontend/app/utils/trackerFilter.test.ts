import { describe, expect, it } from 'vitest';
import type { ResolvedMediaStats } from '~/types/search';
import {
  buildTrackerSearchMediaFilters,
  categoryCountsFromMedia,
  customListMode,
  missingAnimeAction,
  parseTrackerFilterMode,
  type TrackerMissingAnime,
  type TrackerState,
} from '~/utils/trackerFilter';

function makeState(overrides: Partial<TrackerState> = {}): TrackerState {
  return {
    configuredProviders: ['ANILIST'],
    canUsePatronPerks: false,
    connection: {
      provider: 'ANILIST',
      externalUsername: 'natsume',
      supportsCustomLists: true,
      lastSyncedAt: '2026-11-24T00:00:00.000Z',
      lastSyncError: null,
      linkedAt: '2026-11-20T00:00:00.000Z',
      settings: { autoSyncEnabled: false, spoilerGuardEnabled: false, hidePlanToWatch: false },
      effectiveSettings: { autoSyncEnabled: false, spoilerGuardEnabled: false, hidePlanToWatch: false },
      nextManualSyncAt: null,
      manualCooldownSeconds: 21_600,
    },
    coverage: {
      total: 4,
      inCatalog: 4,
      missing: 0,
      byStatus: { WATCHING: 2, COMPLETED: 1, PAUSED: 0, DROPPED: 0, PLANNING: 1 },
    },
    customLists: [],
    customListCount: 1,
    entries: [
      { mediaPublicId: 'media-comp01', title: 'Steins;Gate', status: 'COMPLETED', progress: 24, customLists: ['Favs'] },
      { mediaPublicId: 'media-watch1', title: 'Frieren', status: 'WATCHING', progress: 6, customLists: ['Favs'] },
      { mediaPublicId: 'media-watch0', title: 'Unstarted Show', status: 'WATCHING', progress: 0, customLists: [] },
      { mediaPublicId: 'media-plan01', title: 'Attack on Titan', status: 'PLANNING', progress: 0, customLists: [] },
    ],
    missingAnime: [],
    ...overrides,
  };
}

describe('buildTrackerSearchMediaFilters', () => {
  it('returns empty filters when disconnected', () => {
    expect(buildTrackerSearchMediaFilters(null, 'my-anime')).toEqual({
      include: [],
      exclude: [],
      emptyIncludeMatch: false,
      watchingPromptTitles: [],
      planToWatchCount: 0,
      activeSpoilerProtectionCount: 0,
    });
  });

  it('gives free readers series-level filtering and surfaces Watching prompt titles', () => {
    const result = buildTrackerSearchMediaFilters(makeState(), 'my-anime');

    expect(result.include).toEqual([
      { mediaPublicId: 'media-comp01' },
      { mediaPublicId: 'media-watch1' },
      { mediaPublicId: 'media-watch0' },
    ]);
    expect(result.exclude).toEqual([]);
    expect(result.emptyIncludeMatch).toBe(false);
    expect(result.watchingPromptTitles).toEqual([{ mediaPublicId: 'media-watch1', title: 'Frieren', progress: 6 }]);
    expect(result.planToWatchCount).toBe(1);
  });

  it('applies episode spoiler guard, Plan to Watch auto-hide, and custom lists for active patrons', () => {
    const patronState = makeState({
      canUsePatronPerks: true,
      customLists: ['Favs'],
      connection: {
        ...makeState().connection!,
        settings: { autoSyncEnabled: true, spoilerGuardEnabled: true, hidePlanToWatch: true },
        effectiveSettings: { autoSyncEnabled: true, spoilerGuardEnabled: true, hidePlanToWatch: true },
      },
    });

    const myAnime = buildTrackerSearchMediaFilters(patronState, 'my-anime');
    expect(myAnime.include).toEqual([
      { mediaPublicId: 'media-comp01' },
      { mediaPublicId: 'media-watch1', maxEpisode: 6 },
    ]);
    expect(myAnime.exclude).toEqual([
      { mediaPublicId: 'media-watch1', minEpisode: 7 },
      { mediaPublicId: 'media-watch0' },
      { mediaPublicId: 'media-plan01' },
    ]);
    expect(myAnime.watchingPromptTitles).toEqual([]);
    expect(myAnime.activeSpoilerProtectionCount).toBe(3);

    // Custom list respects spoiler guard on Watching items too.
    const custom = buildTrackerSearchMediaFilters(patronState, customListMode('Favs'));
    expect(custom.include).toEqual([
      { mediaPublicId: 'media-comp01' },
      { mediaPublicId: 'media-watch1', maxEpisode: 6 },
    ]);

    // Even in 'all' mode, global anti-spoiler excludes stay active.
    const allMode = buildTrackerSearchMediaFilters(patronState, 'all');
    expect(allMode.include).toEqual([]);
    expect(allMode.exclude).toHaveLength(3);
  });

  it('flags emptyIncludeMatch when the switch matches zero catalog titles', () => {
    const state = makeState({
      entries: [
        { mediaPublicId: 'media-plan01', title: 'Attack on Titan', status: 'PLANNING', progress: 0, customLists: [] },
      ],
    });
    const result = buildTrackerSearchMediaFilters(state, 'my-anime');
    expect(result.include).toEqual([]);
    expect(result.emptyIncludeMatch).toBe(true);
  });

  it("counts Paused and Dropped titles as part of the reader's list", () => {
    const state = makeState({
      entries: [
        { mediaPublicId: 'media-pause1', title: 'Paused Show', status: 'PAUSED', progress: 8, customLists: [] },
        { mediaPublicId: 'media-drop01', title: 'Dropped Show', status: 'DROPPED', progress: 2, customLists: [] },
        { mediaPublicId: 'media-plan01', title: 'Attack on Titan', status: 'PLANNING', progress: 0, customLists: [] },
      ],
    });
    expect(buildTrackerSearchMediaFilters(state, 'my-anime').include).toEqual([
      { mediaPublicId: 'media-pause1' },
      { mediaPublicId: 'media-drop01' },
    ]);
  });
});

describe('parseTrackerFilterMode', () => {
  it('keeps known modes and custom lists, and falls back to all', () => {
    expect(parseTrackerFilterMode('my-anime')).toBe('my-anime');
    expect(parseTrackerFilterMode('watching')).toBe('all');
    expect(parseTrackerFilterMode('custom:Favs')).toBe('custom:Favs');
    expect(parseTrackerFilterMode('custom:')).toBe('all');
    expect(parseTrackerFilterMode('bogus')).toBe('all');
    expect(parseTrackerFilterMode(null)).toBe('all');
  });
});

describe('categoryCountsFromMedia', () => {
  it('sums narrowed media rows per category', () => {
    const rows = [
      { mediaPublicId: 'a', category: 'ANIME', matchCount: 3 },
      { mediaPublicId: 'b', category: 'ANIME', matchCount: 2 },
      { mediaPublicId: 'c', category: 'JDRAMA', matchCount: 0 },
    ] as unknown as ResolvedMediaStats[];
    expect(categoryCountsFromMedia(rows)).toEqual([{ category: 'ANIME', count: 5, realCount: 5 }]);
  });
});

describe('missingAnimeAction', () => {
  const base: TrackerMissingAnime = {
    externalSource: 'ANILIST',
    externalId: '1',
    title: 'Missing Show',
    status: 'PLANNING',
    sourceUrl: 'https://anilist.co/anime/1',
    request: null,
  };
  const request = { publicId: 'r1', status: 'OPEN' as const, voteCount: 4, voted: false };

  it('offers a request when nobody asked yet', () => {
    expect(missingAnimeAction(base, false)).toEqual({ kind: 'request' });
  });

  it('offers a vote on a request someone else filed', () => {
    expect(missingAnimeAction({ ...base, request }, false)).toEqual({ kind: 'vote', voteCount: 4 });
  });

  it('shows it as requested once the reader filed or voted, before or on this page', () => {
    expect(missingAnimeAction({ ...base, request: { ...request, voted: true } }, false)).toEqual({
      kind: 'requested',
      status: 'OPEN',
    });
    expect(missingAnimeAction({ ...base, request: { ...request, status: 'IN_PROGRESS' } }, true)).toEqual({
      kind: 'requested',
      status: 'IN_PROGRESS',
    });
    expect(missingAnimeAction(base, true)).toEqual({ kind: 'requested', status: 'OPEN' });
  });

  it('never offers a declined title again', () => {
    expect(missingAnimeAction({ ...base, request: { ...request, status: 'DECLINED' } }, true)).toEqual({
      kind: 'declined',
    });
  });
});
