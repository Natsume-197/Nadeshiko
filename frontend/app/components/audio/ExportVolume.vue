<script setup lang="ts">
import { useAudioExportStore } from '~/stores/audioExport';
import { audioExportVolumes } from '~/utils/audioExport';

const settings = useAudioExportStore();
const id = useId();
const volume = computed({
  get: () => settings.volume,
  set: (value) => settings.setVolume(value),
});
</script>

<template>
  <div class="space-y-2">
    <label :for="id" class="block text-sm text-ink">{{ $t('audioExport.volume') }}</label>
    <select :id="id" v-model="volume" class="nd-input w-full" :aria-describedby="`${id}-help`">
      <option v-for="value in audioExportVolumes" :key="value" :value="value">
        {{ value === 100 ? $t('audioExport.original') : `${value}%` }}
      </option>
    </select>
    <p :id="`${id}-help`" class="text-xs text-ink-muted">{{ $t('audioExport.help') }}</p>
  </div>
</template>
