<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core';
import { mdiClose, mdiEmailOffOutline, mdiEmailOutline, mdiMagnify, mdiRefresh } from '@mdi/js';
import type {
  AdminEmailEvent,
  AdminEmailSend,
  AdminEmailSuppression,
  ListAdminEmailsResponse,
} from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import AdminEmailTemplatesTab from './EmailTemplatesTab.vue';
import AdminEmailBroadcastsTab from './EmailBroadcastsTab.vue';
import AdminUiBadge, { type AdminTone } from './ui/Badge.vue';
import AdminUiEmpty from './ui/Empty.vue';
import AdminUiPageHeader from './ui/PageHeader.vue';
import AdminUiPagination from './ui/Pagination.vue';
import AdminUiStatStrip, { type AdminStat } from './ui/StatStrip.vue';
import AdminUiTabs, { type AdminTab } from './ui/Tabs.vue';

type Tab = 'sent' | 'suppressed' | 'types' | 'broadcasts';
type Status = AdminEmailSend['status'];

const KINDS = [
  'magic-link',
  'verify-new-email',
  'welcome',
  'feedback',
  'feedback-ask',
  'dormant-30',
  'request-update',
  'word-available',
  'word-digest',
  'broadcast',
  'recap',
  'unknown',
] as const;
const STATUSES: readonly Status[] = ['sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed'];
const DAY_RANGES = [1, 7, 30, 365] as const;
const LIMIT = 25;

const { t } = useI18n();
const { formatNumber, formatDate } = useFormat();
const localePath = useLocalePath();
const route = useRoute();
const router = typeof useRouter === 'function' ? useRouter() : null;
const templatesTabRef = ref<{ refresh: () => Promise<void> } | null>(null);
const broadcastsTabRef = ref<{ refresh: () => Promise<void> } | null>(null);

const activeTab = ref<Tab>(
  route.query.tab === 'suppressed' || route.query.tab === 'types' || route.query.tab === 'broadcasts'
    ? (route.query.tab as Tab)
    : 'sent',
);

function selectTab(tab: Tab) {
  activeTab.value = tab;
  if (router && route.query.tab !== tab) {
    void router.replace({ query: { ...route.query, tab } });
  }
}

function handleRefresh() {
  if (activeTab.value === 'types') {
    void templatesTabRef.value?.refresh();
  } else if (activeTab.value === 'broadcasts') {
    void broadcastsTabRef.value?.refresh();
  } else {
    void fetchPage();
  }
}
const search = ref(typeof route.query.q === 'string' ? route.query.q : '');
const kind = ref('');
const campaign = ref(typeof route.query.campaign === 'string' ? route.query.campaign : '');
const status = ref<Status | ''>('');
const requestedDays = Number(route.query.days);
const days = ref<number>((DAY_RANGES as readonly number[]).includes(requestedDays) ? requestedDays : 30);
const offset = ref(0);

const emails = ref<AdminEmailSend[]>([]);
const total = ref(0);
const last24h = ref<ListAdminEmailsResponse['last24h'] | null>(null);
const suppressions = ref<AdminEmailSuppression[]>([]);
const isLoading = ref(false);
const liftingAddress = ref<string | null>(null);

const selected = ref<AdminEmailSend | null>(null);
const selectedEvents = ref<AdminEmailEvent[]>([]);
const isLoadingDetail = ref(false);
const isResending = ref(false);

const stats = computed<AdminStat[]>(() => {
  const c = last24h.value;
  const stat = (id: 'sent' | 'failed' | 'bounced' | 'suppressed', tone: AdminStat['tone']): AdminStat => ({
    id,
    label: t(`adminEmails.kpi.${id}`),
    value: c ? formatNumber(c[id]) : null,
    sub: t('adminEmails.last24h'),
    tone,
    testid: `emails-kpi-${id}`,
  });
  return [
    stat('sent', 'neutral'),
    stat('failed', c && c.failed > 0 ? 'danger' : 'neutral'),
    stat('bounced', c && c.bounced > 0 ? 'warning' : 'neutral'),
    stat('suppressed', 'neutral'),
  ];
});

const tabs = computed<AdminTab<Tab>[]>(() =>
  (['sent', 'suppressed', 'types', 'broadcasts'] as const).map((value) => ({
    value,
    label: t(`adminEmails.tabs.${value}`),
  })),
);

function statusTone(value: Status): AdminTone {
  switch (value) {
    case 'delivered':
      return 'success';
    case 'sent':
      return 'info';
    case 'bounced':
      return 'warning';
    case 'complained':
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** `word-digest` → `Word digest`. */
function kindLabel(value: string): string {
  const text = value.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Only the newest request may fill the table; filter changes can overtake each other. */
let latestRequest = 0;

async function fetchPage(nextOffset = offset.value) {
  if (activeTab.value === 'types' || activeTab.value === 'broadcasts') return;
  const request = ++latestRequest;
  isLoading.value = true;
  const q = search.value.trim();
  try {
    if (activeTab.value === 'sent') {
      const result = await useNadeshikoSdk().listAdminEmails({
        limit: LIMIT,
        offset: nextOffset,
        days: days.value,
        ...(q ? { search: q } : {}),
        ...(kind.value ? { kind: kind.value } : {}),
        ...(campaign.value ? { campaign: campaign.value } : {}),
        ...(status.value ? { status: status.value } : {}),
      });
      if (request !== latestRequest) return;
      emails.value = result.emails;
      total.value = result.total;
      last24h.value = result.last24h;
    } else {
      const result = await useNadeshikoSdk().listAdminEmailSuppressions({
        limit: LIMIT,
        offset: nextOffset,
        ...(q ? { search: q } : {}),
      });
      if (request !== latestRequest) return;
      suppressions.value = result.suppressions;
      total.value = result.total;
    }
    offset.value = nextOffset;
  } catch (error) {
    if (request !== latestRequest) return;
    handleApiError('admin:emails-fetch-failed', error);
  } finally {
    if (request === latestRequest) isLoading.value = false;
  }
}

const { start: scheduleSearch, stop: cancelSearch } = useTimeoutFn(() => fetchPage(0), 300, { immediate: false });

/** A filter change fetches at once and takes the pending search with it, so the timer does not fetch the same page. */
function fetchNow() {
  cancelSearch();
  fetchPage(0);
}

watch(search, () => scheduleSearch());
watch([kind, campaign, status, days], fetchNow);
watch(
  () => route.query.tab,
  (tab) => {
    if (tab === 'sent' || tab === 'suppressed' || tab === 'types' || tab === 'broadcasts') {
      activeTab.value = tab;
    }
  },
);
watch(activeTab, () => {
  total.value = 0;
  fetchNow();
});

function openCampaignLog(campaignKey: string) {
  campaign.value = campaignKey;
  kind.value = 'broadcast';
  selectTab('sent');
}

async function openDetail(email: AdminEmailSend) {
  selected.value = email;
  selectedEvents.value = [];
  if (!email.sesMessageId) return;

  isLoadingDetail.value = true;
  try {
    const result = await useNadeshikoSdk().getAdminEmail(email.id);
    if (selected.value?.id !== email.id) return;
    selected.value = result.email;
    selectedEvents.value = result.events;
  } catch (error) {
    handleApiError('admin:email-detail-failed', error);
  } finally {
    isLoadingDetail.value = false;
  }
}

function closeDetail() {
  selected.value = null;
}

/** The new send shows up at the top of the list, which is the confirmation. */
async function resend() {
  const email = selected.value;
  if (!email) return;
  isResending.value = true;
  try {
    await useNadeshikoSdk().resendAdminEmail(email.id);
    closeDetail();
    await fetchPage(0);
  } catch (error) {
    handleApiError('admin:email-resend-failed', error);
  } finally {
    isResending.value = false;
  }
}

async function lift(row: AdminEmailSuppression) {
  liftingAddress.value = row.address;
  try {
    await useNadeshikoSdk().liftAdminEmailSuppression({ address: row.address });
    await fetchPage();
  } catch (error) {
    handleApiError('admin:email-lift-failed', error);
  } finally {
    liftingAddress.value = null;
  }
}

const page = computed(() => Math.floor(offset.value / LIMIT) + 1);
function goToPage(next: number) {
  void fetchPage((next - 1) * LIMIT);
}
const mounted = ref(false);
onMounted(() => (mounted.value = true));

/** The 24 h strip comes with the Sent list; other tabs fetch it once on their own. */
async function fetchLast24h() {
  try {
    const result = await useNadeshikoSdk().listAdminEmails({ limit: 1, offset: 0, days: 1 });
    last24h.value = result.last24h;
  } catch (error) {
    handleApiError('admin:emails-fetch-failed', error);
  }
}

onMounted(() => {
  void fetchPage(0);
  if (activeTab.value === 'types' || activeTab.value === 'broadcasts') void fetchLast24h();
});
</script>

<template>
  <div data-testid="admin-emails" class="space-y-5">
    <AdminUiPageHeader :title="t('adminEmails.title')">
      <template #actions>
        <button
          type="button"
          data-testid="emails-refresh"
          :disabled="mounted && isLoading"
          :aria-label="t('adminDashboard.nav.refresh')"
          class="nd-btn !h-8 !text-[13px]"
          @click="handleRefresh()"
        >
          <UiBaseIcon :path="mdiRefresh" :size="15" w="w-4" h="h-4" :class="{ 'animate-spin': mounted && isLoading }" />
          <span>{{ t('adminLayout.reload') }}</span>
        </button>
      </template>
    </AdminUiPageHeader>

    <AdminUiStatStrip data-testid="emails-kpis" :stats="stats" />

    <section class="space-y-4">
      <AdminUiTabs :model-value="activeTab" :tabs="tabs" testid-prefix="emails-tab" @update:model-value="selectTab" />

      <AdminEmailTemplatesTab v-if="activeTab === 'types'" ref="templatesTabRef" />
      <AdminEmailBroadcastsTab
        v-else-if="activeTab === 'broadcasts'"
        ref="broadcastsTabRef"
        @open-campaign-log="openCampaignLog"
      />

      <template v-else>
        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative w-full sm:w-72">
            <UiBaseIcon
              :path="mdiMagnify"
              :size="15"
              w="w-4"
              h="h-4"
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              v-model="search"
              data-testid="emails-search"
              type="search"
              :placeholder="t('adminEmails.filters.search')"
              class="nd-input !h-8 !pl-8 !text-[13px]"
            />
          </div>
          <template v-if="activeTab === 'sent'">
            <select v-model="kind" data-testid="emails-kind" class="nd-select !h-8 !text-[13px]">
              <option value="">{{ t('adminEmails.filters.allKinds') }}</option>
              <option v-for="k in KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
            </select>
            <select v-model="status" data-testid="emails-status" class="nd-select !h-8 !text-[13px]">
              <option value="">{{ t('adminEmails.filters.allStatuses') }}</option>
              <option v-for="s in STATUSES" :key="s" :value="s">{{ t(`adminEmails.status.${s}`) }}</option>
            </select>
            <select v-model.number="days" data-testid="emails-days" class="nd-select !h-8 !text-[13px]">
              <option v-for="d in DAY_RANGES" :key="d" :value="d">{{ t(`adminEmails.filters.days.${d}`) }}</option>
            </select>
            <button
              v-if="campaign"
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand/15 px-2.5 font-mono text-xs text-brand transition-colors hover:bg-brand/25"
              @click="campaign = ''"
            >
              <span>{{ campaign }}</span>
              <UiBaseIcon :path="mdiClose" :size="12" w="w-3" h="h-3" />
            </button>
          </template>
          <span class="ml-auto text-xs tabular-nums text-ink-faint">{{ formatNumber(total) }}</span>
        </div>

        <div v-if="isLoading && !emails.length && !suppressions.length" class="nd-admin-table-wrap">
          <div v-for="n in 6" :key="n" class="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-0">
            <span class="h-3 w-28 animate-pulse rounded bg-surface-lift" />
            <span class="h-3 w-44 animate-pulse rounded bg-surface-lift" />
            <span class="h-3 flex-1 animate-pulse rounded bg-surface-lift" />
          </div>
        </div>

        <!-- Sent -->
        <template v-else-if="activeTab === 'sent'">
          <div v-if="!emails.length" class="nd-admin-table-wrap">
            <AdminUiEmpty :icon="mdiEmailOutline" :text="t('adminEmails.empty')" />
          </div>
          <div v-else class="nd-admin-table-wrap">
            <table class="nd-admin-table min-w-[760px]">
              <thead>
                <tr>
                  <th>{{ t('adminEmails.table.to') }}</th>
                  <th>{{ t('adminEmails.table.subject') }}</th>
                  <th>{{ t('adminEmails.table.kind') }}</th>
                  <th>{{ t('adminEmails.table.status') }}</th>
                  <th class="text-right">{{ t('adminEmails.table.date') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="email in emails"
                  :key="email.id"
                  data-testid="emails-row"
                  class="is-clickable"
                  :class="{ 'is-active': selected?.id === email.id }"
                  @click="openDetail(email)"
                >
                  <td>
                    <div class="max-w-[16rem] truncate font-medium text-ink">{{ email.address }}</div>
                    <div v-if="email.username" class="text-xs text-ink-faint">{{ email.username }}</div>
                  </td>
                  <td class="text-ink-muted">
                    <div class="max-w-[22rem] truncate">{{ email.subject ?? '—' }}</div>
                  </td>
                  <td class="whitespace-nowrap text-ink-muted">{{ kindLabel(email.kind) }}</td>
                  <td>
                    <AdminUiBadge :data-testid="`emails-status-${email.id}`" :tone="statusTone(email.status)" dot>
                      {{ t(`adminEmails.status.${email.status}`) }}
                    </AdminUiBadge>
                  </td>
                  <td class="whitespace-nowrap text-right text-xs tabular-nums text-ink-faint">
                    {{ formatDate(email.sentAt, 'dateTime') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- Suppressed -->
        <template v-else>
          <div v-if="!suppressions.length" class="nd-admin-table-wrap">
            <AdminUiEmpty :icon="mdiEmailOffOutline" :text="t('adminEmails.empty')" />
          </div>
          <div v-else class="nd-admin-table-wrap">
            <table class="nd-admin-table min-w-[680px]">
              <thead>
                <tr>
                  <th>{{ t('adminEmails.suppressions.address') }}</th>
                  <th>{{ t('adminEmails.suppressions.cause') }}</th>
                  <th>{{ t('adminEmails.suppressions.reason') }}</th>
                  <th>{{ t('adminEmails.suppressions.since') }}</th>
                  <th class="w-24" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in suppressions" :key="row.address" data-testid="suppressions-row">
                  <td class="font-medium">{{ row.address }}</td>
                  <td>
                    <AdminUiBadge :tone="row.cause === 'complaint' ? 'danger' : row.cause === 'manual' ? 'neutral' : 'warning'">
                      {{ t(`adminEmails.suppressions.causes.${row.cause}`) }}
                    </AdminUiBadge>
                  </td>
                  <td class="text-xs text-ink-faint">
                    <div class="max-w-[18rem] truncate" :title="row.reason ?? undefined">{{ row.reason ?? '—' }}</div>
                  </td>
                  <td class="whitespace-nowrap text-xs tabular-nums text-ink-muted">{{ formatDate(row.suppressedAt) }}</td>
                  <td class="text-right">
                    <span v-if="row.permanent" class="text-xs text-ink-faint">{{ t('adminEmails.suppressions.permanent') }}</span>
                    <button
                      v-else
                      type="button"
                      :data-testid="`suppressions-lift-${row.address}`"
                      :disabled="liftingAddress === row.address"
                      class="nd-btn !h-7 !text-xs"
                      @click="lift(row)"
                    >
                      {{ t('adminEmails.suppressions.lift') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <AdminUiPagination :page="page" :page-size="LIMIT" :total="total" @update:page="goToPage" />
      </template>
    </section>

    <CommonBaseModal
      :open="Boolean(selected)"
      transition="nd-drawer"
      labelledby="admin-email-detail-title"
      overlay-class="items-stretch justify-end bg-fixed-scrim/60"
      panel-class="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-hairline bg-background"
      data-testid="email-detail"
      @close="closeDetail"
    >
      <template v-if="selected">
        <div class="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div class="min-w-0 space-y-1.5">
            <AdminUiBadge :tone="statusTone(selected.status)" dot>{{ t(`adminEmails.status.${selected.status}`) }}</AdminUiBadge>
            <h2 id="admin-email-detail-title" class="text-[15px] font-semibold leading-snug text-ink">
              {{ selected.subject ?? kindLabel(selected.kind) }}
            </h2>
          </div>
          <button
            type="button"
            :aria-label="t('adminEmails.detail.close')"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
            @click="closeDetail"
          >
            <UiBaseIcon :path="mdiClose" :size="16" />
          </button>
        </div>

        <dl class="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2.5 px-5 py-4 text-[13px]">
          <dt class="text-ink-faint">{{ t('adminEmails.table.date') }}</dt>
          <dd class="tabular-nums text-ink">
            {{ formatDate(selected.sentAt, 'dateTime') }}
            <span v-if="selected.source === 'backfill'" class="ml-1.5 text-xs text-ink-faint">
              {{ t('adminEmails.detail.backfill') }}
            </span>
          </dd>
          <dt class="text-ink-faint">{{ t('adminEmails.table.to') }}</dt>
          <dd class="break-all text-ink">{{ selected.address }}</dd>
          <template v-if="selected.username">
            <dt class="text-ink-faint">{{ t('adminEmails.detail.user') }}</dt>
            <dd>
              <NuxtLink
                :to="localePath({ path: '/admin/users', query: { q: selected.address } })"
                class="text-brand hover:underline"
              >
                {{ selected.username }}
              </NuxtLink>
            </dd>
          </template>
          <dt class="text-ink-faint">{{ t('adminEmails.table.kind') }}</dt>
          <dd class="text-ink">{{ kindLabel(selected.kind) }}</dd>
          <template v-if="selected.campaign">
            <dt class="text-ink-faint">{{ t('adminEmails.detail.campaign') }}</dt>
            <dd class="font-mono text-xs text-ink">{{ selected.campaign }}</dd>
          </template>
          <template v-if="selected.sesMessageId">
            <dt class="text-ink-faint">{{ t('adminEmails.detail.messageId') }}</dt>
            <dd class="break-all font-mono text-[11px] text-ink-muted">{{ selected.sesMessageId }}</dd>
          </template>
        </dl>

        <div v-if="selected.error" class="mx-5 mb-4 rounded-md bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
          {{ selected.error }}
        </div>

        <div v-if="selected.resendable" class="px-5 pb-4">
          <button
            type="button"
            data-testid="email-resend"
            :disabled="isResending"
            class="nd-btn-accent !h-8 !text-[13px]"
            @click="resend"
          >
            <span v-if="isResending" class="nd-spinner" />
            {{ t('adminEmails.detail.resend') }}
          </button>
        </div>

        <div v-if="selected.sesMessageId" class="border-t border-hairline px-5 py-4">
          <h3 class="mb-3 text-xs font-medium text-ink-muted">{{ t('adminEmails.detail.events') }}</h3>
          <div v-if="isLoadingDetail" class="space-y-2">
            <span v-for="n in 3" :key="n" class="block h-3 animate-pulse rounded bg-surface-lift" />
          </div>
          <p v-else-if="!selectedEvents.length" class="text-[13px] text-ink-faint">{{ t('adminEmails.detail.noEvents') }}</p>
          <ol v-else class="relative space-y-4 border-l border-hairline pl-4" data-testid="email-detail-events">
            <li v-for="event in selectedEvents" :key="event.id" class="relative text-[13px]">
              <span class="absolute -left-[21px] top-1.5 size-2 rounded-full bg-ink-faint ring-4 ring-background" />
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-medium text-ink">{{ kindLabel(event.event) }}</span>
                <span class="text-xs tabular-nums text-ink-faint">{{ formatDate(event.occurredAt, 'dateTime') }}</span>
              </div>
              <div v-if="event.diagnosticMessage || event.reason" class="mt-0.5 break-words text-xs text-ink-muted">
                {{ event.diagnosticMessage ?? event.reason }}
              </div>
            </li>
          </ol>
        </div>
      </template>
    </CommonBaseModal>
  </div>
</template>
