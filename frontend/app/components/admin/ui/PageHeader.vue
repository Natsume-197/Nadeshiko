<script setup lang="ts">
/** Title row shared by every admin page: title, optional count/status chip, actions on the right. */
defineProps<{
  title: string;
  count?: number | string | null;
}>();
</script>

<template>
  <header class="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <div class="flex min-w-0 items-center gap-2.5">
      <h1 class="truncate text-xl font-semibold tracking-tight text-ink">{{ title }}</h1>
      <span
        v-if="count !== undefined && count !== null && count !== ''"
        class="rounded-md bg-surface-lift px-1.5 py-0.5 text-xs font-medium tabular-nums text-ink-muted"
      >
        {{ count }}
      </span>
      <slot name="meta" />
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
