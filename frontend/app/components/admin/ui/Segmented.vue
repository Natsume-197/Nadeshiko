<script setup lang="ts" generic="T extends string | number | null">
/** Compact segmented filter (status, source, audience…). */
export interface AdminSegment<V> {
  value: V;
  label: string;
  count?: number | string | null;
  dot?: string;
  icon?: string;
}

/** `testidPrefix` puts `data-testid="<prefix>-<value>"` on each option. */
defineProps<{ options: AdminSegment<T>[]; testidPrefix?: string }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-hairline bg-surface/60 p-0.5">
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors"
      :class="model === opt.value ? 'bg-surface-lift text-ink shadow-sm' : 'text-ink-muted hover:text-ink'"
      :aria-pressed="model === opt.value"
      :data-testid="testidPrefix ? `${testidPrefix}-${String(opt.value)}` : undefined"
      @click="model = opt.value"
    >
      <span v-if="opt.dot" class="size-1.5 rounded-full" :class="opt.dot" />
      <UiBaseIcon v-if="opt.icon" :path="opt.icon" :size="14" w="w-3.5" h="h-3.5" />
      <span>{{ opt.label }}</span>
      <span v-if="opt.count !== undefined && opt.count !== null" class="tabular-nums text-ink-faint">{{ opt.count }}</span>
    </button>
  </div>
</template>
