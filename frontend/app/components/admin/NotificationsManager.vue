<script setup lang="ts">
import {
  mdiAccountOutline,
  mdiArrowRight,
  mdiBellOutline,
  mdiBellRingOutline,
  mdiBullhornOutline,
  mdiClose,
  mdiEmailOutline,
  mdiEarth,
  mdiHeartOutline,
  mdiLockOutline,
  mdiPencilOutline,
  mdiRefresh,
  mdiSend,
} from '@mdi/js';
import type {
  ListAdminNotificationBroadcastsResponse,
  ListAdminNotificationSettingsResponse,
} from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { useToastError, useToastSuccess } from '~/utils/toast';
import AdminUiBadge, { type AdminTone } from './ui/Badge.vue';
import AdminUiCard from './ui/Card.vue';
import AdminUiEmpty from './ui/Empty.vue';
import AdminUiPageHeader from './ui/PageHeader.vue';
import AdminUiSegmented, { type AdminSegment } from './ui/Segmented.vue';
import AdminUiSwitch from './ui/Switch.vue';
import AdminUiTabs, { type AdminTab } from './ui/Tabs.vue';

type Tab = 'send' | 'registry';
type SettingItem = ListAdminNotificationSettingsResponse['items'][number];
type BroadcastItem = ListAdminNotificationBroadcastsResponse['items'][number];
type Kind = BroadcastItem['kind'];
type Audience = BroadcastItem['audience'];

const { t } = useI18n();
const { formatDate, formatNumber } = useFormat();
const route = useRoute();
const router = useRouter();
const sdk = useNadeshikoSdk();

const activeTab = ref<Tab>(route.query.tab === 'registry' ? 'registry' : 'send');

function selectTab(tab: Tab) {
  activeTab.value = tab;
  if (route.query.tab !== tab) {
    void router.replace({ query: { ...route.query, tab } });
  }
}
const isLoading = ref(false);
const loaded = ref(false);
const mounted = ref(false);
onMounted(() => (mounted.value = true));

// Send form state
const kind = ref<Kind>(route.query.userId ? 'admin-message' : 'site-announcement');
const audience = ref<Audience>(route.query.userId ? 'USER' : 'ALL');
const targetUserId = ref<number | null>(route.query.userId ? Number(route.query.userId) : null);
const targetUsername = ref<string>(typeof route.query.username === 'string' ? route.query.username : '');
const title = ref('');
const message = ref('');
const linkUrl = ref('');
const linkLabel = ref('');
const confirmOpen = ref(false);
const isSending = ref(false);

// History + Registry state
const broadcasts = ref<BroadcastItem[]>([]);
const settings = ref<SettingItem[]>([]);
const savingKind = ref<string | null>(null);
const editingParamsItem = ref<SettingItem | null>(null);
const paramDraft = ref<Record<string, number>>({});

const siteSettings = computed(() => settings.value.filter((item) => item.channels.site));

const tabs = computed<AdminTab<Tab>[]>(() => [
  { value: 'send', label: t('adminNotifications.tabs.send') },
  { value: 'registry', label: t('adminNotifications.tabs.registry'), count: loaded.value ? siteSettings.value.length : null },
]);

const kindOptions = computed<AdminSegment<Kind>[]>(() => [
  { value: 'site-announcement', label: t('adminNotifications.kinds.siteAnnouncement'), icon: mdiBullhornOutline },
  { value: 'admin-message', label: t('adminNotifications.kinds.adminMessage'), icon: mdiEmailOutline },
]);

const audienceOptions = computed<AdminSegment<Audience>[]>(() => [
  { value: 'ALL', label: t('adminNotifications.send.audienceAll'), icon: mdiEarth },
  { value: 'PATRONS', label: t('adminNotifications.send.audiencePatrons'), icon: mdiHeartOutline },
  { value: 'USER', label: t('adminNotifications.send.audienceUser'), icon: mdiAccountOutline },
]);

const AREA_ORDER = ['official', 'words', 'community'] as const;

const groupedSiteSettings = computed(() =>
  AREA_ORDER.map((area) => ({
    area,
    label: t(`adminNotifications.areas.${area}`),
    items: siteSettings.value.filter((i) => i.area === area),
  })).filter((g) => g.items.length > 0),
);

const safePreviewLink = computed(() => {
  const raw = linkUrl.value.trim();
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
});

function audienceLabel(value: Audience): string {
  switch (value) {
    case 'PATRONS':
      return t('adminNotifications.send.audiencePatrons');
    case 'USER':
      return t('adminNotifications.send.audienceUser');
    default:
      return t('adminNotifications.send.audienceAll');
  }
}

function rowAudienceLabel(row: BroadcastItem): string {
  if (row.audience !== 'USER') return audienceLabel(row.audience);
  return row.targetUsername || t('adminNotifications.history.userFallback', { id: row.targetUserId ?? '?' });
}

function audienceTone(value: Audience): AdminTone {
  return value === 'ALL' ? 'brand' : value === 'PATRONS' ? 'violet' : 'neutral';
}

function statusTone(status: BroadcastItem['status']): AdminTone {
  switch (status) {
    case 'SENT':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'SENDING':
      return 'info';
    default:
      return 'warning';
  }
}

function triggerTone(item: SettingItem): AdminTone {
  return item.trigger === 'cron' ? 'violet' : item.trigger === 'realtime' ? 'info' : 'neutral';
}

function triggerLabel(item: SettingItem): string {
  if (item.trigger === 'cron') return item.schedule ?? t('adminNotifications.registry.triggers.cron');
  return t(`adminNotifications.registry.triggers.${item.trigger}`);
}

/** `requests` → `Requests`. */
function capitalize(value: string): string {
  const text = value.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function paramsSummary(item: SettingItem): string {
  return item.paramFields.map((f) => `${f.label}: ${item.params[f.key] ?? item.defaultParams[f.key]}`).join(' · ');
}

async function loadData() {
  isLoading.value = true;
  try {
    const [bRes, sRes] = await Promise.all([
      sdk.listAdminNotificationBroadcasts({ limit: 25 }),
      sdk.listAdminNotificationSettings(),
    ]);
    broadcasts.value = bRes.items;
    settings.value = sRes.items;
  } catch (err) {
    handleApiError('admin:notifications-load-failed', err);
  } finally {
    isLoading.value = false;
    loaded.value = true;
  }
}

function submitSend() {
  if (!title.value.trim() || !message.value.trim()) {
    useToastError(t('adminNotifications.send.missingFields'));
    return;
  }
  if (audience.value === 'USER' && !targetUserId.value) {
    useToastError(t('adminNotifications.send.missingUser'));
    return;
  }
  if (linkUrl.value.trim() && !safePreviewLink.value) {
    useToastError(t('adminNotifications.send.invalidLink'));
    return;
  }
  if (audience.value !== 'USER') {
    confirmOpen.value = true;
    return;
  }
  void doSend();
}

async function doSend() {
  confirmOpen.value = false;
  isSending.value = true;
  try {
    const created = await sdk.sendAdminNotificationBroadcast({
      kind: kind.value,
      audience: audience.value,
      targetUserId: audience.value === 'USER' ? targetUserId.value : null,
      title: title.value.trim(),
      message: message.value.trim(),
      linkUrl: linkUrl.value.trim() || null,
      linkLabel: linkLabel.value.trim() || null,
    });
    broadcasts.value = [created, ...broadcasts.value];
    title.value = '';
    message.value = '';
    linkUrl.value = '';
    linkLabel.value = '';
    useToastSuccess(t('adminNotifications.send.sentToast'));
  } catch (err) {
    handleApiError('admin:notifications-send-failed', err);
  } finally {
    isSending.value = false;
  }
}

async function toggleSite(item: SettingItem) {
  if (item.alwaysEnabled || savingKind.value) return;
  savingKind.value = item.kind;
  try {
    const updated = await sdk.updateAdminNotificationSetting({ kind: item.kind, siteEnabled: !item.siteEnabled });
    item.siteEnabled = updated.siteEnabled;
    useToastSuccess(t('adminNotifications.registry.saved'));
  } catch (err) {
    handleApiError('admin:notification-setting-toggle-failed', err);
  } finally {
    savingKind.value = null;
  }
}

function openParamEditor(item: SettingItem) {
  editingParamsItem.value = item;
  const next: Record<string, number> = {};
  for (const field of item.paramFields) {
    next[field.key] = Number(item.params[field.key] ?? item.defaultParams[field.key] ?? field.min);
  }
  paramDraft.value = next;
}

async function saveParams(reset = false) {
  const item = editingParamsItem.value;
  if (!item) return;
  savingKind.value = item.kind;
  try {
    const updated = await sdk.updateAdminNotificationSetting(
      reset ? { kind: item.kind, resetParams: true } : { kind: item.kind, params: { ...paramDraft.value } },
    );
    item.params = updated.params;
    editingParamsItem.value = null;
    useToastSuccess(t('adminNotifications.registry.saved'));
  } catch (err) {
    handleApiError('admin:notification-setting-params-failed', err);
  } finally {
    savingKind.value = null;
  }
}

onMounted(loadData);

watch(
  () => route.query.tab,
  (tab) => {
    if (tab === 'send' || tab === 'registry') {
      activeTab.value = tab;
    }
  },
);
</script>

<template>
  <div data-testid="admin-notifications" class="space-y-5">
    <AdminUiPageHeader :title="t('adminNotifications.title')">
      <template #actions>
        <button
          type="button"
          data-testid="notifications-refresh"
          :disabled="mounted && isLoading"
          :aria-label="t('adminDashboard.nav.refresh')"
          class="nd-btn !h-8 !text-[13px]"
          @click="loadData"
        >
          <UiBaseIcon :path="mdiRefresh" :size="15" w="w-4" h="h-4" :class="{ 'animate-spin': mounted && isLoading }" />
          <span>{{ t('adminLayout.reload') }}</span>
        </button>
      </template>
    </AdminUiPageHeader>

    <section class="space-y-4">
      <AdminUiTabs
        :model-value="activeTab"
        :tabs="tabs"
        testid-prefix="notifications-tab"
        @update:model-value="selectTab"
      />

      <!-- Tab 1: Send official notice & history -->
      <div v-if="activeTab === 'send'" class="space-y-5">
        <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <!-- Composer -->
          <form class="lg:col-span-7" data-testid="notifications-composer" @submit.prevent="submitSend">
            <AdminUiCard flush>
              <div class="space-y-4 p-4">
                <div class="flex flex-wrap gap-x-6 gap-y-4">
                  <div class="min-w-0 max-w-full">
                    <span class="nd-admin-label">{{ t('adminNotifications.send.kind') }}</span>
                    <AdminUiSegmented v-model="kind" :options="kindOptions" testid-prefix="notifications-kind" />
                  </div>
                  <div class="min-w-0 max-w-full">
                    <span class="nd-admin-label">{{ t('adminNotifications.send.audience') }}</span>
                    <AdminUiSegmented v-model="audience" :options="audienceOptions" testid-prefix="notifications-audience" />
                  </div>
                </div>

                <div v-if="audience === 'USER'">
                  <label for="notif-target-user" class="nd-admin-label">
                    {{ t('adminNotifications.send.targetUserId') }}
                    <span v-if="targetUsername" class="ml-1 text-brand">{{ targetUsername }}</span>
                  </label>
                  <input
                    id="notif-target-user"
                    v-model.number="targetUserId"
                    type="number"
                    min="1"
                    :placeholder="t('common.example', { value: 42 })"
                    class="nd-input !h-8 max-w-[12rem] !text-[13px]"
                  />
                </div>
              </div>

              <div class="space-y-4 border-t border-hairline p-4">
                <div>
                  <label for="notif-title" class="nd-admin-label">{{ t('adminNotifications.send.title') }}</label>
                  <input
                    id="notif-title"
                    v-model="title"
                    type="text"
                    maxlength="160"
                    :placeholder="t('adminNotifications.send.placeholders.title')"
                    class="nd-input !h-8 !text-[13px]"
                  />
                </div>
                <div>
                  <div class="flex items-center justify-between">
                    <label for="notif-message" class="nd-admin-label">{{ t('adminNotifications.send.message') }}</label>
                    <span class="mb-1.5 text-[11px] tabular-nums text-ink-faint">{{ message.length }}/2000</span>
                  </div>
                  <textarea
                    id="notif-message"
                    v-model="message"
                    rows="4"
                    maxlength="2000"
                    :placeholder="t('adminNotifications.send.placeholders.message')"
                    class="nd-input resize-y !text-[13px]"
                  />
                </div>
              </div>

              <div class="grid grid-cols-1 gap-4 border-t border-hairline p-4 sm:grid-cols-2">
                <div>
                  <label for="notif-link-url" class="nd-admin-label">{{ t('adminNotifications.send.linkUrl') }}</label>
                  <input
                    id="notif-link-url"
                    v-model="linkUrl"
                    type="text"
                    placeholder="/blog/…"
                    class="nd-input !h-8 font-mono !text-[13px]"
                  />
                </div>
                <div>
                  <label for="notif-link-label" class="nd-admin-label">{{ t('adminNotifications.send.linkLabel') }}</label>
                  <input
                    id="notif-link-label"
                    v-model="linkLabel"
                    type="text"
                    maxlength="80"
                    :placeholder="t('notifications.bell.openLink')"
                    class="nd-input !h-8 !text-[13px]"
                  />
                </div>
              </div>

              <div class="flex justify-end border-t border-hairline bg-surface/60 px-4 py-3">
                <button
                  type="submit"
                  data-testid="notifications-send"
                  :disabled="mounted && isSending"
                  class="nd-btn-accent !h-8 !text-[13px]"
                >
                  <span v-if="mounted && isSending" class="nd-spinner" />
                  <UiBaseIcon v-else :path="mdiSend" :size="14" w="w-3.5" h="h-3.5" />
                  <span>{{ isSending ? t('adminNotifications.send.sending') : t('adminNotifications.send.submit') }}</span>
                </button>
              </div>
            </AdminUiCard>
          </form>

          <!-- Bell preview -->
          <div class="lg:sticky lg:top-4 lg:col-span-5">
            <AdminUiCard :title="t('adminNotifications.send.preview')">
              <div class="overflow-hidden rounded-lg border border-hairline bg-background shadow-lg">
                <div class="flex items-center justify-between border-b border-hairline px-4 py-2.5">
                  <span class="text-xs font-semibold text-ink">{{ t('notifications.bell.label') }}</span>
                  <span class="text-[11px] text-ink-faint">{{ t('notifications.bell.markAllRead') }}</span>
                </div>
                <div class="flex items-start gap-3 border-l-2 border-brand bg-brand/5 px-4 py-3.5">
                  <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                    <UiBaseIcon
                      :path="kind === 'site-announcement' ? mdiBullhornOutline : mdiEmailOutline"
                      :size="16"
                      w="w-4"
                      h="h-4"
                    />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="text-[13px] font-semibold leading-snug" :class="title ? 'text-ink' : 'text-ink-faint'">
                        {{ title || t('adminNotifications.send.placeholders.title') }}
                      </span>
                      <span class="flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                        <span class="size-1.5 rounded-full bg-brand" /> {{ t('common.justNow') }}
                      </span>
                    </div>
                    <p
                      class="mt-1 whitespace-pre-line break-words text-xs leading-relaxed"
                      :class="message ? 'text-ink-muted' : 'text-ink-faint'"
                    >
                      {{ message || t('adminNotifications.send.placeholders.message') }}
                    </p>
                    <span v-if="safePreviewLink" class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand">
                      <span>{{ linkLabel || t('notifications.bell.openLink') }}</span>
                      <UiBaseIcon :path="mdiArrowRight" :size="13" w="w-3.5" h="h-3.5" />
                    </span>
                  </div>
                </div>
              </div>
            </AdminUiCard>
          </div>
        </div>

        <!-- Recent broadcasts -->
        <div class="space-y-2.5">
          <h2 class="text-[13px] font-semibold text-ink">{{ t('adminNotifications.history.title') }}</h2>
          <div v-if="!loaded || (isLoading && !broadcasts.length)" class="nd-admin-table-wrap">
            <div v-for="n in 4" :key="n" class="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-0">
              <span class="h-3 w-48 animate-pulse rounded bg-surface-lift" />
              <span class="h-3 w-20 animate-pulse rounded bg-surface-lift" />
              <span class="h-3 flex-1 animate-pulse rounded bg-surface-lift" />
            </div>
          </div>
          <div v-else-if="!broadcasts.length" class="nd-admin-table-wrap">
            <AdminUiEmpty :icon="mdiBellOutline" :text="t('adminNotifications.history.empty')" />
          </div>
          <div v-else class="nd-admin-table-wrap">
            <table class="nd-admin-table min-w-[720px]" data-testid="notifications-history">
              <thead>
                <tr>
                  <th>{{ t('adminNotifications.history.titleCol') }}</th>
                  <th>{{ t('adminNotifications.history.audience') }}</th>
                  <th>{{ t('adminNotifications.history.status') }}</th>
                  <th class="text-right">{{ t('adminNotifications.history.sent') }}</th>
                  <th class="text-right">{{ t('adminNotifications.history.date') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in broadcasts" :key="row.id" data-testid="notifications-history-row">
                  <td>
                    <div class="flex items-center gap-2">
                      <UiBaseIcon
                        :path="row.kind === 'site-announcement' ? mdiBullhornOutline : mdiEmailOutline"
                        :size="14"
                        w="w-3.5"
                        h="h-3.5"
                        class="shrink-0 text-ink-faint"
                      />
                      <span class="max-w-[22rem] truncate font-medium text-ink" :title="row.message">{{ row.title }}</span>
                    </div>
                    <div v-if="row.linkUrl" class="ml-5 max-w-[22rem] truncate font-mono text-xs text-ink-faint">
                      {{ row.linkUrl }}
                    </div>
                  </td>
                  <td>
                    <AdminUiBadge :tone="audienceTone(row.audience)">{{ rowAudienceLabel(row) }}</AdminUiBadge>
                  </td>
                  <td>
                    <AdminUiBadge :tone="statusTone(row.status)" dot :title="row.error ?? undefined">
                      {{ t(`adminNotifications.history.statuses.${row.status.toLowerCase()}`) }}
                    </AdminUiBadge>
                  </td>
                  <td class="whitespace-nowrap text-right tabular-nums text-ink-muted">
                    {{ formatNumber(row.sentCount) }} / {{ formatNumber(row.recipientCount) }}
                  </td>
                  <td class="whitespace-nowrap text-right text-xs tabular-nums text-ink-faint">
                    {{ formatDate(row.createdAt, 'dateTime') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Tab 2: Registry -->
      <div v-else class="space-y-4">
        <AdminUiCard v-if="!loaded || (isLoading && siteSettings.length === 0)" flush>
          <div v-for="n in 5" :key="n" class="flex items-center gap-4 border-b border-hairline px-4 py-3.5 last:border-0">
            <div class="flex-1 space-y-2">
              <span class="block h-3 w-40 animate-pulse rounded bg-surface-lift" />
              <span class="block h-2.5 w-64 animate-pulse rounded bg-surface-lift" />
            </div>
            <span class="h-5 w-9 animate-pulse rounded-full bg-surface-lift" />
          </div>
        </AdminUiCard>

        <AdminUiCard v-else-if="siteSettings.length === 0" flush>
          <AdminUiEmpty :icon="mdiBellRingOutline" :text="t('adminNotifications.registry.empty')" />
        </AdminUiCard>

        <AdminUiCard v-for="group in groupedSiteSettings" :key="group.area" flush>
          <template #header>
            <div class="flex items-center gap-2">
              <h2 class="text-[13px] font-semibold text-ink">{{ group.label }}</h2>
              <span class="rounded bg-surface-lift px-1 text-[11px] tabular-nums text-ink-faint">{{ group.items.length }}</span>
            </div>
          </template>

          <ul class="divide-y divide-hairline">
            <li
              v-for="item in group.items"
              :key="item.kind"
              :data-testid="`notification-type-${item.kind}`"
              class="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface-hover/50 sm:flex-row sm:items-center sm:gap-6"
            >
              <div class="min-w-0 flex-1" :title="item.description">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[13px] font-medium text-ink">{{ item.label }}</span>
                  <AdminUiBadge :tone="triggerTone(item)">{{ triggerLabel(item) }}</AdminUiBadge>
                  <AdminUiBadge v-if="item.pinned" tone="brand">{{ t('adminNotifications.registry.pinned') }}</AdminUiBadge>
                  <AdminUiBadge v-if="item.groupable">{{ t('adminNotifications.registry.grouped') }}</AdminUiBadge>
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-faint">
                  <template v-if="item.siteCategory">
                    <span>{{ capitalize(item.siteCategory) }}</span>
                    <span>·</span>
                  </template>
                  <span class="tabular-nums">{{ t('adminNotifications.registry.sent7d', { count: formatNumber(item.stats7d.siteSent) }) }}</span>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-3">
                <button
                  v-if="item.paramFields.length > 0"
                  type="button"
                  :data-testid="`notification-type-edit-${item.kind}`"
                  :title="paramsSummary(item)"
                  class="nd-btn !h-7 !text-xs"
                  @click="openParamEditor(item)"
                >
                  <UiBaseIcon :path="mdiPencilOutline" :size="14" w="w-3.5" h="h-3.5" />
                  <span>{{ t('adminNotifications.registry.edit') }}</span>
                </button>
                <span v-if="item.alwaysEnabled" :title="t('adminNotifications.registry.locked')" class="text-ink-faint">
                  <UiBaseIcon :path="mdiLockOutline" :size="14" w="w-3.5" h="h-3.5" />
                </span>
                <AdminUiSwitch
                  :model-value="item.siteEnabled"
                  :label="item.label"
                  :disabled="item.alwaysEnabled || (mounted && savingKind === item.kind)"
                  @update:model-value="toggleSite(item)"
                />
              </div>
            </li>
          </ul>
        </AdminUiCard>
      </div>
    </section>

    <!-- Parameter drawer -->
    <CommonBaseModal
      :open="Boolean(editingParamsItem)"
      transition="nd-drawer"
      labelledby="admin-notif-params-title"
      overlay-class="items-stretch justify-end bg-fixed-scrim/60"
      panel-class="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-hairline bg-background"
      @close="editingParamsItem = null"
    >
      <template v-if="editingParamsItem">
        <div class="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div class="min-w-0 space-y-1">
            <h2 id="admin-notif-params-title" class="text-[15px] font-semibold leading-snug text-ink">
              {{ editingParamsItem.label }}
            </h2>
            <p class="text-xs text-ink-muted">{{ editingParamsItem.description }}</p>
          </div>
          <button
            type="button"
            :aria-label="t('common.close')"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
            @click="editingParamsItem = null"
          >
            <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
          </button>
        </div>

        <div class="flex-1 space-y-4 px-5 py-4">
          <div v-for="field in editingParamsItem.paramFields" :key="field.key">
            <label :for="`notif-param-${field.key}`" class="nd-admin-label">{{ field.label }}</label>
            <input
              :id="`notif-param-${field.key}`"
              v-model.number="paramDraft[field.key]"
              type="number"
              :min="field.min"
              :max="field.max"
              class="nd-input !h-8 max-w-[10rem] !text-[13px]"
            />
            <p class="mt-1 text-xs text-ink-faint">{{ field.description }}</p>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
          <button
            type="button"
            :disabled="savingKind === editingParamsItem.kind"
            class="nd-btn !h-8 !text-[13px]"
            @click="saveParams(true)"
          >
            {{ t('adminNotifications.registry.reset') }}
          </button>
          <button
            type="button"
            :disabled="savingKind === editingParamsItem.kind"
            class="nd-btn-accent !h-8 !text-[13px]"
            @click="saveParams(false)"
          >
            <span v-if="savingKind === editingParamsItem.kind" class="nd-spinner" />
            {{ t('adminNotifications.registry.save') }}
          </button>
        </div>
      </template>
    </CommonBaseModal>

    <!-- Broadcast confirmation modal -->
    <CommonBaseModal
      :open="confirmOpen"
      labelledby="admin-notif-confirm-title"
      overlay-class="items-center justify-center bg-fixed-scrim/60 p-4"
      panel-class="w-full max-w-md overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="confirmOpen = false"
    >
      <div class="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <h3 id="admin-notif-confirm-title" class="text-[15px] font-semibold text-ink">
          {{ t('adminNotifications.send.confirmTitle') }}
        </h3>
        <button
          type="button"
          :aria-label="t('common.close')"
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
          @click="confirmOpen = false"
        >
          <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
        </button>
      </div>
      <div class="px-5 py-4 text-[13px] text-ink-muted">
        {{ t('adminNotifications.send.confirmBody', { audience: audienceLabel(audience), title }) }}
      </div>
      <div class="flex justify-end gap-2 border-t border-hairline px-5 py-3">
        <button type="button" class="nd-btn !h-8 !text-[13px]" @click="confirmOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button type="button" data-testid="notifications-confirm-send" class="nd-btn-accent !h-8 !text-[13px]" @click="doSend">
          {{ t('adminNotifications.send.confirmAction') }}
        </button>
      </div>
    </CommonBaseModal>
  </div>
</template>
