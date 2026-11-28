<script setup lang="ts">
/** Empty / error state: icon, one short line, optional action. */
withDefaults(defineProps<{ icon?: string; text: string; tone?: 'neutral' | 'danger'; compact?: boolean }>(), {
  icon: undefined,
  tone: 'neutral',
  compact: false,
});
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2.5 text-center" :class="compact ? 'py-6' : 'py-12'">
    <span
      v-if="icon"
      class="flex size-9 items-center justify-center rounded-full"
      :class="tone === 'danger' ? 'bg-red-500/10 text-red-400' : 'bg-surface-lift text-ink-faint'"
    >
      <UiBaseIcon :path="icon" :size="18" w="w-[18px]" h="h-[18px]" />
    </span>
    <p class="text-[13px]" :class="tone === 'danger' ? 'text-red-400' : 'text-ink-muted'">{{ text }}</p>
    <slot />
  </div>
</template>
