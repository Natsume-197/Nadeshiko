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
  mdiHeartOutline,
  mdiLinkVariantOff,
  mdiMagnify,
  mdiRefresh,
  mdiSwapVertical,
  mdiSync,
} from '@mdi/js';
import { handleApiError } from '~/utils/apiError';
import PatreonLinkActions from './PatreonLinkActions.vue';
import AdminUiBadge, { type AdminTone } from './ui/Badge.vue';
import AdminUiCard from './ui/Card.vue';
import AdminUiEmpty from './ui/Empty.vue';
import AdminUiPageHeader from './ui/PageHeader.vue';
import AdminUiSegmented, { type AdminSegment } from './ui/Segmented.vue';
import AdminUiStatStrip, { type AdminStat } from './ui/StatStrip.vue';
import AdminUiTabs, { type AdminTab } from './ui/Tabs.vue';

type CampaignFilter = 'active' | 'unlinked' | 'paid' | 'all';
type LinkedFilter = 'all' | 'active' | 'issues';
type SortKey = 'monthly' | 'lifetime' | 'since';
type Tab = 'campaign' | 'linked' | 'tiers';

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

const activeTab = ref<Tab>('campaign');
const mounted = ref(false);
onMounted(() => (mounted.value = true));

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

const stats = computed<AdminStat[]>(() => {
  const s = data.value?.summary;
  const ok = campaignOk.value;
  return [
    {
      id: 'monthly',
      label: t('adminPatreon.kpi.monthlyLabel'),
      value: s ? (ok ? formatUsdCents(s.campaignMonthlyCents) : '—') : null,
      sub: s ? t('adminPatreon.kpi.monthlySub', { count: s.campaignActive }) : undefined,
      tone: ok && s && s.campaignMonthlyCents > 0 ? 'success' : 'neutral',
      testid: 'kpi-monthly',
    },
    {
      id: 'lifetime',
      label: t('adminPatreon.kpi.lifetimeLabel'),
      value: s ? (ok ? formatUsdCents(s.campaignLifetimeCents) : '—') : null,
      sub: s ? t('adminPatreon.kpi.lifetimeSub', { count: s.campaignPayingEver }) : undefined,
      testid: 'kpi-lifetime',
    },
    {
      id: 'unlinked',
      label: t('adminPatreon.kpi.unlinkedLabel'),
      value: s ? (ok ? formatNumber(s.campaignUnlinkedActive) : '—') : null,
      sub: s ? t('adminPatreon.kpi.unlinkedSub', { count: s.campaignActive }) : undefined,
      tone: ok && s && s.campaignUnlinkedActive > 0 ? 'warning' : 'neutral',
      testid: 'kpi-unlinked',
    },
    {
      id: 'issues',
      label: t('adminPatreon.kpi.issuesLabel'),
      value: s ? formatNumber(s.issues) : null,
      sub: s ? t('adminPatreon.kpi.issuesSub', { count: s.totalLinked }) : undefined,
      tone: s && s.issues > 0 ? 'danger' : 'neutral',
      testid: 'kpi-issues',
    },
  ];
});

const tabs = computed<AdminTab<Tab>[]>(() => [
  { value: 'campaign', label: t('adminPatreon.tabs.members'), count: data.value?.campaign.members.length ?? null },
  {
    value: 'linked',
    label: t('adminPatreon.tabs.accounts'),
    count: data.value?.summary.totalLinked ?? null,
    alert: (data.value?.summary.issues ?? 0) > 0,
  },
  { value: 'tiers', label: t('adminPatreon.tabs.tiers'), count: data.value?.tiers.length ?? null },
]);

const campaignFilters = computed<AdminSegment<CampaignFilter>[]>(() => {
  const s = data.value?.summary;
  return [
    { value: 'active', label: t('adminPatreon.segments.active'), count: s?.campaignActive ?? 0 },
    { value: 'unlinked', label: t('adminPatreon.segments.unlinked'), count: s?.campaignUnlinkedActive ?? 0 },
    { value: 'paid', label: t('adminPatreon.segments.paid'), count: s?.campaignPayingEver ?? 0 },
    { value: 'all', label: t('adminPatreon.segments.all'), count: data.value?.campaign.members.length ?? 0 },
  ];
});

const linkedFilters = computed<AdminSegment<LinkedFilter>[]>(() => {
  const s = data.value?.summary;
  return [
    { value: 'all', label: t('adminPatreon.segments.all'), count: s?.totalLinked ?? 0 },
    { value: 'active', label: t('adminPatreon.segments.active'), count: s?.active ?? 0 },
    {
      value: 'issues',
      label: t('adminPatreon.segments.issues'),
      count: s?.issues ?? 0,
      dot: (s?.issues ?? 0) > 0 ? 'bg-red-400' : undefined,
    },
  ];
});

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

function patronTone(status: string | null, isStale = false): AdminTone {
  if (status === 'active_patron' && !isStale) return 'success';
  if (status === 'declined_patron' || isStale) return 'danger';
  return 'neutral';
}

function chargeTone(status: string): AdminTone {
  if (status === 'Declined' || status === 'Fraud' || status === 'Refunded') return 'danger';
  if (status === 'Pending' || status === 'Other') return 'warning';
  return 'neutral';
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
  <div data-testid="admin-patreon-manager" class="space-y-5">
    <AdminUiPageHeader :title="t('adminPatreon.title')">
      <template #meta>
        <AdminUiBadge
          v-if="data"
          data-testid="patreon-config-badge"
          :tone="data.configured ? 'neutral' : 'warning'"
          dot
        >
          {{
            data.configured
              ? t('adminPatreon.configured', { campaignId: data.campaignId ?? '—' })
              : t('adminPatreon.notConfigured')
          }}
        </AdminUiBadge>
      </template>
      <template #actions>
        <button
          type="button"
          data-testid="patreon-reload"
          :disabled="mounted && isLoading"
          class="nd-btn !h-8 !text-[13px]"
          @click="fetchPatreon(true)"
        >
          <UiBaseIcon :path="mdiRefresh" :size="15" w="w-4" h="h-4" :class="{ 'animate-spin': mounted && isLoading }" />
          <span>{{ t('adminLayout.reload') }}</span>
        </button>
        <button
          type="button"
          data-testid="patreon-sync-all"
          :disabled="!canResync || isSyncingAll || (data?.summary.totalLinked ?? 0) === 0"
          class="nd-btn-accent !h-8 !text-[13px]"
          @click="syncAll"
        >
          <span v-if="isSyncingAll" class="nd-spinner" />
          <UiBaseIcon v-else :path="mdiSync" :size="15" w="w-4" h="h-4" />
          <span>{{ isSyncingAll ? t('adminPatreon.syncingAll') : t('adminPatreon.syncAll') }}</span>
        </button>
      </template>
    </AdminUiPageHeader>

    <AdminUiStatStrip data-testid="patreon-kpi-strip" :stats="stats" />

    <section data-testid="patreon-campaign-section" class="space-y-4">
      <AdminUiTabs v-model="activeTab" :tabs="tabs" testid-prefix="tab" />

      <!-- Skeleton until the first payload arrives, whichever tab is open -->
      <div v-if="!data" class="nd-admin-table-wrap">
        <AdminUiEmpty
          v-if="mounted && !isLoading"
          :icon="mdiAlertOutline"
          tone="danger"
          :text="t('adminPatreon.loadError')"
        />
        <template v-else>
          <div v-for="n in 6" :key="n" class="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-0">
            <span class="h-3 w-36 animate-pulse rounded bg-surface-lift" />
            <span class="h-3 w-20 animate-pulse rounded bg-surface-lift" />
            <span class="h-3 flex-1 animate-pulse rounded bg-surface-lift" />
          </div>
        </template>
      </div>

      <!-- Patreon campaign members -->
      <template v-else-if="activeTab === 'campaign'">
        <div
          v-if="!campaignOk"
          data-testid="patreon-campaign-alert"
          class="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] text-amber-400"
        >
          <UiBaseIcon :path="mdiAlertOutline" :size="16" w="w-4" h="h-4" class="shrink-0" />
          <span class="min-w-0 truncate">
            {{ t(`adminPatreon.campaign.${data.campaign.status}`) }}
            <span v-if="data.campaign.errorMessage" class="opacity-70">· {{ data.campaign.errorMessage }}</span>
          </span>
        </div>

        <template v-else>
          <div class="flex flex-wrap items-center gap-2">
            <AdminUiSegmented v-model="campaignFilter" data-testid="campaign-filters" testid-prefix="campaign-filter" :options="campaignFilters" />
            <div class="relative w-full sm:w-64">
              <UiBaseIcon
                :path="mdiMagnify"
                :size="15"
                w="w-4"
                h="h-4"
                class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                v-model="campaignSearch"
                data-testid="campaign-search"
                type="search"
                class="nd-input !h-8 !pl-8 !text-[13px]"
                :placeholder="t('adminPatreon.searchPlaceholder')"
              />
            </div>
            <span v-if="data.campaign.fetchedAt" class="ml-auto text-xs text-ink-faint">
              {{ t('adminPatreon.campaign.fetchedAt', { when: formatRelativeTime(data.campaign.fetchedAt) }) }}
            </span>
          </div>

          <div v-if="filteredCampaignMembers.length === 0" class="nd-admin-table-wrap">
            <AdminUiEmpty :icon="mdiHeartOutline" :text="t('adminPatreon.campaign.empty')" />
          </div>
          <div v-else class="nd-admin-table-wrap">
            <table class="nd-admin-table min-w-[980px]">
              <thead>
                <tr>
                  <th>{{ t('adminPatreon.campaign.member') }}</th>
                  <th>{{ t('adminPatreon.table.status') }}</th>
                  <th>{{ t('adminPatreon.tiers.tier') }}</th>
                  <th v-for="col in SORT_COLUMNS" :key="col.key" :class="{ 'text-right': col.alignRight }">
                    <button
                      type="button"
                      :data-testid="`sort-${col.key}`"
                      class="inline-flex items-center gap-1 transition-colors hover:text-ink"
                      :class="campaignSortKey === col.key ? 'text-ink' : ''"
                      @click="toggleCampaignSort(col.key)"
                    >
                      <span>{{ t(col.labelKey) }}</span>
                      <UiBaseIcon :path="sortIconFor(col.key)" :size="13" w="w-3.5" h="h-3.5" />
                    </button>
                  </th>
                  <th>{{ t('adminPatreon.campaign.nadeshikoLink') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="member in filteredCampaignMembers"
                  :key="member.memberId"
                  :data-testid="`campaign-row-${member.memberId}`"
                >
                  <td>
                    <div class="max-w-[14rem] truncate font-medium text-ink">{{ member.fullName }}</div>
                    <div class="max-w-[14rem] truncate text-xs text-ink-faint">{{ member.email || '—' }}</div>
                  </td>

                  <td>
                    <div class="flex flex-wrap items-center gap-1">
                      <AdminUiBadge :tone="patronTone(member.patronStatus)" dot>
                        {{ patronStatusLabel(member.patronStatus) }}
                      </AdminUiBadge>
                      <AdminUiBadge
                        v-if="member.lastChargeStatus && member.lastChargeStatus !== 'Paid'"
                        :data-testid="`charge-status-${member.memberId}`"
                        :tone="chargeTone(member.lastChargeStatus)"
                      >{{ member.lastChargeStatus }}</AdminUiBadge>
                    </div>
                  </td>

                  <td>
                    <div class="flex flex-wrap items-center gap-1">
                      <AdminUiBadge v-if="member.resolvedTierName" tone="brand">{{ member.resolvedTierName }}</AdminUiBadge>
                      <AdminUiBadge v-else-if="member.patreonTierTitles.length > 0">
                        {{ member.patreonTierTitles.join(', ') }}
                      </AdminUiBadge>
                      <AdminUiBadge v-for="rawId in member.unmatchedTierIds" :key="rawId" tone="warning">
                        {{ t('adminPatreon.badges.unmatched', { id: rawId }) }}
                      </AdminUiBadge>
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

                  <td class="whitespace-nowrap text-right tabular-nums">
                    <span
                      v-if="member.monthlyAmountCents > 0"
                      :class="member.patronStatus === 'active_patron' ? 'font-medium text-emerald-400' : 'text-ink-muted'"
                    >
                      {{ formatUsdCents(member.monthlyAmountCents) }}
                    </span>
                    <span v-else class="text-ink-faint">—</span>
                  </td>

                  <td class="whitespace-nowrap text-right tabular-nums">
                    <span v-if="member.lifetimeSupportCents > 0" class="text-ink">
                      {{ formatUsdCents(member.lifetimeSupportCents) }}
                    </span>
                    <span v-else class="text-ink-faint">—</span>
                  </td>

                  <td class="whitespace-nowrap">
                    <div class="text-xs tabular-nums text-ink-muted">
                      {{ member.pledgeStart ? formatDate(member.pledgeStart) : '—' }}
                    </div>
                    <div v-if="member.lastChargeDate" class="text-xs text-ink-faint">
                      {{ t('adminPatreon.campaign.lastCharge', { date: formatDate(member.lastChargeDate) }) }}
                    </div>
                  </td>

                  <td>
                    <!-- Linked via OAuth -->
                    <div v-if="member.linkedUserId" class="flex flex-wrap items-center gap-2">
                      <span class="inline-flex items-center gap-1 text-emerald-400">
                        <UiBaseIcon :path="mdiCheckCircleOutline" :size="14" w="w-3.5" h="h-3.5" />
                        <NuxtLink :to="userSearchPath(member.linkedUsername ?? '')" class="font-medium hover:underline">
                          {{ member.linkedUsername }}
                        </NuxtLink>
                      </span>
                      <AdminUiBadge v-if="connectionsByUserId.get(member.linkedUserId)?.isStale" tone="danger">
                        {{ t('adminPatreon.badges.stale') }}
                      </AdminUiBadge>
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

                    <!-- Email matches an account that has not linked via OAuth yet -->
                    <div
                      v-else-if="member.matchedUserId && member.matchedUsername"
                      :data-testid="`campaign-matched-${member.memberId}`"
                    >
                      <NuxtLink
                        :to="userSearchPath(member.matchedUsername)"
                        class="inline-flex items-center gap-1 font-medium text-amber-400 hover:underline"
                      >
                        <UiBaseIcon :path="mdiAccountSearchOutline" :size="14" w="w-3.5" h="h-3.5" />
                        <span>{{ member.matchedUsername }}</span>
                      </NuxtLink>
                      <div class="text-xs text-ink-faint">
                        {{ t('adminPatreon.campaign.matchedAccount') }} · {{ t('adminPatreon.campaign.noOauthYet') }}
                      </div>
                    </div>

                    <span v-else class="text-xs text-ink-faint">{{ t('adminPatreon.campaign.noAccount') }}</span>
                  </td>
                </tr>
              </tbody>
              <tfoot data-testid="campaign-subtotal-row" class="border-t border-hairline bg-surface/60 text-[13px]">
                <tr>
                  <td colspan="3" class="px-4 py-2.5 text-xs font-medium text-ink-muted">
                    {{ t('adminPatreon.campaign.subtotal', { count: filteredCampaignMembers.length }) }}
                  </td>
                  <td class="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-emerald-400">
                    {{ formatUsdCents(campaignSubtotal.monthlyCents) }}
                  </td>
                  <td class="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums text-ink">
                    {{ formatUsdCents(campaignSubtotal.lifetimeCents) }}
                  </td>
                  <td colspan="2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </template>
      </template>

      <!-- Linked accounts (OAuth connections) -->
      <template v-else-if="activeTab === 'linked'">
        <div class="flex flex-wrap items-center gap-2">
          <AdminUiSegmented v-model="statusFilter" data-testid="patreon-filters" testid-prefix="patreon-filter" :options="linkedFilters" />
          <div class="relative w-full sm:w-64">
            <UiBaseIcon
              :path="mdiMagnify"
              :size="15"
              w="w-4"
              h="h-4"
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              v-model="searchQuery"
              data-testid="patreon-search"
              type="search"
              class="nd-input !h-8 !pl-8 !text-[13px]"
              :placeholder="t('adminPatreon.searchPlaceholder')"
            />
          </div>
        </div>

        <div v-if="filteredConnections.length === 0" data-testid="patreon-empty" class="nd-admin-table-wrap">
          <AdminUiEmpty :icon="mdiLinkVariantOff" :text="t('adminPatreon.empty')" />
        </div>
        <div v-else class="nd-admin-table-wrap">
          <table class="nd-admin-table min-w-[960px]">
            <thead>
              <tr>
                <th>{{ t('adminPatreon.table.account') }}</th>
                <th>{{ t('adminPatreon.table.patreon') }}</th>
                <th>{{ t('adminPatreon.table.status') }}</th>
                <th>{{ t('adminPatreon.table.tierAndQuota') }}</th>
                <th>{{ t('adminPatreon.table.lastChecked') }}</th>
                <th class="text-right">{{ t('adminPatreon.table.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="conn in filteredConnections" :key="conn.userId" :data-testid="`patreon-row-${conn.userId}`">
                <td>
                  <NuxtLink :to="userSearchPath(conn.username)" class="font-medium text-ink hover:underline">
                    {{ conn.username }}
                  </NuxtLink>
                  <div class="max-w-[14rem] truncate text-xs text-ink-faint">{{ conn.email }}</div>
                </td>

                <td>
                  <div class="text-ink">{{ conn.fullName || '—' }}</div>
                  <div class="font-mono text-[11px] text-ink-faint">#{{ conn.patreonUserId }}</div>
                </td>

                <td>
                  <div class="flex flex-wrap items-center gap-1">
                    <AdminUiBadge :tone="patronTone(conn.patronStatus, conn.isStale)" dot>
                      {{ patronStatusLabel(conn.patronStatus) }}
                    </AdminUiBadge>
                    <AdminUiBadge v-if="conn.isStale" tone="danger">{{ t('adminPatreon.badges.stale') }}</AdminUiBadge>
                  </div>
                </td>

                <td>
                  <div class="flex flex-wrap items-center gap-1">
                    <AdminUiBadge v-if="conn.resolvedTierName" tone="brand">{{ conn.resolvedTierName }}</AdminUiBadge>
                    <AdminUiBadge v-for="rawId in conn.unmatchedTierIds" :key="rawId" tone="warning">
                      {{ t('adminPatreon.badges.unmatched', { id: rawId }) }}
                    </AdminUiBadge>
                    <span v-if="!conn.resolvedTierName && conn.unmatchedTierIds.length === 0" class="text-ink-faint">—</span>
                    <span v-if="conn.monthlyAmountCents > 0" class="text-xs tabular-nums text-emerald-400">
                      {{ t('adminPatreon.pledgePerMonth', { amount: formatUsdCents(conn.monthlyAmountCents) }) }}
                    </span>
                  </div>
                  <div class="mt-0.5 text-xs text-ink-faint">
                    {{
                      t('adminPatreon.quotaPerMonth', {
                        limit: formatNumber(conn.effectiveQuotaLimit),
                        source: t(`adminPatreon.quotaSource.${conn.quotaSource}`),
                      })
                    }}
                  </div>
                </td>

                <td class="whitespace-nowrap" :title="formatDate(conn.membershipCheckedAt)">
                  <div class="text-xs tabular-nums" :class="conn.isStale ? 'font-medium text-red-400' : 'text-ink-muted'">
                    {{ formatRelativeTime(conn.membershipCheckedAt) }}
                  </div>
                  <div class="text-xs text-ink-faint">
                    {{ t('adminPatreon.linkedDate', { date: formatDate(conn.linkedAt) }) }}
                  </div>
                </td>

                <td class="whitespace-nowrap text-right">
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

      <!-- Tier mapping and manual grants -->
      <div v-else class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <AdminUiCard data-testid="patreon-tiers-card" :title="t('adminPatreon.tiers.title')" flush>
          <div class="overflow-x-auto">
            <table class="nd-admin-table min-w-[460px]">
              <thead>
                <tr>
                  <th>{{ t('adminPatreon.tiers.tier') }}</th>
                  <th class="text-right">{{ t('adminPatreon.tiers.patreon') }}</th>
                  <th class="text-right">{{ t('adminPatreon.tiers.linked') }}</th>
                  <th class="text-right">{{ t('adminPatreon.tiers.monthly') }}</th>
                  <th class="text-right">{{ t('adminPatreon.tiers.perks') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tier in data.tiers" :key="tier.id" :data-testid="`tier-row-${tier.id}`">
                  <td>
                    <div class="flex items-baseline gap-1.5">
                      <span class="font-medium text-ink">{{ tier.displayName }}</span>
                      <span class="font-mono text-[11px] text-ink-faint">{{ tier.id }}</span>
                    </div>
                    <div v-if="tier.patreonTierId" class="font-mono text-[11px] text-ink-faint">
                      #{{ tier.patreonTierId }}
                    </div>
                  </td>
                  <td class="text-right tabular-nums">
                    <span
                      v-if="tier.patreonTierId"
                      :class="tier.campaignPatronCount > 0 ? 'font-medium text-ink' : 'text-ink-faint'"
                    >
                      {{ tier.campaignPatronCount }}
                    </span>
                    <span v-else class="text-ink-faint">—</span>
                  </td>
                  <td class="text-right tabular-nums">
                    <span
                      v-if="tier.patreonTierId"
                      :class="tier.activePatronCount > 0 ? 'text-emerald-400' : 'text-ink-faint'"
                    >
                      {{ tier.activePatronCount }}
                    </span>
                    <span v-else class="text-ink-faint">—</span>
                  </td>
                  <td class="whitespace-nowrap text-right tabular-nums">
                    <span v-if="tier.patreonTierId && tier.campaignMonthlyCents > 0" class="font-medium text-emerald-400">
                      {{ formatUsdCents(tier.campaignMonthlyCents) }}
                    </span>
                    <span v-else class="text-ink-faint">—</span>
                  </td>
                  <td class="whitespace-nowrap text-right tabular-nums">
                    <div class="text-ink">{{ formatNumber(tier.monthlyQuotaLimit) }}</div>
                    <div v-if="tier.monthlyRequestBoosts > 0" class="text-xs text-ink-faint">
                      +{{ tier.monthlyRequestBoosts }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </AdminUiCard>

        <AdminUiCard data-testid="patreon-manual-grants-card" :title="t('adminPatreon.manualGrants.title')" flush>
          <template #actions>
            <NuxtLink :to="localePath('/admin/users')" class="text-xs font-medium text-brand hover:underline">
              {{ t('adminPatreon.manualGrants.manageInUsers') }}
            </NuxtLink>
          </template>
          <AdminUiEmpty
            v-if="data.manualGrants.length === 0"
            compact
            :text="t('adminPatreon.manualGrants.empty')"
          />
          <div v-else class="overflow-x-auto">
            <table class="nd-admin-table min-w-[380px]">
              <thead>
                <tr>
                  <th>{{ t('adminPatreon.table.account') }}</th>
                  <th>{{ t('adminPatreon.manualGrants.assignment') }}</th>
                  <th class="text-right">{{ t('adminPatreon.tiers.quota') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="grant in data.manualGrants" :key="grant.userId">
                  <td>
                    <NuxtLink :to="userSearchPath(grant.username)" class="font-medium text-ink hover:underline">
                      {{ grant.username }}
                    </NuxtLink>
                    <div class="max-w-[14rem] truncate text-xs text-ink-faint">{{ grant.email }}</div>
                  </td>
                  <td>
                    <AdminUiBadge v-if="grant.quotaOverride != null" tone="warning">
                      {{ t('adminPatreon.manualGrants.override') }}
                    </AdminUiBadge>
                    <AdminUiBadge v-else-if="grant.tierName">{{ grant.tierName }}</AdminUiBadge>
                  </td>
                  <td class="text-right font-medium tabular-nums text-ink">
                    {{ formatNumber(grant.effectiveQuotaLimit) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </AdminUiCard>
      </div>
    </section>
  </div>
</template>
