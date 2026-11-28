<script setup lang="ts">
import { mdiLinkOff, mdiSync } from '@mdi/js';

// Re-sync / unlink buttons for one linked account, with an inline unlink confirmation.
defineProps<{
  userId: number;
  /** `data-testid` prefix, e.g. `campaign` gives `campaign-refresh-<id>`. */
  testidPrefix: string;
  canResync: boolean;
  refreshing: boolean;
  unlinking: boolean;
  /** Icon-only unlink for use inside a table cell next to other content. */
  compact?: boolean;
}>();

const emit = defineEmits<{ refresh: []; unlink: [] }>();

const { t } = useI18n();

const confirming = ref(false);

// No reset after unlinking: the parent refetches on success, which unmounts this row's actions,
// and a failed unlink leaves the confirmation open for a retry.
</script>

<template>
  <div v-if="confirming" class="inline-flex items-center gap-1">
    <button
      type="button"
      :data-testid="`${testidPrefix}-confirm-unlink-${userId}`"
      :disabled="unlinking"
      class="nd-btn-danger !h-7 !px-2.5 !text-xs"
      @click="emit('unlink')"
    >
      <span v-if="unlinking" class="nd-spinner" />
      {{ t('adminPatreon.actions.confirmUnlink') }}
    </button>
    <button type="button" class="nd-btn !h-7 !px-2.5 !text-xs" @click="confirming = false">
      {{ t('adminPatreon.actions.cancel') }}
    </button>
  </div>

  <div v-else class="inline-flex items-center gap-1">
    <button
      type="button"
      :data-testid="`${testidPrefix}-refresh-${userId}`"
      :disabled="!canResync || refreshing"
      class="nd-btn !h-7 !px-2.5 !text-xs"
      @click="emit('refresh')"
    >
      <UiBaseIcon :path="mdiSync" :size="14" w="w-3.5" h="h-3.5" :class="{ 'animate-spin': refreshing }" />
      <span>{{ t('adminPatreon.actions.resync') }}</span>
    </button>
    <button
      type="button"
      :data-testid="`${testidPrefix}-unlink-${userId}`"
      class="nd-btn !h-7 !text-xs text-ink-faint hover:!text-red-400"
      :class="compact ? '!px-1.5' : '!px-2.5'"
      :title="t('adminPatreon.actions.unlink')"
      :aria-label="t('adminPatreon.actions.unlink')"
      @click="confirming = true"
    >
      <UiBaseIcon :path="mdiLinkOff" :size="14" w="w-3.5" h="h-3.5" />
      <span v-if="!compact">{{ t('adminPatreon.actions.unlink') }}</span>
    </button>
  </div>
</template>
