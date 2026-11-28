<script setup lang="ts">
import { mdiBullhornOutline } from '@mdi/js';
import type { Announcement as AnnouncementData } from '@brigadasos/nadeshiko-sdk';
import { announcementTitle } from '~/utils/announcement';
import { handleApiError } from '~/utils/apiError';

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

const typeOptions = computed(
  () =>
    [
      { value: 'INFO', label: t('accountSettings.announcement.types.INFO'), color: 'bg-neutral-500' },
      { value: 'WARNING', label: t('accountSettings.announcement.types.WARNING'), color: 'bg-amber-500' },
      { value: 'MAINTENANCE', label: t('accountSettings.announcement.types.MAINTENANCE'), color: 'bg-blue-500' },
    ] as const,
);

const previewTitle = computed(() => announcementTitle(t, form.type));
</script>

<template>
  <div class="space-y-5">
    <!-- PostHog-style header -->
    <div class="flex items-center justify-between gap-3 border-b border-hairline pb-4">
      <div class="flex items-center gap-2.5">
        <UiBaseIcon :path="mdiBullhornOutline" :size="18" class="text-brand" />
        <div>
          <h1 class="text-lg font-semibold tracking-tight text-ink">{{ t('accountSettings.announcement.title') }}</h1>
          <p class="text-xs text-ink-muted">{{ t('accountSettings.announcement.description') }}</p>
        </div>
      </div>

      <span
        :class="[
          'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
          form.active
            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
            : 'border-hairline bg-surface-lift text-ink-faint',
        ]"
      >
        {{ form.active ? 'Active' : 'Inactive' }}
      </span>
    </div>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <!-- Editor -->
      <div class="space-y-4 rounded-lg border border-hairline bg-card-background p-4 lg:col-span-7">
        <div>
          <label :for="`${fieldId}-message`" class="mb-1 block text-xs font-medium text-ink-muted">
            {{ t('accountSettings.announcement.fields.message') }}
          </label>
          <textarea
            :id="`${fieldId}-message`"
            v-model="form.message"
            maxlength="500"
            rows="3"
            :placeholder="t('accountSettings.announcement.placeholders.message')"
            class="nd-input resize-none"
          />
          <div class="mt-1 flex items-start justify-between gap-4">
            <p class="text-[11px] text-ink-faint">{{ t('accountSettings.announcement.markdownHint') }}</p>
            <p class="shrink-0 text-[11px] text-ink-faint tabular-nums">{{ form.message?.length ?? 0 }}/500</p>
          </div>
        </div>

        <fieldset class="min-w-0">
          <legend class="mb-1.5 block text-xs font-medium text-ink-muted">
            {{ t('accountSettings.announcement.fields.type') }}
          </legend>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="opt in typeOptions"
              :key="opt.value"
              type="button"
              :class="[
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                form.type === opt.value
                  ? 'border-brand-solid bg-brand/15 text-brand'
                  : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
              ]"
              @click="form.type = opt.value"
            >
              <span :class="[opt.color, 'mr-1.5 inline-block size-2 rounded-full']" />
              {{ opt.label }}
            </button>
          </div>
        </fieldset>

        <div class="flex items-center justify-between border-t border-hairline pt-4">
          <div>
            <span class="text-xs font-medium text-ink">{{ t('accountSettings.announcement.fields.active') }}</span>
            <p class="text-[11px] text-ink-faint">{{ t('accountSettings.announcement.activeDescription') }}</p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="form.active"
            :class="[
              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
              form.active ? 'bg-brand-solid' : 'bg-gray-600',
            ]"
            @click="form.active = !form.active"
          >
            <span
              :class="[
                'pointer-events-none inline-block size-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out',
                form.active ? 'translate-x-5' : 'translate-x-0',
              ]"
            />
          </button>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-hairline pt-3">
          <button v-if="existing?.active" type="button" :disabled="saving" class="nd-btn !h-8 text-xs" @click="clear">
            {{ t('accountSettings.announcement.deactivate') }}
          </button>
          <button
            type="button"
            :disabled="saving || !(form.message ?? '').trim() || !hasChanges"
            class="nd-btn-accent !h-8 text-xs"
            @click="save"
          >
            {{ saving ? t('accountSettings.announcement.saving') : t('accountSettings.announcement.save') }}
          </button>
        </div>
      </div>

      <!-- Live preview -->
      <div class="space-y-2 lg:col-span-5">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {{ t('accountSettings.announcement.preview') }}
        </div>
        <div class="rounded-lg border border-hairline bg-card-background p-4">
          <div class="rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-xs">
            <div class="font-semibold text-ink">{{ previewTitle }}</div>
            <p class="mt-0.5 text-ink-muted">
              {{ form.message || t('accountSettings.announcement.placeholders.message') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
