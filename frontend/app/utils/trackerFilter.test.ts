import { describe, expect, it } from 'vitest';
import { buildTrackerSearchMediaFilters, customListMode, type TrackerState } from '~/utils/trackerFilter';

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

  it('flags emptyIncludeMatch when a narrowing mode matches zero catalog titles', () => {
    const state = makeState({
      entries: [
        { mediaPublicId: 'media-plan01', title: 'Attack on Titan', status: 'PLANNING', progress: 0, customLists: [] },
      ],
    });
    const result = buildTrackerSearchMediaFilters(state, 'completed');
    expect(result.include).toEqual([]);
    expect(result.emptyIncludeMatch).toBe(true);
  });
});
