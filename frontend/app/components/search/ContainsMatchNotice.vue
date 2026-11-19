<script setup lang="ts">
/**
 * Word search matches whole words, so `糊` misses the single word `血糊`. While the reader searches inside words
 * (`?match=contains`, from `*糊*` or a kanji's sentence link), this says so and leads back to the word search. It
 * no longer suggests the mode on short results (dropped 2026-11-19).
 */
import { mdiTextSearchVariant } from '@mdi/js';

defineProps<{
  query: string;
  /** Always true now; kept so the container's call site reads the same. */
  active: boolean;
}>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <div
    data-testid="contains-match-notice"
    class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 md:px-0 py-2.5 text-sm text-white/45">
    <UiBaseIcon :path="mdiTextSearchVariant" size="16" class="shrink-0" />
    <span>
      <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
      <i18n-t scope="global" keypath="searchContainer.containsActive" tag="span">
        <template #query><span lang="ja" class="text-white/70">{{ query }}</span></template>
      </i18n-t>
    </span>
    <button
      type="button"
      data-testid="contains-match-toggle"
      class="font-medium text-white/70 hover:text-white underline underline-offset-2 transition-colors"
      @click="$emit('toggle')">
      {{ $t('searchContainer.containsBack') }}
    </button>
  </div>
</template>
