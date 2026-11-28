<script setup lang="ts">
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';

/** "1–50 of 230" plus previous / next. `page` is 1-based. */
const props = defineProps<{ page: number; pageSize: number; total?: number | null; hasMore?: boolean }>();
const emit = defineEmits<{ 'update:page': [page: number] }>();
const { formatNumber } = useFormat();

const from = computed(() => (props.page - 1) * props.pageSize + 1);
const to = computed(() =>
  props.total != null ? Math.min(props.page * props.pageSize, props.total) : props.page * props.pageSize,
);
const canNext = computed(() => (props.total != null ? props.page * props.pageSize < props.total : !!props.hasMore));
</script>

<template>
  <div v-if="page > 1 || canNext" class="flex items-center justify-end gap-3 pt-3 text-xs text-ink-faint">
    <span class="tabular-nums">
      {{ formatNumber(from) }}–{{ formatNumber(to) }}<template v-if="total != null"> / {{ formatNumber(total) }}</template>
    </span>
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="nd-btn !h-7 !px-1.5"
        :disabled="page <= 1"
        aria-label="Previous page"
        @click="emit('update:page', page - 1)"
      >
        <UiBaseIcon :path="mdiChevronLeft" :size="16" w="w-4" h="h-4" />
      </button>
      <button
        type="button"
        class="nd-btn !h-7 !px-1.5"
        :disabled="!canNext"
        aria-label="Next page"
        @click="emit('update:page', page + 1)"
      >
        <UiBaseIcon :path="mdiChevronRight" :size="16" w="w-4" h="h-4" />
      </button>
    </div>
  </div>
</template>
