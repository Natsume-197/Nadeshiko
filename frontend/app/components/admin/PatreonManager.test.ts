// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

const getAdminPatreonOverview = vi.fn();
const refreshAdminPatreonConnection = vi.fn();
const unlinkAdminPatreonConnection = vi.fn();
const refreshAllAdminPatreonConnections = vi.fn();
const refreshAdminOverview = vi.fn();
const useToastSuccess = vi.fn();

vi.stubGlobal('useI18n', () => ({
  t: (k: string, params?: Record<string, unknown>) => (params ? `${k}:${JSON.stringify(params)}` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useFormat', () => ({
  formatNumber: (n: number) => String(n),
  formatDate: (s: string) => s,
  formatRelativeTime: (s: string) => s,
}));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useAdminOverview', () => ({ refresh: refreshAdminOverview }));
vi.stubGlobal('useToastSuccess', useToastSuccess);
vi.stubGlobal('useNadeshikoSdk', () => ({
  getAdminPatreonOverview,
  refreshAdminPatreonConnection,
  unlinkAdminPatreonConnection,
  refreshAllAdminPatreonConnections,
}));

import PatreonManager from './PatreonManager.vue';

const mounted: { unmount: () => void }[] = [];

function makePayload() {
  return {
    configured: true,
    campaignId: '999999',
    summary: { totalLinked: 2, active: 1, stale: 1, issues: 1 },
    tiers: [
      {
        id: 'pro',
        displayName: 'Flower',
        patreonTierId: '28118736',
        monthlyQuotaLimit: 30000,
        monthlyRequestBoosts: 5,
        activePatronCount: 1,
      },
    ],
    connections: [
      {
        userId: 10,
        username: 'hanako',
        email: 'hanako@example.com',
        patreonUserId: 'p-10',
        fullName: 'Hanako',
        patronStatus: 'active_patron',
        entitledAmountCents: 1000,
        entitledTierIds: ['28118736'],
        resolvedTierId: 'pro',
        resolvedTierName: 'Flower',
        effectiveQuotaLimit: 30000,
        quotaSource: 'patreon',
        unmatchedTierIds: [],
        isActive: true,
        isStale: false,
        hasIssue: false,
        membershipCheckedAt: '2026-11-22T10:00:00.000Z',
        linkedAt: '2026-11-01T10:00:00.000Z',
      },
      {
        userId: 11,
        username: 'taro',
        email: 'taro@example.com',
        patreonUserId: 'p-11',
        fullName: 'Taro',
        patronStatus: 'active_patron',
        entitledAmountCents: 1000,
        entitledTierIds: ['unknown-tier'],
        resolvedTierId: null,
        resolvedTierName: null,
        effectiveQuotaLimit: 5000,
        quotaSource: 'tier',
        unmatchedTierIds: ['unknown-tier'],
        isActive: false,
        isStale: true,
        hasIssue: true,
        membershipCheckedAt: '2026-11-01T10:00:00.000Z',
        linkedAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    manualGrants: [
      {
        userId: 20,
        username: 'kobo',
        email: 'kobo@example.com',
        tierId: 'free',
        tierName: 'Free',
        quotaOverride: 20000,
        effectiveQuotaLimit: 20000,
        quotaSource: 'override',
      },
    ],
  };
}

async function render() {
  const wrapper = mount(PatreonManager, {
    global: {
      stubs: {
        NuxtLink: { props: ['to'], inheritAttrs: true, template: '<a :href="to"><slot /></a>' },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdminPatreonOverview.mockResolvedValue(makePayload());
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe('PatreonManager', () => {
  test('renders connections, tiers mapping and manual grants', async () => {
    const wrapper = await render();

    expect(wrapper.find('[data-testid="patreon-row-10"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="patreon-row-11"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="patreon-tiers-card"]').text()).toContain('Flower');
    expect(wrapper.get('[data-testid="patreon-manual-grants-card"]').text()).toContain('kobo');
  });

  test('filters by issues and search query', async () => {
    const wrapper = await render();

    await wrapper.get('[data-testid="patreon-filter-issues"]').trigger('click');
    expect(wrapper.find('[data-testid="patreon-row-10"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="patreon-row-11"]').exists()).toBe(true);

    await wrapper.get('[data-testid="patreon-filter-all"]').trigger('click');
    await wrapper.get('[data-testid="patreon-search"]').setValue('hanako');
    expect(wrapper.find('[data-testid="patreon-row-10"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="patreon-row-11"]').exists()).toBe(false);
  });

  test('triggers single refresh, two-step unlink, and sync-all', async () => {
    const payload = makePayload();
    refreshAdminPatreonConnection.mockResolvedValue(payload.connections[0]);
    unlinkAdminPatreonConnection.mockResolvedValue(undefined);
    refreshAllAdminPatreonConnections.mockResolvedValue({ checked: 2, failed: 0 });

    const wrapper = await render();

    await wrapper.get('[data-testid="patreon-refresh-10"]').trigger('click');
    await flushPromises();
    expect(refreshAdminPatreonConnection).toHaveBeenCalledWith({ userId: 10 });

    await wrapper.get('[data-testid="patreon-unlink-11"]').trigger('click');
    await wrapper.get('[data-testid="patreon-confirm-unlink-11"]').trigger('click');
    await flushPromises();
    expect(unlinkAdminPatreonConnection).toHaveBeenCalledWith({ userId: 11 });

    await wrapper.get('[data-testid="patreon-sync-all"]').trigger('click');
    await flushPromises();
    expect(refreshAllAdminPatreonConnections).toHaveBeenCalledTimes(1);
  });
});
