// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import type { AdminOverview } from '@brigadasos/nadeshiko-sdk';

const overview = ref<AdminOverview | null>(null);
const isLoading = ref(false);
const refresh = vi.fn();

vi.stubGlobal('useI18n', () => ({
  t: (k: string, params?: Record<string, unknown>) => (params ? `${k}:${JSON.stringify(params)}` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useFormat', () => ({
  formatNumber: (n: number) => String(n),
}));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useAdminOverview', () => ({ overview, isLoading, refresh }));

import AdminDashboardHome from './AdminDashboardHome.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(AdminDashboardHome, {
    global: {
      stubs: {
        NuxtLink: { props: ['to'], inheritAttrs: true, template: '<a :href="to"><slot /></a>' },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  overview.value = {
    reports: { open: 7, processing: 2 },
    requests: { open: 11, planned: 3, inProgress: 2, boostedOpen: 4 },
    feedback: { unhandled: 5, total: 20 },
    users: { total: 420, newLast7d: 19, activePatrons: 9, banned: 1 },
    catalogue: { media: 250, episodes: 3100, segments: 950000 },
    queues: { queued: 2, active: 1, failed: 0 },
    email: { suppressed: 3 },
    announcement: { active: true },
    generatedAt: '2026-11-21T22:00:00.000Z',
  };
  isLoading.value = false;
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe('AdminDashboardHome', () => {
  test('renders the 5 top action cards and all 4 categorized directory columns', () => {
    const wrapper = render();

    expect(wrapper.find('[data-testid="admin-pulse-strip"]').exists()).toBe(true);
    for (const card of ['moderation', 'requests', 'users', 'comms', 'ops']) {
      expect(wrapper.find(`[data-testid="admin-card-${card}"]`).exists()).toBe(true);
    }
    for (const sec of ['moderation', 'community', 'site', 'catalogue']) {
      expect(wrapper.find(`[data-testid="admin-section-${sec}"]`).exists()).toBe(true);
    }
  });

  test('links all six active admin tools under /admin/*', () => {
    const wrapper = render();
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'));

    for (const target of [
      '/en/admin/reports',
      '/en/admin/requests',
      '/en/admin/roadmap',
      '/en/admin/announcement',
      '/en/admin/users',
      '/en/admin/patreon',
    ]) {
      expect(hrefs).toContain(target);
    }
  });

  test('refreshes live overview counts when clicking refresh', async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="admin-refresh-overview"]').trigger('click');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
