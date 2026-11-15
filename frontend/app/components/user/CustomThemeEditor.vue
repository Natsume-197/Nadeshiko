<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import {
  type CustomTheme,
  type CustomThemeBase,
  customThemeVariables,
  customThemeWarnings,
} from '~/utils/customTheme';

/**
 * "Create your own" in the Themes settings: a base, an accent and a background, with a live preview and a warning
 * when something would not read. It only edits; saving (and the patron check) belongs to ThemeSettings.
 */
const props = defineProps<{ initial: CustomTheme; saving?: boolean }>();
const emit = defineEmits<{ save: [theme: CustomTheme]; cancel: [] }>();

const { t } = useI18n();

const draft = ref<CustomTheme>({ ...props.initial, preset: 'custom' });

const warnings = computed(() => customThemeWarnings(draft.value));

/** The preview is drawn with the draft's own tokens, so it shows the theme before it is applied to the site. */
const previewStyle = computed(() => ({
  ...customThemeVariables(draft.value),
  backgroundColor: 'var(--background)',
  color: draft.value.base === 'dark' ? '#e8e8e8' : '#1f1f1f',
}));

const edit = (patch: Partial<CustomTheme>) => {
  draft.value = { ...draft.value, ...patch, preset: 'custom' };
};
</script>

<template>
  <div class="mt-4 rounded-xl border border-hairline p-4" data-testid="custom-theme-editor">
    <div class="grid gap-3 sm:grid-cols-3">
      <label class="flex flex-col gap-1 text-sm text-gray-300">
        {{ t('accountSettings.account.customTheme.base') }}
        <select
          class="nd-select"
          data-testid="custom-theme-base"
          :value="draft.base"
          @change="edit({ base: ($event.target as HTMLSelectElement).value as CustomThemeBase })"
        >
          <option value="dark">{{ t('accountSettings.account.themeOptions.dark') }}</option>
          <option value="light">{{ t('accountSettings.account.themeOptions.light') }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm text-gray-300">
        {{ t('accountSettings.account.customTheme.accent') }}
        <input
          type="color"
          class="h-9 w-full cursor-pointer rounded-lg border border-hairline bg-transparent"
          data-testid="custom-theme-accent"
          :value="draft.accent"
          @input="edit({ accent: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm text-gray-300">
        {{ t('accountSettings.account.customTheme.background') }}
        <input
          type="color"
          class="h-9 w-full cursor-pointer rounded-lg border border-hairline bg-transparent"
          data-testid="custom-theme-background"
          :value="draft.background"
          @input="edit({ background: ($event.target as HTMLInputElement).value })"
        />
      </label>
    </div>

    <div class="mt-4 rounded-lg p-4" :style="previewStyle" data-testid="custom-theme-preview">
      <div class="rounded-md p-3" :style="{ background: 'var(--surface)', border: '1px solid var(--line)' }">
        <p class="font-semibold">彼女なの？</p>
        <p class="text-sm opacity-70">{{ t('accountSettings.account.customTheme.previewText') }}</p>
        <span
          class="mt-3 inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold"
          :style="{ background: 'var(--accent)', color: '#ffffff' }"
        >
          {{ t('accountSettings.account.customTheme.previewButton') }}
        </span>
      </div>
    </div>

    <ul v-if="warnings.length" class="mt-3 space-y-1 text-sm text-amber-300" data-testid="custom-theme-warnings">
      <li v-for="warning in warnings" :key="warning">
        {{ t(`accountSettings.account.customTheme.warning_${warning}`) }}
      </li>
    </ul>

    <div class="mt-4 flex flex-wrap gap-2">
      <button
        type="button"
        class="nd-btn-accent"
        :disabled="saving"
        data-testid="custom-theme-apply"
        @click="emit('save', { ...draft })"
      >
        {{ t('accountSettings.account.customTheme.apply') }}
      </button>
      <button type="button" class="nd-btn" data-testid="custom-theme-cancel" @click="emit('cancel')">
        {{ t('accountSettings.themes.cancel') }}
      </button>
    </div>
  </div>
</template>
