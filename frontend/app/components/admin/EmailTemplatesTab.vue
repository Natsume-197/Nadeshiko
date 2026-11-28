<script setup lang="ts">
import { watchDebounced } from '@vueuse/core';
import { mdiClose, mdiEmailOutline, mdiLockOutline, mdiPencilOutline, mdiRefresh, mdiSend } from '@mdi/js';
import type { ListAdminNotificationSettingsResponse } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';
import { useToastSuccess } from '~/utils/toast';
import AdminUiBadge, { type AdminTone } from './ui/Badge.vue';
import AdminUiCard from './ui/Card.vue';
import AdminUiEmpty from './ui/Empty.vue';
import AdminUiSwitch from './ui/Switch.vue';

type SettingItem = ListAdminNotificationSettingsResponse['items'][number];

const { t } = useI18n();
const { formatNumber } = useFormat();
const sdk = useNadeshikoSdk();
const store = userStore();

const items = ref<SettingItem[]>([]);
const isLoading = ref(false);
const loaded = ref(false);
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
const isSendingTest = ref(false);
const isSavingTemplate = ref(false);
const testEmailTo = ref(store.userEmail ?? '');

const mounted = ref(false);
onMounted(() => (mounted.value = true));

function formatVar(name: string): string {
  return `{{${name}}}`;
}

/** `checkins` → `Checkins`. */
function capitalize(value: string): string {
  const text = value.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function triggerTone(item: SettingItem): AdminTone {
  return item.trigger === 'cron' ? 'violet' : item.trigger === 'realtime' ? 'info' : 'neutral';
}

function triggerLabel(item: SettingItem): string {
  if (item.trigger === 'cron') return item.schedule ?? t('adminNotifications.registry.triggers.cron');
  return t(`adminNotifications.registry.triggers.${item.trigger}`);
}

function paramsSummary(item: SettingItem): string {
  return item.paramFields.map((f) => `${f.label}: ${item.params[f.key] ?? item.defaultParams[f.key]}`).join(' · ');
}

const emailItems = computed(() => items.value.filter((i) => i.channels.email));

const AREA_ORDER = ['official', 'words', 'community', 'lifecycle', 'transactional'] as const;

const groupedEmailItems = computed(() =>
  AREA_ORDER.map((area) => ({
    area,
    label: t(`adminNotifications.areas.${area}`),
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
    loaded.value = true;
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

function fillParamDraft(item: SettingItem) {
  const next: Record<string, number> = {};
  for (const field of item.paramFields) {
    next[field.key] = Number(item.params[field.key] ?? item.defaultParams[field.key] ?? field.min);
  }
  paramDraft.value = next;
}

function openParams(item: SettingItem) {
  editingParamsItem.value = item;
  fillParamDraft(item);
}

/** One Edit per row: the template editor when the copy is editable (it carries the parameters too), else the drawer. */
function openEditor(item: SettingItem) {
  if (item.editableTemplate) void openTemplateEditor(item);
  else openParams(item);
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
  fillParamDraft(item);
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
  if (sendTest) isSendingTest.value = true;
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
    isSendingTest.value = false;
  }
}

/** Live preview while typing. */
watchDebounced(
  [subjectDraft, bodyDraft],
  () => {
    if (editingTemplate.value) void refreshPreview();
  },
  { debounce: 700 },
);

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
            ...(item.paramFields.length > 0 ? { params: { ...paramDraft.value } } : {}),
          },
    );
    item.subjectOverride = updated.subjectOverride ?? null;
    item.bodyOverride = updated.bodyOverride ?? null;
    if (updated.params) item.params = updated.params;
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
  <div class="space-y-4">
    <!-- Loading -->
    <AdminUiCard v-if="!loaded || (isLoading && emailItems.length === 0)" flush>
      <div v-for="n in 5" :key="n" class="flex items-center gap-4 border-b border-hairline px-4 py-3.5 last:border-0">
        <div class="flex-1 space-y-2">
          <span class="block h-3 w-40 animate-pulse rounded bg-surface-lift" />
          <span class="block h-2.5 w-64 animate-pulse rounded bg-surface-lift" />
        </div>
        <span class="h-5 w-9 animate-pulse rounded-full bg-surface-lift" />
      </div>
    </AdminUiCard>

    <AdminUiCard v-else-if="emailItems.length === 0" flush>
      <AdminUiEmpty :icon="mdiEmailOutline" :text="t('adminNotifications.registry.empty')" />
    </AdminUiCard>

    <AdminUiCard v-for="group in groupedEmailItems" :key="group.area" flush>
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
          :data-testid="`email-type-${item.kind}`"
          class="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface-hover/50 sm:flex-row sm:items-center sm:gap-6"
        >
          <div class="min-w-0 flex-1" :title="item.description">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[13px] font-medium text-ink">{{ item.label }}</span>
              <AdminUiBadge :tone="triggerTone(item)">{{ triggerLabel(item) }}</AdminUiBadge>
              <AdminUiBadge v-if="item.subjectOverride || item.bodyOverride" tone="warning">
                {{ t('adminNotifications.registry.customCopy') }}
              </AdminUiBadge>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-faint">
              <span>{{ item.emailFrom ? `${item.emailFrom}@` : '—' }}</span>
              <span>·</span>
              <span>{{ item.emailCategory ? capitalize(item.emailCategory) : t('adminNotifications.registry.transactional') }}</span>
              <span>·</span>
              <span class="tabular-nums">{{ t('adminNotifications.registry.sent7d', { count: formatNumber(item.stats7d.emailSent) }) }}</span>
              <template v-if="item.stats7d.emailFailed > 0">
                <span>·</span>
                <span class="tabular-nums text-red-400">
                  {{ t('adminNotifications.registry.failed7d', { count: formatNumber(item.stats7d.emailFailed) }) }}
                </span>
              </template>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-3">
            <button
              v-if="item.editableTemplate || item.paramFields.length > 0"
              type="button"
              :data-testid="`email-type-edit-${item.kind}`"
              :title="item.paramFields.length > 0 ? paramsSummary(item) : undefined"
              class="nd-btn !h-7 !text-xs"
              @click="openEditor(item)"
            >
              <UiBaseIcon :path="mdiPencilOutline" :size="14" w="w-3.5" h="h-3.5" />
              <span>{{ t('adminNotifications.registry.edit') }}</span>
            </button>
            <span v-if="item.alwaysEnabled" :title="t('adminNotifications.registry.locked')" class="text-ink-faint">
              <UiBaseIcon :path="mdiLockOutline" :size="14" w="w-3.5" h="h-3.5" />
            </span>
            <AdminUiSwitch
              :model-value="item.emailEnabled"
              :label="item.label"
              :disabled="item.alwaysEnabled || (mounted && savingKind === item.kind)"
              @update:model-value="toggleEmail(item)"
            />
          </div>
        </li>
      </ul>
    </AdminUiCard>

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
        <div class="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div class="min-w-0 space-y-1">
            <h2 id="admin-email-params-title" class="text-[15px] font-semibold leading-snug text-ink">
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
            <label :for="`email-param-${field.key}`" class="nd-admin-label">{{ field.label }}</label>
            <input
              :id="`email-param-${field.key}`"
              v-model.number="paramDraft[field.key]"
              type="number"
              :min="field.min"
              :max="field.max"
              :title="field.description"
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

    <!-- Template editor modal -->
    <CommonBaseModal
      :open="Boolean(editingTemplate)"
      labelledby="admin-email-template-title"
      overlay-class="items-center justify-center bg-fixed-scrim/60 p-4"
      panel-class="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="editingTemplate = null"
    >
      <template v-if="editingTemplate">
        <div class="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 id="admin-email-template-title" class="text-[15px] font-semibold leading-snug text-ink">
                {{ editingTemplate.label }}
              </h3>
              <AdminUiBadge :tone="triggerTone(editingTemplate)">{{ triggerLabel(editingTemplate) }}</AdminUiBadge>
            </div>
            <p class="text-xs text-ink-muted">{{ editingTemplate.description }}</p>
          </div>
          <button
            type="button"
            :aria-label="t('common.close')"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
            @click="editingTemplate = null"
          >
            <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
          </button>
        </div>

        <div class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          <!-- Fields -->
          <div class="space-y-4 p-5 lg:overflow-y-auto">
            <div>
              <label for="admin-email-template-subject" class="nd-admin-label">{{ t('adminEmails.table.subject') }}</label>
              <input
                id="admin-email-template-subject"
                v-model="subjectDraft"
                type="text"
                class="nd-input !h-8 !text-[13px]"
              />
            </div>

            <div>
              <label for="admin-email-template-body" class="nd-admin-label">
                {{ t('adminEmails.templates.bodyMarkdown') }}
              </label>
              <div v-if="(editingTemplate.allowedVariables ?? []).length > 0" class="mb-2 flex flex-wrap gap-1">
                <button
                  v-for="v in editingTemplate.allowedVariables ?? []"
                  :key="v"
                  type="button"
                  :title="t('adminEmails.templates.insertVariable')"
                  class="rounded-md bg-surface-lift px-1.5 py-0.5 font-mono text-[11px] text-ink-muted transition-colors hover:bg-brand/15 hover:text-brand"
                  @click="insertVariable(v)"
                >
                  {{ formatVar(v) }}
                </button>
              </div>
              <textarea
                id="admin-email-template-body"
                v-model="bodyDraft"
                rows="16"
                class="nd-input resize-y font-mono !text-xs leading-relaxed"
              />
            </div>

            <div v-if="editingTemplate.paramFields.length > 0" class="space-y-3 border-t border-hairline pt-4">
              <h4 class="text-[13px] font-semibold text-ink">{{ t('adminNotifications.registry.params') }}</h4>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div v-for="field in editingTemplate.paramFields" :key="field.key">
                  <label :for="`email-tpl-param-${field.key}`" class="nd-admin-label">{{ field.label }}</label>
                  <input
                    :id="`email-tpl-param-${field.key}`"
                    v-model.number="paramDraft[field.key]"
                    type="number"
                    :min="field.min"
                    :max="field.max"
                    :title="field.description"
                    class="nd-input !h-8 !text-[13px]"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Live preview -->
          <div class="flex min-h-[460px] flex-col border-t border-hairline bg-surface lg:border-l lg:border-t-0">
            <div class="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
              <div class="min-w-0 flex-1 truncate text-[13px] text-ink">
                <span class="text-ink-faint">{{ t('adminEmails.table.subject') }}:</span>
                {{ previewSubject || subjectDraft }}
              </div>
              <button
                type="button"
                :disabled="isPreviewing"
                :aria-label="t('adminEmails.templates.refreshPreview')"
                :title="t('adminEmails.templates.refreshPreview')"
                class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
                @click="refreshPreview(false)"
              >
                <UiBaseIcon :path="mdiRefresh" :size="15" w="w-4" h="h-4" :class="{ 'animate-spin': isPreviewing }" />
              </button>
            </div>
            <iframe
              :srcdoc="previewHtml"
              sandbox=""
              class="w-full flex-1 border-0 bg-card-background"
              :title="t('adminEmails.templates.preview')"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-5 py-3">
          <button type="button" :disabled="isSavingTemplate" class="nd-btn !h-8 !text-[13px]" @click="saveTemplate(true)">
            {{ t('adminEmails.templates.resetDefault') }}
          </button>
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="testEmailTo"
              type="email"
              :placeholder="t('adminEmails.templates.testTo')"
              :aria-label="t('adminEmails.templates.testTo')"
              class="nd-input !h-8 w-56 !text-[13px]"
            />
            <button
              type="button"
              :disabled="isPreviewing || !testEmailTo.trim()"
              class="nd-btn !h-8 !text-[13px]"
              @click="refreshPreview(true)"
            >
              <span v-if="isSendingTest" class="nd-spinner" />
              <UiBaseIcon v-else :path="mdiSend" :size="14" w="w-3.5" h="h-3.5" />
              <span>{{ t('adminEmails.templates.sendTest') }}</span>
            </button>
            <button
              type="button"
              :disabled="isSavingTemplate"
              class="nd-btn-accent !h-8 !text-[13px]"
              @click="saveTemplate(false)"
            >
              <span v-if="isSavingTemplate" class="nd-spinner" />
              {{ t('adminNotifications.registry.save') }}
            </button>
          </div>
        </div>
      </template>
    </CommonBaseModal>
  </div>
</template>
