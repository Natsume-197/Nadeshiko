<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core';
import {
  mdiClose,
  mdiDeleteOutline,
  mdiFormatBold,
  mdiFormatHeader1,
  mdiFormatHeader3,
  mdiFormatListBulleted,
  mdiFormatQuoteClose,
  mdiImagePlusOutline,
  mdiLinkVariant,
  mdiOpenInNew,
  mdiPlus,
  mdiRefresh,
  mdiSend,
  mdiStopCircleOutline,
} from '@mdi/js';
import type { AdminEmailBroadcast } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { useToastError, useToastSuccess } from '~/utils/toast';

const emit = defineEmits<{ openCampaignLog: [campaignKey: string] }>();

const { t } = useI18n();
const { formatDate, formatNumber } = useFormat();
const sdk = useNadeshikoSdk();
const store = userStore();

const broadcasts = ref<AdminEmailBroadcast[]>([]);
const isLoading = ref(false);
const composerOpen = ref(false);
const editingId = ref<string | null>(null);

const campaignKey = ref('');
const subject = ref('');
const previewText = ref('');
const bodyMarkdown = ref('');
const ctaLabel = ref('');
const ctaUrl = ref('');
const audience = ref<AdminEmailBroadcast['audience']>('ALL_OPTED_IN');
const activeDays = ref(90);
const userIdsText = ref('');

const bodyTextarea = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const isUploadingImage = ref(false);

const previewHtml = ref('');
const previewSubject = ref('');
const isPreviewing = ref(false);

const estimatedCount = ref<number | null>(null);
const isEstimating = ref(false);
const isSaving = ref(false);
const confirmSendTarget = ref<AdminEmailBroadcast | null>(null);
const testEmailTo = ref(store.userEmail ?? '');

const AUDIENCE_OPTIONS = [
  { value: 'ALL_OPTED_IN', label: 'All opted-in' },
  { value: 'PATRONS', label: 'Patrons' },
  { value: 'ACTIVE_DAYS', label: 'Active (N days)' },
  { value: 'SPECIFIC_USERS', label: 'Specific users' },
] as const;

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
  try {
    const res = await sdk.previewAdminEmailTemplate({
      kind: 'broadcast',
      subjectOverride: subject.value.trim() || 'Preview',
      bodyOverride: bodyMarkdown.value.trim() || 'Write your email body...',
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
    useToastError('Only PNG, JPEG, WebP, or GIF images are supported.');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    useToastError('Image must be 2 MB or smaller.');
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
  composerOpen.value = true;
  void estimate();
  void refreshPreview(false);
}

async function saveDraft() {
  if (!campaignKey.value.trim() || !subject.value.trim() || !bodyMarkdown.value.trim()) {
    useToastError(t('adminNotifications.send.missingFields'));
    return;
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
    if (editingId.value) {
      await sdk.updateAdminEmailBroadcast({ broadcastId: editingId.value, ...payload });
    } else {
      await sdk.createAdminEmailBroadcast(payload);
    }
    composerOpen.value = false;
    useToastSuccess(t('adminEmails.broadcasts.savedToast'));
    await load();
  } catch (err) {
    handleApiError('admin:email-broadcast-save-failed', err);
  } finally {
    isSaving.value = false;
  }
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

function statusTone(status: AdminEmailBroadcast['status']): string {
  switch (status) {
    case 'SENT':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'SENDING':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'FAILED':
      return 'bg-red-500/15 text-red-300 border-red-500/30';
    default:
      return 'bg-surface-lift text-ink-muted border-hairline';
  }
}

watch([audience, activeDays], () => {
  if (composerOpen.value) void estimate();
});

watch([subject, previewText, bodyMarkdown, ctaLabel, ctaUrl], () => {
  if (composerOpen.value) schedulePreview();
});

onMounted(load);
defineExpose({ refresh: load });
</script>

<template>
  <div class="space-y-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.broadcasts.testAddress') }}</span>
        <input v-model="testEmailTo" type="email" placeholder="you@nadeshiko.co" class="nd-input max-w-[15rem]" />
      </div>
      <button type="button" class="nd-btn-accent" @click="openNew">
        <UiBaseIcon :path="mdiPlus" :size="16" />
        <span>{{ t('adminEmails.broadcasts.new') }}</span>
      </button>
    </div>

    <!-- Broadcast list -->
    <div v-if="isLoading && broadcasts.length === 0" class="py-12 text-center">
      <div
        class="inline-block size-6 animate-spin rounded-full border-[3px] border-current border-t-transparent text-ink"
        role="status"
      />
    </div>
    <div
      v-else-if="broadcasts.length === 0"
      class="rounded-xl border border-hairline bg-surface/40 px-4 py-10 text-center text-sm text-ink-faint"
    >
      {{ t('adminEmails.broadcasts.empty') }}
    </div>
    <div v-else class="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface/40">
      <div
        v-for="row in broadcasts"
        :key="row.id"
        class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-semibold text-ink">{{ row.subject }}</span>
            <span class="rounded-full border px-2 py-0.5 text-[10px] font-semibold" :class="statusTone(row.status)">
              {{ row.status }}
            </span>
            <code class="rounded bg-surface-lift px-1.5 py-0.5 text-[11px] text-ink-faint">{{ row.campaignKey }}</code>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-faint">
            <span>{{ formatDate(row.createdAt, 'dateTime') }}</span>
            <span>·</span>
            <span>{{ row.audience }}</span>
            <template v-if="row.status !== 'DRAFT'">
              <span>·</span>
              <span class="tabular-nums text-ink-muted">
                {{ formatNumber(row.sentCount) }} / {{ formatNumber(row.recipientCount) }} sent
                <span v-if="row.failedCount > 0" class="text-red-300">({{ row.failedCount }} failed)</span>
              </span>
            </template>
          </div>
          <p
            v-if="row.error"
            class="mt-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300"
          >
            {{ row.error }}
          </p>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <button v-if="row.status === 'DRAFT'" type="button" class="nd-btn !h-8 text-xs" @click="openEdit(row)">
            {{ t('adminNotifications.registry.edit') }}
          </button>
          <button type="button" class="nd-btn !h-8 text-xs" @click="sendTest(row)">
            {{ t('adminEmails.templates.sendTest') }}
          </button>
          <button
            v-if="row.status === 'DRAFT' || row.status === 'FAILED'"
            type="button"
            class="nd-btn-accent !h-8 !px-3 text-xs"
            @click="confirmSendTarget = row"
          >
            <UiBaseIcon :path="mdiSend" :size="13" />
            <span>{{ t('adminEmails.broadcasts.send') }}</span>
          </button>
          <button
            v-if="row.status === 'SENDING'"
            type="button"
            class="nd-btn !h-8 text-xs text-red-300"
            @click="cancel(row)"
          >
            <UiBaseIcon :path="mdiStopCircleOutline" :size="14" />
            <span>{{ t('adminEmails.broadcasts.cancel') }}</span>
          </button>
          <button
            v-if="row.status !== 'DRAFT'"
            type="button"
            class="nd-btn !h-8 text-xs"
            @click="emit('openCampaignLog', row.campaignKey)"
          >
            <UiBaseIcon :path="mdiOpenInNew" :size="13" />
            <span>{{ t('adminEmails.broadcasts.viewLog') }}</span>
          </button>
          <button
            v-if="row.status === 'DRAFT'"
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-red-300"
            @click="removeDraft(row)"
          >
            <UiBaseIcon :path="mdiDeleteOutline" :size="16" />
          </button>
        </div>
      </div>
    </div>

    <!-- Split-screen Composer modal with live HTML preview & clipboard image paste -->
    <CommonBaseModal
      :open="composerOpen"
      labelledby="admin-email-broadcast-composer-title"
      overlay-class="items-center justify-center bg-fixed-scrim/70 p-4"
      panel-class="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="composerOpen = false"
    >
      <div class="nd-modal-header">
        <h3 id="admin-email-broadcast-composer-title" class="font-bold text-ink">
          {{ editingId ? t('adminEmails.broadcasts.editTitle') : t('adminEmails.broadcasts.new') }}
        </h3>
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
          @click="composerOpen = false"
        >
          <UiBaseIcon :path="mdiClose" :size="18" />
        </button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-1 divide-y divide-hairline overflow-y-auto lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <!-- Left: Editor -->
        <div class="space-y-4 overflow-y-auto p-5">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="block space-y-1">
              <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.detail.campaign') }}</span>
              <input v-model="campaignKey" type="text" placeholder="release-3.0.0" class="nd-input font-mono" />
            </label>
            <div class="space-y-1">
              <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.broadcasts.estimatedRecipients') }}</span>
              <div class="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3 text-xs">
                <strong class="text-sm font-bold text-ink tabular-nums">
                  {{ isEstimating ? '…' : estimatedCount !== null ? formatNumber(estimatedCount) : '—' }}
                </strong>
                <span class="truncate text-ink-faint">{{ t('adminEmails.broadcasts.respectsOptOut') }}</span>
              </div>
            </div>
          </div>

          <fieldset class="space-y-1.5">
            <legend class="text-xs font-medium text-ink-muted">{{ t('adminNotifications.send.audience') }}</legend>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="opt in AUDIENCE_OPTIONS"
                :key="opt.value"
                type="button"
                :class="[
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                  audience === opt.value
                    ? 'border-brand-solid bg-brand/15 text-brand'
                    : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
                ]"
                @click="audience = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </fieldset>

          <div v-if="audience === 'ACTIVE_DAYS'">
            <label class="flex items-center gap-2 text-xs text-ink-muted">
              <span>Active in the last</span>
              <input v-model.number="activeDays" type="number" min="1" max="365" class="nd-input !w-24" />
              <span>days</span>
            </label>
          </div>
          <div v-if="audience === 'SPECIFIC_USERS'">
            <label class="block space-y-1">
              <span class="text-xs font-medium text-ink-muted">User IDs (comma-separated)</span>
              <input v-model="userIdsText" type="text" placeholder="1, 42, 108" class="nd-input" @blur="estimate" />
            </label>
          </div>

          <label class="block space-y-1">
            <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.table.subject') }}</span>
            <input v-model="subject" type="text" placeholder="Nadeshiko 3.0.0 is here!" class="nd-input" />
          </label>

          <label class="block space-y-1">
            <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.broadcasts.previewText') }}</span>
            <input v-model="previewText" type="text" placeholder="Optional inbox snippet..." class="nd-input" />
          </label>

          <!-- Markdown body + formatting & image paste toolbar -->
          <div class="space-y-1.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.templates.bodyMarkdown') }}</span>
              <span class="text-[11px] text-ink-faint">Ctrl+V to paste images</span>
            </div>

            <div class="flex flex-wrap items-center gap-1 rounded-lg border border-hairline bg-surface p-1">
              <button
                type="button"
                title="Title (#)"
                class="inline-flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
                @click="insertAtCursor('\n# ')"
              >
                <UiBaseIcon :path="mdiFormatHeader1" :size="16" />
              </button>
              <button
                type="button"
                title="Heading (###)"
                class="inline-flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
                @click="insertAtCursor('\n### ')"
              >
                <UiBaseIcon :path="mdiFormatHeader3" :size="16" />
              </button>
              <button
                type="button"
                title="Bold"
                class="inline-flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
                @click="wrapSelection('**', '**', 'bold text')"
              >
                <UiBaseIcon :path="mdiFormatBold" :size="16" />
              </button>
              <button
                type="button"
                title="Bullet list"
                class="inline-flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
                @click="insertAtCursor('\n- ')"
              >
                <UiBaseIcon :path="mdiFormatListBulleted" :size="16" />
              </button>
              <button
                type="button"
                title="Note / quote"
                class="inline-flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
                @click="insertAtCursor('\n> ')"
              >
                <UiBaseIcon :path="mdiFormatQuoteClose" :size="16" />
              </button>
              <button
                type="button"
                title="Link"
                class="inline-flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
                @click="wrapSelection('[', '](https://nadeshiko.co)', 'link text')"
              >
                <UiBaseIcon :path="mdiLinkVariant" :size="15" />
              </button>
              <span class="mx-1 h-4 w-px bg-hairline" />
              <button
                type="button"
                :disabled="isUploadingImage"
                class="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink disabled:opacity-50"
                @click="fileInput?.click()"
              >
                <UiBaseIcon :path="mdiImagePlusOutline" :size="15" />
                <span>{{ isUploadingImage ? 'Uploading…' : 'Image' }}</span>
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
                class="ml-auto rounded border border-hairline bg-surface-lift px-2 py-0.5 font-mono text-[11px] text-ink hover:border-brand/50 hover:text-brand"
                @click="insertAtCursor(USERNAME_VAR)"
              >
                {{ USERNAME_VAR }}
              </button>
            </div>

            <textarea
              ref="bodyTextarea"
              v-model="bodyMarkdown"
              rows="11"
              class="nd-input font-mono text-xs leading-relaxed"
              @paste="onBodyPaste"
            />
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="block space-y-1">
              <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.broadcasts.ctaLabel') }}</span>
              <input v-model="ctaLabel" type="text" placeholder="Read the blog post" class="nd-input" />
            </label>
            <label class="block space-y-1">
              <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.broadcasts.ctaUrl') }}</span>
              <input v-model="ctaUrl" type="text" placeholder="/en/blog/nadeshiko-v3-0-0" class="nd-input" />
            </label>
          </div>
        </div>

        <!-- Right: Live HTML Email Preview -->
        <div class="flex flex-col bg-[#1d1d1d]">
          <div class="flex items-center justify-between gap-2 border-b border-hairline bg-surface px-4 py-2.5">
            <div class="min-w-0 truncate text-xs text-ink-muted">
              <strong class="text-ink">{{ t('adminEmails.table.subject') }}:</strong>
              {{ previewSubject || subject || '—' }}
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                :disabled="isPreviewing"
                class="nd-btn !h-7 !px-2 text-xs"
                @click="refreshPreview(false)"
              >
                <UiBaseIcon :path="mdiRefresh" :size="13" :class="{ 'animate-spin': isPreviewing }" />
              </button>
              <button
                type="button"
                :disabled="isPreviewing"
                class="nd-btn !h-7 !px-2.5 text-xs"
                @click="refreshPreview(true)"
              >
                <UiBaseIcon :path="mdiSend" :size="12" />
                <span>{{ t('adminEmails.templates.sendTest') }}</span>
              </button>
            </div>
          </div>
          <iframe
            :srcdoc="previewHtml"
            sandbox=""
            class="min-h-[480px] w-full flex-1 border-0 bg-[#1d1d1d]"
            title="Broadcast email preview"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2 border-t border-hairline px-5 py-3">
        <button type="button" class="nd-btn" @click="composerOpen = false">
          {{ t('adminEmails.detail.close') }}
        </button>
        <button type="button" :disabled="isSaving" class="nd-btn-accent" @click="saveDraft">
          {{ t('adminEmails.broadcasts.saveDraft') }}
        </button>
      </div>
    </CommonBaseModal>

    <!-- Confirm launch modal -->
    <CommonBaseModal
      :open="Boolean(confirmSendTarget)"
      labelledby="admin-email-broadcast-confirm-title"
      overlay-class="items-center justify-center bg-fixed-scrim/70 p-4"
      panel-class="w-full max-w-md overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="confirmSendTarget = null"
    >
      <template v-if="confirmSendTarget">
        <div class="nd-modal-header">
          <h3 id="admin-email-broadcast-confirm-title" class="font-bold text-ink">
            {{ t('adminEmails.broadcasts.confirmTitle') }}
          </h3>
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="confirmSendTarget = null"
          >
            <UiBaseIcon :path="mdiClose" :size="16" />
          </button>
        </div>
        <div class="px-5 py-4 text-sm text-ink-muted">
          {{ t('adminEmails.broadcasts.confirmBody', { subject: confirmSendTarget.subject, audience: confirmSendTarget.audience }) }}
        </div>
        <div class="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          <button type="button" class="nd-btn" @click="confirmSendTarget = null">
            {{ t('adminEmails.detail.close') }}
          </button>
          <button type="button" class="nd-btn-accent" @click="confirmAndSend">
            {{ t('adminEmails.broadcasts.send') }}
          </button>
        </div>
      </template>
    </CommonBaseModal>
  </div>
</template>
