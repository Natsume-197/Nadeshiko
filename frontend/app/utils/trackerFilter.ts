import type { Category } from '@brigadasos/nadeshiko-sdk';
import type { MediaFilterItem, ResolvedCategoryCount, ResolvedMediaStats } from '~/types/search';

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

export interface TrackerMissingRequest {
  publicId: string;
  status: 'OPEN' | 'PLANNED' | 'IN_PROGRESS' | 'DECLINED';
  voteCount: number;
  /** The reader already voted (filing a request counts as one). */
  voted: boolean;
}

export interface TrackerMissingAnime {
  externalSource: TrackerProviderId;
  externalId: string;
  title: string;
  status: WatchStatus;
  sourceUrl: string;
  /** The request already filed for this title, so the card offers a vote instead of a duplicate. */
  request: TrackerMissingRequest | null;
}

/** What the card offers for a missing title. */
export type MissingAnimeAction =
  | { kind: 'request' }
  | { kind: 'vote'; voteCount: number }
  | { kind: 'requested'; status: TrackerMissingRequest['status'] }
  | { kind: 'declined' };

/** `filedHere` is true once the reader requested or voted from the card in this page view. */
export function missingAnimeAction(item: TrackerMissingAnime, filedHere: boolean): MissingAnimeAction {
  const request = item.request;
  if (request?.status === 'DECLINED') return { kind: 'declined' };
  if (filedHere || request?.voted) return { kind: 'requested', status: request?.status ?? 'OPEN' };
  if (request) return { kind: 'vote', voteCount: request.voteCount };
  return { kind: 'request' };
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

/** `my-anime` is the search switch (every started title); `custom:` narrows it to one AniList custom list. */
export type TrackerFilterMode = 'all' | 'my-anime' | `custom:${string}`;

export interface WatchingPromptTitle {
  mediaPublicId: string;
  title: string;
  progress: number;
}

export interface ComputedTrackerSearchFilters {
  include: MediaFilterItem[];
  exclude: MediaFilterItem[];
  /** True when the switch is on but none of the reader's titles are in the catalog. */
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

const FILTER_MODES = new Set(['all', 'my-anime']);

/** Parses a stored filter mode, falling back to `all` for anything unknown. */
export function parseTrackerFilterMode(raw: string | null | undefined): TrackerFilterMode {
  if (!raw) return 'all';
  if (FILTER_MODES.has(raw)) return raw as TrackerFilterMode;
  if (raw.startsWith(CUSTOM_LIST_PREFIX) && raw.length > CUSTOM_LIST_PREFIX.length) return raw as TrackerFilterMode;
  return 'all';
}

/**
 * Derive search `media.include` and `media.exclude` entries from the reader's synced tracker state.
 *
 * Free readers get series-level inclusion (`my-anime` = every started title). Patrons also get episode-level
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
    !state.canUsePatronPerks && mode !== 'all'
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
    // Everything the reader has started: Paused and Dropped titles still have watched episodes.
    if (mode === 'my-anime') return entry.status !== 'PLANNING';
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

/**
 * Category tab counts for a search narrowed to the reader's list.
 *
 * The stats endpoint counts categories with `media.include` lifted (so a picked title never empties its own tab),
 * which would make the tabs count the whole catalog while the results only show the list. The media rows are
 * already narrowed, so the tabs are summed from them instead.
 */
export function categoryCountsFromMedia(media: readonly ResolvedMediaStats[]): ResolvedCategoryCount[] {
  const totals = new Map<Category, number>();
  for (const row of media) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.matchCount);
  }
  return [...totals]
    .filter(([, count]) => count > 0)
    .map(([category, count]) => ({ category, count, realCount: count }));
}
