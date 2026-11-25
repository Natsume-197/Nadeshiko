import type { MediaFilterItem } from '~/types/search';

export type TrackerProviderId = 'ANILIST' | 'MAL';
export type WatchStatus = 'WATCHING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'PLANNING';

export interface TrackerSettings {
  autoSyncEnabled: boolean;
  spoilerGuardEnabled: boolean;
  hidePlanToWatch: boolean;
}

export interface TrackerConnectionSummary {
  provider: TrackerProviderId;
  externalUsername: string | null;
  supportsCustomLists: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  linkedAt: string;
  settings: TrackerSettings;
  effectiveSettings: TrackerSettings;
  nextManualSyncAt: string | null;
  manualCooldownSeconds: number;
}

export interface TrackerCoverage {
  total: number;
  inCatalog: number;
  missing: number;
  byStatus: Record<WatchStatus, number>;
}

export interface TrackerProgressEntry {
  mediaPublicId: string;
  title: string;
  status: WatchStatus;
  progress: number;
  customLists: string[];
}

export interface TrackerMissingAnime {
  externalSource: TrackerProviderId;
  externalId: string;
  title: string;
  status: WatchStatus;
  sourceUrl: string;
}

export interface TrackerState {
  configuredProviders: TrackerProviderId[];
  canUsePatronPerks: boolean;
  connection: TrackerConnectionSummary | null;
  coverage: TrackerCoverage | null;
  customLists: string[];
  customListCount: number;
  entries: TrackerProgressEntry[];
  missingAnime: TrackerMissingAnime[];
}

export type TrackerFilterMode = 'all' | 'my-anime' | 'completed' | 'watching' | `custom:${string}`;

export interface WatchingPromptTitle {
  mediaPublicId: string;
  title: string;
  progress: number;
}

export interface ComputedTrackerSearchFilters {
  include: MediaFilterItem[];
  exclude: MediaFilterItem[];
  /** True when the reader picked a narrowing filter (e.g. Watching only) that matched 0 catalog titles. */
  emptyIncludeMatch: boolean;
  /** Matched Watching titles with episode progress > 0, surfaced to free readers as a contextual spoiler-guard prompt. */
  watchingPromptTitles: WatchingPromptTitle[];
  planToWatchCount: number;
  /** Patron spoiler guard / Plan to Watch hiding currently active on this search. */
  activeSpoilerProtectionCount: number;
}

const CUSTOM_LIST_PREFIX = 'custom:';

export function customListNameFromMode(mode: TrackerFilterMode): string | null {
  return mode.startsWith(CUSTOM_LIST_PREFIX) ? mode.slice(CUSTOM_LIST_PREFIX.length) : null;
}

export function customListMode(name: string): `custom:${string}` {
  return `${CUSTOM_LIST_PREFIX}${name}`;
}

/**
 * Derive search `media.include` and `media.exclude` entries from the reader's synced tracker state.
 *
 * Free readers get series-level inclusion (`my-anime`, `completed`, `watching`). Patrons also get episode-level
 * spoiler guard (`maxEpisode` on included Watching titles, `minEpisode` on global excludes), automatic
 * `PLANNING` exclusion, and custom tracker lists.
 */
export function buildTrackerSearchMediaFilters(
  state: TrackerState | null,
  mode: TrackerFilterMode,
): ComputedTrackerSearchFilters {
  if (!state?.connection) {
    return {
      include: [],
      exclude: [],
      emptyIncludeMatch: false,
      watchingPromptTitles: [],
      planToWatchCount: 0,
      activeSpoilerProtectionCount: 0,
    };
  }

  const effective = state.connection.effectiveSettings;
  const spoilerGuard = effective.spoilerGuardEnabled;
  const hidePlanToWatch = effective.hidePlanToWatch;

  const exclude: MediaFilterItem[] = [];
  let planToWatchCount = 0;
  let activeSpoilerProtectionCount = 0;

  for (const entry of state.entries) {
    if (entry.status === 'PLANNING') {
      planToWatchCount += 1;
      if (hidePlanToWatch) {
        exclude.push({ mediaPublicId: entry.mediaPublicId });
        activeSpoilerProtectionCount += 1;
      }
    } else if (entry.status === 'WATCHING' && spoilerGuard) {
      if (entry.progress > 0) {
        exclude.push({ mediaPublicId: entry.mediaPublicId, minEpisode: entry.progress + 1 });
      } else {
        // Episode 0 progress means the reader hasn't watched episode 1 yet: hide the whole title.
        exclude.push({ mediaPublicId: entry.mediaPublicId });
      }
      activeSpoilerProtectionCount += 1;
    }
  }

  const watchingPromptTitles: WatchingPromptTitle[] =
    !state.canUsePatronPerks && (mode === 'my-anime' || mode === 'watching')
      ? state.entries
          .filter((entry) => entry.status === 'WATCHING' && entry.progress > 0)
          .map((entry) => ({
            mediaPublicId: entry.mediaPublicId,
            title: entry.title,
            progress: entry.progress,
          }))
      : [];

  if (mode === 'all') {
    return {
      include: [],
      exclude,
      emptyIncludeMatch: false,
      watchingPromptTitles,
      planToWatchCount,
      activeSpoilerProtectionCount,
    };
  }

  const customList = customListNameFromMode(mode);
  const matchingEntries = state.entries.filter((entry) => {
    if (mode === 'my-anime') return entry.status === 'COMPLETED' || entry.status === 'WATCHING';
    if (mode === 'completed') return entry.status === 'COMPLETED';
    if (mode === 'watching') return entry.status === 'WATCHING';
    if (customList !== null) {
      return state.canUsePatronPerks && entry.customLists.includes(customList);
    }
    return false;
  });

  const include: MediaFilterItem[] = [];
  for (const entry of matchingEntries) {
    if (entry.status === 'WATCHING' && spoilerGuard) {
      if (entry.progress > 0) {
        include.push({ mediaPublicId: entry.mediaPublicId, maxEpisode: entry.progress });
      }
      // Progress 0 with spoiler guard on means no episodes are safe to show yet.
      continue;
    }
    include.push({ mediaPublicId: entry.mediaPublicId });
  }

  return {
    include,
    exclude,
    emptyIncludeMatch: include.length === 0,
    watchingPromptTitles,
    planToWatchCount,
    activeSpoilerProtectionCount,
  };
}
