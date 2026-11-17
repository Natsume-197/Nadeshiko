<script setup lang="ts">
/**
 * Word search matches whole words, so `糊` misses the single word `血糊`. In word mode this offers the search
 * inside words once a Japanese query comes back short; in that mode it says so and leads back.
 */
import { mdiTextSearchVariant } from '@mdi/js';

defineProps<{
  query: string;
  /** The reader is already searching inside words (`?match=contains`). */
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
      <i18n-t scope="global" :keypath="active ? 'searchContainer.containsActive' : 'searchContainer.containsOffer'" tag="span">
        <template #query><span lang="ja" class="text-white/70">{{ query }}</span></template>
      </i18n-t>
    </span>
    <button
      type="button"
      data-testid="contains-match-toggle"
      class="font-medium text-white/70 hover:text-white underline underline-offset-2 transition-colors"
      @click="$emit('toggle')">
      {{ active ? $t('searchContainer.containsBack') : $t('searchContainer.containsSearch') }}
    </button>
  </div>
</template>
