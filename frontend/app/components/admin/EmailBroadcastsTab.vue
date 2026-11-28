<script setup lang="ts">
import { useEventListener, useTimeoutFn } from '@vueuse/core';
import {
  mdiChevronDown,
  mdiClose,
  mdiDeleteOutline,
  mdiDotsHorizontal,
  mdiEmailFastOutline,
  mdiFormatBold,
  mdiFormatHeader1,
  mdiFormatHeader3,
  mdiFormatListBulleted,
  mdiFormatQuoteClose,
  mdiImagePlusOutline,
  mdiLinkVariant,
  mdiOpenInNew,
  mdiPencilOutline,
  mdiPlus,
  mdiRefresh,
  mdiSend,
  mdiSendOutline,
  mdiStopCircleOutline,
} from '@mdi/js';
import type { AdminEmailBroadcast } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { useToastError, useToastSuccess } from '~/utils/toast';
import AdminUiBadge, { type AdminTone } from './ui/Badge.vue';
import AdminUiEmpty from './ui/Empty.vue';
import AdminUiSegmented, { type AdminSegment } from './ui/Segmented.vue';

type Audience = AdminEmailBroadcast['audience'];
type Status = AdminEmailBroadcast['status'];

const emit = defineEmits<{ openCampaignLog: [campaignKey: string] }>();

const { t } = useI18n();
const { formatDate, formatNumber } = useFormat();
const sdk = useNadeshikoSdk();
const store = userStore();

const broadcasts = ref<AdminEmailBroadcast[]>([]);
const isLoading = ref(false);
const composerOpen = ref(false);
const editingId = ref<string | null>(null);
const statusFilter = ref<Status | 'ALL'>('ALL');
const mounted = ref(false);

const campaignKey = ref('');
const subject = ref('');
const previewText = ref('');
const bodyMarkdown = ref('');
const ctaLabel = ref('');
const ctaUrl = ref('');
const audience = ref<Audience>('ALL_OPTED_IN');
const activeDays = ref(90);
const userIdsText = ref('');
const showButton = ref(false);
const showAdvanced = ref(false);

const bodyTextarea = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const isUploadingImage = ref(false);

const previewHtml = ref('');
const previewSubject = ref('');
const isPreviewing = ref(false);
const isSendingTest = ref(false);

const estimatedCount = ref<number | null>(null);
const isEstimating = ref(false);
const isSaving = ref(false);
const confirmSendTarget = ref<AdminEmailBroadcast | null>(null);
/** Exact recipients for the broadcast awaiting confirmation; `undefined` when the estimate failed. */
const confirmCount = ref<number | null | undefined>(null);
const deleteTarget = ref<AdminEmailBroadcast | null>(null);
const testEmailTo = ref(store.userEmail ?? '');

const AUDIENCES: readonly Audience[] = ['ALL_OPTED_IN', 'PATRONS', 'ACTIVE_DAYS', 'SPECIFIC_USERS'];
const STATUSES: readonly Status[] = ['DRAFT', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'];

const audienceOptions = computed<AdminSegment<Audience>[]>(() =>
  AUDIENCES.map((value) => ({ value, label: t(`adminEmails.broadcasts.audiences.${value}`) })),
);

const statusOptions = computed<AdminSegment<Status | 'ALL'>[]>(() => [
  { value: 'ALL', label: t('adminEmails.broadcasts.filterAll'), count: broadcasts.value.length },
  ...STATUSES.filter((s) => broadcasts.value.some((b) => b.status === s)).map((value) => ({
    value,
    label: t(`adminEmails.broadcasts.status.${value}`),
    count: broadcasts.value.filter((b) => b.status === value).length,
  })),
]);

const visibleBroadcasts = computed(() =>
  statusFilter.value === 'ALL' ? broadcasts.value : broadcasts.value.filter((b) => b.status === statusFilter.value),
);

function statusTone(status: Status): AdminTone {
  switch (status) {
    case 'SENT':
      return 'success';
    case 'SENDING':
      return 'warning';
    case 'FAILED':
      return 'danger';
    case 'DRAFT':
      return 'info';
    default:
      return 'neutral';
  }
}

function audienceDetail(row: AdminEmailBroadcast): string | null {
  if (row.audience === 'ACTIVE_DAYS') {
    return t('adminEmails.broadcasts.activeDaysShort', { days: row.audienceParams?.activeDays ?? 90 });
  }
  if (row.audience === 'SPECIFIC_USERS') {
    const count = row.audienceParams?.userIds?.length ?? 0;
    return t('adminEmails.broadcasts.usersCount', { count }, count);
  }
  return null;
}

function progress(row: AdminEmailBroadcast): number {
  if (!row.recipientCount) return 0;
  return Math.min(100, Math.round(((row.sentCount + row.failedCount) / row.recipientCount) * 100));
}

const USERNAME_VAR = '{{username}}';

async function load() {
  isLoading.value = true;
  try {
    const res = await sdk.listAdminEmailBroadcasts();
    broadcasts.value = res.items;
  } catch (err) {
    handleApiError('admin:email-broadcasts-load-failed', err);
  } finally {
    isLoading.value = false;
  }
}

function buildAudienceParams() {
  if (audience.value === 'ACTIVE_DAYS') return { activeDays: activeDays.value };
  if (audience.value === 'SPECIFIC_USERS') {
    const ids = userIdsText.value
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return { userIds: ids };
  }
  return {};
}

async function estimate() {
  isEstimating.value = true;
  try {
    const res = await sdk.estimateAdminEmailBroadcast({
      audience: audience.value,
      audienceParams: buildAudienceParams(),
    });
    estimatedCount.value = res.recipientCount;
  } catch (err) {
    handleApiError('admin:email-broadcast-estimate-failed', err);
  } finally {
    isEstimating.value = false;
  }
}

async function refreshPreview(sendTest = false) {
  isPreviewing.value = true;
  if (sendTest) isSendingTest.value = true;
  try {
    const res = await sdk.previewAdminEmailTemplate({
      kind: 'broadcast',
      subjectOverride: subject.value.trim() || t('adminEmails.broadcasts.previewSubjectFallback'),
      bodyOverride: bodyMarkdown.value.trim() || t('adminEmails.broadcasts.previewBodyFallback'),
      previewText: previewText.value.trim() || null,
      ctaLabel: ctaLabel.value.trim() || null,
      ctaUrl: ctaUrl.value.trim() || null,
      sendTestTo: sendTest ? testEmailTo.value.trim() || store.userEmail || null : null,
    });
    previewSubject.value = res.subject;
    previewHtml.value = res.html;
    if (res.testSent) {
      useToastSuccess(t('adminEmails.templates.testSentToast', { email: testEmailTo.value || store.userEmail || '' }));
    }
  } catch (err) {
    if (sendTest) handleApiError('admin:email-broadcast-preview-failed', err);
  } finally {
    isPreviewing.value = false;
    isSendingTest.value = false;
  }
}

const { start: schedulePreview } = useTimeoutFn(() => {
  if (composerOpen.value) void refreshPreview(false);
}, 400, { immediate: false });

function insertAtCursor(snippet: string) {
  const el = bodyTextarea.value;
  if (!el) {
    bodyMarkdown.value = `${bodyMarkdown.value}${snippet}`;
    return;
  }
  const start = el.selectionStart ?? bodyMarkdown.value.length;
  const end = el.selectionEnd ?? bodyMarkdown.value.length;
  const before = bodyMarkdown.value.slice(0, start);
  const after = bodyMarkdown.value.slice(end);
  bodyMarkdown.value = `${before}${snippet}${after}`;
  nextTick(() => {
    el.focus();
    const pos = start + snippet.length;
    el.setSelectionRange(pos, pos);
  });
}

function wrapSelection(prefix: string, suffix: string, placeholder: string) {
  const el = bodyTextarea.value;
  if (!el) {
    insertAtCursor(`${prefix}${placeholder}${suffix}`);
    return;
  }
  const start = el.selectionStart ?? bodyMarkdown.value.length;
  const end = el.selectionEnd ?? bodyMarkdown.value.length;
  const selected = bodyMarkdown.value.slice(start, end) || placeholder;
  const before = bodyMarkdown.value.slice(0, start);
  const after = bodyMarkdown.value.slice(end);
  bodyMarkdown.value = `${before}${prefix}${selected}${suffix}${after}`;
  nextTick(() => {
    el.focus();
    el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  });
}

async function uploadImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    useToastError(t('adminEmails.broadcasts.imageTypeError'));
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    useToastError(t('adminEmails.broadcasts.imageSizeError'));
    return;
  }
  isUploadingImage.value = true;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
    const uploaded = await sdk.uploadAdminEmailAsset({ dataUrl });
    const alt = file.name ? file.name.replace(/\.[^.]+$/, '') : 'image';
    insertAtCursor(`\n\n![${alt}](${uploaded.url})\n\n`);
    void refreshPreview(false);
  } catch (err) {
    handleApiError('admin:email-asset-upload-failed', err);
  } finally {
    isUploadingImage.value = false;
  }
}

function onBodyPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        void uploadImageFile(file);
        return;
      }
    }
  }
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void uploadImageFile(file);
}

const markdownTools = computed(() => [
  { key: 'title', icon: mdiFormatHeader1, run: () => insertAtCursor('\n# ') },
  { key: 'heading', icon: mdiFormatHeader3, run: () => insertAtCursor('\n### ') },
  {
    key: 'bold',
    icon: mdiFormatBold,
    run: () => wrapSelection('**', '**', t('adminEmails.broadcasts.toolbar.boldPlaceholder')),
  },
  { key: 'list', icon: mdiFormatListBulleted, run: () => insertAtCursor('\n- ') },
  { key: 'quote', icon: mdiFormatQuoteClose, run: () => insertAtCursor('\n> ') },
  {
    key: 'link',
    icon: mdiLinkVariant,
    run: () => wrapSelection('[', '](https://nadeshiko.co)', t('adminEmails.broadcasts.toolbar.linkPlaceholder')),
  },
]);

function openNew() {
  editingId.value = null;
  campaignKey.value = 'release-3.0.0';
  subject.value = 'Nadeshiko 3.0.0 is here!';
  previewText.value = 'Our biggest release yet — dictionary, pitch audio, word alerts and more.';
  bodyMarkdown.value =
    '# Hey {{username}}, Nadeshiko 3.0.0 is here!\n\nWe just shipped our biggest update yet.\n\n### What is new\n\n- Built-in dictionary & pitch accent audio\n- Word alerts and in-site notifications\n- Content requests with votes and Patron boosts\n\n> Tip: you can paste screenshots directly here with Ctrl+V!';
  ctaLabel.value = 'Read the 3.0.0 blog post';
  ctaUrl.value = '/en/blog/nadeshiko-v3-0-0';
  audience.value = 'ALL_OPTED_IN';
  activeDays.value = 90;
  userIdsText.value = '';
  estimatedCount.value = null;
  showButton.value = Boolean(ctaLabel.value || ctaUrl.value);
  showAdvanced.value = false;
  composerOpen.value = true;
  void estimate();
  void refreshPreview(false);
}

function openEdit(row: AdminEmailBroadcast) {
  editingId.value = row.id;
  campaignKey.value = row.campaignKey;
  subject.value = row.subject;
  previewText.value = row.previewText ?? '';
  bodyMarkdown.value = row.bodyMarkdown;
  ctaLabel.value = row.ctaLabel ?? '';
  ctaUrl.value = row.ctaUrl ?? '';
  audience.value = row.audience;
  activeDays.value = row.audienceParams?.activeDays ?? 90;
  userIdsText.value = (row.audienceParams?.userIds ?? []).join(', ');
  estimatedCount.value = null;
  showButton.value = Boolean(ctaLabel.value || ctaUrl.value);
  showAdvanced.value = false;
  composerOpen.value = true;
  void estimate();
  void refreshPreview(false);
}

/** Creates or updates the draft from the composer; returns the stored row, or null when nothing was saved. */
async function persistDraft(): Promise<AdminEmailBroadcast | null> {
  if (!campaignKey.value.trim() || !subject.value.trim() || !bodyMarkdown.value.trim()) {
    if (!campaignKey.value.trim()) showAdvanced.value = true;
    useToastError(t('adminNotifications.send.missingFields'));
    return null;
  }
  isSaving.value = true;
  try {
    const payload = {
      campaignKey: campaignKey.value.trim(),
      subject: subject.value.trim(),
      previewText: previewText.value.trim() || null,
      bodyMarkdown: bodyMarkdown.value.trim(),
      ctaLabel: ctaLabel.value.trim() || null,
      ctaUrl: ctaUrl.value.trim() || null,
      audience: audience.value,
      audienceParams: buildAudienceParams(),
    };
    const saved = editingId.value
      ? await sdk.updateAdminEmailBroadcast({ broadcastId: editingId.value, ...payload })
      : await sdk.createAdminEmailBroadcast(payload);
    editingId.value = saved.id;
    return saved;
  } catch (err) {
    handleApiError('admin:email-broadcast-save-failed', err);
    return null;
  } finally {
    isSaving.value = false;
  }
}

async function saveDraft() {
  const saved = await persistDraft();
  if (!saved) return;
  composerOpen.value = false;
  useToastSuccess(t('adminEmails.broadcasts.savedToast'));
  await load();
}

/** Sending from the composer stores the draft first, then asks for the same confirmation as the list. */
async function saveAndSend() {
  const saved = await persistDraft();
  if (!saved) return;
  composerOpen.value = false;
  await load();
  void openSendConfirm(saved);
}

async function openSendConfirm(row: AdminEmailBroadcast) {
  closeMenu();
  confirmSendTarget.value = row;
  confirmCount.value = null;
  try {
    const res = await sdk.estimateAdminEmailBroadcast({ audience: row.audience, audienceParams: row.audienceParams ?? {} });
    if (confirmSendTarget.value?.id === row.id) confirmCount.value = res.recipientCount;
  } catch (err) {
    if (confirmSendTarget.value?.id === row.id) confirmCount.value = undefined;
    handleApiError('admin:email-broadcast-estimate-failed', err);
  }
}

function askDelete(row: AdminEmailBroadcast) {
  closeMenu();
  deleteTarget.value = row;
}

async function confirmDelete() {
  const row = deleteTarget.value;
  deleteTarget.value = null;
  if (row) await removeDraft(row);
}

async function removeDraft(row: AdminEmailBroadcast) {
  try {
    await sdk.deleteAdminEmailBroadcast(row.id);
    broadcasts.value = broadcasts.value.filter((b) => b.id !== row.id);
    useToastSuccess(t('adminEmails.broadcasts.deletedToast'));
  } catch (err) {
    handleApiError('admin:email-broadcast-delete-failed', err);
  }
}

async function sendTest(row: AdminEmailBroadcast) {
  closeMenu();
  try {
    await sdk.testAdminEmailBroadcast({ broadcastId: row.id, toEmail: testEmailTo.value.trim() || undefined });
    useToastSuccess(t('adminEmails.templates.testSentToast', { email: testEmailTo.value || store.userEmail || '' }));
  } catch (err) {
    handleApiError('admin:email-broadcast-test-failed', err);
  }
}

async function confirmAndSend() {
  const row = confirmSendTarget.value;
  if (!row) return;
  confirmSendTarget.value = null;
  try {
    await sdk.sendAdminEmailBroadcast(row.id);
    useToastSuccess(t('adminEmails.broadcasts.launchedToast'));
    await load();
  } catch (err) {
    handleApiError('admin:email-broadcast-send-failed', err);
  }
}

async function cancel(row: AdminEmailBroadcast) {
  try {
    await sdk.cancelAdminEmailBroadcast(row.id);
    useToastSuccess(t('adminEmails.broadcasts.cancelledToast'));
    await load();
  } catch (err) {
    handleApiError('admin:email-broadcast-cancel-failed', err);
  }
}

function openLog(row: AdminEmailBroadcast) {
  closeMenu();
  emit('openCampaignLog', row.campaignKey);
}

/** Row kebab menu, positioned fixed so the scrolling table frame does not clip it. */
const menu = ref<{ row: AdminEmailBroadcast; top: number; right: number } | null>(null);

function toggleMenu(row: AdminEmailBroadcast, event: MouseEvent) {
  if (menu.value?.row.id === row.id) {
    menu.value = null;
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  menu.value = { row, top: rect.bottom + 4, right: window.innerWidth - rect.right };
}

function closeMenu() {
  menu.value = null;
}

if (import.meta.client) {
  useEventListener(window, 'click', closeMenu);
  useEventListener(window, 'resize', closeMenu);
  useEventListener(window, 'scroll', closeMenu, { capture: true, passive: true });
}

watch([audience, activeDays], () => {
  if (composerOpen.value) void estimate();
});

watch([subject, previewText, bodyMarkdown, ctaLabel, ctaUrl], () => {
  if (composerOpen.value) schedulePreview();
});

onMounted(() => {
  mounted.value = true;
  void load();
});
defineExpose({ refresh: load });
</script>

<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2">
      <AdminUiSegmented v-if="broadcasts.length" v-model="statusFilter" :options="statusOptions" />
      <button type="button" data-testid="broadcasts-new" class="nd-btn-accent ml-auto !h-8 !text-[13px]" @click="openNew">
        <UiBaseIcon :path="mdiPlus" :size="16" w="w-4" h="h-4" />
        <span>{{ t('adminEmails.broadcasts.new') }}</span>
      </button>
    </div>

    <!-- List -->
    <div v-if="isLoading && broadcasts.length === 0" class="nd-admin-table-wrap">
      <div v-for="n in 4" :key="n" class="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-0">
        <span class="h-3 w-56 animate-pulse rounded bg-surface-lift" />
        <span class="h-3 w-24 animate-pulse rounded bg-surface-lift" />
        <span class="h-3 flex-1 animate-pulse rounded bg-surface-lift" />
      </div>
    </div>
    <div v-else-if="visibleBroadcasts.length === 0" class="nd-admin-table-wrap">
      <AdminUiEmpty :icon="mdiEmailFastOutline" :text="t('adminEmails.broadcasts.empty')">
        <button v-if="!broadcasts.length" type="button" class="nd-btn-accent !h-8 !text-[13px]" @click="openNew">
          <UiBaseIcon :path="mdiPlus" :size="16" w="w-4" h="h-4" />
          <span>{{ t('adminEmails.broadcasts.new') }}</span>
        </button>
      </AdminUiEmpty>
    </div>
    <div v-else class="nd-admin-table-wrap">
      <table class="nd-admin-table min-w-[880px]">
        <thead>
          <tr>
            <th>{{ t('adminEmails.table.subject') }}</th>
            <th>{{ t('adminNotifications.send.audience') }}</th>
            <th>{{ t('adminEmails.table.status') }}</th>
            <th class="text-right">{{ t('adminEmails.broadcasts.recipients') }}</th>
            <th class="text-right">{{ t('adminEmails.kpi.sent') }}</th>
            <th class="text-right">{{ t('adminEmails.kpi.failed') }}</th>
            <th class="text-right">{{ t('adminEmails.table.date') }}</th>
            <th class="w-32" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visibleBroadcasts" :key="row.id" data-testid="broadcasts-row">
            <td>
              <div class="max-w-[22rem] truncate font-medium text-ink" :title="row.subject">{{ row.subject }}</div>
              <div class="font-mono text-xs text-ink-faint">{{ row.campaignKey }}</div>
              <div v-if="row.error" class="mt-0.5 max-w-[22rem] truncate text-xs text-red-400" :title="row.error">
                {{ row.error }}
              </div>
            </td>
            <td class="whitespace-nowrap">
              <div class="text-ink-muted">{{ t(`adminEmails.broadcasts.audiences.${row.audience}`) }}</div>
              <div v-if="audienceDetail(row)" class="text-xs text-ink-faint">{{ audienceDetail(row) }}</div>
            </td>
            <td>
              <AdminUiBadge :tone="statusTone(row.status)" dot>{{ t(`adminEmails.broadcasts.status.${row.status}`) }}</AdminUiBadge>
              <div v-if="row.status === 'SENDING'" class="mt-1.5 flex items-center gap-2">
                <div class="h-1 w-20 overflow-hidden rounded-full bg-surface-lift">
                  <div class="h-full rounded-full bg-brand transition-all" :style="{ width: `${progress(row)}%` }" />
                </div>
                <span class="text-[11px] tabular-nums text-ink-faint">{{ progress(row) }}%</span>
              </div>
            </td>
            <td class="text-right tabular-nums text-ink-muted">
              {{ row.status === 'DRAFT' ? '—' : formatNumber(row.recipientCount) }}
            </td>
            <td class="text-right tabular-nums text-ink-muted">
              {{ row.status === 'DRAFT' ? '—' : formatNumber(row.sentCount) }}
            </td>
            <td class="text-right tabular-nums" :class="row.failedCount > 0 ? 'text-red-400' : 'text-ink-faint'">
              {{ row.status === 'DRAFT' ? '—' : formatNumber(row.failedCount) }}
            </td>
            <td class="whitespace-nowrap text-right text-xs tabular-nums text-ink-faint">
              {{ formatDate(row.sentAt ?? row.updatedAt ?? row.createdAt, 'dateTime') }}
            </td>
            <td>
              <div class="flex items-center justify-end gap-1">
                <button v-if="row.status === 'DRAFT'" type="button" class="nd-btn !h-7 !text-xs" @click="openEdit(row)">
                  <UiBaseIcon :path="mdiPencilOutline" :size="14" w="w-3.5" h="h-3.5" />
                  <span>{{ t('adminNotifications.registry.edit') }}</span>
                </button>
                <button v-else-if="row.status === 'SENDING'" type="button" class="nd-btn !h-7 !text-xs" @click="cancel(row)">
                  <UiBaseIcon :path="mdiStopCircleOutline" :size="14" w="w-3.5" h="h-3.5" />
                  <span>{{ t('adminEmails.broadcasts.cancel') }}</span>
                </button>
                <button v-else type="button" class="nd-btn !h-7 !text-xs" @click="openLog(row)">
                  <UiBaseIcon :path="mdiOpenInNew" :size="14" w="w-3.5" h="h-3.5" />
                  <span>{{ t('adminEmails.broadcasts.viewLog') }}</span>
                </button>
                <button
                  type="button"
                  :data-testid="`broadcasts-menu-${row.id}`"
                  :aria-label="t('adminEmails.broadcasts.actions')"
                  :aria-expanded="menu?.row.id === row.id"
                  class="inline-flex size-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
                  :class="{ 'bg-surface-hover text-ink': menu?.row.id === row.id }"
                  @click.stop="toggleMenu(row, $event)"
                >
                  <UiBaseIcon :path="mdiDotsHorizontal" :size="16" w="w-4" h="h-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Row menu -->
    <div
      v-if="menu"
      class="nd-menu fixed z-40 w-48"
      :style="{ top: `${menu.top}px`, right: `${menu.right}px` }"
      role="menu"
      @click.stop
      @keydown.esc="closeMenu"
    >
      <button
        v-if="menu.row.status === 'DRAFT' || menu.row.status === 'FAILED'"
        type="button"
        role="menuitem"
        class="nd-menu-item !text-[13px]"
        @click="openSendConfirm(menu.row)"
      >
        <UiBaseIcon :path="mdiSend" :size="15" w="w-4" h="h-4" />
        <span>{{ t('adminEmails.broadcasts.send') }}</span>
      </button>
      <button
        v-if="menu.row.status === 'SENDING'"
        type="button"
        role="menuitem"
        class="nd-menu-item !text-[13px]"
        @click="openLog(menu.row)"
      >
        <UiBaseIcon :path="mdiOpenInNew" :size="15" w="w-4" h="h-4" />
        <span>{{ t('adminEmails.broadcasts.viewLog') }}</span>
      </button>
      <button type="button" role="menuitem" class="nd-menu-item !text-[13px]" @click="sendTest(menu.row)">
        <UiBaseIcon :path="mdiSendOutline" :size="15" w="w-4" h="h-4" />
        <span>{{ t('adminEmails.templates.sendTest') }}</span>
      </button>
      <button
        v-if="menu.row.status === 'DRAFT'"
        type="button"
        role="menuitem"
        class="nd-menu-item is-danger !text-[13px]"
        @click="askDelete(menu.row)"
      >
        <UiBaseIcon :path="mdiDeleteOutline" :size="15" w="w-4" h="h-4" />
        <span>{{ t('adminEmails.broadcasts.deleteDraft') }}</span>
      </button>
    </div>

    <!-- Composer: grouped form on the left, live preview on the right -->
    <CommonBaseModal
      :open="composerOpen"
      labelledby="admin-email-broadcast-composer-title"
      overlay-class="items-center justify-center bg-fixed-scrim/70 p-4"
      panel-class="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="composerOpen = false"
    >
      <div class="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <h3 id="admin-email-broadcast-composer-title" class="text-[15px] font-semibold text-ink">
          {{ editingId ? t('adminEmails.broadcasts.editTitle') : t('adminEmails.broadcasts.new') }}
        </h3>
        <button
          type="button"
          :aria-label="t('adminEmails.detail.close')"
          class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
          @click="composerOpen = false"
        >
          <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-2 lg:overflow-hidden">
        <!-- Form -->
        <div class="divide-y divide-hairline lg:overflow-y-auto">
          <!-- Audience -->
          <section class="space-y-3 p-5">
            <div class="flex items-center justify-between gap-3">
              <h4 class="text-[13px] font-semibold text-ink">{{ t('adminNotifications.send.audience') }}</h4>
              <AdminUiBadge
                data-testid="broadcast-estimate"
                tone="brand"
                :title="t('adminEmails.broadcasts.respectsOptOut')"
              >
                <template v-if="mounted && isEstimating">…</template>
                <template v-else-if="estimatedCount !== null">
                  {{ t('adminEmails.broadcasts.recipientsCount', { count: formatNumber(estimatedCount) }, estimatedCount) }}
                </template>
                <template v-else>—</template>
              </AdminUiBadge>
            </div>
            <AdminUiSegmented v-model="audience" :options="audienceOptions" testid-prefix="broadcast-audience" />
            <label v-if="audience === 'ACTIVE_DAYS'" class="block">
              <span class="nd-admin-label">{{ t('adminEmails.broadcasts.activeDays') }}</span>
              <input v-model.number="activeDays" type="number" min="1" max="365" class="nd-input !h-8 !w-28 !text-[13px]" />
            </label>
            <label v-if="audience === 'SPECIFIC_USERS'" class="block">
              <span class="nd-admin-label">{{ t('adminEmails.broadcasts.userIds') }}</span>
              <input v-model="userIdsText" type="text" placeholder="1, 42, 108" class="nd-input !h-8 !text-[13px]" @blur="estimate" />
            </label>
          </section>

          <!-- Content -->
          <section class="space-y-3 p-5">
            <h4 class="text-[13px] font-semibold text-ink">{{ t('adminEmails.broadcasts.sectionContent') }}</h4>
            <label class="block">
              <span class="nd-admin-label">{{ t('adminEmails.table.subject') }}</span>
              <input v-model="subject" type="text" class="nd-input !h-8 !text-[13px]" />
            </label>
            <label class="block">
              <span class="nd-admin-label">{{ t('adminEmails.broadcasts.previewText') }}</span>
              <input v-model="previewText" type="text" class="nd-input !h-8 !text-[13px]" />
            </label>

            <div>
              <span class="nd-admin-label">{{ t('adminEmails.templates.bodyMarkdown') }}</span>
              <div class="overflow-hidden rounded-lg border border-hairline focus-within:border-brand/50">
                <div class="flex flex-wrap items-center gap-0.5 border-b border-hairline bg-surface p-1">
                  <button
                    v-for="tool in markdownTools"
                    :key="tool.key"
                    type="button"
                    :title="t(`adminEmails.broadcasts.toolbar.${tool.key}`)"
                    :aria-label="t(`adminEmails.broadcasts.toolbar.${tool.key}`)"
                    class="inline-flex size-7 items-center justify-center rounded text-ink-muted transition hover:bg-surface-hover hover:text-ink"
                    @click="tool.run()"
                  >
                    <UiBaseIcon :path="tool.icon" :size="16" w="w-4" h="h-4" />
                  </button>
                  <span class="mx-1 h-4 w-px bg-hairline" />
                  <button
                    type="button"
                    :disabled="isUploadingImage"
                    :title="t('adminEmails.broadcasts.toolbar.pasteHint')"
                    class="inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs text-ink-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
                    @click="fileInput?.click()"
                  >
                    <span v-if="mounted && isUploadingImage" class="nd-spinner !mr-0" />
                    <UiBaseIcon v-else :path="mdiImagePlusOutline" :size="15" w="w-4" h="h-4" />
                    <span>
                      {{ isUploadingImage ? t('adminEmails.broadcasts.toolbar.uploading') : t('adminEmails.broadcasts.toolbar.image') }}
                    </span>
                  </button>
                  <input
                    ref="fileInput"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    class="hidden"
                    @change="onFilePicked"
                  />
                  <button
                    type="button"
                    class="ml-auto rounded-md bg-surface-lift px-1.5 py-0.5 font-mono text-[11px] text-ink-muted transition hover:bg-brand/15 hover:text-brand"
                    @click="insertAtCursor(USERNAME_VAR)"
                  >
                    {{ USERNAME_VAR }}
                  </button>
                </div>
                <textarea
                  ref="bodyTextarea"
                  v-model="bodyMarkdown"
                  rows="12"
                  class="block w-full resize-y border-0 bg-surface/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-ink outline-none focus:ring-0"
                  @paste="onBodyPaste"
                />
              </div>
            </div>
          </section>

          <!-- Button -->
          <section class="p-5">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 text-left"
              :aria-expanded="showButton"
              @click="showButton = !showButton"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span class="text-[13px] font-semibold text-ink">{{ t('adminEmails.broadcasts.sectionButton') }}</span>
                <span v-if="!showButton && ctaLabel" class="truncate text-xs text-ink-faint">{{ ctaLabel }}</span>
              </span>
              <UiBaseIcon
                :path="mdiChevronDown"
                :size="16"
                w="w-4"
                h="h-4"
                class="shrink-0 text-ink-faint transition-transform"
                :class="{ 'rotate-180': showButton }"
              />
            </button>
            <div v-if="showButton" class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="nd-admin-label">{{ t('adminEmails.broadcasts.ctaLabel') }}</span>
                <input v-model="ctaLabel" type="text" class="nd-input !h-8 !text-[13px]" />
              </label>
              <label class="block">
                <span class="nd-admin-label">{{ t('adminEmails.broadcasts.ctaUrl') }}</span>
                <input v-model="ctaUrl" type="text" placeholder="/en/blog/…" class="nd-input !h-8 font-mono !text-[13px]" />
              </label>
            </div>
          </section>

          <!-- Advanced -->
          <section class="p-5">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 text-left"
              :aria-expanded="showAdvanced"
              @click="showAdvanced = !showAdvanced"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span class="text-[13px] font-semibold text-ink">{{ t('adminEmails.broadcasts.sectionAdvanced') }}</span>
                <span v-if="!showAdvanced && campaignKey" class="truncate font-mono text-xs text-ink-faint">{{ campaignKey }}</span>
              </span>
              <UiBaseIcon
                :path="mdiChevronDown"
                :size="16"
                w="w-4"
                h="h-4"
                class="shrink-0 text-ink-faint transition-transform"
                :class="{ 'rotate-180': showAdvanced }"
              />
            </button>
            <label v-if="showAdvanced" class="mt-3 block">
              <span class="nd-admin-label">{{ t('adminEmails.detail.campaign') }}</span>
              <input v-model="campaignKey" type="text" placeholder="release-3.0.0" class="nd-input !h-8 font-mono !text-[13px]" />
            </label>
          </section>
        </div>

        <!-- Live preview -->
        <div class="flex min-h-[480px] flex-col border-t border-hairline bg-surface/40 lg:min-h-0 lg:border-l lg:border-t-0">
          <div class="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2">
            <div class="min-w-0 truncate text-xs">
              <span class="text-ink-faint">{{ t('adminEmails.table.subject') }}:</span>
              <span class="ml-1 font-medium text-ink">{{ previewSubject || subject || '—' }}</span>
            </div>
            <button
              type="button"
              :disabled="isPreviewing"
              :aria-label="t('adminEmails.templates.refreshPreview')"
              :title="t('adminEmails.templates.refreshPreview')"
              class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
              @click="refreshPreview(false)"
            >
              <UiBaseIcon :path="mdiRefresh" :size="15" w="w-4" h="h-4" :class="{ 'animate-spin': mounted && isPreviewing }" />
            </button>
          </div>
          <iframe
            :srcdoc="previewHtml"
            sandbox=""
            class="min-h-[440px] w-full flex-1 border-0 bg-background"
            :title="t('adminEmails.broadcasts.preview')"
          />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-3">
        <div class="flex w-full items-center gap-2 sm:w-auto">
          <input
            v-model="testEmailTo"
            data-testid="broadcast-test-address"
            type="email"
            :placeholder="t('adminEmails.broadcasts.testAddress')"
            :aria-label="t('adminEmails.broadcasts.testAddress')"
            class="nd-input !h-8 min-w-0 flex-1 !text-[13px] sm:!w-56 sm:flex-none"
          />
          <button
            type="button"
            :disabled="isPreviewing"
            class="nd-btn !h-8 shrink-0 !text-[13px]"
            @click="refreshPreview(true)"
          >
            <span v-if="mounted && isSendingTest" class="nd-spinner" />
            <UiBaseIcon v-else :path="mdiSendOutline" :size="15" w="w-4" h="h-4" />
            <span>{{ t('adminEmails.templates.sendTest') }}</span>
          </button>
        </div>
        <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
          <button type="button" class="nd-btn !h-8 !text-[13px]" @click="composerOpen = false">
            {{ t('common.cancel') }}
          </button>
          <button type="button" :disabled="isSaving" class="nd-btn !h-8 !text-[13px]" @click="saveDraft">
            {{ t('adminEmails.broadcasts.saveDraft') }}
          </button>
          <button type="button" :disabled="isSaving" class="nd-btn-accent !h-8 !text-[13px]" @click="saveAndSend">
            <span v-if="mounted && isSaving" class="nd-spinner" />
            <UiBaseIcon v-else :path="mdiSend" :size="15" w="w-4" h="h-4" />
            <span>{{ t('adminEmails.broadcasts.sendBroadcast') }}</span>
          </button>
        </div>
      </div>
    </CommonBaseModal>

    <!-- Confirm launch -->
    <CommonBaseModal
      :open="Boolean(confirmSendTarget)"
      labelledby="admin-email-broadcast-confirm-title"
      overlay-class="items-center justify-center bg-fixed-scrim/70 p-4"
      panel-class="w-full max-w-md overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="confirmSendTarget = null"
    >
      <template v-if="confirmSendTarget">
        <div class="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <h3 id="admin-email-broadcast-confirm-title" class="text-[15px] font-semibold text-ink">
            {{ t('adminEmails.broadcasts.confirmTitle') }}
          </h3>
          <button
            type="button"
            :aria-label="t('adminEmails.detail.close')"
            class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
            @click="confirmSendTarget = null"
          >
            <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
          </button>
        </div>
        <div class="px-5 py-4 text-[13px] text-ink-muted">
          <template v-if="confirmCount === undefined">
            {{
              t('adminEmails.broadcasts.confirmBody', {
                subject: confirmSendTarget.subject,
                audience: t(`adminEmails.broadcasts.audiences.${confirmSendTarget.audience}`),
              })
            }}
          </template>
          <span v-else-if="confirmCount === null" class="block h-3 w-3/4 animate-pulse rounded bg-surface-lift" />
          <template v-else>
            {{
              t(
                'adminEmails.broadcasts.confirmBodyCount',
                { subject: confirmSendTarget.subject, count: formatNumber(confirmCount) },
                confirmCount,
              )
            }}
          </template>
        </div>
        <div class="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          <button type="button" class="nd-btn !h-8 !text-[13px]" @click="confirmSendTarget = null">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            data-testid="broadcast-confirm-send"
            :disabled="confirmCount === null"
            class="nd-btn-accent !h-8 !text-[13px]"
            @click="confirmAndSend"
          >
            {{ t('adminEmails.broadcasts.send') }}
          </button>
        </div>
      </template>
    </CommonBaseModal>

    <CommonConfirmModal
      :visible="Boolean(deleteTarget)"
      :title="t('adminEmails.broadcasts.deleteTitle')"
      :description="t('adminEmails.broadcasts.deleteBody', { subject: deleteTarget?.subject ?? '' })"
      :confirm-label="t('adminEmails.broadcasts.deleteDraft')"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />
  </div>
</template>
