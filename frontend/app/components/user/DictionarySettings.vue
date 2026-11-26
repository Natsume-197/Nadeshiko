<script setup lang="ts">
import { dictionaryImportError } from '~/utils/dictionaryImportError';
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiCloudUploadOutline,
  mdiDeleteOutline,
  mdiDragVertical,
  mdiHelpCircleOutline,
  mdiLoading,
  mdiPlus,
} from '@mdi/js';
import type { UserDictionary, UserDictionaryListResponse } from '@brigadasos/nadeshiko-sdk';
import { useI18n } from 'vue-i18n';
import { handleApiError } from '~/utils/apiError';
import { useToastError, useToastSuccess } from '~/utils/toast';

/**
 * Custom Yomitan dictionary manager (`/user/dictionaries`, task 48).
 *
 * Lets signed-in readers upload Yomitan v3 `.zip` dictionaries (terms, frequency, pitch),
 * reorder them together with Nadeshiko's built-in JMdict, toggle them on/off, and delete them.
 */

const { t } = useI18n();
const localePath = useLocalePath();
const sdk = useNadeshikoSdk();
const user = userStore();

interface StackRow {
  stackId: string;
  kind: 'builtin' | 'custom';
  title: string;
  enabled: boolean;
  dict?: UserDictionary;
}

const data = ref<UserDictionaryListResponse | null>(null);
const loading = ref(true);
const saving = ref(false);
const deletingId = ref<number | null>(null);
const confirmDeleteId = ref<number | null>(null);
const showFormatHelp = ref(false);

const draggingFile = ref(false);
const draggedRowIndex = ref<number | null>(null);
const dragOverRowIndex = ref<number | null>(null);
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadError = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

const triggerFilePicker = () => {
  if (uploading.value || atQuotaLimit.value) return;
  fileInputRef.value?.click();
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

const { formatNumber } = useFormat();
const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
/** Indexed space, which can pass a gigabyte. */
const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB` : formatMb(bytes);
/** Indexed space still free for this account, in bytes. */
const indexedRemaining = computed(() =>
  data.value ? Math.max(0, data.value.quota.maxIndexedBytes - data.value.quota.indexedBytesUsed) : null,
);

const hasCustomDictionaries = computed(() => (data.value?.dictionaries.length ?? 0) > 0);

const quotaPercent = computed(() => {
  if (!data.value || data.value.quota.max <= 0) return 0;
  return Math.min(100, Math.round((data.value.quota.used / data.value.quota.max) * 100));
});

const indexedPercent = computed(() => {
  if (!data.value || data.value.quota.maxIndexedBytes <= 0) return 0;
  return Math.min(100, Math.round((data.value.quota.indexedBytesUsed / data.value.quota.maxIndexedBytes) * 100));
});

// At the limit, a failed dictionary can still be uploaded again (the server allows it), so the picker stays open.
const atQuotaLimit = computed(() => {
  if (!data.value) return false;
  if (data.value.dictionaries.some((dict) => dict.status === 'failed')) return false;
  return data.value.quota.used >= data.value.quota.max;
});

const stackRows = computed<StackRow[]>(() => {
  if (!data.value) return [];
  const customRows: StackRow[] = data.value.dictionaries.map((dict) => ({
    stackId: dict.stackId,
    kind: 'custom',
    title: dict.title,
    enabled: dict.enabled,
    dict,
  }));

  const builtinRow: StackRow = {
    stackId: data.value.builtin.id,
    kind: 'builtin',
    title: t('accountSettings.dictionaries.builtinTitle'),
    enabled: data.value.builtin.enabled,
  };

  const pos = Math.max(0, Math.min(data.value.builtin.position, customRows.length));
  const merged = [...customRows];
  merged.splice(pos, 0, builtinRow);
  return merged;
});

function syncStoreFingerprint(res: UserDictionaryListResponse) {
  const activeReadyCount = res.dictionaries.filter((d) => d.enabled && d.status === 'ready').length;
  user.setCustomDictionariesState(res.stackFingerprint, activeReadyCount);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function ensurePolling(res: UserDictionaryListResponse) {
  const hasProcessing = res.dictionaries.some((d) => d.status === 'processing');
  if (hasProcessing && !pollTimer) {
    pollTimer = setInterval(() => {
      void fetchDictionaries(true);
    }, 2500);
  } else if (!hasProcessing) {
    stopPolling();
  }
}

async function fetchDictionaries(silent = false) {
  if (!silent) loading.value = true;
  try {
    const res = await sdk.listUserDictionaries();
    data.value = res;
    syncStoreFingerprint(res);
    ensurePolling(res);
  } catch (error) {
    if (!silent) {
      handleApiError('account:dictionaries-load-failed', error, {
        toastKey: 'accountSettings.dictionaries.loadError',
      });
    }
  } finally {
    if (!silent) loading.value = false;
  }
}

async function persistStack(rows: StackRow[]) {
  if (saving.value) return;
  saving.value = true;
  try {
    const res = await sdk.updateUserDictionaries({
      items: rows.map((row) => ({ id: row.stackId, enabled: row.enabled })),
    });
    data.value = res;
    syncStoreFingerprint(res);
    ensurePolling(res);
  } catch (error) {
    handleApiError('account:dictionaries-update-failed', error, {
      toastKey: 'accountSettings.dictionaries.saveError',
    });
    await fetchDictionaries(true);
  } finally {
    saving.value = false;
  }
}

function moveRow(index: number, delta: -1 | 1) {
  const target = index + delta;
  const rows = [...stackRows.value];
  if (target < 0 || target >= rows.length) return;
  const [item] = rows.splice(index, 1);
  if (!item) return;
  rows.splice(target, 0, item);
  void persistStack(rows);
}

function reorderRow(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || saving.value) return;
  const rows = [...stackRows.value];
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) return;
  const [item] = rows.splice(fromIndex, 1);
  if (!item) return;
  rows.splice(toIndex, 0, item);
  void persistStack(rows);
}

function onRowDragStart(index: number, event: DragEvent) {
  if (saving.value) {
    event.preventDefault();
    return;
  }
  confirmDeleteId.value = null;
  draggedRowIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onRowDragOver(index: number, event: DragEvent) {
  if (draggedRowIndex.value === null || event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dragOverRowIndex.value = index;
}

function onRowDrop(index: number, event: DragEvent) {
  if (draggedRowIndex.value === null || event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  const from = draggedRowIndex.value;
  draggedRowIndex.value = null;
  dragOverRowIndex.value = null;
  reorderRow(from, index);
}

function onRowDragEnd() {
  draggedRowIndex.value = null;
  dragOverRowIndex.value = null;
}

function toggleRow(index: number) {
  const rows = stackRows.value.map((row, i) => (i === index ? { ...row, enabled: !row.enabled } : row));
  void persistStack(rows);
}

async function removeDictionary(dict: UserDictionary) {
  if (deletingId.value !== null) return;
  confirmDeleteId.value = null;
  deletingId.value = dict.id;
  try {
    await sdk.deleteUserDictionary(dict.id);
    useToastSuccess(t('accountSettings.dictionaries.deletedToast', { title: dict.title }));
    await fetchDictionaries(true);
  } catch (error) {
    handleApiError('account:dictionaries-delete-failed', error, {
      toastKey: 'accountSettings.dictionaries.deleteError',
    });
  } finally {
    deletingId.value = null;
  }
}

function uploadZipFile(file: File) {
  uploadError.value = '';
  if (!file.name.toLowerCase().endsWith('.zip')) {
    uploadError.value = t('accountSettings.dictionaries.invalidZipType');
    return;
  }
  const maxBytes = data.value?.quota.maxZipBytes ?? 60 * 1024 * 1024;
  if (file.size > maxBytes) {
    uploadError.value = t('accountSettings.dictionaries.fileTooLarge', {
      maxMb: Math.round(maxBytes / (1024 * 1024)),
    });
    return;
  }
  if (atQuotaLimit.value) {
    uploadError.value = t('accountSettings.dictionaries.quotaReached', {
      max: data.value?.quota.max ?? 3,
    });
    return;
  }
  // Indexed, a dictionary takes at least about its zip size, so a file larger than what is left will not fit. The
  // server checks again after the upload.
  if (indexedRemaining.value !== null && file.size > indexedRemaining.value) {
    uploadError.value = t('accountSettings.dictionaries.importErrors.indexedQuota');
    return;
  }

  uploading.value = true;
  uploadProgress.value = 0;

  const upload = data.value?.directUpload ? uploadDirect(file) : uploadThroughServer(file);
  void upload.catch(failUpload);
}

function failUpload(error: unknown) {
  endUpload();
  const message = (error as { detail?: string } | null)?.detail ?? (error instanceof Error ? error.message : '');
  uploadError.value = uploadFailureText(message);
  useToastError(uploadError.value);
}

/** The reader-facing reason for a refused upload: one we know in their language, anything else as the server said. */
function uploadFailureText(message: string | null | undefined): string {
  const known = dictionaryImportError(message);
  if (known !== 'generic') return t(`accountSettings.dictionaries.importErrors.${known}`);
  return message || t('accountSettings.dictionaries.uploadError');
}

function endUpload() {
  uploading.value = false;
  uploadProgress.value = 0;
  if (fileInputRef.value) fileInputRef.value.value = '';
}

/** A finished upload: says whether the dictionary is ready or still being indexed, then refreshes the list. */
async function finishUpload(dictionary: UserDictionary | undefined, file: File) {
  endUpload();
  const title = dictionary?.title ?? file.name;
  useToastSuccess(
    dictionary?.status === 'ready'
      ? t('accountSettings.dictionaries.uploadedReadyToast', { title })
      : t('accountSettings.dictionaries.uploadedProcessingToast', { title }),
  );
  await fetchDictionaries(true);
}

/** Reports upload progress from an XHR into the bar, never past `cap`. */
function trackProgress(xhr: XMLHttpRequest, cap: number) {
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable && event.total > 0) {
      uploadProgress.value = Math.min(cap, Math.round((event.loaded / event.total) * 100));
    }
  };
}

/** PUTs the file to a presigned URL, reporting progress; resolves with the HTTP status. */
function putWithProgress(url: string, headers: Record<string, string>, file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    // Held at 99: the upload is not done until `complete` answers.
    trackProgress(xhr, 99);
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => reject(new Error('Upload to storage failed'));
    xhr.send(file);
  });
}

/** POSTs the zip to our own API with the session cookie, reporting progress; resolves with the status and body. */
function postWithProgress(url: string, file: File): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/zip');
    trackProgress(xhr, 100);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    // No message: the reader gets the generic upload error, in their language.
    xhr.onerror = () => reject(new Error(''));
    xhr.send(file);
  });
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** The older path, for servers without direct upload: the archive goes through Nadeshiko's API. */
async function uploadThroughServer(file: File) {
  const { status, body } = await postWithProgress('/v1/user/dictionaries', file);
  if (status < 200 || status >= 300) {
    const refusal = parseJson<{ detail?: string; message?: string; title?: string }>(body);
    throw new Error(refusal?.detail || refusal?.message || refusal?.title || '');
  }
  await finishUpload(parseJson<{ dictionary?: UserDictionary }>(body)?.dictionary, file);
}

/**
 * Direct upload: reserve, PUT the file straight to storage, then complete. The archive
 * never goes through Nadeshiko's servers on the way in.
 */
async function uploadDirect(file: File) {
  const reservation = await sdk.reserveUserDictionaryUpload({ sizeBytes: file.size });
  const status = await putWithProgress(reservation.url, reservation.headers, file);
  if (status < 200 || status >= 300) throw new Error(t('accountSettings.dictionaries.uploadError'));
  uploadProgress.value = 100;
  const result = await sdk.completeUserDictionaryUpload(reservation.uploadId);
  await finishUpload(result.dictionary, file);
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) uploadZipFile(file);
}

function onCardDragOver(event: DragEvent) {
  if (draggedRowIndex.value !== null || !event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  draggingFile.value = true;
}

function onCardDragLeave(event: DragEvent) {
  if (event.currentTarget instanceof Node && event.relatedTarget instanceof Node) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
  }
  draggingFile.value = false;
}

function onDrop(event: DragEvent) {
  draggingFile.value = false;
  if (draggedRowIndex.value !== null || uploading.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) uploadZipFile(file);
}

onMounted(() => {
  void fetchDictionaries();
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <section class="nd-settings-section" data-testid="dictionary-settings">
    <div class="mb-2.5 flex flex-wrap items-end justify-between gap-3 px-1">
      <div class="min-w-0">
        <div class="flex items-center gap-1.5">
          <h2 class="nd-settings-section-label !mb-0 !px-0">{{ t('accountSettings.dictionaries.title') }}</h2>
          <div class="group/help relative inline-flex items-center">
            <button
              type="button"
              class="inline-flex size-5 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-lift hover:text-ink"
              :aria-label="t('accountSettings.dictionaries.supportedFormats')"
              :aria-expanded="showFormatHelp"
              data-testid="dictionary-format-help"
              @click="showFormatHelp = !showFormatHelp"
              @blur="showFormatHelp = false"
            >
              <UiBaseIcon :path="mdiHelpCircleOutline" size="15" />
            </button>
            <div
              role="tooltip"
              class="nd-menu pointer-events-none absolute left-0 top-full z-20 mt-1.5 w-72 !p-3 text-xs leading-relaxed text-ink-muted transition-opacity"
              :class="
                showFormatHelp
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/help:opacity-100 group-focus-within/help:opacity-100'
              "
            >
              <p class="font-medium text-ink">{{ t('accountSettings.dictionaries.description') }}</p>
              <p class="mt-1">{{ t('accountSettings.dictionaries.supportedFormats') }}</p>
            </div>
          </div>
        </div>
        <p class="mt-0.5 text-xs text-ink-muted">{{ t('accountSettings.dictionaries.stackHint') }}</p>
      </div>

      <button
        type="button"
        class="nd-btn-accent !h-8 !px-3 !text-xs shrink-0"
        :disabled="uploading || atQuotaLimit"
        :title="t('accountSettings.dictionaries.description')"
        data-testid="dictionary-upload-button"
        @click="triggerFilePicker"
      >
        <UiBaseIcon :path="uploading ? mdiLoading : mdiPlus" size="15" :class="{ 'animate-spin': uploading }" />
        <span>
          {{ uploading ? t('accountSettings.dictionaries.uploading', { progress: uploadProgress }) : t('accountSettings.dictionaries.uploadButton') }}
        </span>
      </button>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept=".zip,application/zip"
      class="sr-only"
      :disabled="uploading || atQuotaLimit"
      data-testid="dictionary-upload-input"
      @change="onFileChange"
    />

    <!-- biome-ignore lint/a11y/noStaticElementInteractions: card accepts dropped .zip files alongside the upload button -->
    <div
      class="nd-settings-group relative transition-colors"
      :class="draggingFile ? '!border-brand-solid ring-1 ring-brand-solid/40' : ''"
      data-testid="dictionary-upload-dropzone"
      @dragover="onCardDragOver"
      @dragleave="onCardDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- Thin upload progress line along top edge when uploading -->
      <div v-if="uploading" class="h-0.5 w-full bg-lift-strong">
        <div class="h-full bg-brand-solid transition-all duration-150" :style="{ width: `${uploadProgress}%` }" />
      </div>

      <!-- Loading state -->
      <div v-if="loading" class="nd-settings-item flex items-center gap-2 text-sm text-ink-muted">
        <UiBaseIcon :path="mdiLoading" size="18" class="animate-spin" />
        <span>{{ t('accountSettings.dictionaries.loading') }}</span>
      </div>

      <!-- Clean dictionary list -->
      <ul
        v-else
        :aria-label="t('accountSettings.dictionaries.stackTitle')"
        class="divide-y divide-line-subtle"
        data-testid="dictionary-stack-list"
      >
        <li
          v-for="(row, index) in stackRows"
          :key="row.stackId"
          :draggable="!saving"
          class="group flex items-center justify-between gap-4 px-5 py-3.5 transition-all"
          :class="[
            { 'opacity-50': !row.enabled && draggedRowIndex !== index },
            { 'opacity-35': draggedRowIndex === index },
            dragOverRowIndex === index && draggedRowIndex !== null && draggedRowIndex !== index
              ? 'bg-lift ring-1 ring-inset ring-brand-solid/50'
              : '',
          ]"
          :data-testid="`dictionary-row-${row.stackId}`"
          @dragstart="onRowDragStart(index, $event)"
          @dragover="onRowDragOver(index, $event)"
          @drop="onRowDrop(index, $event)"
          @dragend="onRowDragEnd"
        >
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <span
              class="hidden sm:inline-flex shrink-0 cursor-grab active:cursor-grabbing text-ink-faint/60 transition-colors group-hover:text-ink-muted"
              aria-hidden="true"
            >
              <UiBaseIcon :path="mdiDragVertical" size="18" />
            </span>

            <div class="min-w-0 flex-1" :title="row.dict?.revision || undefined">
              <div class="flex flex-wrap items-center gap-2">
                <span class="truncate text-sm font-medium text-ink">{{ row.title }}</span>
                <span
                  v-if="row.kind === 'builtin'"
                  class="rounded bg-lift-strong px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {{ t('accountSettings.dictionaries.builtinBadge') }}
                </span>
                <template v-else-if="row.dict">
                  <span
                    v-if="row.dict.status === 'processing'"
                    class="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-amber-300"
                  >
                    <UiBaseIcon :path="mdiLoading" size="12" class="animate-spin" />
                    <template v-if="row.dict.progress !== null">
                      {{ t('accountSettings.dictionaries.statusIndexing', { percent: row.dict.progress }) }}
                    </template>
                    <template v-else-if="row.dict.queuePosition !== null">
                      {{
                        row.dict.queuePosition <= 1
                          ? t('accountSettings.dictionaries.statusQueuedNext')
                          : t('accountSettings.dictionaries.statusQueued', { ahead: row.dict.queuePosition - 1 })
                      }}
                    </template>
                    <template v-else>{{ t('accountSettings.dictionaries.statusProcessing') }}</template>
                  </span>
                  <span
                    v-else-if="row.dict.status === 'failed'"
                    class="rounded bg-red-500/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-red-400"
                  >
                    {{ t('accountSettings.dictionaries.statusFailed') }}
                  </span>
                  <span
                    v-if="row.dict.hasTerms"
                    class="rounded bg-sky-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-sky-600 dark:text-sky-300"
                  >
                    {{ t('accountSettings.dictionaries.bankTerms') }}
                  </span>
                  <span
                    v-if="row.dict.hasFrequency"
                    class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-emerald-600 dark:text-emerald-300"
                  >
                    {{ t('accountSettings.dictionaries.bankFrequency') }}
                  </span>
                  <span
                    v-if="row.dict.hasPitch"
                    class="rounded bg-violet-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-violet-600 dark:text-violet-300"
                  >
                    {{ t('accountSettings.dictionaries.bankPitch') }}
                  </span>
                </template>
              </div>

              <p v-if="row.kind === 'builtin'" class="mt-0.5 text-xs text-ink-muted">
                {{ t('accountSettings.dictionaries.builtinDescription') }}
              </p>
              <div v-else-if="row.dict" class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                <span v-if="row.dict.termCount > 0">
                  {{ t('accountSettings.dictionaries.termCount', { count: formatNumber(row.dict.termCount) }) }}
                </span>
                <span v-if="row.dict.frequencyCount > 0">
                  {{ t('accountSettings.dictionaries.frequencyCount', { count: formatNumber(row.dict.frequencyCount) }) }}
                </span>
                <span v-if="row.dict.pitchCount > 0">
                  {{ t('accountSettings.dictionaries.pitchCount', { count: formatNumber(row.dict.pitchCount) }) }}
                </span>
                <span aria-hidden="true" class="text-ink-faint">&middot;</span>
                <span>{{ formatMb(row.dict.zipBytes) }}</span>
              </div>
              <p
                v-if="row.dict?.status === 'failed'"
                class="mt-1 text-xs text-red-400"
                :title="row.dict.errorMessage ?? undefined"
                data-testid="dictionary-import-error"
              >
                {{ t(`accountSettings.dictionaries.importErrors.${dictionaryImportError(row.dict.errorMessage)}`) }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <template v-if="row.kind === 'custom' && row.dict && confirmDeleteId === row.dict.id">
              <button
                type="button"
                class="nd-btn !h-7 !px-2.5 !text-xs"
                :disabled="deletingId === row.dict.id"
                @click="confirmDeleteId = null"
              >
                {{ t('accountSettings.dictionaries.cancelDelete') }}
              </button>
              <button
                type="button"
                class="nd-btn-danger !h-7 !px-2.5 !text-xs"
                :disabled="deletingId === row.dict.id"
                :data-testid="`dictionary-confirm-delete-${row.dict.id}`"
                @click="removeDictionary(row.dict)"
              >
                <UiBaseIcon v-if="deletingId === row.dict.id" :path="mdiLoading" size="14" class="animate-spin" />
                {{ t('accountSettings.dictionaries.confirmDelete') }}
              </button>
            </template>

            <template v-else>
              <!-- Subtle keyboard/touch reorder controls; appear cleanly on hover or focus -->
              <div class="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-md text-ink-faint hover:bg-lift-strong hover:text-ink disabled:opacity-25 disabled:pointer-events-none"
                  :disabled="saving || index === 0"
                  :aria-label="t('accountSettings.dictionaries.moveUp')"
                  @click="moveRow(index, -1)"
                >
                  <UiBaseIcon :path="mdiArrowUp" size="15" />
                </button>
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-md text-ink-faint hover:bg-lift-strong hover:text-ink disabled:opacity-25 disabled:pointer-events-none"
                  :disabled="saving || index === stackRows.length - 1"
                  :aria-label="t('accountSettings.dictionaries.moveDown')"
                  @click="moveRow(index, 1)"
                >
                  <UiBaseIcon :path="mdiArrowDown" size="15" />
                </button>
              </div>

              <button
                type="button"
                role="switch"
                :aria-checked="row.enabled"
                :aria-label="row.enabled ? t('accountSettings.dictionaries.disable') : t('accountSettings.dictionaries.enable')"
                class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out disabled:opacity-50"
                :class="row.enabled ? 'bg-brand-solid' : 'bg-gray-600'"
                :disabled="saving"
                @click="toggleRow(index)"
              >
                <!-- The site's switch, as in Settings → Notifications. -->
                <span
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  :class="row.enabled ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>

              <button
                v-if="row.kind === 'custom' && row.dict"
                type="button"
                class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40"
                :disabled="deletingId === row.dict.id"
                :aria-label="t('accountSettings.dictionaries.delete')"
                :data-testid="`dictionary-delete-${row.dict.id}`"
                @click="confirmDeleteId = row.dict.id"
              >
                <UiBaseIcon :path="deletingId === row.dict.id ? mdiLoading : mdiDeleteOutline" size="18" :class="{ 'animate-spin': deletingId === row.dict.id }" />
              </button>
              <span v-else class="size-8 shrink-0" aria-hidden="true" />
            </template>
          </div>
        </li>
      </ul>

      <!-- Empty-state upload prompt only when the reader has no custom dictionaries yet -->
      <button
        v-if="!loading && !hasCustomDictionaries"
        type="button"
        class="flex w-full items-center justify-center gap-2 border-t border-line-subtle px-5 py-4 text-sm text-ink-muted transition-colors hover:bg-lift hover:text-ink disabled:opacity-50"
        :disabled="uploading || atQuotaLimit"
        @click="triggerFilePicker"
      >
        <UiBaseIcon :path="mdiCloudUploadOutline" size="18" />
        <span>{{ t('accountSettings.dictionaries.dropPrompt') }}</span>
      </button>

      <!-- Quota & limits footer strip -->
      <div
        v-if="data"
        class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line-subtle bg-lift px-5 py-3 text-xs"
      >
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div class="flex items-center gap-2">
            <div class="h-1.5 w-14 overflow-hidden rounded-full bg-lift-strong" aria-hidden="true">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="atQuotaLimit ? 'bg-amber-400' : 'bg-brand-solid'"
                :style="{ width: `${quotaPercent}%` }"
              />
            </div>
            <span class="font-medium text-ink">
              {{ t('accountSettings.dictionaries.quotaUsed', { used: data.quota.used, max: data.quota.max }) }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <div class="h-1.5 w-14 overflow-hidden rounded-full bg-lift-strong" aria-hidden="true">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="indexedPercent >= 90 ? 'bg-amber-400' : 'bg-brand-solid'"
                :style="{ width: `${indexedPercent}%` }"
              />
            </div>
            <span class="text-ink-muted" data-testid="dictionary-indexed-space">
              {{
                t('accountSettings.dictionaries.indexedSpace', {
                  used: formatSize(data.quota.indexedBytesUsed),
                  max: formatSize(data.quota.maxIndexedBytes),
                })
              }}
            </span>
          </div>
        </div>

        <span class="text-ink-muted">
          {{ t('accountSettings.dictionaries.maxZipSize', { maxMb: Math.round(data.quota.maxZipBytes / (1024 * 1024)) }) }}
        </span>
      </div>

      <!-- Drag-over overlay when dragging a .zip file onto the card -->
      <div
        v-if="draggingFile"
        class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-background/85 backdrop-blur-[1px] text-sm font-medium text-ink"
      >
        <UiBaseIcon :path="mdiCloudUploadOutline" size="20" class="text-brand" />
        <span>{{ t('accountSettings.dictionaries.dropPrompt') }}</span>
      </div>
    </div>

    <p v-if="uploadError" class="mt-2 px-1 text-sm text-red-400" role="alert" data-testid="dictionary-upload-error">
      {{ uploadError }}
    </p>

    <p v-if="data && !data.quota.isPatron" class="mt-2 px-1 text-xs text-ink-muted">
      {{ t('accountSettings.dictionaries.patronUpsell') }}
      <NuxtLink :to="`${localePath('/supporters')}#support`" class="text-brand hover:underline">
        {{ t('accountSettings.account.customTheme.seeSupport') }}
      </NuxtLink>
    </p>
  </section>
</template>
