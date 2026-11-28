<script setup lang="ts">
/** Status / count pill. One look for every status in the admin. */
export type AdminTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet';

withDefaults(defineProps<{ tone?: AdminTone; dot?: boolean }>(), { tone: 'neutral', dot: false });

const TONES: Record<AdminTone, { pill: string; dot: string }> = {
  neutral: { pill: 'bg-surface-lift text-ink-muted', dot: 'bg-ink-faint' },
  brand: { pill: 'bg-brand/10 text-brand', dot: 'bg-brand' },
  success: { pill: 'bg-emerald-500/10 text-emerald-400', dot: 'bg-emerald-400' },
  warning: { pill: 'bg-amber-500/10 text-amber-400', dot: 'bg-amber-400' },
  danger: { pill: 'bg-red-500/10 text-red-400', dot: 'bg-red-400' },
  info: { pill: 'bg-sky-500/10 text-sky-400', dot: 'bg-sky-400' },
  violet: { pill: 'bg-violet-500/10 text-violet-400', dot: 'bg-violet-400' },
};
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 tabular-nums"
    :class="TONES[tone].pill"
  >
    <span v-if="dot" class="size-1.5 rounded-full" :class="TONES[tone].dot" />
    <slot />
  </span>
</template>
