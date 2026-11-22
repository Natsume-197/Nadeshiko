<script setup lang="ts">
import type {
  AdminPatreonCampaignMember,
  AdminPatreonConnection,
  AdminPatreonOverview,
} from '@brigadasos/nadeshiko-sdk';
import {
  mdiAccountSearchOutline,
  mdiAlertOutline,
  mdiArrowDown,
  mdiArrowUp,
  mdiCheckCircleOutline,
  mdiMagnify,
  mdiRefresh,
  mdiSwapVertical,
  mdiSync,
} from '@mdi/js';
import { handleApiError } from '~/utils/apiError';
import PatreonLinkActions from './PatreonLinkActions.vue';

type CampaignFilter = 'active' | 'unlinked' | 'paid' | 'all';
type LinkedFilter = 'all' | 'active' | 'issues';
type SortKey = 'monthly' | 'lifetime' | 'since';
type ChipTone = 'brand' | 'warning' | 'danger';

const CHIP_ACTIVE_CLASSES: Record<ChipTone, string> = {
  brand: 'border-brand-solid bg-brand/15 text-brand font-semibold',
  warning: 'border-amber-500/60 bg-amber-500/15 text-amber-300 font-semibold',
  danger: 'border-red-500/60 bg-red-500/15 text-red-300 font-semibold',
};

const SORT_COLUMNS: readonly { key: SortKey; labelKey: string; alignRight: boolean }[] = [
  { key: 'monthly', labelKey: 'adminPatreon.campaign.monthly', alignRight: true },
  { key: 'lifetime', labelKey: 'adminPatreon.campaign.lifetime', alignRight: true },
  { key: 'since', labelKey: 'adminPatreon.campaign.since', alignRight: false },
];

const { t } = useI18n();
const { formatDate, formatNumber, formatRelativeTime, formatUsdCents } = useFormat();
const localePath = useLocalePath();

const data = ref<AdminPatreonOverview | null>(null);
const isLoading = ref(false);
const isSyncingAll = ref(false);
const refreshingUserId = ref<number | null>(null);
const unlinkingUserId = ref<number | null>(null);

const activeTab = ref<'campaign' | 'linked'>('campaign');

const campaignSearch = ref('');
const campaignFilter = ref<CampaignFilter>('active');
const campaignSortKey = ref<'default' | SortKey>('default');
const campaignSortDir = ref<'desc' | 'asc'>('desc');

const searchQuery = ref('');
const statusFilter = ref<LinkedFilter>('all');

async function fetchPatreon(refreshCampaign = false) {
  isLoading.value = true;
  try {
    data.value = await useNadeshikoSdk().getAdminPatreonOverview(
      refreshCampaign ? { refreshCampaign: true } : undefined,
    );
  } catch (error) {
    handleApiError('admin:patreon-fetch-failed', error, { toastKey: 'adminPatreon.loadError' });
  } finally {
    isLoading.value = false;
  }
}

const campaignOk = computed(() => data.value?.campaign.status === 'ok');
const canResync = computed(() => data.value?.configured ?? false);

const kpis = computed(() => {
  if (!data.value) return [];
  const s = data.value.summary;
  const ok = campaignOk.value;
  return [
    {
      id: 'monthly',
      label: t('adminPatreon.kpi.monthlyLabel'),
      value: ok ? formatUsdCents(s.campaignMonthlyCents) : '—',
      valueClass: ok && s.campaignMonthlyCents > 0 ? 'text-emerald-300' : 'text-ink',
      sub: t('adminPatreon.kpi.monthlySub', { count: s.campaignActive }),
    },
    {
      id: 'lifetime',
      label: t('adminPatreon.kpi.lifetimeLabel'),
      value: ok ? formatUsdCents(s.campaignLifetimeCents) : '—',
      valueClass: 'text-ink',
      sub: t('adminPatreon.kpi.lifetimeSub', { count: s.campaignPayingEver }),
    },
    {
      id: 'unlinked',
      label: t('adminPatreon.kpi.unlinkedLabel'),
      value: ok ? formatNumber(s.campaignUnlinkedActive) : '—',
      valueClass: !ok ? 'text-ink-faint' : s.campaignUnlinkedActive > 0 ? 'text-amber-300' : 'text-emerald-300',
      sub: t('adminPatreon.kpi.unlinkedSub', { count: s.campaignActive }),
    },
    {
      id: 'issues',
      label: t('adminPatreon.kpi.issuesLabel'),
      value: formatNumber(s.issues),
      valueClass: s.issues > 0 ? 'text-red-300' : 'text-ink',
      sub: t('adminPatreon.kpi.issuesSub', { count: s.totalLinked }),
    },
  ];
});

const campaignFilters = computed<{ value: CampaignFilter; tone: ChipTone; label: string }[]>(() => {
  const s = data.value?.summary;
  return [
    { value: 'active', tone: 'brand', label: t('adminPatreon.filters.active', { count: s?.campaignActive ?? 0 }) },
    {
      value: 'unlinked',
      tone: 'warning',
      label: t('adminPatreon.campaign.unlinkedFilter', { count: s?.campaignUnlinkedActive ?? 0 }),
    },
    { value: 'paid', tone: 'brand', label: t('adminPatreon.campaign.paidFilter', { count: s?.campaignPayingEver ?? 0 }) },
    { value: 'all', tone: 'brand', label: t('adminPatreon.filters.all', { count: data.value?.campaign.members.length ?? 0 }) },
  ];
});

const linkedFilters = computed<{ value: LinkedFilter; tone: ChipTone; label: string }[]>(() => {
  const s = data.value?.summary;
  return [
    { value: 'all', tone: 'brand', label: t('adminPatreon.filters.all', { count: s?.totalLinked ?? 0 }) },
    { value: 'active', tone: 'brand', label: t('adminPatreon.filters.active', { count: s?.active ?? 0 }) },
    { value: 'issues', tone: 'danger', label: t('adminPatreon.filters.issues', { count: s?.issues ?? 0 }) },
  ];
});

function chipClasses(selected: boolean, tone: ChipTone): string[] {
  return [
    'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
    selected ? CHIP_ACTIVE_CLASSES[tone] : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
  ];
}

const connectionsByUserId = computed(() => {
  const map = new Map<number, AdminPatreonConnection>();
  for (const conn of data.value?.connections ?? []) {
    map.set(conn.userId, conn);
  }
  return map;
});

function toggleCampaignSort(key: SortKey) {
  if (campaignSortKey.value === key) {
    campaignSortDir.value = campaignSortDir.value === 'desc' ? 'asc' : 'desc';
  } else {
    campaignSortKey.value = key;
    campaignSortDir.value = 'desc';
  }
}

function sortIconFor(key: SortKey): string {
  if (campaignSortKey.value !== key) return mdiSwapVertical;
  return campaignSortDir.value === 'desc' ? mdiArrowDown : mdiArrowUp;
}

const filteredCampaignMembers = computed<AdminPatreonCampaignMember[]>(() => {
  const list = data.value?.campaign.members ?? [];
  const q = campaignSearch.value.trim().toLowerCase();

  const filtered = list.filter((member) => {
    if (campaignFilter.value === 'active' && member.patronStatus !== 'active_patron') return false;
    if (
      campaignFilter.value === 'unlinked' &&
      (member.patronStatus !== 'active_patron' || member.linkedUserId !== null)
    ) {
      return false;
    }
    if (campaignFilter.value === 'paid' && member.lifetimeSupportCents <= 0 && member.monthlyAmountCents <= 0) {
      return false;
    }
    if (!q) return true;
    return (
      member.fullName.toLowerCase().includes(q) ||
      (member.email ?? '').toLowerCase().includes(q) ||
      (member.linkedUsername ?? '').toLowerCase().includes(q) ||
      (member.matchedUsername ?? '').toLowerCase().includes(q) ||
      (member.patreonUserId ?? '').toLowerCase().includes(q)
    );
  });

  if (campaignSortKey.value === 'default') return filtered;

  const dir = campaignSortDir.value === 'desc' ? -1 : 1;
  return [...filtered].sort((a, b) => {
    let cmp = 0;
    if (campaignSortKey.value === 'monthly') {
      cmp = a.monthlyAmountCents - b.monthlyAmountCents || a.lifetimeSupportCents - b.lifetimeSupportCents;
    } else if (campaignSortKey.value === 'lifetime') {
      cmp = a.lifetimeSupportCents - b.lifetimeSupportCents || a.monthlyAmountCents - b.monthlyAmountCents;
    } else {
      cmp = (a.pledgeStart ?? '').localeCompare(b.pledgeStart ?? '');
    }
    return cmp * dir;
  });
});

const campaignSubtotal = computed(() =>
  filteredCampaignMembers.value.reduce(
    (acc, member) => {
      acc.monthlyCents += member.monthlyAmountCents;
      acc.lifetimeCents += member.lifetimeSupportCents;
      return acc;
    },
    { monthlyCents: 0, lifetimeCents: 0 },
  ),
);

const filteredConnections = computed<AdminPatreonConnection[]>(() => {
  const list = data.value?.connections ?? [];
  const q = searchQuery.value.trim().toLowerCase();

  return list.filter((conn) => {
    if (statusFilter.value === 'active' && !conn.isActive) return false;
    if (statusFilter.value === 'issues' && !conn.hasIssue) return false;
    if (!q) return true;
    return (
      conn.username.toLowerCase().includes(q) ||
      conn.email.toLowerCase().includes(q) ||
      (conn.fullName ?? '').toLowerCase().includes(q) ||
      conn.patreonUserId.toLowerCase().includes(q)
    );
  });
});

function patronStatusLabel(status: string | null): string {
  switch (status) {
    case 'active_patron':
      return t('adminPatreon.status.activePatron');
    case 'declined_patron':
      return t('adminPatreon.status.declinedPatron');
    case 'former_patron':
      return t('adminPatreon.status.formerPatron');
    default:
      return t('adminPatreon.status.notPatron');
  }
}

function statusPillClasses(status: string | null, isStale = false): string {
  if (status === 'active_patron' && !isStale) return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300';
  if (status === 'declined_patron' || isStale) {
    return 'border-red-500/30 bg-red-500/15 text-red-300';
  }
  return 'border-hairline bg-surface-lift text-ink-muted';
}

function chargeStatusClasses(status: string): string {
  if (status === 'Declined' || status === 'Fraud' || status === 'Refunded') {
    return 'border-red-500/40 bg-red-500/15 text-red-300 font-semibold';
  }
  if (status === 'Pending' || status === 'Other') {
    return 'border-amber-500/40 bg-amber-500/15 text-amber-300 font-semibold';
  }
  return 'border-hairline bg-surface text-ink-faint';
}

function userSearchPath(username: string): string {
  return `${localePath('/admin/users')}?q=${encodeURIComponent(username)}`;
}

async function refreshOne(userId: number) {
  refreshingUserId.value = userId;
  try {
    await useNadeshikoSdk().refreshAdminPatreonConnection({ userId });
    useToastSuccess(t('adminPatreon.refreshOneSuccess'));
    await fetchPatreon(false);
  } catch (error) {
    handleApiError('admin:patreon-refresh-one-failed', error, { toastKey: 'adminPatreon.refreshOneError' });
  } finally {
    refreshingUserId.value = null;
  }
}

async function unlinkOne(userId: number) {
  unlinkingUserId.value = userId;
  try {
    await useNadeshikoSdk().unlinkAdminPatreonConnection({ userId });
    useToastSuccess(t('adminPatreon.unlinkSuccess'));
    await fetchPatreon(false);
  } catch (error) {
    handleApiError('admin:patreon-unlink-failed', error, { toastKey: 'adminPatreon.unlinkError' });
  } finally {
    unlinkingUserId.value = null;
  }
}

async function syncAll() {
  isSyncingAll.value = true;
  try {
    const result = await useNadeshikoSdk().refreshAllAdminPatreonConnections();
    useToastSuccess(t('adminPatreon.syncAllSuccess', { checked: result.checked, failed: result.failed }));
    await fetchPatreon(true);
  } catch (error) {
    handleApiError('admin:patreon-sync-all-failed', error, { toastKey: 'adminPatreon.syncAllError' });
  } finally {
    isSyncingAll.value = false;
  }
}

onMounted(() => fetchPatreon(false));
</script>

<template>
  <div data-testid="admin-patreon-manager" class="space-y-6">
    <!-- Clean header with config badge and global actions -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-wrap items-center gap-2.5">
        <h1 class="text-2xl font-bold tracking-tight text-ink">
          {{ t('adminPatreon.title') }}
        </h1>
        <span
          v-if="data"
          data-testid="patreon-config-badge"
          :class="[
            'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
            data.configured
              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/15 text-amber-300',
          ]"
        >
          {{
            data.configured
              ? t('adminPatreon.configured', { campaignId: data.campaignId ?? '—' })
              : t('adminPatreon.notConfigured')
          }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          data-testid="patreon-reload"
          :disabled="isLoading"
          :aria-label="t('adminDashboard.nav.refresh')"
          :title="t('adminDashboard.nav.refresh')"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-hairline bg-surface px-2.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          @click="fetchPatreon(true)"
        >
          <UiBaseIcon :path="mdiRefresh" :size="16" :class="{ 'animate-spin': isLoading }" />
        </button>

        <button
          type="button"
          data-testid="patreon-sync-all"
          :disabled="!canResync || isSyncingAll || (data?.summary.totalLinked ?? 0) === 0"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          @click="syncAll"
        >
          <UiBaseIcon :path="mdiSync" :size="16" :class="{ 'animate-spin': isSyncingAll }" />
          <span>{{ isSyncingAll ? t('adminPatreon.syncingAll') : t('adminPatreon.syncAll') }}</span>
        </button>
      </div>
    </div>

    <!-- Financial & health summary strip -->
    <div v-if="data" data-testid="patreon-kpi-strip" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div v-for="kpi in kpis" :key="kpi.id" class="rounded-xl border border-hairline bg-card-background px-4 py-3">
        <div class="text-[11px] font-medium text-ink-faint">{{ kpi.label }}</div>
        <div
          :data-testid="`kpi-${kpi.id}`"
          :class="['mt-1 text-2xl font-bold tracking-tight tabular-nums', kpi.valueClass]"
        >
          {{ kpi.value }}
        </div>
        <div class="mt-0.5 text-[11px] text-ink-faint">{{ kpi.sub }}</div>
      </div>
    </div>

    <!-- Main tabbed directory: Patreon Campaign Members | Linked OAuth Accounts -->
    <section
      data-testid="patreon-campaign-section"
      class="rounded-xl border border-hairline bg-card-background p-4 space-y-4"
    >
      <div class="flex flex-col gap-2 border-b border-hairline pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-wrap items-center gap-1.5" role="tablist">
          <button
            type="button"
            role="tab"
            data-testid="tab-campaign"
            :aria-selected="activeTab === 'campaign'"
            :class="[
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
              activeTab === 'campaign'
                ? 'bg-brand/15 text-brand'
                : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
            ]"
            @click="activeTab = 'campaign'"
          >
            {{ t('adminPatreon.tabs.campaign', { count: data?.campaign.members.length ?? 0 }) }}
          </button>

          <button
            type="button"
            role="tab"
            data-testid="tab-linked"
            :aria-selected="activeTab === 'linked'"
            :class="[
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
              activeTab === 'linked'
                ? 'bg-brand/15 text-brand'
                : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
            ]"
            @click="activeTab = 'linked'"
          >
            <span>{{ t('adminPatreon.tabs.linked', { count: data?.summary.totalLinked ?? 0 }) }}</span>
            <span
              v-if="(data?.summary.issues ?? 0) > 0"
              data-testid="tab-linked-issues-badge"
              class="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300 tabular-nums"
            >
              {{ data?.summary.issues }}
            </span>
          </button>
        </div>

        <span v-if="activeTab === 'campaign' && data?.campaign.fetchedAt" class="text-[11px] text-ink-faint">
          {{ t('adminPatreon.campaign.fetchedAt', { when: formatRelativeTime(data.campaign.fetchedAt) }) }}
        </span>
      </div>

      <!-- TAB 1: Live Patreon.com campaign members -->
      <template v-if="activeTab === 'campaign'">
        <p class="text-xs text-ink-faint">{{ t('adminPatreon.campaign.subtitle') }}</p>

        <div
          v-if="data && !campaignOk"
          data-testid="patreon-campaign-alert"
          :class="[
            'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs',
            data.campaign.status === 'unconfigured'
              ? 'border-hairline bg-surface text-ink-muted'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200',
          ]"
        >
          <UiBaseIcon :path="mdiAlertOutline" :size="16" class="mt-0.5 shrink-0" />
          <div>
            <p class="font-medium">
              {{ t(`adminPatreon.campaign.${data.campaign.status}`) }}
            </p>
            <p v-if="data.campaign.errorMessage" class="mt-0.5 text-[11px] opacity-80">
              {{ data.campaign.errorMessage }}
            </p>
          </div>
        </div>

        <template v-else-if="data">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="filter in campaignFilters"
                :key="filter.value"
                type="button"
                :data-testid="`campaign-filter-${filter.value}`"
                :class="chipClasses(campaignFilter === filter.value, filter.tone)"
                @click="campaignFilter = filter.value"
              >
                {{ filter.label }}
              </button>
            </div>

            <div class="relative sm:w-64">
              <input
                v-model="campaignSearch"
                data-testid="campaign-search"
                type="search"
                class="nd-input h-8 pl-8 text-xs"
                :placeholder="t('adminPatreon.searchPlaceholder')"
              />
              <UiBaseIcon
                :path="mdiMagnify"
                :size="15"
                class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
            </div>
          </div>

          <div class="overflow-x-auto rounded-lg border border-hairline">
            <table class="w-full text-left text-xs text-ink-muted">
              <thead class="bg-surface text-[11px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th class="px-3 py-2.5">{{ t('adminPatreon.campaign.member') }}</th>
                  <th class="px-3 py-2.5">{{ t('adminPatreon.table.status') }}</th>
                  <th class="px-3 py-2.5">{{ t('adminPatreon.tiers.tier') }}</th>
                  <th
                    v-for="col in SORT_COLUMNS"
                    :key="col.key"
                    :class="['px-3 py-2.5', { 'text-right': col.alignRight }]"
                  >
                    <button
                      type="button"
                      :data-testid="`sort-${col.key}`"
                      class="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink"
                      @click="toggleCampaignSort(col.key)"
                    >
                      <span>{{ t(col.labelKey) }}</span>
                      <UiBaseIcon :path="sortIconFor(col.key)" :size="13" />
                    </button>
                  </th>
                  <th class="px-3 py-2.5">{{ t('adminPatreon.campaign.nadeshikoLink') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-hairline">
                <tr v-if="filteredCampaignMembers.length === 0">
                  <td colspan="7" class="px-4 py-6 text-center text-ink-faint">
                    {{ t('adminPatreon.campaign.empty') }}
                  </td>
                </tr>
                <tr
                  v-for="member in filteredCampaignMembers"
                  :key="member.memberId"
                  :data-testid="`campaign-row-${member.memberId}`"
                  class="hover:bg-surface-hover/40"
                >
                  <td class="px-3 py-2.5">
                    <div class="font-medium text-ink">{{ member.fullName }}</div>
                    <div class="text-[11px] text-ink-faint">{{ member.email || '—' }}</div>
                  </td>

                  <td class="px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span
                        :class="[
                          'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                          statusPillClasses(member.patronStatus),
                        ]"
                      >
                        {{ patronStatusLabel(member.patronStatus) }}
                      </span>
                      <span
                        v-if="member.lastChargeStatus && member.lastChargeStatus !== 'Paid'"
                        :data-testid="`charge-status-${member.memberId}`"
                        :class="[
                          'rounded border px-1.5 py-0.5 text-[10px]',
                          chargeStatusClasses(member.lastChargeStatus),
                        ]"
                      >
                        {{ member.lastChargeStatus }}
                      </span>
                    </div>
                  </td>

                  <td class="px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span
                        v-if="member.resolvedTierName"
                        class="rounded-md border border-brand/30 bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand"
                      >
                        {{ member.resolvedTierName }}
                      </span>
                      <span
                        v-else-if="member.patreonTierTitles.length > 0"
                        class="rounded-md border border-hairline bg-surface-lift px-2 py-0.5 text-[11px] text-ink"
                      >
                        {{ member.patreonTierTitles.join(', ') }}
                      </span>
                      <span
                        v-for="rawId in member.unmatchedTierIds"
                        :key="rawId"
                        class="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300"
                      >
                        {{ t('adminPatreon.badges.unmatched', { id: rawId }) }}
                      </span>
                      <span
                        v-if="
                          !member.resolvedTierName &&
                          member.patreonTierTitles.length === 0 &&
                          member.unmatchedTierIds.length === 0
                        "
                        class="text-ink-faint"
                      >
                        —
                      </span>
                    </div>
                  </td>

                  <td class="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                    <span
                      v-if="member.monthlyAmountCents > 0"
                      :class="
                        member.patronStatus === 'active_patron' ? 'font-semibold text-emerald-300' : 'text-ink-muted'
                      "
                    >
                      {{ formatUsdCents(member.monthlyAmountCents) }}
                    </span>
                    <span v-else class="text-ink-faint">—</span>
                  </td>

                  <td class="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                    <span v-if="member.lifetimeSupportCents > 0" class="font-medium text-ink">
                      {{ formatUsdCents(member.lifetimeSupportCents) }}
                    </span>
                    <span v-else class="text-ink-faint">—</span>
                  </td>

                  <td class="px-3 py-2.5 whitespace-nowrap">
                    <div class="text-ink-muted">{{ member.pledgeStart ? formatDate(member.pledgeStart) : '—' }}</div>
                    <div v-if="member.lastChargeDate" class="text-[11px] text-ink-faint">
                      {{ t('adminPatreon.campaign.lastCharge', { date: formatDate(member.lastChargeDate) }) }}
                    </div>
                  </td>

                  <td class="px-3 py-2.5">
                    <!-- State 1: Linked via OAuth (with inline actions) -->
                    <div v-if="member.linkedUserId" class="space-y-1">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="inline-flex items-center gap-1 text-emerald-300">
                          <UiBaseIcon :path="mdiCheckCircleOutline" :size="14" />
                          <NuxtLink
                            :to="userSearchPath(member.linkedUsername ?? '')"
                            class="font-medium hover:underline"
                          >
                            {{ member.linkedUsername }}
                          </NuxtLink>
                        </span>
                        <span
                          v-if="connectionsByUserId.get(member.linkedUserId)?.isStale"
                          class="rounded-full border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300"
                        >
                          {{ t('adminPatreon.badges.stale') }}
                        </span>
                      </div>

                      <PatreonLinkActions
                        compact
                        testid-prefix="campaign"
                        :user-id="member.linkedUserId"
                        :can-resync="canResync"
                        :refreshing="refreshingUserId === member.linkedUserId"
                        :unlinking="unlinkingUserId === member.linkedUserId"
                        @refresh="refreshOne(member.linkedUserId)"
                        @unlink="unlinkOne(member.linkedUserId)"
                      />
                    </div>

                    <!-- State 2: Email matches an existing Nadeshiko account (not OAuth-linked yet) -->
                    <div
                      v-else-if="member.matchedUserId && member.matchedUsername"
                      :data-testid="`campaign-matched-${member.memberId}`"
                      class="space-y-0.5"
                    >
                      <NuxtLink
                        :to="userSearchPath(member.matchedUsername)"
                        class="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25"
                      >
                        <UiBaseIcon :path="mdiAccountSearchOutline" :size="13" />
                        <span>{{ member.matchedUsername }}</span>
                      </NuxtLink>
                      <div class="text-[10px] text-ink-faint">
                        {{ t('adminPatreon.campaign.matchedAccount') }} · {{ t('adminPatreon.campaign.noOauthYet') }}
                      </div>
                    </div>

                    <!-- State 3: No Nadeshiko account detected -->
                    <span
                      v-else
                      class="rounded-full border border-hairline bg-surface px-2 py-0.5 text-[11px] text-ink-faint"
                    >
                      {{ t('adminPatreon.campaign.noAccount') }}
                    </span>
                  </td>
                </tr>
              </tbody>
              <tfoot
                v-if="filteredCampaignMembers.length > 0"
                data-testid="campaign-subtotal-row"
                class="border-t border-hairline bg-surface/70 text-xs font-semibold"
              >
                <tr>
                  <td colspan="3" class="px-3 py-2 text-ink-muted">
                    {{ t('adminPatreon.campaign.subtotal', { count: filteredCampaignMembers.length }) }}
                  </td>
                  <td class="px-3 py-2 text-right whitespace-nowrap tabular-nums text-emerald-300">
                    {{ formatUsdCents(campaignSubtotal.monthlyCents) }}
                  </td>
                  <td class="px-3 py-2 text-right whitespace-nowrap tabular-nums text-ink">
                    {{ formatUsdCents(campaignSubtotal.lifetimeCents) }}
                  </td>
                  <td colspan="2" class="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </template>
      </template>

      <!-- TAB 2: Linked Nadeshiko accounts (OAuth connections) -->
      <template v-else>
        <p class="text-xs text-ink-faint">{{ t('adminPatreon.linkedSection.subtitle') }}</p>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="filter in linkedFilters"
              :key="filter.value"
              type="button"
              :data-testid="`patreon-filter-${filter.value}`"
              :class="chipClasses(statusFilter === filter.value, filter.tone)"
              @click="statusFilter = filter.value"
            >
              {{ filter.label }}
            </button>
          </div>

          <div class="relative sm:w-64">
            <input
              v-model="searchQuery"
              data-testid="patreon-search"
              type="search"
              class="nd-input h-8 pl-8 text-xs"
              :placeholder="t('adminPatreon.searchPlaceholder')"
            />
            <UiBaseIcon
              :path="mdiMagnify"
              :size="15"
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            />
          </div>
        </div>

        <div class="overflow-x-auto rounded-lg border border-hairline">
          <table class="w-full text-left text-xs text-ink-muted">
            <thead class="bg-surface text-[11px] uppercase tracking-wider text-ink-faint">
              <tr>
                <th class="px-3 py-2.5">{{ t('adminPatreon.table.account') }}</th>
                <th class="px-3 py-2.5">{{ t('adminPatreon.table.patreon') }}</th>
                <th class="px-3 py-2.5">{{ t('adminPatreon.table.status') }}</th>
                <th class="px-3 py-2.5">{{ t('adminPatreon.table.tierAndQuota') }}</th>
                <th class="px-3 py-2.5">{{ t('adminPatreon.table.lastChecked') }}</th>
                <th class="px-3 py-2.5 text-right">{{ t('adminPatreon.table.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-hairline">
              <tr v-if="isLoading && !data">
                <td colspan="6" class="px-4 py-8 text-center text-ink-faint">
                  {{ t('adminDashboard.loading') }}
                </td>
              </tr>
              <tr v-else-if="filteredConnections.length === 0">
                <td colspan="6" data-testid="patreon-empty" class="px-4 py-8 text-center text-ink-faint">
                  {{ t('adminPatreon.empty') }}
                </td>
              </tr>
              <tr
                v-for="conn in filteredConnections"
                :key="conn.userId"
                :data-testid="`patreon-row-${conn.userId}`"
                class="hover:bg-surface-hover/40"
              >
                <td class="px-3 py-2.5">
                  <NuxtLink :to="userSearchPath(conn.username)" class="font-medium text-ink hover:underline">
                    {{ conn.username }}
                  </NuxtLink>
                  <div class="text-[11px] text-ink-faint">{{ conn.email }}</div>
                </td>

                <td class="px-3 py-2.5">
                  <div class="text-ink">{{ conn.fullName || '—' }}</div>
                  <div class="font-mono text-[11px] text-ink-faint">#{{ conn.patreonUserId }}</div>
                </td>

                <td class="px-3 py-2.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span
                      :class="[
                        'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                        statusPillClasses(conn.patronStatus, conn.isStale),
                      ]"
                    >
                      {{ patronStatusLabel(conn.patronStatus) }}
                    </span>
                    <span
                      v-if="conn.isStale"
                      class="inline-flex items-center gap-0.5 rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300"
                    >
                      <UiBaseIcon :path="mdiAlertOutline" :size="12" />
                      {{ t('adminPatreon.badges.stale') }}
                    </span>
                  </div>
                </td>

                <td class="px-3 py-2.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span
                      v-if="conn.resolvedTierName"
                      class="rounded-md border border-brand/30 bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand"
                    >
                      {{ conn.resolvedTierName }}
                    </span>
                    <span
                      v-for="rawId in conn.unmatchedTierIds"
                      :key="rawId"
                      class="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300"
                    >
                      {{ t('adminPatreon.badges.unmatched', { id: rawId }) }}
                    </span>
                    <span v-if="!conn.resolvedTierName && conn.unmatchedTierIds.length === 0" class="text-ink-faint">
                      —
                    </span>
                    <span
                      v-if="conn.monthlyAmountCents > 0"
                      class="tabular-nums text-[11px] font-medium text-emerald-300/90"
                    >
                      {{ t('adminPatreon.pledgePerMonth', { amount: formatUsdCents(conn.monthlyAmountCents) }) }}
                    </span>
                  </div>
                  <div class="mt-0.5 text-[11px] text-ink-faint">
                    {{
                      t('adminPatreon.quotaPerMonth', {
                        limit: formatNumber(conn.effectiveQuotaLimit),
                        source: conn.quotaSource,
                      })
                    }}
                  </div>
                </td>

                <td class="px-3 py-2.5 whitespace-nowrap" :title="formatDate(conn.membershipCheckedAt)">
                  <div :class="conn.isStale ? 'font-semibold text-red-300' : 'text-ink-muted'">
                    {{ formatRelativeTime(conn.membershipCheckedAt) }}
                  </div>
                  <div class="text-[11px] text-ink-faint">
                    {{ t('adminPatreon.linkedDate', { date: formatDate(conn.linkedAt) }) }}
                  </div>
                </td>

                <td class="px-3 py-2.5 text-right whitespace-nowrap">
                  <PatreonLinkActions
                    testid-prefix="patreon"
                    :user-id="conn.userId"
                    :can-resync="canResync"
                    :refreshing="refreshingUserId === conn.userId"
                    :unlinking="unlinkingUserId === conn.userId"
                    @refresh="refreshOne(conn.userId)"
                    @unlink="unlinkOne(conn.userId)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <!-- Bottom reference: Tier breakdown (real campaign + linked + monthly) & Manual grants -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section data-testid="patreon-tiers-card" class="rounded-xl border border-hairline bg-card-background p-4 space-y-3">
        <div>
          <h2 class="text-sm font-semibold text-ink">{{ t('adminPatreon.tiers.title') }}</h2>
          <p class="text-xs text-ink-faint">{{ t('adminPatreon.tiers.subtitle') }}</p>
        </div>

        <div class="overflow-x-auto rounded-lg border border-hairline">
          <table class="w-full text-left text-xs text-ink-muted">
            <thead class="bg-surface text-[11px] uppercase tracking-wider text-ink-faint">
              <tr>
                <th class="px-3 py-2">{{ t('adminPatreon.tiers.tier') }}</th>
                <th class="px-3 py-2 text-right">{{ t('adminPatreon.tiers.patreon') }}</th>
                <th class="px-3 py-2 text-right">{{ t('adminPatreon.tiers.linked') }}</th>
                <th class="px-3 py-2 text-right">{{ t('adminPatreon.tiers.monthly') }}</th>
                <th class="px-3 py-2 text-right">{{ t('adminPatreon.tiers.perks') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-hairline">
              <tr v-for="tier in data?.tiers ?? []" :key="tier.id" :data-testid="`tier-row-${tier.id}`">
                <td class="px-3 py-2">
                  <div>
                    <span class="font-medium text-ink">{{ tier.displayName }}</span>
                    <span class="ml-1.5 font-mono text-[10px] text-ink-faint">{{ tier.id }}</span>
                  </div>
                  <div v-if="tier.patreonTierId" class="font-mono text-[10px] text-ink-faint">
                    #{{ tier.patreonTierId }}
                  </div>
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  <span
                    v-if="tier.patreonTierId"
                    :class="tier.campaignPatronCount > 0 ? 'font-semibold text-ink' : 'text-ink-faint'"
                  >
                    {{ tier.campaignPatronCount }}
                  </span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  <span v-if="tier.patreonTierId" :class="tier.activePatronCount > 0 ? 'text-emerald-300' : 'text-ink-faint'">
                    {{ tier.activePatronCount }}
                  </span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td class="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  <span
                    v-if="tier.patreonTierId && tier.campaignMonthlyCents > 0"
                    class="font-semibold text-emerald-300"
                  >
                    {{ formatUsdCents(tier.campaignMonthlyCents) }}
                  </span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td class="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  <div class="text-ink">{{ formatNumber(tier.monthlyQuotaLimit) }}</div>
                  <div v-if="tier.monthlyRequestBoosts > 0" class="text-[10px] text-ink-faint">
                    +{{ tier.monthlyRequestBoosts }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        data-testid="patreon-manual-grants-card"
        class="rounded-xl border border-hairline bg-card-background p-4 space-y-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-ink">{{ t('adminPatreon.manualGrants.title') }}</h2>
            <p class="text-xs text-ink-faint">{{ t('adminPatreon.manualGrants.subtitle') }}</p>
          </div>
          <NuxtLink :to="localePath('/admin/users')" class="shrink-0 text-xs font-medium text-brand hover:underline">
            {{ t('adminPatreon.manualGrants.manageInUsers') }}
          </NuxtLink>
        </div>

        <div class="overflow-x-auto rounded-lg border border-hairline">
          <table class="w-full text-left text-xs text-ink-muted">
            <thead class="bg-surface text-[11px] uppercase tracking-wider text-ink-faint">
              <tr>
                <th class="px-3 py-2">{{ t('adminPatreon.table.account') }}</th>
                <th class="px-3 py-2">{{ t('adminPatreon.manualGrants.assignment') }}</th>
                <th class="px-3 py-2 text-right">{{ t('adminPatreon.tiers.quota') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-hairline">
              <tr v-if="(data?.manualGrants.length ?? 0) === 0">
                <td colspan="3" class="px-3 py-6 text-center text-ink-faint">
                  {{ t('adminPatreon.manualGrants.empty') }}
                </td>
              </tr>
              <tr v-for="grant in data?.manualGrants ?? []" :key="grant.userId">
                <td class="px-3 py-2">
                  <NuxtLink :to="userSearchPath(grant.username)" class="font-medium text-ink hover:underline">
                    {{ grant.username }}
                  </NuxtLink>
                  <div class="text-[11px] text-ink-faint">{{ grant.email }}</div>
                </td>
                <td class="px-3 py-2">
                  <span
                    v-if="grant.quotaOverride != null"
                    class="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300"
                  >
                    {{ t('adminPatreon.manualGrants.override') }}
                  </span>
                  <span
                    v-else-if="grant.tierName"
                    class="rounded-md border border-hairline bg-surface-lift px-2 py-0.5 text-[11px] font-medium text-ink"
                  >
                    {{ grant.tierName }}
                  </span>
                </td>
                <td class="px-3 py-2 text-right tabular-nums font-medium text-ink">
                  {{ formatNumber(grant.effectiveQuotaLimit) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
