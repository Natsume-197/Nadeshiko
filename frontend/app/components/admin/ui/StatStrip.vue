<script setup lang="ts">
import { resolveComponent } from 'vue';

/** Joined KPI strip. Each stat may link somewhere; `value: null` renders a skeleton. */
export interface AdminStat {
  id: string;
  label: string;
  value: string | number | null;
  sub?: string;
  icon?: string;
  to?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  /** data-testid placed on the value. */
  testid?: string;
}

defineProps<{ stats: AdminStat[]; loading?: boolean }>();
const LinkComponent = resolveComponent('NuxtLink');
const localePath = useLocalePath();

const TONE: Record<NonNullable<AdminStat['tone']>, string> = {
  neutral: 'text-ink',
  brand: 'text-brand',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
};
</script>

<template>
  <div
    class="grid overflow-hidden rounded-lg border border-hairline bg-card-background"
    :class="{
      'grid-cols-2 sm:grid-cols-4': stats.length === 4,
      'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5': stats.length === 5,
      'grid-cols-3': stats.length === 3,
      'grid-cols-2': stats.length === 2,
    }"
  >
    <component
      :is="stat.to ? LinkComponent : 'div'"
      v-for="stat in stats"
      :key="stat.id"
      :to="stat.to ? localePath(stat.to) : undefined"
      class="group -ml-px -mt-px flex min-w-0 flex-col gap-1 border-l border-t border-hairline px-4 py-3.5"
      :class="stat.to ? 'transition-colors hover:bg-surface-hover' : ''"
    >
      <div class="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span class="truncate">{{ stat.label }}</span>
        <UiBaseIcon
          v-if="stat.icon"
          :path="stat.icon"
          :size="14"
          w="w-3.5"
          h="h-3.5"
          class="shrink-0 text-ink-faint transition-colors group-hover:text-brand"
        />
      </div>
      <span
        v-if="loading || stat.value === null"
        class="my-1 block h-6 w-12 animate-pulse rounded bg-surface-lift"
      />
      <span
        v-else
        :data-testid="stat.testid"
        class="text-2xl font-semibold leading-8 tracking-tight tabular-nums"
        :class="TONE[stat.tone ?? 'neutral']"
      >
        {{ stat.value }}
      </span>
      <span v-if="stat.sub" class="truncate text-xs text-ink-faint">{{ stat.sub }}</span>
    </component>
  </div>
</template>
