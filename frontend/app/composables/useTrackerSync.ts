import { computed } from 'vue';
import { userStore } from '~/stores/auth';
import { handleApiError } from '~/utils/apiError';
import {
  buildTrackerSearchMediaFilters,
  parseTrackerFilterMode,
  type TrackerFilterMode,
  type TrackerProviderId,
  type TrackerSettings,
  type TrackerState,
  trackerTitleStatus,
} from '~/utils/trackerFilter';

// Remembered per browser so the list filter survives reloads and new searches.
const FILTER_STORAGE_KEY = 'nd-tracker-filter';
// Titles shown in full despite the spoiler guard or Plan to Watch hiding, per browser like the filter.
const UNLOCKED_STORAGE_KEY = 'nd-tracker-unlocked';

function readStoredUnlocked(): string[] {
  if (!import.meta.client) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(UNLOCKED_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function storeUnlocked(ids: readonly string[]): void {
  if (!import.meta.client) return;
  try {
    if (ids.length) window.localStorage.setItem(UNLOCKED_STORAGE_KEY, JSON.stringify(ids));
    else window.localStorage.removeItem(UNLOCKED_STORAGE_KEY);
  } catch {
    // Storage blocked: the choice still holds for this page view.
  }
}

/** Tracker events are rare (a few per reader), so they stay well inside the PostHog event budget. */
function captureTrackerEvent(event: string, properties: Record<string, unknown>): void {
  if (!import.meta.client) return;
  usePostHog()?.capture(event, properties);
}

function readStoredFilterMode(): TrackerFilterMode {
  if (!import.meta.client) return 'all';
  try {
    return parseTrackerFilterMode(window.localStorage.getItem(FILTER_STORAGE_KEY));
  } catch {
    return 'all';
  }
}

function storeFilterMode(mode: TrackerFilterMode): void {
  if (!import.meta.client) return;
  try {
    if (mode === 'all') window.localStorage.removeItem(FILTER_STORAGE_KEY);
    else window.localStorage.setItem(FILTER_STORAGE_KEY, mode);
  } catch {
    // Storage blocked: the filter still works for this page view.
  }
}

/**
 * Shared client state for the reader's linked anime tracker (AniList / MAL), catalog coverage, and search filters.
 */
export function useTrackerSync() {
  const user = userStore();
  const state = useState<TrackerState | null>('tracker-sync-state', () => null);
  const loadedForUser = useState<string | null>('tracker-sync-loaded-user', () => null);
  const loading = useState<boolean>('tracker-sync-loading', () => false);
  const working = useState<boolean>('tracker-sync-working', () => false);
  const filterMode = useState<TrackerFilterMode>('tracker-search-filter', () => 'all');
  const promptDismissed = useState<boolean>('tracker-spoiler-prompt-dismissed', () => false);
  const unlockedIds = useState<string[]>('tracker-unlocked-titles', () => []);

  const isConnected = computed(() => Boolean(user.isLoggedIn && state.value?.connection));
  const unlockedTitles = computed(() => new Set(unlockedIds.value));

  const searchFilters = computed(() =>
    user.isLoggedIn
      ? buildTrackerSearchMediaFilters(state.value, filterMode.value, unlockedTitles.value)
      : buildTrackerSearchMediaFilters(null, 'all'),
  );

  /** Where the tracker stands on one title: status, progress and what it hides. */
  function titleStatus(mediaPublicId: string | null) {
    return user.isLoggedIn ? trackerTitleStatus(state.value, mediaPublicId, unlockedTitles.value) : null;
  }

  async function load(force = false): Promise<TrackerState | null> {
    if (!user.isLoggedIn) {
      state.value = null;
      loadedForUser.value = null;
      filterMode.value = 'all';
      return null;
    }

    const userKey = String(user.userId ?? 'signed-in');
    if (!force && loadedForUser.value === userKey && state.value !== null) {
      return state.value;
    }

    loading.value = true;
    try {
      const data = await $fetch<TrackerState>('/v1/user/connections/tracker');
      state.value = data;
      loadedForUser.value = userKey;
      if (!data.connection) {
        filterMode.value = 'all';
      } else if (filterMode.value === 'all') {
        filterMode.value = readStoredFilterMode();
      }
      unlockedIds.value = data.connection ? readStoredUnlocked() : [];
      // Reset a custom-list filter if the reader's membership lapsed or the list disappeared.
      if (filterMode.value.startsWith('custom:')) {
        const listName = filterMode.value.slice('custom:'.length);
        if (!data.canUsePatronPerks || !data.customLists.includes(listName)) {
          setFilterMode('all');
        }
      }
      return data;
    } catch (error) {
      handleApiError('trackerConnection.load', error, { toastKey: false });
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function startLink(provider: TrackerProviderId): Promise<void> {
    working.value = true;
    try {
      const { authorizeUrl } = await $fetch<{ authorizeUrl: string }>('/v1/user/connections/tracker', {
        method: 'POST',
        body: { provider },
      });
      window.location.href = authorizeUrl;
    } catch (error) {
      handleApiError('trackerConnection.start', error);
      working.value = false;
    }
  }

  async function completeLink(provider: TrackerProviderId, code: string, sealedState: string): Promise<TrackerState> {
    const data = await $fetch<TrackerState>('/v1/user/connections/tracker/callback', {
      method: 'POST',
      body: { provider, code, state: sealedState },
    });
    state.value = data;
    loadedForUser.value = String(user.userId ?? 'signed-in');
    captureTrackerEvent('tracker_connected', {
      provider,
      list_size: data.coverage?.total ?? 0,
      in_catalog: data.coverage?.inCatalog ?? 0,
      patron: data.canUsePatronPerks,
    });
    return data;
  }

  async function syncNow(): Promise<boolean> {
    working.value = true;
    try {
      const data = await $fetch<TrackerState>('/v1/user/connections/tracker/sync', { method: 'POST' });
      state.value = data;
      return true;
    } catch (error) {
      handleApiError('trackerConnection.sync', error);
      return false;
    } finally {
      working.value = false;
    }
  }

  async function updateSettings(patch: Partial<TrackerSettings>): Promise<boolean> {
    working.value = true;
    try {
      const data = await $fetch<TrackerState>('/v1/user/connections/tracker/settings', {
        method: 'PATCH',
        body: patch,
      });
      state.value = data;
      for (const [setting, enabled] of Object.entries(patch)) {
        captureTrackerEvent('tracker_setting_changed', { setting, enabled });
      }
      return true;
    } catch (error) {
      handleApiError('trackerConnection.settings', error);
      return false;
    } finally {
      working.value = false;
    }
  }

  async function disconnect(): Promise<boolean> {
    working.value = true;
    try {
      await $fetch('/v1/user/connections/tracker', { method: 'DELETE' });
      captureTrackerEvent('tracker_disconnected', { provider: state.value?.connection?.provider ?? null });
      unlockedIds.value = [];
      storeUnlocked([]);
      if (state.value) {
        state.value = {
          ...state.value,
          connection: null,
          coverage: null,
          customLists: [],
          customListCount: 0,
          entries: [],
          missingAnime: [],
        };
      }
      setFilterMode('all');
      return true;
    } catch (error) {
      handleApiError('trackerConnection.unlink', error);
      return false;
    } finally {
      working.value = false;
    }
  }

  function setFilterMode(mode: TrackerFilterMode): void {
    if (mode !== filterMode.value) {
      captureTrackerEvent('tracker_filter_changed', {
        mode: mode.startsWith('custom:') ? 'custom-list' : mode,
      });
    }
    filterMode.value = mode;
    storeFilterMode(mode);
    if (mode !== 'all') promptDismissed.value = false;
  }

  /** Show one title in full (`true`) or put its spoiler guard / Plan to Watch hiding back (`false`). */
  function setTitleUnlocked(mediaPublicId: string, unlock: boolean): void {
    const next = unlock
      ? [...new Set([...unlockedIds.value, mediaPublicId])]
      : unlockedIds.value.filter((id) => id !== mediaPublicId);
    if (next.length === unlockedIds.value.length) return;
    unlockedIds.value = next;
    storeUnlocked(next);
    captureTrackerEvent('tracker_title_unlocked', {
      unlocked: unlock,
      status: state.value?.entries.find((entry) => entry.mediaPublicId === mediaPublicId)?.status ?? null,
    });
  }

  function dismissPrompt(): void {
    promptDismissed.value = true;
  }

  return {
    state,
    isConnected,
    loading,
    working,
    filterMode,
    promptDismissed,
    searchFilters,
    load,
    startLink,
    completeLink,
    syncNow,
    updateSettings,
    disconnect,
    setFilterMode,
    dismissPrompt,
    titleStatus,
    setTitleUnlocked,
  };
}
