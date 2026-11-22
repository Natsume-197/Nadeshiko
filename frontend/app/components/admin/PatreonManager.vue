<script setup lang="ts">
import type { AdminPatreonConnection, AdminPatreonOverview } from '@brigadasos/nadeshiko-sdk';
import { mdiAlertOutline, mdiLinkOff, mdiMagnify, mdiRefresh, mdiSync } from '@mdi/js';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();
const { formatDate, formatNumber, formatRelativeTime } = useFormat();
const localePath = useLocalePath();
const { refresh: refreshAdminOverview } = useAdminOverview();

const data = ref<AdminPatreonOverview | null>(null);
const isLoading = ref(false);
const isSyncingAll = ref(false);
const refreshingUserId = ref<number | null>(null);
const unlinkingUserId = ref<number | null>(null);
const confirmingUnlinkUserId = ref<number | null>(null);

const searchQuery = ref('');
const statusFilter = ref<'all' | 'active' | 'issues'>('all');

async function fetchPatreon() {
  isLoading.value = true;
  try {
    data.value = await useNadeshikoSdk().getAdminPatreonOverview();
  } catch (error) {
    handleApiError('admin:patreon-fetch-failed', error, { toastKey: 'adminPatreon.loadError' });
  } finally {
    isLoading.value = false;
  }
}

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

function patronStatusClasses(conn: AdminPatreonConnection): string {
  if (conn.isActive) return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300';
  if (conn.patronStatus === 'declined_patron' || conn.isStale) {
    return 'border-red-500/30 bg-red-500/15 text-red-300';
  }
  return 'border-hairline bg-surface-lift text-ink-muted';
}

async function refreshOne(userId: number) {
  refreshingUserId.value = userId;
  try {
    const updated = await useNadeshikoSdk().refreshAdminPatreonConnection({ userId });
    if (data.value) {
      data.value = {
        ...data.value,
        connections: data.value.connections.map((c) => (c.userId === userId ? updated : c)),
      };
    }
    useToastSuccess(t('adminPatreon.refreshOneSuccess'));
    await Promise.all([fetchPatreon(), refreshAdminOverview()]);
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
    confirmingUnlinkUserId.value = null;
    useToastSuccess(t('adminPatreon.unlinkSuccess'));
    await Promise.all([fetchPatreon(), refreshAdminOverview()]);
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
    await Promise.all([fetchPatreon(), refreshAdminOverview()]);
  } catch (error) {
    handleApiError('admin:patreon-sync-all-failed', error, { toastKey: 'adminPatreon.syncAllError' });
  } finally {
    isSyncingAll.value = false;
  }
}

onMounted(fetchPatreon);
</script>

<template>
  <div data-testid="admin-patreon-manager" class="space-y-6">
    <!-- Compact header with config status, inline summary, and Sync all -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
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

        <p v-if="data" data-testid="patreon-summary-line" class="mt-1 text-xs text-ink-faint">
          {{
            t('adminPatreon.summaryLine', {
              active: data.summary.active,
              linked: data.summary.totalLinked,
              issues: data.summary.issues,
            })
          }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          data-testid="patreon-reload"
          :disabled="isLoading"
          :aria-label="t('adminDashboard.nav.refresh')"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-hairline bg-surface px-2.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          @click="fetchPatreon"
        >
          <UiBaseIcon :path="mdiRefresh" :size="16" :class="{ 'animate-spin': isLoading }" />
        </button>

        <button
          type="button"
          data-testid="patreon-sync-all"
          :disabled="!data?.configured || isSyncingAll || (data?.summary.totalLinked ?? 0) === 0"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          @click="syncAll"
        >
          <UiBaseIcon :path="mdiSync" :size="16" :class="{ 'animate-spin': isSyncingAll }" />
          <span>{{ isSyncingAll ? t('adminPatreon.syncingAll') : t('adminPatreon.syncAll') }}</span>
        </button>
      </div>
    </div>

    <!-- Linked Patreon connections -->
    <section class="rounded-xl border border-hairline bg-card-background p-4 space-y-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="patreon-filter-all"
            :class="[
              'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
              statusFilter === 'all'
                ? 'border-brand-solid bg-brand/15 text-brand font-semibold'
                : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
            ]"
            @click="statusFilter = 'all'"
          >
            {{ t('adminPatreon.filters.all', { count: data?.summary.totalLinked ?? 0 }) }}
          </button>
          <button
            type="button"
            data-testid="patreon-filter-active"
            :class="[
              'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
              statusFilter === 'active'
                ? 'border-brand-solid bg-brand/15 text-brand font-semibold'
                : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
            ]"
            @click="statusFilter = 'active'"
          >
            {{ t('adminPatreon.filters.active', { count: data?.summary.active ?? 0 }) }}
          </button>
          <button
            type="button"
            data-testid="patreon-filter-issues"
            :class="[
              'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
              statusFilter === 'issues'
                ? 'border-red-500/60 bg-red-500/15 text-red-300 font-semibold'
                : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
            ]"
            @click="statusFilter = 'issues'"
          >
            {{ t('adminPatreon.filters.issues', { count: data?.summary.issues ?? 0 }) }}
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
                <div class="font-medium text-ink">{{ conn.username }}</div>
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
                      patronStatusClasses(conn),
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
                <div v-if="confirmingUnlinkUserId === conn.userId" class="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    :data-testid="`patreon-confirm-unlink-${conn.userId}`"
                    :disabled="unlinkingUserId === conn.userId"
                    class="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                    @click="unlinkOne(conn.userId)"
                  >
                    {{ t('adminPatreon.actions.confirmUnlink') }}
                  </button>
                  <button
                    type="button"
                    class="rounded-md border border-hairline bg-surface px-2 py-1 text-[11px] text-ink-muted hover:text-ink"
                    @click="confirmingUnlinkUserId = null"
                  >
                    {{ t('adminPatreon.actions.cancel') }}
                  </button>
                </div>

                <div v-else class="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    :data-testid="`patreon-refresh-${conn.userId}`"
                    :disabled="!data?.configured || refreshingUserId === conn.userId"
                    class="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                    @click="refreshOne(conn.userId)"
                  >
                    <UiBaseIcon
                      :path="mdiSync"
                      :size="13"
                      :class="{ 'animate-spin': refreshingUserId === conn.userId }"
                    />
                    <span>{{ t('adminPatreon.actions.resync') }}</span>
                  </button>
                  <button
                    type="button"
                    :data-testid="`patreon-unlink-${conn.userId}`"
                    class="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-1 text-[11px] font-medium text-ink-faint transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                    :title="t('adminPatreon.actions.unlink')"
                    @click="confirmingUnlinkUserId = conn.userId"
                  >
                    <UiBaseIcon :path="mdiLinkOff" :size="13" />
                    <span>{{ t('adminPatreon.actions.unlink') }}</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Bottom read-only reference: Tier mapping + Manual grants -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Tier mapping -->
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
                <th class="px-3 py-2">{{ t('adminPatreon.tiers.patreonId') }}</th>
                <th class="px-3 py-2 text-right">{{ t('adminPatreon.tiers.quota') }}</th>
                <th class="px-3 py-2 text-right">{{ t('adminPatreon.tiers.boosts') }}</th>
                <th class="px-3 py-2 text-right">{{ t('adminPatreon.tiers.active') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-hairline">
              <tr v-for="tier in data?.tiers ?? []" :key="tier.id">
                <td class="px-3 py-2">
                  <span class="font-medium text-ink">{{ tier.displayName }}</span>
                  <span class="ml-1.5 font-mono text-[10px] text-ink-faint">{{ tier.id }}</span>
                </td>
                <td class="px-3 py-2 font-mono text-[11px] text-ink-faint">
                  {{ tier.patreonTierId || '—' }}
                </td>
                <td class="px-3 py-2 text-right tabular-nums text-ink">
                  {{ formatNumber(tier.monthlyQuotaLimit) }}
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {{ tier.monthlyRequestBoosts }}
                </td>
                <td class="px-3 py-2 text-right tabular-nums font-semibold text-ink">
                  {{ tier.activePatronCount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Manual tiers & quota overrides -->
      <section data-testid="patreon-manual-grants-card" class="rounded-xl border border-hairline bg-card-background p-4 space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-ink">{{ t('adminPatreon.manualGrants.title') }}</h2>
            <p class="text-xs text-ink-faint">{{ t('adminPatreon.manualGrants.subtitle') }}</p>
          </div>
          <NuxtLink
            :to="localePath('/admin/users')"
            class="shrink-0 text-xs font-medium text-brand hover:underline"
          >
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
                  <div class="font-medium text-ink">{{ grant.username }}</div>
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
