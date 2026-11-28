<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core';
import { mdiClose, mdiRefresh } from '@mdi/js';
import type {
  AdminEmailEvent,
  AdminEmailSend,
  AdminEmailSuppression,
  ListAdminEmailsResponse,
} from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import AdminEmailTemplatesTab from './EmailTemplatesTab.vue';
import AdminEmailBroadcastsTab from './EmailBroadcastsTab.vue';

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

const activeTab = ref<Tab>(
  route.query.tab === 'suppressed' || route.query.tab === 'types' || route.query.tab === 'broadcasts'
    ? (route.query.tab as Tab)
    : 'sent',
);
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

const kpis = computed(() => {
  const counts = last24h.value;
  if (!counts) return [];
  return [
    { id: 'sent', value: counts.sent, tone: 'text-ink' },
    { id: 'failed', value: counts.failed, tone: counts.failed > 0 ? 'text-red-300' : 'text-ink' },
    { id: 'bounced', value: counts.bounced, tone: counts.bounced > 0 ? 'text-amber-300' : 'text-ink' },
    { id: 'suppressed', value: counts.suppressed, tone: 'text-ink' },
  ] as const;
});

function statusClasses(value: Status): string {
  switch (value) {
    case 'delivered':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'bounced':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'complained':
    case 'failed':
      return 'bg-red-500/15 text-red-300 border-red-500/30';
    default:
      return 'bg-surface-lift text-ink-muted border-hairline';
  }
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
watch(activeTab, () => {
  total.value = 0;
  fetchNow();
});

function openCampaignLog(campaignKey: string) {
  campaign.value = campaignKey;
  kind.value = 'broadcast';
  activeTab.value = 'sent';
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

const pageEnd = computed(() => Math.min(offset.value + LIMIT, total.value));

onMounted(() => fetchPage(0));
</script>

<template>
  <div data-testid="admin-emails" class="space-y-5">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-2xl font-bold tracking-tight text-ink">{{ t('adminEmails.title') }}</h1>
      <button
        type="button"
        data-testid="emails-refresh"
        :disabled="isLoading"
        :aria-label="t('adminDashboard.nav.refresh')"
        :title="t('adminDashboard.nav.refresh')"
        class="inline-flex size-8 items-center justify-center rounded-lg border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
        @click="fetchPage()"
      >
        <UiBaseIcon :path="mdiRefresh" :size="16" :class="{ 'animate-spin': isLoading }" />
      </button>
    </div>

    <div v-if="kpis.length" data-testid="emails-kpis" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div v-for="kpi in kpis" :key="kpi.id" class="rounded-xl border border-hairline bg-card-background px-4 py-3">
        <div class="text-[11px] font-medium text-ink-faint">
          {{ t(`adminEmails.kpi.${kpi.id}`) }} · {{ t('adminEmails.last24h') }}
        </div>
        <div :data-testid="`emails-kpi-${kpi.id}`" :class="['mt-1 text-2xl font-bold tabular-nums', kpi.tone]">
          {{ formatNumber(kpi.value) }}
        </div>
      </div>
    </div>

    <section class="space-y-4 rounded-xl border border-hairline bg-card-background p-4">
      <div class="flex flex-wrap items-center gap-1.5 border-b border-hairline pb-3" role="tablist">
        <button
          v-for="tab in (['sent', 'suppressed', 'types', 'broadcasts'] as const)"
          :key="tab"
          type="button"
          role="tab"
          :data-testid="`emails-tab-${tab}`"
          :aria-selected="activeTab === tab"
          :class="[
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
            activeTab === tab ? 'bg-brand/15 text-brand' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
          ]"
          @click="activeTab = tab"
        >
          {{ t(`adminEmails.tabs.${tab}`) }}
        </button>
      </div>

      <AdminEmailTemplatesTab v-if="activeTab === 'types'" />
      <AdminEmailBroadcastsTab v-else-if="activeTab === 'broadcasts'" @open-campaign-log="openCampaignLog" />

      <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          data-testid="emails-search"
          type="search"
          :placeholder="t('adminEmails.filters.search')"
          class="nd-input max-w-xs"
        />
        <template v-if="activeTab === 'sent'">
          <select v-model="kind" data-testid="emails-kind" class="nd-input w-auto">
            <option value="">{{ t('adminEmails.filters.allKinds') }}</option>
            <option v-for="k in KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
          <select v-model="status" data-testid="emails-status" class="nd-input w-auto">
            <option value="">{{ t('adminEmails.filters.allStatuses') }}</option>
            <option v-for="s in STATUSES" :key="s" :value="s">{{ t(`adminEmails.status.${s}`) }}</option>
          </select>
          <select v-model.number="days" data-testid="emails-days" class="nd-input w-auto">
            <option v-for="d in DAY_RANGES" :key="d" :value="d">{{ t(`adminEmails.filters.days.${d}`) }}</option>
          </select>
          <button
            v-if="campaign"
            type="button"
            class="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/15 px-2.5 py-1 text-xs text-brand"
            @click="campaign = ''"
          >
            <span>{{ campaign }}</span>
            <UiBaseIcon :path="mdiClose" :size="12" />
          </button>
        </template>
        <span class="ml-auto text-xs text-ink-faint tabular-nums">{{ formatNumber(total) }}</span>
      </div>

      <div v-if="isLoading && !emails.length && !suppressions.length" class="py-12 text-center">
        <div class="inline-block size-6 animate-spin rounded-full border-[3px] border-current border-t-transparent text-ink" role="status" />
      </div>

      <!-- Sent -->
      <template v-else-if="activeTab === 'sent'">
        <div v-if="!emails.length" class="py-12 text-center text-sm text-ink-faint">{{ t('adminEmails.empty') }}</div>
        <div v-else class="overflow-x-auto rounded-lg border border-hairline">
          <table class="w-full min-w-[760px] text-sm">
            <thead>
              <tr class="border-b border-hairline text-left text-xs text-ink-muted">
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.table.date') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.table.to') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.table.kind') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.table.subject') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.table.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="email in emails"
                :key="email.id"
                data-testid="emails-row"
                class="cursor-pointer border-b border-hairline last:border-0 hover:bg-surface-hover"
                @click="openDetail(email)"
              >
                <td class="whitespace-nowrap px-3 py-2.5 text-ink-muted tabular-nums">
                  {{ formatDate(email.sentAt, 'dateTime') }}
                </td>
                <td class="px-3 py-2.5 text-ink">
                  <div class="max-w-[16rem] truncate">{{ email.address }}</div>
                  <div v-if="email.username" class="text-[11px] text-ink-faint">{{ email.username }}</div>
                </td>
                <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink-muted">{{ email.kind }}</td>
                <td class="px-3 py-2.5 text-ink-muted">
                  <div class="max-w-[20rem] truncate">{{ email.subject ?? '—' }}</div>
                </td>
                <td class="px-3 py-2.5">
                  <span
                    :data-testid="`emails-status-${email.id}`"
                    :class="['rounded-full border px-2 py-0.5 text-[11px] font-semibold', statusClasses(email.status)]"
                  >
                    {{ t(`adminEmails.status.${email.status}`) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- Suppressed -->
      <template v-else>
        <div v-if="!suppressions.length" class="py-12 text-center text-sm text-ink-faint">{{ t('adminEmails.empty') }}</div>
        <div v-else class="overflow-x-auto rounded-lg border border-hairline">
          <table class="w-full min-w-[680px] text-sm">
            <thead>
              <tr class="border-b border-hairline text-left text-xs text-ink-muted">
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.suppressions.address') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.suppressions.cause') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.suppressions.reason') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('adminEmails.suppressions.since') }}</th>
                <th class="w-24 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in suppressions"
                :key="row.address"
                data-testid="suppressions-row"
                class="border-b border-hairline last:border-0"
              >
                <td class="px-3 py-2.5 text-ink">{{ row.address }}</td>
                <td class="whitespace-nowrap px-3 py-2.5 text-ink-muted">
                  {{ t(`adminEmails.suppressions.causes.${row.cause}`) }}
                </td>
                <td class="px-3 py-2.5 text-xs text-ink-faint">
                  <div class="max-w-[18rem] truncate" :title="row.reason ?? undefined">{{ row.reason ?? '—' }}</div>
                </td>
                <td class="whitespace-nowrap px-3 py-2.5 text-ink-muted tabular-nums">{{ formatDate(row.suppressedAt) }}</td>
                <td class="px-3 py-2.5 text-right">
                  <span v-if="row.permanent" class="text-[11px] text-ink-faint">{{ t('adminEmails.suppressions.permanent') }}</span>
                  <button
                    v-else
                    type="button"
                    :data-testid="`suppressions-lift-${row.address}`"
                    :disabled="liftingAddress === row.address"
                    class="rounded-lg border border-hairline px-2.5 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
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

      <div v-if="total > LIMIT" class="flex items-center justify-between text-sm text-ink-muted">
        <span>
          {{
            t('accountSettings.dashboard.pagination.showing', {
              start: formatNumber(offset + 1),
              end: formatNumber(pageEnd),
              total: formatNumber(total),
            })
          }}
        </span>
        <div class="flex gap-2">
          <button
            type="button"
            :disabled="offset <= 0 || isLoading"
            class="rounded-lg border border-hairline px-3 py-1.5 transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            @click="fetchPage(Math.max(0, offset - LIMIT))"
          >
            {{ t('accountSettings.dashboard.pagination.previous') }}
          </button>
          <button
            type="button"
            :disabled="pageEnd >= total || isLoading"
            class="rounded-lg border border-hairline px-3 py-1.5 transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            @click="fetchPage(offset + LIMIT)"
          >
            {{ t('accountSettings.dashboard.pagination.next') }}
          </button>
        </div>
      </div>
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
        <div class="nd-modal-header">
          <h2 id="admin-email-detail-title" class="min-w-0 truncate font-bold text-ink">
            {{ selected.subject ?? selected.kind }}
          </h2>
          <button
            type="button"
            :aria-label="t('adminEmails.detail.close')"
            class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="closeDetail"
          >
            <UiBaseIcon :path="mdiClose" :size="16" />
          </button>
        </div>

        <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 px-5 py-4 text-sm">
          <dt class="text-ink-faint">{{ t('adminEmails.table.status') }}</dt>
          <dd>
            <span :class="['rounded-full border px-2 py-0.5 text-[11px] font-semibold', statusClasses(selected.status)]">
              {{ t(`adminEmails.status.${selected.status}`) }}
            </span>
            <span v-if="selected.source === 'backfill'" class="ml-2 text-[11px] text-ink-faint">
              {{ t('adminEmails.detail.backfill') }}
            </span>
          </dd>
          <dt class="text-ink-faint">{{ t('adminEmails.table.date') }}</dt>
          <dd class="text-ink tabular-nums">{{ formatDate(selected.sentAt, 'dateTime') }}</dd>
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
          <dd class="font-mono text-xs text-ink">{{ selected.kind }}</dd>
          <template v-if="selected.campaign">
            <dt class="text-ink-faint">{{ t('adminEmails.detail.campaign') }}</dt>
            <dd class="font-mono text-xs text-ink">{{ selected.campaign }}</dd>
          </template>
          <template v-if="selected.sesMessageId">
            <dt class="text-ink-faint">{{ t('adminEmails.detail.messageId') }}</dt>
            <dd class="break-all font-mono text-[11px] text-ink-muted">{{ selected.sesMessageId }}</dd>
          </template>
          <template v-if="selected.error">
            <dt class="text-ink-faint">{{ t('adminEmails.detail.error') }}</dt>
            <dd class="break-words text-red-300">{{ selected.error }}</dd>
          </template>
        </dl>

        <div v-if="selected.resendable" class="px-5 pb-4">
          <button
            type="button"
            data-testid="email-resend"
            :disabled="isResending"
            class="inline-flex h-9 items-center rounded-lg bg-brand-solid px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            @click="resend"
          >
            {{ t('adminEmails.detail.resend') }}
          </button>
        </div>

        <div v-if="selected.sesMessageId" class="border-t border-hairline px-5 py-4">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {{ t('adminEmails.detail.events') }}
          </h3>
          <div v-if="isLoadingDetail" class="text-sm text-ink-faint">…</div>
          <p v-else-if="!selectedEvents.length" class="text-sm text-ink-faint">{{ t('adminEmails.detail.noEvents') }}</p>
          <ol v-else class="space-y-3" data-testid="email-detail-events">
            <li v-for="event in selectedEvents" :key="event.id" class="text-sm">
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-mono text-xs text-ink">{{ event.event }}</span>
                <span class="text-[11px] text-ink-faint tabular-nums">{{ formatDate(event.occurredAt, 'dateTime') }}</span>
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
