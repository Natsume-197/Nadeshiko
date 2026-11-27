import { onMounted, reactive } from 'vue';

export interface WordEntryPreferences {
  collapsed: boolean;
}

const STORAGE_KEY = 'nadeshiko.wordEntryPrefs';

const DEFAULTS: WordEntryPreferences = {
  collapsed: false,
};

const state = reactive<WordEntryPreferences>({ ...DEFAULTS });
let loaded = false;

function readStorage(): Partial<WordEntryPreferences> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<WordEntryPreferences> = {};
    if (typeof parsed.collapsed === 'boolean') out.collapsed = parsed.collapsed;
    return out;
  } catch {
    return {};
  }
}

function writeStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed: state.collapsed }));
  } catch {
    // Private browsing or quota exceeded: keep working in-memory.
  }
}

export function resetWordEntryPreferencesForTest() {
  Object.assign(state, DEFAULTS);
  loaded = false;
}

/**
 * Display preferences for the `/search` word definition box (`SearchWordEntry.vue`), persisted in `localStorage` so
 * signed-out readers can configure the box too. Hydrated in `onMounted` so SSR markup stays deterministic.
 */
export function useWordEntryPreferences() {
  onMounted(() => {
    if (loaded) return;
    loaded = true;
    Object.assign(state, readStorage());
  });

  function setPref<K extends keyof WordEntryPreferences>(key: K, value: WordEntryPreferences[K]) {
    state[key] = value;
    writeStorage();
  }

  return { prefs: state, setPref };
}
