// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

/** Account actions and simple preferences save through to the store and report to analytics. */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({
  handleApiError: (...a: unknown[]) => handleApiError(...a),
  apiErrorStatus: () => null,
}));
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: ref('en') }),
}));

const updateUserPreferences = vi.fn();
const capture = vi.fn();
const preferences = reactive<Record<string, unknown>>({});
const store = {
  preferences: preferences as Record<string, unknown>,
  user: { id: 'u1', name: 'Reader', email: 'r@example.test' },
  userName: 'Reader',
  userEmail: 'r@example.test',
  isLoggedIn: true,
  sessions: [],
  listSessions: vi.fn().mockResolvedValue([]),
  changeEmail: vi.fn(),
};

vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useFormat', () => ({ formatDate: (d: unknown) => String(d) }));
vi.stubGlobal('useNadeshikoSdk', () => ({ updateUserPreferences, search: vi.fn() }));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useMediaCardDefault', () => ({ preference: ref('open'), startsOpen: ref(true) }));
vi.stubGlobal('useMotionPreference', () => ({ preference: ref('full') }));
vi.stubGlobal('useTranslationLanguages', () => ({ languages: ref(['en']) }));
vi.stubGlobal('useLazyAsyncData', async () => ({ data: ref(null) }));
vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }));
vi.stubGlobal('useLocalePath', () => (p: string) => p);
vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
vi.stubGlobal('useDefaultSearchCategory', () => ({
  storedDefault: ref('all'),
  defaultCategorySlug: ref('all'),
  isDefaultCategoryHidden: ref(false),
}));
vi.stubGlobal('useHiddenCategories', () => ({
  hiddenCategories: ref([]),
  visibleCategories: ref([]),
  hasHiddenCategories: ref(false),
  isCategoryHidden: () => false,
  canToggleCategory: () => true,
  toggleCategory: vi.fn(),
}));
vi.stubGlobal('useDictionaryLinks', () => ({
  presets: [],
  enabledDictionaries: ref([]),
  isDictionaryEnabled: () => false,
  setDictionaryEnabled: vi.fn(),
}));

import AccountSettings from './AccountSettings.vue';

const mounted: { unmount: () => void }[] = [];

async function render(prefs: Record<string, unknown> = {}) {
  for (const key of Object.keys(preferences)) delete preferences[key];
  Object.assign(preferences, prefs);
  store.preferences = preferences;

  const Host = defineComponent({
    components: { AccountSettings },
    template: '<Suspense><AccountSettings /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        UserConnectionsCard: true,
        ConnectionsCard: true,
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: {
          props: ['text'],
          emits: ['click'],
          template: '<button @click="$emit(\'click\')">{{ text }}</button>',
        },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateUserPreferences.mockResolvedValue({});
  store.changeEmail.mockResolvedValue({ success: true });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('stable account actions', () => {
  test('identify the destructive and download controls, not adjacent session actions', async () => {
    const wrapper = await render();

    expect(wrapper.get('[data-testid="account-sign-out"]').text()).toBe('accountSettings.account.logout');
    expect(wrapper.get('[data-testid="account-export"]').text()).toBe('accountSettings.account.exportData');
    expect(wrapper.get('[data-testid="account-delete"]').text()).toBe('accountSettings.account.deleteAccountButton');
  });
});

describe('simple preferences', () => {
  test('a changed select is saved and written through to the store', async () => {
    const wrapper = await render({});

    await wrapper.get('[data-testid="default-search-category"]').setValue('ANIME');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({ defaultSearchCategory: 'ANIME' });
    expect(store.preferences.defaultSearchCategory).toBe('ANIME');
  });

  test('and reported to analytics by NAME, so settings can be told apart', async () => {
    const wrapper = await render({});

    await wrapper.get('[data-testid="default-search-category"]').setValue('ANIME');
    await flushPromises();

    expect(capture).toHaveBeenCalledWith('setting_changed', {
      setting_name: 'defaultSearchCategory',
      value: 'ANIME',
    });
  });
});
