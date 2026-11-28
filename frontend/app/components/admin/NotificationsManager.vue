<script setup lang="ts">
import {
  mdiAccountOutline,
  mdiArrowRight,
  mdiBellRingOutline,
  mdiBullhornOutline,
  mdiClose,
  mdiCogOutline,
  mdiEmailOutline,
  mdiHeartOutline,
  mdiRefresh,
  mdiSend,
} from '@mdi/js';
import type {
  ListAdminNotificationBroadcastsResponse,
  ListAdminNotificationSettingsResponse,
} from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { useToastError, useToastSuccess } from '~/utils/toast';

type Tab = 'send' | 'registry';
type SettingItem = ListAdminNotificationSettingsResponse['items'][number];
type BroadcastItem = ListAdminNotificationBroadcastsResponse['items'][number];

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

// Send form state
const kind = ref<'site-announcement' | 'admin-message'>(route.query.userId ? 'admin-message' : 'site-announcement');
const audience = ref<'ALL' | 'PATRONS' | 'USER'>(route.query.userId ? 'USER' : 'ALL');
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

const AREA_ORDER = ['official', 'words', 'community'] as const;
const AREA_LABELS: Record<string, string> = {
  official: 'Official & admin',
  words: 'Word alerts',
  community: 'Community',
};

const groupedSiteSettings = computed(() =>
  AREA_ORDER.map((area) => ({
    area,
    label: AREA_LABELS[area] ?? area,
    items: siteSettings.value.filter((i) => i.area === area),
  })).filter((g) => g.items.length > 0),
);

const safePreviewLink = computed(() => {
  const raw = linkUrl.value.trim();
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
});

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

function statusTone(status: BroadcastItem['status']): string {
  switch (status) {
    case 'SENT':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'FAILED':
      return 'bg-red-500/15 text-red-300 border-red-500/30';
    default:
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
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
  <div data-testid="admin-notifications" class="space-y-4">
    <!-- PostHog-style compact header -->
    <div class="flex items-center justify-between gap-3 border-b border-hairline pb-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-ink">{{ t('adminNotifications.title') }}</h1>
        <p class="text-xs text-ink-muted">{{ t('adminNotifications.subtitle') }}</p>
      </div>
      <button
        type="button"
        :disabled="isLoading"
        :aria-label="t('adminDashboard.nav.refresh')"
        :title="t('adminDashboard.nav.refresh')"
        class="nd-btn !h-8 text-xs"
        @click="loadData"
      >
        <UiBaseIcon :path="mdiRefresh" :size="14" :class="{ 'animate-spin': isLoading }" />
        <span>Reload</span>
      </button>
    </div>

    <!-- Flush underline tabs -->
    <section class="space-y-5">
      <div class="flex flex-wrap items-center gap-4 border-b border-hairline" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'send'"
          :class="[
            '-mb-px border-b-2 pb-2 text-xs font-semibold transition-colors',
            activeTab === 'send' ? 'border-brand-solid text-ink' : 'border-transparent text-ink-muted hover:text-ink',
          ]"
          @click="selectTab('send')"
        >
          {{ t('adminNotifications.tabs.send') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'registry'"
          :class="[
            '-mb-px border-b-2 pb-2 text-xs font-semibold transition-colors',
            activeTab === 'registry' ? 'border-brand-solid text-ink' : 'border-transparent text-ink-muted hover:text-ink',
          ]"
          @click="selectTab('registry')"
        >
          {{ t('adminNotifications.tabs.registry') }}
        </button>
      </div>

      <!-- Tab 1: Send official notice & history -->
      <div v-if="activeTab === 'send'" class="space-y-6">
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <!-- Composer -->
          <form class="space-y-4 lg:col-span-7" @submit.prevent="submitSend">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <fieldset class="space-y-1.5">
                <legend class="text-xs font-medium text-ink-muted">{{ t('adminNotifications.send.kind') }}</legend>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    :class="[
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                      kind === 'site-announcement'
                        ? 'border-brand-solid bg-brand/15 text-brand'
                        : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
                    ]"
                    @click="kind = 'site-announcement'"
                  >
                    <UiBaseIcon :path="mdiBullhornOutline" :size="14" />
                    <span>Announcement</span>
                  </button>
                  <button
                    type="button"
                    :class="[
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                      kind === 'admin-message'
                        ? 'border-brand-solid bg-brand/15 text-brand'
                        : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
                    ]"
                    @click="kind = 'admin-message'"
                  >
                    <UiBaseIcon :path="mdiEmailOutline" :size="14" />
                    <span>Direct message</span>
                  </button>
                </div>
              </fieldset>

              <fieldset class="space-y-1.5">
                <legend class="text-xs font-medium text-ink-muted">{{ t('adminNotifications.send.audience') }}</legend>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="opt in [
                      { value: 'ALL', label: t('adminNotifications.send.audienceAll') },
                      { value: 'PATRONS', label: t('adminNotifications.send.audiencePatrons'), icon: mdiHeartOutline },
                      { value: 'USER', label: t('adminNotifications.send.audienceUser'), icon: mdiAccountOutline },
                    ] as const"
                    :key="opt.value"
                    type="button"
                    :class="[
                      'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      audience === opt.value
                        ? 'border-brand-solid bg-brand/15 text-brand'
                        : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
                    ]"
                    @click="audience = opt.value"
                  >
                    <span>{{ opt.label }}</span>
                  </button>
                </div>
              </fieldset>
            </div>

            <div v-if="audience === 'USER'" class="space-y-1">
              <label class="block space-y-1">
                <span class="text-xs font-medium text-ink-muted">
                  {{ t('adminNotifications.send.targetUserId') }}
                  <span v-if="targetUsername" class="ml-1 text-brand">({{ targetUsername }})</span>
                </span>
                <input
                  v-model.number="targetUserId"
                  type="number"
                  min="1"
                  placeholder="e.g. 42"
                  class="nd-input max-w-xs"
                />
              </label>
            </div>

            <label class="block space-y-1">
              <span class="text-xs font-medium text-ink-muted">{{ t('adminNotifications.send.title') }}</span>
              <input
                v-model="title"
                type="text"
                maxlength="160"
                placeholder="Nadeshiko 3.0.0 is here!"
                class="nd-input"
              />
            </label>

            <label class="block space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-ink-muted">{{ t('adminNotifications.send.message') }}</span>
                <span class="text-[11px] text-ink-faint tabular-nums">{{ message.length }}/2000</span>
              </div>
              <textarea
                v-model="message"
                rows="4"
                maxlength="2000"
                placeholder="Short announcement text shown in the bell (English)..."
                class="nd-input resize-y"
              />
            </label>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="block space-y-1">
                <span class="text-xs font-medium text-ink-muted">{{ t('adminNotifications.send.linkUrl') }}</span>
                <input
                  v-model="linkUrl"
                  type="text"
                  placeholder="/en/blog/nadeshiko-v3-0-0"
                  class="nd-input"
                />
              </label>
              <label class="block space-y-1">
                <span class="text-xs font-medium text-ink-muted">{{ t('adminNotifications.send.linkLabel') }}</span>
                <input
                  v-model="linkLabel"
                  type="text"
                  maxlength="80"
                  placeholder="Read the blog post"
                  class="nd-input"
                />
              </label>
            </div>

            <div class="flex justify-end pt-1">
              <button type="submit" :disabled="isSending" class="nd-btn-accent">
                <UiBaseIcon :path="mdiSend" :size="15" />
                <span>{{ isSending ? t('adminNotifications.send.sending') : t('adminNotifications.send.submit') }}</span>
              </button>
            </div>
          </form>

          <!-- Realistic Bell Preview -->
          <div class="space-y-3 lg:col-span-5">
            <div class="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              {{ t('adminNotifications.send.preview') }}
            </div>
            <div class="overflow-hidden rounded-xl border border-hairline bg-surface shadow-lg">
              <div class="flex items-center justify-between border-b border-hairline px-4 py-2.5">
                <span class="text-xs font-semibold text-ink">{{ t('notifications.bell.label') }}</span>
                <span class="text-[11px] text-ink-faint">{{ t('notifications.bell.markAllRead') }}</span>
              </div>
              <div class="flex items-start gap-3 border-l-2 border-brand bg-brand/[0.06] px-4 py-3.5">
                <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                  <UiBaseIcon :path="kind === 'site-announcement' ? mdiBullhornOutline : mdiEmailOutline" :size="16" />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-sm font-semibold leading-snug text-ink">
                      {{ title || 'Nadeshiko 3.0.0 is here!' }}
                    </span>
                    <span class="flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                      <span class="size-1.5 rounded-full bg-brand" /> now
                    </span>
                  </div>
                  <p class="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink-muted">
                    {{ message || 'Write your announcement message to preview how readers will see it in the bell.' }}
                  </p>
                  <span
                    v-if="safePreviewLink"
                    class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand"
                  >
                    <span>{{ linkLabel || t('notifications.bell.openLink') }}</span>
                    <UiBaseIcon :path="mdiArrowRight" :size="13" />
                  </span>
                </div>
              </div>
            </div>
            <p class="text-xs leading-relaxed text-ink-faint">{{ t('adminNotifications.send.pinnedHint') }}</p>
          </div>
        </div>

        <!-- Recent broadcasts list -->
        <div class="space-y-2.5 border-t border-hairline pt-5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {{ t('adminNotifications.history.title') }}
          </h2>
          <div
            v-if="broadcasts.length === 0"
            class="rounded-xl border border-hairline bg-surface/40 px-4 py-8 text-center text-sm text-ink-faint"
          >
            {{ t('adminNotifications.history.empty') }}
          </div>
          <div v-else class="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface/40">
            <div
              v-for="row in broadcasts"
              :key="row.id"
              class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium text-ink">{{ row.title }}</span>
                  <span class="rounded-full border px-2 py-0.5 text-[10px] font-semibold" :class="statusTone(row.status)">
                    {{ row.status }}
                  </span>
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-faint">
                  <span>{{ formatDate(row.createdAt, 'dateTime') }}</span>
                  <span>·</span>
                  <span>
                    {{ row.audience === 'USER' ? (row.targetUsername || `User #${row.targetUserId}`) : row.audience }}
                  </span>
                  <span v-if="row.linkUrl">· {{ row.linkUrl }}</span>
                </div>
              </div>
              <div class="shrink-0 text-xs font-medium text-ink-muted tabular-nums">
                {{ formatNumber(row.sentCount) }} / {{ formatNumber(row.recipientCount) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 2: Registry & Settings (Grouped cards) -->
      <div v-else class="space-y-6">
        <div v-for="group in groupedSiteSettings" :key="group.area" class="space-y-2">
          <h2 class="px-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {{ group.label }}
          </h2>
          <div class="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface/40">
            <div
              v-for="item in group.items"
              :key="item.kind"
              class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <UiBaseIcon :path="mdiBellRingOutline" :size="15" class="shrink-0 text-brand" />
                  <span class="text-sm font-medium text-ink">{{ item.label }}</span>
                  <code class="rounded bg-surface-lift px-1.5 py-0.5 text-[11px] text-ink-faint">{{ item.kind }}</code>
                  <span
                    v-if="item.pinned"
                    class="rounded-full border border-brand/30 bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand"
                  >
                    Pinned
                  </span>
                  <span
                    v-if="item.groupable"
                    class="rounded-full border border-hairline bg-surface-lift px-2 py-0.5 text-[10px] font-medium text-ink-muted"
                  >
                    Grouped
                  </span>
                </div>
                <p class="mt-1 text-xs leading-relaxed text-ink-muted">{{ item.description }}</p>
                <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                  <span>{{ item.schedule ? `${item.trigger} · ${item.schedule}` : item.trigger }}</span>
                  <span>·</span>
                  <span class="tabular-nums">7d: {{ formatNumber(item.stats7d.siteSent) }} sent</span>
                  <template v-if="item.paramFields.length > 0">
                    <span>·</span>
                    <span class="font-mono text-ink-muted">
                      {{ item.paramFields.map((f) => `${f.key}=${item.params[f.key]}`).join(', ') }}
                    </span>
                  </template>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-3">
                <button
                  v-if="item.paramFields.length > 0"
                  type="button"
                  class="nd-btn !h-8 text-xs"
                  @click="openParamEditor(item)"
                >
                  <UiBaseIcon :path="mdiCogOutline" :size="14" />
                  <span>{{ t('adminNotifications.registry.edit') }}</span>
                </button>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="item.siteEnabled"
                  :aria-label="item.label"
                  :disabled="item.alwaysEnabled || savingKind === item.kind"
                  :class="[
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                    item.siteEnabled ? 'bg-brand-solid' : 'bg-gray-600',
                  ]"
                  @click="toggleSite(item)"
                >
                  <span
                    :class="[
                      'pointer-events-none inline-block size-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out',
                      item.siteEnabled ? 'translate-x-5' : 'translate-x-0',
                    ]"
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
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
        <div class="nd-modal-header">
          <h2 id="admin-notif-params-title" class="min-w-0 truncate font-bold text-ink">
            {{ editingParamsItem.label }}
          </h2>
          <button
            type="button"
            :aria-label="t('adminEmails.detail.close')"
            class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="editingParamsItem = null"
          >
            <UiBaseIcon :path="mdiClose" :size="16" />
          </button>
        </div>

        <div class="flex-1 space-y-4 px-5 py-4">
          <p class="text-xs leading-relaxed text-ink-muted">{{ editingParamsItem.description }}</p>
          <div v-for="field in editingParamsItem.paramFields" :key="field.key" class="space-y-1">
            <label :for="`notif-param-${field.key}`" class="block text-sm font-medium text-ink">{{ field.label }}</label>
            <p class="text-xs text-ink-faint">{{ field.description }}</p>
            <input
              :id="`notif-param-${field.key}`"
              v-model.number="paramDraft[field.key]"
              type="number"
              :min="field.min"
              :max="field.max"
              class="nd-input max-w-[10rem]"
            />
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-hairline px-5 py-3">
          <button type="button" class="nd-btn text-xs" @click="saveParams(true)">
            {{ t('adminNotifications.registry.reset') }}
          </button>
          <div class="flex gap-2">
            <button type="button" class="nd-btn" @click="editingParamsItem = null">
              {{ t('adminEmails.detail.close') }}
            </button>
            <button type="button" class="nd-btn-accent" @click="saveParams(false)">
              {{ t('adminNotifications.registry.save') }}
            </button>
          </div>
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
      <div class="nd-modal-header">
        <h3 id="admin-notif-confirm-title" class="font-bold text-ink">{{ t('adminNotifications.send.confirmTitle') }}</h3>
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
          @click="confirmOpen = false"
        >
          <UiBaseIcon :path="mdiClose" :size="16" />
        </button>
      </div>
      <div class="px-5 py-4 text-sm text-ink-muted">
        {{ t('adminNotifications.send.confirmBody', { audience, title }) }}
      </div>
      <div class="flex justify-end gap-2 border-t border-hairline px-5 py-3">
        <button type="button" class="nd-btn" @click="confirmOpen = false">
          {{ t('adminEmails.detail.close') }}
        </button>
        <button type="button" class="nd-btn-accent" @click="doSend">
          {{ t('adminNotifications.send.confirmAction') }}
        </button>
      </div>
    </CommonBaseModal>
  </div>
</template>
