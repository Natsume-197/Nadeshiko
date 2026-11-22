// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, ref } from 'vue';
import type { AdminOverview } from '@brigadasos/nadeshiko-sdk';

const route = reactive<{
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  fullPath: string;
}>({
  path: '/en/admin',
  params: {},
  query: {},
  fullPath: '/en/admin',
});
const navigateTo = vi.fn();
const overview = ref<AdminOverview | null>(null);
const isLoading = ref(false);
const refresh = vi.fn();
const ensureLoaded = vi.fn();

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (k: string, params?: Record<string, unknown>) => (params ? `${k}:${JSON.stringify(params)}` : k),
    locale: ref('en'),
  }),
}));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('definePageMeta', vi.fn());
vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn);
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('useAdminOverview', () => ({ overview, isLoading, refresh, ensureLoaded }));

import AdminShell from './admin.vue';

const mounted: { unmount: () => void }[] = [];

function makeOverview(overrides: Partial<AdminOverview> = {}): AdminOverview {
  return {
    reports: { open: 3, processing: 1 },
    requests: { open: 5, planned: 2, inProgress: 1, boostedOpen: 2 },
    feedback: { unhandled: 4, total: 10 },
    users: { total: 120, newLast7d: 8, activePatrons: 6, banned: 1 },
    catalogue: { media: 50, episodes: 600, segments: 150000 },
    queues: { queued: 1, active: 0, failed: 0 },
    email: { suppressed: 2 },
    announcement: { active: false },
    generatedAt: '2026-11-21T22:00:00.000Z',
    ...overrides,
  };
}

function render(path = '/en/admin', query: Record<string, string> = {}) {
  route.path = path;
  route.query = query;
  route.fullPath = path;
  const wrapper = mount(AdminShell, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: { props: ['to'], inheritAttrs: true, template: '<a :href="to"><slot /></a>' },
        NuxtPage: true,
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  overview.value = makeOverview();
  isLoading.value = false;
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe('Admin shell command bar', () => {
  test('fetches overview on mount and renders open reports badge', () => {
    const wrapper = render();
    expect(ensureLoaded).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="admin-reports-badge"]').text()).toBe('3');
  });

  test('navigates directly when choosing an item from Quick Jump', async () => {
    const wrapper = render();
    const select = wrapper.get('[data-testid="admin-quick-jump"]');
    await select.setValue('/admin/requests');

    expect(navigateTo).toHaveBeenCalledWith('/en/admin/requests');
  });

  test('shows failed-jobs alert pill only when pg-boss has failed jobs', () => {
    expect(render().find('[data-testid="admin-failed-jobs-pill"]').exists()).toBe(false);

    overview.value = makeOverview({ queues: { queued: 0, active: 0, failed: 4 } });
    expect(render().find('[data-testid="admin-failed-jobs-pill"]').exists()).toBe(true);
  });

  test('toggles category filter query when clicking category pills', async () => {
    const wrapper = render('/en/admin', {});
    await wrapper.get('[data-testid="admin-cat-moderation"]').trigger('click');
    expect(navigateTo).toHaveBeenCalledWith({ path: '/en/admin', query: { section: 'moderation' } });

    const filtered = render('/en/admin', { section: 'moderation' });
    await filtered.get('[data-testid="admin-cat-moderation"]').trigger('click');
    expect(navigateTo).toHaveBeenCalledWith('/en/admin');
  });

  test('triggers manual refresh from the refresh button', async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="admin-refresh-overview"]').trigger('click');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
