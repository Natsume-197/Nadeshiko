// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const startLink = vi.fn();
const trackerState = ref<Record<string, unknown> | null>(null);

vi.mock('~/composables/useTrackerSync', () => ({
  useTrackerSync: () => ({
    state: trackerState,
    loading: ref(false),
    working: ref(false),
    load: vi.fn(),
    startLink,
    syncNow: vi.fn(),
    updateSettings: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (path: string) => path);

import TrackerConnectionCard from './TrackerConnectionCard.vue';

const mounted: { unmount: () => void }[] = [];

async function render(configuredProviders: string[]) {
  trackerState.value = {
    configuredProviders,
    canUsePatronPerks: false,
    connection: null,
    coverage: null,
    customLists: [],
    customListCount: 0,
    entries: [],
    missingAnime: [],
  };
  const wrapper = mount(TrackerConnectionCard, { global: { stubs: { UiBaseIcon: true, NuxtLink: true } } });
  mounted.push(wrapper);
  await nextTick();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('MyAnimeList connect row', () => {
  test('starts MAL OAuth when MAL is configured', async () => {
    const wrapper = await render(['ANILIST', 'MAL']);

    const button = wrapper.get('[data-testid="tracker-connect-mal"]');
    expect(button.text()).toBe('connections.tracker.connectMal');
    expect(wrapper.text()).not.toContain('connections.tracker.comingSoon');

    await button.trigger('click');
    expect(startLink).toHaveBeenCalledWith('MAL');
  });

  test('stays a coming-soon row without a button when MAL is not configured', async () => {
    const wrapper = await render(['ANILIST']);

    expect(wrapper.find('[data-testid="tracker-connect-mal"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('connections.tracker.comingSoon');
  });
});

describe('before the tracker state arrives', () => {
  test('shows both connect buttons disabled, never Unavailable or Coming soon', async () => {
    trackerState.value = null;
    const wrapper = mount(TrackerConnectionCard, { global: { stubs: { UiBaseIcon: true, NuxtLink: true } } });
    mounted.push(wrapper);
    await nextTick();

    const anilist = wrapper.get('[data-testid="tracker-connect-anilist"]');
    expect(anilist.text()).toBe('connections.tracker.connect');
    expect(anilist.attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="tracker-connect-mal"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).not.toContain('connections.tracker.unavailable');
    expect(wrapper.text()).not.toContain('connections.tracker.comingSoon');
  });
});
