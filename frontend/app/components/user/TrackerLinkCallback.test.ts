// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const completeLink = vi.fn();
const replace = vi.fn();
const route = { path: '/link/mal/callback', query: {} as Record<string, string> };

vi.mock('~/composables/useTrackerSync', () => ({ useTrackerSync: () => ({ completeLink }) }));
vi.mock('~/utils/apiError', () => ({ handleApiError: vi.fn() }));

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));
vi.stubGlobal('useLocalePath', () => (path: string) => path);
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ replace }));

import TrackerLinkCallback from './TrackerLinkCallback.vue';

const mounted: { unmount: () => void }[] = [];

async function render(provider: 'ANILIST' | 'MAL', query: Record<string, string>) {
  route.query = query;
  const wrapper = mount(TrackerLinkCallback, {
    props: { provider },
    global: { stubs: { UiBaseIcon: true, NuxtLink: true } },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('tracker OAuth callback', () => {
  test('completes a MyAnimeList link with the code and state', async () => {
    completeLink.mockResolvedValueOnce({ coverage: { inCatalog: 3, total: 10 } });
    const wrapper = await render('MAL', { code: 'mal-code', state: 'sealed' });

    expect(completeLink).toHaveBeenCalledWith('MAL', 'mal-code', 'sealed');
    expect(replace).toHaveBeenCalledWith({ path: '/link/mal/callback', query: {} });
    expect(wrapper.get('h1').text()).toBe('trackerCallback.malDone');
  });

  test('reports a declined MyAnimeList link without calling the API', async () => {
    const wrapper = await render('MAL', { error: 'access_denied' });

    expect(completeLink).not.toHaveBeenCalled();
    expect(wrapper.get('h1').text()).toBe('trackerCallback.malDeclined');
  });

  test('keeps AniList wording for AniList links', async () => {
    completeLink.mockRejectedValueOnce(new Error('boom'));
    const wrapper = await render('ANILIST', { code: 'c', state: 's' });

    expect(completeLink).toHaveBeenCalledWith('ANILIST', 'c', 's');
    expect(wrapper.get('h1').text()).toBe('trackerCallback.failed');
  });
});
