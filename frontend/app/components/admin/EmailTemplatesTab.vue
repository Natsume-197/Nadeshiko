<script setup lang="ts">
import { mdiClose, mdiCogOutline, mdiEmailOutline, mdiEyeOutline, mdiLockOutline, mdiSend } from '@mdi/js';
import type { ListAdminNotificationSettingsResponse } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { useToastSuccess } from '~/utils/toast';

type SettingItem = ListAdminNotificationSettingsResponse['items'][number];

const { t } = useI18n();
const { formatNumber } = useFormat();
const sdk = useNadeshikoSdk();
const store = userStore();

const items = ref<SettingItem[]>([]);
const isLoading = ref(false);
const savingKind = ref<string | null>(null);
const editingParamsItem = ref<SettingItem | null>(null);
const paramDraft = ref<Record<string, number>>({});

// Template editor modal state
const editingTemplate = ref<SettingItem | null>(null);
const subjectDraft = ref('');
const bodyDraft = ref('');
const previewHtml = ref('');
const previewSubject = ref('');
const isPreviewing = ref(false);
const isSavingTemplate = ref(false);
const testEmailTo = ref(store.userEmail ?? '');

function formatVar(name: string): string {
  return `{{${name}}}`;
}

const emailItems = computed(() => items.value.filter((i) => i.channels.email));

const AREA_ORDER = ['official', 'words', 'community', 'lifecycle', 'transactional'] as const;
const AREA_LABELS: Record<string, string> = {
  official: 'Official & broadcasts',
  words: 'Word alerts',
  community: 'Community',
  lifecycle: 'Lifecycle & retention',
  transactional: 'Transactional & auth',
};

const groupedEmailItems = computed(() =>
  AREA_ORDER.map((area) => ({
    area,
    label: AREA_LABELS[area] ?? area,
    items: emailItems.value.filter((i) => i.area === area),
  })).filter((g) => g.items.length > 0),
);

async function load() {
  isLoading.value = true;
  try {
    const res = await sdk.listAdminNotificationSettings();
    items.value = res.items;
  } catch (err) {
    handleApiError('admin:email-settings-load-failed', err);
  } finally {
    isLoading.value = false;
  }
}

async function toggleEmail(item: SettingItem) {
  if (item.alwaysEnabled || savingKind.value) return;
  savingKind.value = item.kind;
  try {
    const updated = await sdk.updateAdminNotificationSetting({ kind: item.kind, emailEnabled: !item.emailEnabled });
    item.emailEnabled = updated.emailEnabled;
    useToastSuccess(t('adminNotifications.registry.saved'));
  } catch (err) {
    handleApiError('admin:email-setting-toggle-failed', err);
  } finally {
    savingKind.value = null;
  }
}

function openParams(item: SettingItem) {
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
    handleApiError('admin:email-setting-params-failed', err);
  } finally {
    savingKind.value = null;
  }
}

async function openTemplateEditor(item: SettingItem) {
  editingTemplate.value = item;
  subjectDraft.value = item.subjectOverride ?? item.defaultSubject ?? '';
  bodyDraft.value = item.bodyOverride ?? item.defaultBodyMarkdown ?? '';
  previewHtml.value = '';
  previewSubject.value = '';
  await refreshPreview();
}

function insertVariable(name: string) {
  bodyDraft.value = `${bodyDraft.value}${formatVar(name)}`;
}

async function refreshPreview(sendTest = false) {
  const item = editingTemplate.value;
  if (!item) return;
  isPreviewing.value = true;
  try {
    const res = await sdk.previewAdminEmailTemplate({
      kind: item.kind,
      subjectOverride: subjectDraft.value.trim() || null,
      bodyOverride: bodyDraft.value.trim() || null,
      sendTestTo: sendTest ? testEmailTo.value.trim() || null : null,
    });
    previewSubject.value = res.subject;
    previewHtml.value = res.html;
    if (res.testSent) {
      useToastSuccess(t('adminEmails.templates.testSentToast', { email: testEmailTo.value }));
    }
  } catch (err) {
    handleApiError('admin:email-template-preview-failed', err);
  } finally {
    isPreviewing.value = false;
  }
}

async function saveTemplate(reset = false) {
  const item = editingTemplate.value;
  if (!item) return;
  isSavingTemplate.value = true;
  try {
    const updated = await sdk.updateAdminNotificationSetting(
      reset
        ? { kind: item.kind, resetTemplate: true }
        : {
            kind: item.kind,
            subjectOverride: subjectDraft.value.trim() || null,
            bodyOverride: bodyDraft.value.trim() || null,
          },
    );
    item.subjectOverride = updated.subjectOverride ?? null;
    item.bodyOverride = updated.bodyOverride ?? null;
    if (reset) {
      subjectDraft.value = item.defaultSubject ?? '';
      bodyDraft.value = item.defaultBodyMarkdown ?? '';
      await refreshPreview();
    } else {
      editingTemplate.value = null;
    }
    useToastSuccess(t('adminNotifications.registry.saved'));
  } catch (err) {
    handleApiError('admin:email-template-save-failed', err);
  } finally {
    isSavingTemplate.value = false;
  }
}

onMounted(load);
defineExpose({ refresh: load });
</script>

<template>
  <div class="space-y-6">
    <div v-if="isLoading && emailItems.length === 0" class="py-12 text-center">
      <div
        class="inline-block size-6 animate-spin rounded-full border-[3px] border-current border-t-transparent text-ink"
        role="status"
      />
    </div>

    <div v-for="group in groupedEmailItems" :key="group.area" class="space-y-2">
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
              <UiBaseIcon :path="mdiEmailOutline" :size="15" class="shrink-0 text-brand" />
              <span class="text-sm font-medium text-ink">{{ item.label }}</span>
              <code class="rounded bg-surface-lift px-1.5 py-0.5 text-[11px] text-ink-faint">{{ item.kind }}</code>
              <span
                v-if="item.subjectOverride || item.bodyOverride"
                class="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
              >
                Custom copy
              </span>
              <span
                v-if="item.alwaysEnabled"
                class="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-lift px-2 py-0.5 text-[10px] font-medium text-ink-faint"
              >
                <UiBaseIcon :path="mdiLockOutline" :size="11" />
                Locked ON
              </span>
            </div>

            <p class="mt-1 text-xs leading-relaxed text-ink-muted">{{ item.description }}</p>

            <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
              <span>{{ item.schedule ? `${item.trigger} · ${item.schedule}` : item.trigger }}</span>
              <span>·</span>
              <span>{{ item.emailFrom ? `${item.emailFrom}@` : '—' }} · {{ item.emailCategory ?? 'transactional' }}</span>
              <span>·</span>
              <span class="tabular-nums">
                7d: {{ formatNumber(item.stats7d.emailSent) }} sent
                <span v-if="item.stats7d.emailFailed > 0" class="text-red-300">
                  ({{ formatNumber(item.stats7d.emailFailed) }} failed)
                </span>
              </span>
              <template v-if="item.paramFields.length > 0">
                <span>·</span>
                <span class="font-mono text-ink-muted">
                  {{ item.paramFields.map((f) => `${f.key}=${item.params[f.key]}`).join(', ') }}
                </span>
              </template>
            </div>
          </div>

          <div class="flex shrink-0 flex-wrap items-center gap-2.5">
            <button
              v-if="item.paramFields.length > 0"
              type="button"
              class="nd-btn !h-8 text-xs"
              @click="openParams(item)"
            >
              <UiBaseIcon :path="mdiCogOutline" :size="14" />
              <span>{{ t('adminNotifications.registry.edit') }}</span>
            </button>
            <button
              v-if="item.editableTemplate"
              type="button"
              class="nd-btn !h-8 text-xs"
              @click="openTemplateEditor(item)"
            >
              <UiBaseIcon :path="mdiEyeOutline" :size="14" />
              <span>{{ t('adminEmails.templates.editTemplate') }}</span>
            </button>
            <button
              type="button"
              role="switch"
              :aria-checked="item.emailEnabled"
              :aria-label="item.label"
              :disabled="item.alwaysEnabled || savingKind === item.kind"
              :class="[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                item.emailEnabled ? 'bg-brand-solid' : 'bg-gray-600',
              ]"
              @click="toggleEmail(item)"
            >
              <span
                :class="[
                  'pointer-events-none inline-block size-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out',
                  item.emailEnabled ? 'translate-x-5' : 'translate-x-0',
                ]"
              />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Parameter drawer -->
    <CommonBaseModal
      :open="Boolean(editingParamsItem)"
      transition="nd-drawer"
      labelledby="admin-email-params-title"
      overlay-class="items-stretch justify-end bg-fixed-scrim/60"
      panel-class="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-hairline bg-background"
      @close="editingParamsItem = null"
    >
      <template v-if="editingParamsItem">
        <div class="nd-modal-header">
          <h2 id="admin-email-params-title" class="min-w-0 truncate font-bold text-ink">
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
            <label :for="`email-param-${field.key}`" class="block text-sm font-medium text-ink">{{ field.label }}</label>
            <p class="text-xs text-ink-faint">{{ field.description }}</p>
            <input
              :id="`email-param-${field.key}`"
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

    <!-- Template editor modal -->
    <CommonBaseModal
      :open="Boolean(editingTemplate)"
      labelledby="admin-email-template-title"
      overlay-class="items-center justify-center bg-fixed-scrim/70 p-4"
      panel-class="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="editingTemplate = null"
    >
      <template v-if="editingTemplate">
        <div class="nd-modal-header">
          <div class="min-w-0">
            <h3 id="admin-email-template-title" class="truncate font-bold text-ink">
              {{ editingTemplate.label }}
              <code class="ml-1.5 rounded bg-surface-lift px-1.5 py-0.5 text-xs font-normal text-ink-faint">
                {{ editingTemplate.kind }}
              </code>
            </h3>
          </div>
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="editingTemplate = null"
          >
            <UiBaseIcon :path="mdiClose" :size="18" />
          </button>
        </div>

        <div class="grid min-h-0 flex-1 grid-cols-1 divide-y divide-hairline overflow-y-auto lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div class="space-y-4 p-5">
            <div v-if="(editingTemplate.allowedVariables ?? []).length > 0" class="flex flex-wrap items-center gap-1.5">
              <span class="text-xs text-ink-faint">{{ t('adminEmails.templates.variablesHint') }}</span>
              <button
                v-for="v in editingTemplate.allowedVariables ?? []"
                :key="v"
                type="button"
                class="rounded-md border border-hairline bg-surface-lift px-2 py-0.5 font-mono text-[11px] text-ink transition-colors hover:border-brand/50 hover:text-brand"
                @click="insertVariable(v)"
              >
                {{ formatVar(v) }}
              </button>
            </div>

            <label class="block space-y-1">
              <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.table.subject') }}</span>
              <input v-model="subjectDraft" type="text" class="nd-input" />
            </label>
            <label class="block space-y-1">
              <span class="text-xs font-medium text-ink-muted">{{ t('adminEmails.templates.bodyMarkdown') }}</span>
              <textarea v-model="bodyDraft" rows="15" class="nd-input font-mono text-xs leading-relaxed" />
            </label>

            <div class="flex flex-wrap items-center gap-2 pt-1">
              <input v-model="testEmailTo" type="email" placeholder="you@nadeshiko.co" class="nd-input max-w-[14rem]" />
              <button type="button" :disabled="isPreviewing" class="nd-btn" @click="refreshPreview(true)">
                <UiBaseIcon :path="mdiSend" :size="14" />
                <span>{{ t('adminEmails.templates.sendTest') }}</span>
              </button>
              <button type="button" :disabled="isPreviewing" class="nd-btn" @click="refreshPreview(false)">
                {{ t('adminEmails.templates.refreshPreview') }}
              </button>
            </div>
          </div>

          <div class="flex flex-col bg-[#1d1d1d]">
            <div class="border-b border-hairline bg-surface px-4 py-2.5 text-xs text-ink-muted">
              <strong class="text-ink">{{ t('adminEmails.table.subject') }}:</strong>
              {{ previewSubject || subjectDraft }}
            </div>
            <iframe
              :srcdoc="previewHtml"
              sandbox=""
              class="min-h-[440px] w-full flex-1 border-0 bg-[#1d1d1d]"
              title="Email preview"
            />
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-hairline px-5 py-3">
          <button type="button" :disabled="isSavingTemplate" class="nd-btn text-xs" @click="saveTemplate(true)">
            {{ t('adminEmails.templates.resetDefault') }}
          </button>
          <div class="flex gap-2">
            <button type="button" class="nd-btn" @click="editingTemplate = null">
              {{ t('adminEmails.detail.close') }}
            </button>
            <button type="button" :disabled="isSavingTemplate" class="nd-btn-accent" @click="saveTemplate(false)">
              {{ t('adminNotifications.registry.save') }}
            </button>
          </div>
        </div>
      </template>
    </CommonBaseModal>
  </div>
</template>
