<script setup lang="ts">
import { mdiCogOutline } from '@mdi/js';
import SettingsDialog from '~/components/export/SettingsDialog.vue';

defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ compact?: boolean }>(), { compact: true });
const open = ref(false);
</script>

<template>
  <button v-bind="$attrs" type="button" class="nd-btn h-11 px-3" :aria-label="$t('exportSettings.title')"
    :title="$t('exportSettings.title')" aria-haspopup="dialog" @click="open = true">
    <UiBaseIcon :path="mdiCogOutline" />
    <span v-if="!compact">{{ $t('exportSettings.title') }}</span>
  </button>
  <SettingsDialog v-if="open" @close="open = false" />
</template>
