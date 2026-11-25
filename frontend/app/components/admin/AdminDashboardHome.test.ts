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
  formatNumber: (n: number) => n.toLocaleString('en-US'),
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
    reports: { open: 7 },
    requests: { open: 11, boostedOpen: 4 },
    users: { total: 4200, activePatrons: 9 },
    announcement: { active: true },
    emails: { failed: 1, bounced: 2 },
  } as AdminOverview;
  isLoading.value = false;
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe('AdminDashboardHome', () => {
  test('renders all 3 categorized directory columns', () => {
    const wrapper = render();

    for (const sec of ['moderation', 'community', 'site']) {
      expect(wrapper.find(`[data-testid="admin-section-${sec}"]`).exists()).toBe(true);
    }
    expect(wrapper.find('[data-testid="admin-section-catalogue"]').exists()).toBe(false);
  });

  test('links all six active admin tools under /admin/*', () => {
    const wrapper = render();
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'));

    for (const target of [
      '/en/admin/reports',
      '/en/admin/requests',
      '/en/admin/announcement',
      '/en/admin/users',
      '/en/admin/patreon',
      '/en/admin/emails',
    ]) {
      expect(hrefs).toContain(target);
    }
  });

  test('shows locale-formatted counts and the external status link', () => {
    const wrapper = render();

    expect(wrapper.get('[data-testid="admin-dir-users"]').text()).toContain('4,200');
    expect(wrapper.get('[data-testid="admin-dir-reports"]').text()).toContain('7');
    expect(wrapper.get('[data-testid="admin-dir-announcement"]').text()).toContain(
      'adminDashboard.status.bannerActive',
    );
    expect(wrapper.get('[data-testid="admin-dir-emails"]').text()).toContain('3');
    const status = wrapper.get('[data-testid="admin-dir-status-page"]');
    expect(status.attributes('href')).toBe('https://status.nadeshiko.co');
    expect(status.attributes('target')).toBe('_blank');
  });

  test('refreshes live overview counts when clicking refresh', async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="admin-refresh-overview"]').trigger('click');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
