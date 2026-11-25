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
} from '~/utils/trackerFilter';

// Remembered per browser so the list filter survives reloads and new searches.
const FILTER_STORAGE_KEY = 'nd-tracker-filter';

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

  const isConnected = computed(() => Boolean(user.isLoggedIn && state.value?.connection));

  const searchFilters = computed(() =>
    user.isLoggedIn
      ? buildTrackerSearchMediaFilters(state.value, filterMode.value)
      : buildTrackerSearchMediaFilters(null, 'all'),
  );

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
    filterMode.value = mode;
    storeFilterMode(mode);
    if (mode !== 'all') promptDismissed.value = false;
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
  };
}
