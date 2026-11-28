<script setup lang="ts">
/** Bordered panel with an optional title row. `flush` drops body padding (tables, lists). */
withDefaults(defineProps<{ title?: string; flush?: boolean }>(), { title: undefined, flush: false });
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-hairline bg-card-background">
    <div
      v-if="title || $slots.header || $slots.actions"
      class="flex min-h-11 items-center justify-between gap-3 border-b border-hairline px-4 py-2"
    >
      <slot name="header">
        <h2 class="text-[13px] font-semibold text-ink">{{ title }}</h2>
      </slot>
      <div v-if="$slots.actions" class="flex items-center gap-2"><slot name="actions" /></div>
    </div>
    <div :class="flush ? '' : 'p-4'"><slot /></div>
  </section>
</template>
