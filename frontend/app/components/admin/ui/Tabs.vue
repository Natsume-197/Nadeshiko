<script setup lang="ts" generic="T extends string">
/** Underline tabs for switching views inside one admin page. */
export interface AdminTab<V extends string = string> {
  value: V;
  label: string;
  count?: number | string | null;
  /** Small coloured dot after the label (e.g. something needs attention). */
  alert?: boolean;
}

defineProps<{ tabs: AdminTab<T>[]; testidPrefix?: string }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div role="tablist" class="-mb-px flex items-center gap-5 overflow-x-auto border-b border-hairline">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="model === tab.value"
      :data-testid="testidPrefix ? `${testidPrefix}-${tab.value}` : undefined"
      class="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-2.5 pt-1 text-[13px] font-medium transition-colors"
      :class="model === tab.value ? 'text-ink' : 'text-ink-muted hover:text-ink'"
      @click="model = tab.value"
    >
      <span>{{ tab.label }}</span>
      <span
        v-if="tab.count !== undefined && tab.count !== null"
        class="rounded px-1 text-[11px] tabular-nums"
        :class="model === tab.value ? 'bg-brand/15 text-brand' : 'bg-surface-lift text-ink-faint'"
      >
        {{ tab.count }}
      </span>
      <span v-if="tab.alert" class="size-1.5 rounded-full bg-amber-400" />
      <span
        class="absolute inset-x-0 -bottom-px h-0.5 rounded-full transition-colors"
        :class="model === tab.value ? 'bg-brand' : 'bg-transparent'"
      />
    </button>
  </div>
</template>
