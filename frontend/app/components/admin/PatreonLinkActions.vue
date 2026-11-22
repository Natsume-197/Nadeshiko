<script setup lang="ts">
import { mdiLinkOff, mdiSync } from '@mdi/js';

// Re-sync / unlink buttons for one linked account, with an inline unlink confirmation.
const props = defineProps<{
  userId: number;
  /** `data-testid` prefix, e.g. `campaign` gives `campaign-refresh-<id>`. */
  testidPrefix: string;
  canResync: boolean;
  refreshing: boolean;
  unlinking: boolean;
  /** Smaller buttons for use inside a table cell next to other content. */
  compact?: boolean;
}>();

const emit = defineEmits<{ refresh: []; unlink: [] }>();

const { t } = useI18n();

const confirming = ref(false);

const size = computed(() =>
  props.compact
    ? { gap: 'gap-1', shape: 'rounded', text: 'text-[10px]', confirm: 'px-2 py-0.5', resync: 'px-1.5 py-0.5', secondary: 'px-1.5 py-0.5', icon: 11 }
    : { gap: 'gap-1.5', shape: 'rounded-md', text: 'text-[11px]', confirm: 'px-2.5 py-1', resync: 'px-2.5 py-1', secondary: 'px-2 py-1', icon: 13 },
);

// No reset after unlinking: the parent refetches on success, which unmounts this row's actions,
// and a failed unlink leaves the confirmation open for a retry.
</script>

<template>
  <div v-if="confirming" :class="['inline-flex items-center', size.gap]">
    <button
      type="button"
      :data-testid="`${testidPrefix}-confirm-unlink-${userId}`"
      :disabled="unlinking"
      :class="[
        size.shape,
        size.text,
        size.confirm,
        'bg-red-600 font-semibold text-white hover:bg-red-500 disabled:opacity-50',
      ]"
      @click="emit('unlink')"
    >
      {{ t('adminPatreon.actions.confirmUnlink') }}
    </button>
    <button
      type="button"
      :class="[size.shape, size.text, size.secondary, 'border border-hairline bg-surface text-ink-muted hover:text-ink']"
      @click="confirming = false"
    >
      {{ t('adminPatreon.actions.cancel') }}
    </button>
  </div>

  <div v-else :class="['inline-flex items-center', size.gap]">
    <button
      type="button"
      :data-testid="`${testidPrefix}-refresh-${userId}`"
      :disabled="!canResync || refreshing"
      :class="[
        size.shape,
        size.text,
        size.resync,
        'inline-flex items-center gap-1 border border-hairline bg-surface font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
      ]"
      @click="emit('refresh')"
    >
      <UiBaseIcon :path="mdiSync" :size="size.icon" :class="{ 'animate-spin': refreshing }" />
      <span>{{ t('adminPatreon.actions.resync') }}</span>
    </button>
    <button
      type="button"
      :data-testid="`${testidPrefix}-unlink-${userId}`"
      :class="[
        size.shape,
        size.text,
        size.secondary,
        'inline-flex items-center gap-1 border border-hairline bg-surface font-medium text-ink-faint transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300',
      ]"
      :title="t('adminPatreon.actions.unlink')"
      @click="confirming = true"
    >
      <UiBaseIcon :path="mdiLinkOff" :size="size.icon" />
      <span>{{ t('adminPatreon.actions.unlink') }}</span>
    </button>
  </div>
</template>
