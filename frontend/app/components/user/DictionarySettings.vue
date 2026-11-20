<script setup lang="ts">
import { dictionaryImportError } from '~/utils/dictionaryImportError';
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiBookOpenVariantOutline,
  mdiCloudUploadOutline,
  mdiDeleteOutline,
  mdiLoading,
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

const { t, locale } = useI18n();
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

const draggingFile = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadError = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;

const formatNumber = (n: number) => new Intl.NumberFormat(locale.value).format(n);
const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
/** Indexed space, which can pass a gigabyte. */
const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB` : formatMb(bytes);
/** Indexed space still free for this account, in bytes. */
const indexedRemaining = computed(() =>
  data.value ? Math.max(0, data.value.quota.maxIndexedBytes - data.value.quota.indexedBytesUsed) : null,
);

const quotaPercent = computed(() => {
  if (!data.value || data.value.quota.max <= 0) return 0;
  return Math.min(100, Math.round((data.value.quota.used / data.value.quota.max) * 100));
});

const atQuotaLimit = computed(() => {
  if (!data.value) return false;
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

function toggleRow(index: number) {
  const rows = stackRows.value.map((row, i) => (i === index ? { ...row, enabled: !row.enabled } : row));
  void persistStack(rows);
}

async function removeDictionary(dict: UserDictionary) {
  if (deletingId.value !== null) return;
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
      max: data.value?.quota.max ?? 2,
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

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/v1/user/dictionaries', true);
  xhr.withCredentials = true;
  xhr.setRequestHeader('Content-Type', 'application/zip');

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable && event.total > 0) {
      uploadProgress.value = Math.min(100, Math.round((event.loaded / event.total) * 100));
    }
  };

  xhr.onload = async () => {
    uploading.value = false;
    uploadProgress.value = 0;
    if (fileInputRef.value) fileInputRef.value.value = '';

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const parsed = JSON.parse(xhr.responseText) as { dictionary?: UserDictionary };
        const title = parsed.dictionary?.title ?? file.name;
        useToastSuccess(
          parsed.dictionary?.status === 'ready'
            ? t('accountSettings.dictionaries.uploadedReadyToast', { title })
            : t('accountSettings.dictionaries.uploadedProcessingToast', { title }),
        );
      } catch {
        useToastSuccess(t('accountSettings.dictionaries.uploadedProcessingToast', { title: file.name }));
      }
      await fetchDictionaries(true);
      return;
    }

    let detail = t('accountSettings.dictionaries.uploadError');
    try {
      const body = JSON.parse(xhr.responseText) as { detail?: string; message?: string; title?: string };
      const message = body.detail || body.message || body.title;
      // A reason we know is said in the reader's language; anything else is shown as the server put it.
      const known = dictionaryImportError(message);
      detail = known !== 'generic' ? t(`accountSettings.dictionaries.importErrors.${known}`) : message || detail;
    } catch {
      // keep fallback error
    }
    uploadError.value = detail;
    useToastError(detail);
  };

  xhr.onerror = () => {
    uploading.value = false;
    uploadProgress.value = 0;
    uploadError.value = t('accountSettings.dictionaries.uploadError');
    useToastError(uploadError.value);
  };

  xhr.send(file);
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) uploadZipFile(file);
}

function onDrop(event: DragEvent) {
  draggingFile.value = false;
  if (uploading.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) uploadZipFile(file);
}

onMounted(() => {
  void fetchDictionaries();
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="nd-settings-card" data-testid="dictionary-settings">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="nd-settings-title">{{ t('accountSettings.dictionaries.title') }}</h3>
        <p class="mt-1 text-sm text-gray-400">{{ t('accountSettings.dictionaries.description') }}</p>
      </div>
      <div v-if="data" class="text-right text-xs text-gray-400">
        <div class="font-semibold text-white">
          {{ t('accountSettings.dictionaries.quotaUsed', { used: data.quota.used, max: data.quota.max }) }}
        </div>
        <div>
          {{ t('accountSettings.dictionaries.maxZipSize', { maxMb: Math.round(data.quota.maxZipBytes / (1024 * 1024)) }) }}
        </div>
        <div data-testid="dictionary-indexed-space">
          {{
            t('accountSettings.dictionaries.indexedSpace', {
              used: formatSize(data.quota.indexedBytesUsed),
              max: formatSize(data.quota.maxIndexedBytes),
            })
          }}
        </div>
      </div>
    </div>

    <!-- Quota bar -->
    <div v-if="data" class="mt-4">
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          class="h-full rounded-full bg-brand-solid transition-all duration-300"
          :style="{ width: `${quotaPercent}%` }"
        />
      </div>
      <p v-if="!data.quota.isPatron" class="mt-2 text-xs text-gray-400">
        {{ t('accountSettings.dictionaries.patronUpsell') }}
        <NuxtLink :to="`${localePath('/supporters')}#support`" class="text-brand hover:underline">
          {{ t('accountSettings.account.customTheme.seeSupport') }}
        </NuxtLink>
      </p>
    </div>

    <!-- Upload dropzone -->
    <label
      class="mt-5 block rounded-lg border-2 border-dashed p-5 text-center transition-colors"
      :class="[
        draggingFile ? 'border-brand-solid bg-white/5' : 'border-white/15 bg-white/[0.02]',
        atQuotaLimit || uploading ? 'opacity-60' : 'cursor-pointer hover:border-white/30',
      ]"
      data-testid="dictionary-upload-dropzone"
      @dragover.prevent="draggingFile = true"
      @dragleave.prevent="draggingFile = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInputRef"
        type="file"
        accept=".zip,application/zip"
        class="sr-only"
        :disabled="uploading || atQuotaLimit"
        data-testid="dictionary-upload-input"
        @change="onFileChange"
      />
      <div class="mx-auto flex max-w-md flex-col items-center gap-2">
        <UiBaseIcon :path="uploading ? mdiLoading : mdiCloudUploadOutline" size="28" :class="{ 'animate-spin': uploading }" class="text-gray-300" />
        <p class="text-sm font-medium text-white">
          {{ uploading ? t('accountSettings.dictionaries.uploading', { progress: uploadProgress }) : t('accountSettings.dictionaries.dropPrompt') }}
        </p>
        <p class="text-xs text-gray-400">
          {{ t('accountSettings.dictionaries.supportedFormats') }}
        </p>
        <div v-if="uploading" class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-brand-solid transition-all duration-150" :style="{ width: `${uploadProgress}%` }" />
        </div>
      </div>
    </label>

    <p v-if="uploadError" class="mt-2 text-sm text-red-400" role="alert" data-testid="dictionary-upload-error">
      {{ uploadError }}
    </p>

    <!-- Stack list -->
    <div class="mt-6">
      <div class="flex items-center justify-between">
        <h4 class="text-sm font-semibold text-white">{{ t('accountSettings.dictionaries.stackTitle') }}</h4>
        <span class="text-xs text-gray-400">{{ t('accountSettings.dictionaries.stackHint') }}</span>
      </div>

      <div v-if="loading" class="mt-4 flex items-center gap-2 text-sm text-gray-400">
        <UiBaseIcon :path="mdiLoading" size="18" class="animate-spin" />
        <span>{{ t('accountSettings.dictionaries.loading') }}</span>
      </div>

      <ul v-else class="mt-3 flex flex-col gap-2" data-testid="dictionary-stack-list">
        <li
          v-for="(row, index) in stackRows"
          :key="row.stackId"
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
          :class="{ 'opacity-60': !row.enabled }"
          :data-testid="`dictionary-row-${row.stackId}`"
        >
          <div class="flex min-w-0 flex-1 items-start gap-3">
            <div class="flex flex-col gap-0.5 pt-0.5">
              <button
                type="button"
                class="rounded p-0.5 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                :disabled="saving || index === 0"
                :aria-label="t('accountSettings.dictionaries.moveUp')"
                @click="moveRow(index, -1)"
              >
                <UiBaseIcon :path="mdiArrowUp" size="16" />
              </button>
              <button
                type="button"
                class="rounded p-0.5 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                :disabled="saving || index === stackRows.length - 1"
                :aria-label="t('accountSettings.dictionaries.moveDown')"
                @click="moveRow(index, 1)"
              >
                <UiBaseIcon :path="mdiArrowDown" size="16" />
              </button>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <UiBaseIcon :path="mdiBookOpenVariantOutline" size="18" class="shrink-0 text-gray-400" />
                <span class="truncate text-sm font-medium text-white">{{ row.title }}</span>
                <span
                  v-if="row.kind === 'builtin'"
                  class="rounded bg-white/10 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-gray-300"
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
                    class="rounded bg-red-500/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-red-300"
                  >
                    {{ t('accountSettings.dictionaries.statusFailed') }}
                  </span>
                  <span
                    v-if="row.dict.hasTerms"
                    class="rounded bg-white/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-gray-300"
                  >
                    {{ t('accountSettings.dictionaries.bankTerms') }}
                  </span>
                  <span
                    v-if="row.dict.hasFrequency"
                    class="rounded bg-white/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-gray-300"
                  >
                    {{ t('accountSettings.dictionaries.bankFrequency') }}
                  </span>
                  <span
                    v-if="row.dict.hasPitch"
                    class="rounded bg-white/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-gray-300"
                  >
                    {{ t('accountSettings.dictionaries.bankPitch') }}
                  </span>
                </template>
              </div>

              <p v-if="row.kind === 'builtin'" class="mt-0.5 text-xs text-gray-400">
                {{ t('accountSettings.dictionaries.builtinDescription') }}
              </p>
              <div v-else-if="row.dict" class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400">
                <span v-if="row.dict.termCount > 0">
                  {{ t('accountSettings.dictionaries.termCount', { count: formatNumber(row.dict.termCount) }) }}
                </span>
                <span v-if="row.dict.frequencyCount > 0">
                  {{ t('accountSettings.dictionaries.frequencyCount', { count: formatNumber(row.dict.frequencyCount) }) }}
                </span>
                <span v-if="row.dict.pitchCount > 0">
                  {{ t('accountSettings.dictionaries.pitchCount', { count: formatNumber(row.dict.pitchCount) }) }}
                </span>
                <span>{{ formatMb(row.dict.zipBytes) }}</span>
                <span v-if="row.dict.revision" class="truncate opacity-75">{{ row.dict.revision }}</span>
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

          <div class="flex items-center gap-2">
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
              <!-- The site's switch, as in Settings → Emails. -->
              <span
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="row.enabled ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>

            <button
              v-if="row.kind === 'custom' && row.dict"
              type="button"
              class="rounded p-1.5 text-gray-400 hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40"
              :disabled="deletingId === row.dict.id"
              :aria-label="t('accountSettings.dictionaries.delete')"
              :data-testid="`dictionary-delete-${row.dict.id}`"
              @click="removeDictionary(row.dict)"
            >
              <UiBaseIcon :path="deletingId === row.dict.id ? mdiLoading : mdiDeleteOutline" size="18" :class="{ 'animate-spin': deletingId === row.dict.id }" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
