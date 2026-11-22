// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

/** The Supporters page holds two tabs, Tiers and Roadmap. The hash names the open one so the footer, Settings and the
 * old /roadmap URL land on the right tab, and both panels stay in the markup so crawlers see them. */

vi.mock('~/utils/apiError', () => ({ handleApiError: vi.fn() }));

const $fetch = vi.fn();
const navigateTo = vi.fn();
vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/supporters'));
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('userStore', () => ({ isLoggedIn: false }));
vi.stubGlobal('useLoginModal', () => ({ openLoginModal: vi.fn() }));
vi.stubGlobal('useAsyncData', async (_k: unknown, handler: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  data.value = await handler();
  return { data, refresh: vi.fn(), pending: ref(false), error: ref(null) };
});

import { PATREON_URL } from '#shared/utils/socialLinks';
import SupportersPage from './supporters.vue';
import RoadmapRedirect from './roadmap.vue';

const featureRoadmapItem = {
  id: 'r1',
  kind: 'FEATURE',
  status: 'PLANNED',
  title: 'Custom themes',
  description: 'Personalize the palette.',
  sourceUrl: null,
  coverUrl: null,
  targetDate: '2026-12-01',
  introducedInVersion: null,
  sortOrder: 0,
  createdAt: '2026-11-01',
  proposerName: null,
};

const contentRoadmapItem = {
  id: 'r2',
  kind: 'CONTENT',
  status: 'PLANNED',
  title: 'Frieren',
  description: '',
  sourceUrl: null,
  coverUrl: null,
  targetDate: '2026-12-01',
  introducedInVersion: null,
  sortOrder: 0,
  createdAt: '2026-11-01',
  proposerName: null,
};

const mounted: { unmount: () => void }[] = [];

async function render(page = SupportersPage) {
  const Host = defineComponent({
    components: { Page: page },
    errorCaptured: () => false,
    template: '<Suspense><Page /></Suspense>',
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      stubs: {
        SupportTiers: { template: '<div data-testid="tiers-stub" />' },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const panel = (w: Awaited<ReturnType<typeof render>>, tab: 'support' | 'roadmap') => w.get(`#panel-${tab}`);
const isShown = (el: ReturnType<typeof panel>) => (el.element as HTMLElement).style.display !== 'none';

beforeEach(() => {
  $fetch.mockReset();
  $fetch.mockResolvedValue({
    items: [featureRoadmapItem, contentRoadmapItem],
    patreonUrl: 'https://www.patreon.com/NadeshikoApp',
  });
  navigateTo.mockReset();
  history.replaceState(null, '', '/en/supporters');
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe('Supporters page', () => {
  test('opens on the Tiers tab, with the roadmap still in the markup', async () => {
    const wrapper = await render();

    expect(isShown(panel(wrapper, 'support'))).toBe(true);
    expect(panel(wrapper, 'support').find('[data-testid="tiers-stub"]').exists()).toBe(true);
    expect(isShown(panel(wrapper, 'roadmap'))).toBe(false);
    expect(panel(wrapper, 'roadmap').text()).toContain('Custom themes');
    expect(panel(wrapper, 'roadmap').text()).not.toContain('Frieren');
    expect(wrapper.get('[data-testid="supporters-tab-support"]').attributes('aria-selected')).toBe('true');
  });

  test('opens on the Roadmap tab when the URL ends in #roadmap', async () => {
    history.replaceState(null, '', '/en/supporters#roadmap');
    const wrapper = await render();

    expect(isShown(panel(wrapper, 'roadmap'))).toBe(true);
    expect(isShown(panel(wrapper, 'support'))).toBe(false);
    expect(wrapper.get('[data-testid="supporters-tab-roadmap"]').attributes('aria-selected')).toBe('true');
  });

  test('clicking a tab switches the panel and writes its hash', async () => {
    const wrapper = await render();

    await wrapper.get('[data-testid="supporters-tab-roadmap"]').trigger('click');

    expect(window.location.hash).toBe('#roadmap');
    expect(isShown(panel(wrapper, 'roadmap'))).toBe(true);
    expect(isShown(panel(wrapper, 'support'))).toBe(false);
  });

  test('follows a later hash change, such as an in-page #support link', async () => {
    history.replaceState(null, '', '/en/supporters#roadmap');
    const wrapper = await render();

    history.replaceState(null, '', '/en/supporters#support');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await nextTick();

    expect(isShown(panel(wrapper, 'support'))).toBe(true);
    expect(isShown(panel(wrapper, 'roadmap'))).toBe(false);
  });
});

describe('content requests', () => {
  test('the hero points to Patreon and the requests page', async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-testid="supporters-hero-patreon-cta"]').attributes('href')).toBe(PATREON_URL);
    expect(wrapper.get('[data-testid="supporters-requests-cta"]').attributes('href')).toBe('/en/requests');
  });
});

describe('/roadmap', () => {
  test('redirects permanently to the Roadmap tab of the Supporters page', async () => {
    await render(RoadmapRedirect);

    expect(navigateTo).toHaveBeenCalledWith('/en/supporters#roadmap', { redirectCode: 301, replace: true });
  });
});
