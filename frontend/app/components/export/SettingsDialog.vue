<script setup lang="ts">
import { mdiClose, mdiImageOutline, mdiVolumeHigh } from '@mdi/js';
import { useExportSettingsStore } from '~/stores/exportSettings';
import CommonBaseModal from '~/components/common/BaseModal.vue';

const emit = defineEmits<{ close: [] }>();
const settings = useExportSettingsStore();
const id = useId();
const audioVolume = computed({ get: () => settings.audioVolume, set: (value: number) => settings.setAudioVolume(value) });
const imageQuality = computed({ get: () => settings.imageQuality, set: (value: number) => settings.setImageQuality(value) });
</script>

<template>
  <CommonBaseModal :open="true" :label="$t('exportSettings.title')"
    overlay-class="items-center justify-center bg-fixed-scrim/60 p-4"
    panel-class="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6 text-ink shadow-xl"
    @close="emit('close')">
    <div class="flex items-center justify-between gap-4">
      <h2 class="text-lg font-semibold">{{ $t('exportSettings.title') }}</h2>
      <button type="button" class="nd-btn size-9 !p-0" :aria-label="$t('common.close')" @click="emit('close')">
        <UiBaseIcon :path="mdiClose" />
      </button>
    </div>
    <p class="mt-1 text-sm text-ink-muted">{{ $t('exportSettings.appliesTo') }}</p>

    <div class="mt-6 space-y-6">
      <section>
        <div class="flex items-center justify-between gap-4">
          <label :for="`${id}-audio`" class="flex items-center gap-2 text-sm font-medium">
            <UiBaseIcon :path="mdiVolumeHigh" />{{ $t('exportSettings.audioVolume') }}
          </label>
          <output :for="`${id}-audio`" class="text-sm tabular-nums text-brand">
            {{ audioVolume === 100 ? $t('exportSettings.original') : `${audioVolume}%` }}
          </output>
        </div>
        <input :id="`${id}-audio`" v-model.number="audioVolume" type="range" min="25" max="100" step="5"
          class="mt-4 w-full accent-brand" :aria-describedby="`${id}-audio-help`"
          :aria-valuetext="audioVolume === 100 ? $t('exportSettings.original') : `${audioVolume}%`" />
        <p :id="`${id}-audio-help`" class="mt-2 text-xs leading-relaxed text-ink-muted">{{ $t('exportSettings.audioHelp') }}</p>
      </section>
      <section class="border-t border-hairline pt-5">
        <div class="flex items-center justify-between gap-4">
          <label :for="`${id}-image`" class="flex items-center gap-2 text-sm font-medium">
            <UiBaseIcon :path="mdiImageOutline" />{{ $t('exportSettings.imageQuality') }}
          </label>
          <output :for="`${id}-image`" class="text-sm tabular-nums text-brand">
            {{ imageQuality === 100 ? $t('exportSettings.original') : `${imageQuality}%` }}
          </output>
        </div>
        <input :id="`${id}-image`" v-model.number="imageQuality" type="range" min="25" max="100" step="5"
          class="mt-4 w-full accent-brand" :aria-describedby="`${id}-image-help`"
          :aria-valuetext="imageQuality === 100 ? $t('exportSettings.original') : `${imageQuality}%`" />
        <p :id="`${id}-image-help`" class="mt-2 text-xs leading-relaxed text-ink-muted">{{ $t('exportSettings.imageHelp') }}</p>
      </section>
    </div>
    <p class="mt-5 text-xs text-ink-faint">{{ $t('exportSettings.savedLocally') }}</p>
    <div class="mt-5 flex items-center justify-between gap-3">
      <button type="button" class="nd-btn" @click="settings.reset()">{{ $t('exportSettings.restore') }}</button>
      <button type="button" class="nd-btn-accent" @click="emit('close')">{{ $t('exportSettings.done') }}</button>
    </div>
  </CommonBaseModal>
</template>
