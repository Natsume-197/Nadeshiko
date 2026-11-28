<script setup lang="ts">
import type { Announcement as AnnouncementData } from '@brigadasos/nadeshiko-sdk';
import { announcementTitle } from '~/utils/announcement';
import { handleApiError } from '~/utils/apiError';
import AdminUiBadge from './ui/Badge.vue';
import AdminUiCard from './ui/Card.vue';
import AdminUiPageHeader from './ui/PageHeader.vue';
import AdminUiSegmented, { type AdminSegment } from './ui/Segmented.vue';
import AdminUiSwitch from './ui/Switch.vue';

const { t } = useI18n();
const fieldId = useId();
const sdk = useNadeshikoSdk();
const saving = ref(false);

const form = reactive<AnnouncementData>({
  message: '',
  type: 'INFO',
  active: false,
});

const { data: existing } = await useAsyncData(
  'settings-admin-announcement',
  async () => {
    try {
      const data = await sdk.getAnnouncement();
      return data && typeof data === 'object' && 'message' in data
        ? ({
            message: data.message ?? '',
            type: data.type ?? 'INFO',
            active: Boolean(data.active),
          } as AnnouncementData)
        : null;
    } catch (error) {
      handleApiError('admin:announcement-fetch-failed', error, { toastKey: false });
      return null;
    }
  },
  {
    default: () => null,
  },
);

if (existing.value) {
  form.message = existing.value.message ?? '';
  form.type = existing.value.type ?? 'INFO';
  form.active = Boolean(existing.value.active);
}

const hasChanges = computed(() => {
  if (!existing.value) return form.message.length > 0;
  return (
    form.message !== existing.value.message ||
    form.type !== existing.value.type ||
    form.active !== existing.value.active
  );
});

const save = async () => {
  if (saving.value || !form.message.trim()) return;
  saving.value = true;

  try {
    const data = await sdk.updateAnnouncement({
      message: form.message.trim(),
      type: form.type,
      active: form.active,
    });
    existing.value = data as AnnouncementData;
    useToastSuccess(t('accountSettings.announcement.updated'));
  } catch (error) {
    handleApiError('admin:announcement-update-failed', error, {
      toastKey: 'accountSettings.announcement.updateError',
    });
  } finally {
    saving.value = false;
  }
};

const clear = async () => {
  if (saving.value) return;
  saving.value = true;

  try {
    const data = await sdk.updateAnnouncement({
      message: form.message || t('accountSettings.announcement.fallbackMessage'),
      type: form.type,
      active: false,
    });
    existing.value = data as AnnouncementData;
    form.active = false;
    useToastSuccess(t('accountSettings.announcement.deactivated'));
  } catch (error) {
    handleApiError('admin:announcement-deactivate-failed', error, {
      toastKey: 'accountSettings.announcement.deactivateError',
    });
  } finally {
    saving.value = false;
  }
};

const typeOptions = computed<AdminSegment<AnnouncementData['type']>[]>(() => [
  { value: 'INFO', label: t('accountSettings.announcement.types.INFO'), dot: 'bg-ink-faint' },
  { value: 'WARNING', label: t('accountSettings.announcement.types.WARNING'), dot: 'bg-amber-400' },
  { value: 'MAINTENANCE', label: t('accountSettings.announcement.types.MAINTENANCE'), dot: 'bg-sky-400' },
]);

const previewTitle = computed(() => announcementTitle(t, form.type));
</script>

<template>
  <div class="space-y-5">
    <AdminUiPageHeader :title="t('accountSettings.announcement.title')">
      <template #meta>
        <AdminUiBadge data-testid="announcement-status" :tone="existing?.active ? 'success' : 'neutral'" dot>
          {{ existing?.active ? t('accountSettings.announcement.fields.active') : t('accountSettings.announcement.inactive') }}
        </AdminUiBadge>
      </template>
    </AdminUiPageHeader>

    <div class="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <AdminUiCard class="lg:col-span-7" flush>
        <div class="space-y-5 p-4">
          <div>
            <label :for="`${fieldId}-message`" class="nd-admin-label">
              {{ t('accountSettings.announcement.fields.message') }}
            </label>
            <textarea
              :id="`${fieldId}-message`"
              v-model="form.message"
              maxlength="500"
              rows="3"
              :placeholder="t('accountSettings.announcement.placeholders.message')"
              class="nd-input resize-none !text-[13px]"
            />
            <div class="mt-1 flex items-start justify-between gap-4 text-xs text-ink-faint">
              <p>{{ t('accountSettings.announcement.markdownHint') }}</p>
              <p class="shrink-0 tabular-nums">{{ form.message?.length ?? 0 }}/500</p>
            </div>
          </div>

          <div>
            <span class="nd-admin-label">{{ t('accountSettings.announcement.fields.type') }}</span>
            <AdminUiSegmented v-model="form.type" :options="typeOptions" testid-prefix="announcement-type" />
          </div>

          <div class="flex items-center justify-between gap-3">
            <span :id="`${fieldId}-active`" class="text-[13px] font-medium text-ink">
              {{ t('accountSettings.announcement.fields.active') }}
            </span>
            <AdminUiSwitch v-model="form.active" :label="t('accountSettings.announcement.fields.active')" />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          <button v-if="existing?.active" type="button" :disabled="saving" class="nd-btn !h-8 !text-[13px]" @click="clear">
            {{ t('accountSettings.announcement.deactivate') }}
          </button>
          <button
            type="button"
            :disabled="saving || !(form.message ?? '').trim() || !hasChanges"
            class="nd-btn-accent !h-8 !text-[13px]"
            @click="save"
          >
            {{ saving ? t('accountSettings.announcement.saving') : t('accountSettings.announcement.save') }}
          </button>
        </div>
      </AdminUiCard>

      <AdminUiCard class="self-start lg:col-span-5" :title="t('accountSettings.announcement.fields.preview')">
        <div class="rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-[13px]">
          <div class="flex items-center gap-2 font-semibold text-ink">
            <span class="size-1.5 shrink-0 rounded-full" :class="typeOptions.find((o) => o.value === form.type)?.dot" />
            {{ previewTitle }}
          </div>
          <p class="mt-0.5 break-words text-ink-muted">
            {{ form.message || t('accountSettings.announcement.placeholders.message') }}
          </p>
        </div>
      </AdminUiCard>
    </div>
  </div>
</template>
