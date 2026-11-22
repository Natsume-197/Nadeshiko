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
  formatUsdCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
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
    summary: {
      totalLinked: 2,
      active: 1,
      stale: 1,
      issues: 1,
      campaignActive: 2,
      campaignUnlinkedActive: 1,
      campaignMonthlyCents: 2000,
      campaignLifetimeCents: 8500,
      campaignPayingEver: 3,
    },
    campaign: {
      configured: true,
      status: 'ok',
      errorMessage: null,
      fetchedAt: '2026-11-22T12:00:00.000Z',
      members: [
        {
          memberId: 'mem-1',
          patreonUserId: 'p-10',
          fullName: 'Hanako',
          email: 'hanako@patreon.test',
          patronStatus: 'active_patron',
          entitledAmountCents: 1467,
          monthlyAmountCents: 1000,
          lifetimeSupportCents: 3000,
          pledgeStart: '2026-08-01T00:00:00.000Z',
          lastChargeStatus: 'Paid',
          lastChargeDate: '2026-11-01T00:00:00.000Z',
          entitledTierIds: ['28118736'],
          patreonTierTitles: ['Flower'],
          resolvedTierId: 'pro',
          resolvedTierName: 'Flower',
          unmatchedTierIds: [],
          linkedUserId: 10,
          linkedUsername: 'hanako',
          linkedEmail: 'hanako@example.com',
          matchedUserId: null,
          matchedUsername: null,
        },
        {
          memberId: 'mem-2',
          patreonUserId: 'p-99',
          fullName: 'New Supporter',
          email: 'new@patreon.test',
          patronStatus: 'active_patron',
          entitledAmountCents: 1000,
          monthlyAmountCents: 1000,
          lifetimeSupportCents: 1000,
          pledgeStart: '2026-11-15T00:00:00.000Z',
          lastChargeStatus: 'Declined',
          lastChargeDate: '2026-11-15T00:00:00.000Z',
          entitledTierIds: ['28118736'],
          patreonTierTitles: ['Flower'],
          resolvedTierId: 'pro',
          resolvedTierName: 'Flower',
          unmatchedTierIds: [],
          linkedUserId: null,
          linkedUsername: null,
          linkedEmail: null,
          matchedUserId: 42,
          matchedUsername: 'newbie_jp',
        },
        {
          memberId: 'mem-3',
          patreonUserId: 'p-50',
          fullName: 'Former Supporter',
          email: 'former@patreon.test',
          patronStatus: 'former_patron',
          entitledAmountCents: 0,
          monthlyAmountCents: 0,
          lifetimeSupportCents: 4500,
          pledgeStart: '2026-01-10T00:00:00.000Z',
          lastChargeStatus: 'Paid',
          lastChargeDate: '2026-05-10T00:00:00.000Z',
          entitledTierIds: [],
          patreonTierTitles: [],
          resolvedTierId: null,
          resolvedTierName: null,
          unmatchedTierIds: [],
          linkedUserId: null,
          linkedUsername: null,
          linkedEmail: null,
          matchedUserId: null,
          matchedUsername: null,
        },
        {
          memberId: 'mem-4',
          patreonUserId: 'p-1',
          fullName: 'Free Follower',
          email: 'free@patreon.test',
          patronStatus: null,
          entitledAmountCents: 0,
          monthlyAmountCents: 0,
          lifetimeSupportCents: 0,
          pledgeStart: null,
          lastChargeStatus: null,
          lastChargeDate: null,
          entitledTierIds: [],
          patreonTierTitles: [],
          resolvedTierId: null,
          resolvedTierName: null,
          unmatchedTierIds: [],
          linkedUserId: null,
          linkedUsername: null,
          linkedEmail: null,
          matchedUserId: null,
          matchedUsername: null,
        },
      ],
    },
    tiers: [
      {
        id: 'pro',
        displayName: 'Flower',
        patreonTierId: '28118736',
        monthlyQuotaLimit: 30000,
        monthlyRequestBoosts: 5,
        activePatronCount: 1,
        campaignPatronCount: 2,
        campaignMonthlyCents: 2000,
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
  test('renders KPI strip, email-matched accounts, sorting, subtotals, tiers breakdown, and manual grants', async () => {
    const wrapper = await render();

    expect(wrapper.get('[data-testid="kpi-monthly"]').text()).toBe('$20.00');
    expect(wrapper.get('[data-testid="kpi-lifetime"]').text()).toBe('$85.00');
    expect(wrapper.get('[data-testid="tab-linked-issues-badge"]').text()).toBe('1');

    // Campaign tab active by default
    expect(wrapper.find('[data-testid="campaign-row-mem-1"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="campaign-row-mem-1"]').text()).toContain('$10.00');
    expect(wrapper.get('[data-testid="campaign-row-mem-1"]').text()).toContain('$30.00');
    expect(wrapper.get('[data-testid="campaign-matched-mem-2"]').text()).toContain('newbie_jp');
    expect(wrapper.get('[data-testid="charge-status-mem-2"]').text()).toBe('Declined');
    expect(wrapper.get('[data-testid="campaign-subtotal-row"]').text()).toContain('$20.00');
    expect(wrapper.get('[data-testid="campaign-subtotal-row"]').text()).toContain('$40.00');

    // Tiers breakdown shows live campaign count and monthly total
    const flowerRow = wrapper.get('[data-testid="tier-row-pro"]').text();
    expect(flowerRow).toContain('Flower');
    expect(flowerRow).toContain('$20.00');
    expect(wrapper.get('[data-testid="patreon-manual-grants-card"]').text()).toContain('kobo');

    // Paid filter + sort by lifetime puts Former Supporter ($45) first
    await wrapper.get('[data-testid="campaign-filter-paid"]').trigger('click');
    await wrapper.get('[data-testid="sort-lifetime"]').trigger('click');
    const rowIds = wrapper.findAll('tbody tr[data-testid^="campaign-row-"]').map((r) => r.attributes('data-testid'));
    expect(rowIds).toEqual(['campaign-row-mem-3', 'campaign-row-mem-1', 'campaign-row-mem-2']);
    expect(wrapper.get('[data-testid="campaign-subtotal-row"]').text()).toContain('$85.00');
  });

  test('switches to linked accounts tab and filters by issues and search query', async () => {
    const wrapper = await render();

    await wrapper.get('[data-testid="tab-linked"]').trigger('click');
    expect(wrapper.find('[data-testid="patreon-row-10"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="patreon-row-11"]').exists()).toBe(true);

    await wrapper.get('[data-testid="patreon-filter-issues"]').trigger('click');
    expect(wrapper.find('[data-testid="patreon-row-10"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="patreon-row-11"]').exists()).toBe(true);

    await wrapper.get('[data-testid="patreon-filter-all"]').trigger('click');
    await wrapper.get('[data-testid="patreon-search"]').setValue('hanako');
    expect(wrapper.find('[data-testid="patreon-row-10"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="patreon-row-11"]').exists()).toBe(false);
  });

  test('triggers inline refresh from campaign tab, unlink from linked tab, and sync-all', async () => {
    const payload = makePayload();
    refreshAdminPatreonConnection.mockResolvedValue(payload.connections[0]);
    unlinkAdminPatreonConnection.mockResolvedValue(undefined);
    refreshAllAdminPatreonConnections.mockResolvedValue({ checked: 2, failed: 0 });

    const wrapper = await render();

    // Inline re-sync directly from Campaign tab
    await wrapper.get('[data-testid="campaign-refresh-10"]').trigger('click');
    await flushPromises();
    expect(refreshAdminPatreonConnection).toHaveBeenCalledWith({ userId: 10 });

    // Switch to Linked tab to unlink taro
    await wrapper.get('[data-testid="tab-linked"]').trigger('click');
    await wrapper.get('[data-testid="patreon-unlink-11"]').trigger('click');
    await wrapper.get('[data-testid="patreon-confirm-unlink-11"]').trigger('click');
    await flushPromises();
    expect(unlinkAdminPatreonConnection).toHaveBeenCalledWith({ userId: 11 });

    await wrapper.get('[data-testid="patreon-sync-all"]').trigger('click');
    await flushPromises();
    expect(refreshAllAdminPatreonConnections).toHaveBeenCalledTimes(1);
  });
});
