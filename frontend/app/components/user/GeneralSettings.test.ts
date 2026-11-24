// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

/** Display preferences save through to the store and report to analytics. */
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
  isLoggedIn: true,
};

vi.stubGlobal('userStore', () => store);
vi.stubGlobal('useNadeshikoSdk', () => ({ updateUserPreferences, search: vi.fn() }));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useMediaCardDefault', () => ({ preference: ref('OPEN'), startsOpen: ref(true) }));
vi.stubGlobal('useMotionPreference', () => ({ preference: ref('full'), setPreference: vi.fn() }));

import GeneralSettings from './GeneralSettings.vue';

const mounted: { unmount: () => void }[] = [];

async function render(prefs: Record<string, unknown> = {}) {
  for (const key of Object.keys(preferences)) delete preferences[key];
  Object.assign(preferences, prefs);
  store.preferences = preferences;

  const Host = defineComponent({
    components: { GeneralSettings },
    template: '<GeneralSettings />',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateUserPreferences.mockResolvedValue({});
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('general display preferences', () => {
  test('a changed select is saved and written through to the store', async () => {
    const wrapper = await render({});

    await wrapper.get('[data-testid="media-card-default"]').setValue('CLOSED');
    await flushPromises();

    expect(updateUserPreferences).toHaveBeenCalledWith({ mediaCardDefault: 'CLOSED' });
    expect(store.preferences.mediaCardDefault).toBe('CLOSED');
  });

  test('and reported to analytics by NAME, so settings can be told apart', async () => {
    const wrapper = await render({});

    await wrapper.get('[data-testid="media-card-default"]').setValue('CLOSED');
    await flushPromises();

    expect(capture).toHaveBeenCalledWith('setting_changed', {
      setting_name: 'mediaCardDefault',
      value: 'CLOSED',
    });
  });
});
