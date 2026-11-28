<script setup lang="ts">
import { mdiLinkVariantOff } from '@mdi/js';
import AdminUiSegmented, { type AdminSegment } from '../ui/Segmented.vue';
import { ALL_STATUSES, statusDot } from './reportHelpers';

type Source = '' | 'USER' | 'AUTO';
type StatusChoice = 'ALL' | (typeof ALL_STATUSES)[number] | '';

const props = defineProps<{
  source: Source;
  activeStatuses: Set<string>;
  orphaned: boolean;
}>();

const emit = defineEmits<{
  'update:source': [source: Source];
  'update:orphaned': [orphaned: boolean];
  'toggle-status': [status: string];
}>();

const { t } = useI18n();

const statusOptions = computed<AdminSegment<StatusChoice>[]>(() => [
  { value: 'ALL', label: t('reports.admin.filters.all') },
  ...ALL_STATUSES.map((status) => ({
    value: status,
    label: t(`reports.statuses.${status}`),
    dot: statusDot(status),
  })),
]);

const sourceOptions = computed<AdminSegment<Source>[]>(() => [
  { value: '', label: t('reports.admin.filters.allSources') },
  { value: 'USER', label: t('reports.admin.sources.USER') },
  { value: 'AUTO', label: t('reports.admin.sources.AUTO') },
]);

/** The parent keeps a set of statuses; the control offers "all" or exactly one. */
const statusChoice = computed<StatusChoice>(() => {
  const size = props.activeStatuses.size;
  if (size === 0 || size === ALL_STATUSES.length) return 'ALL';
  if (size === 1) return [...props.activeStatuses][0] as StatusChoice;
  return '';
});

/** Toggles every status whose membership differs from the chosen set, so the parent's set ends up equal to it. */
const selectStatus = (choice: StatusChoice) => {
  if (!choice) return;
  const wanted = new Set<string>(choice === 'ALL' ? ALL_STATUSES : [choice]);
  for (const status of ALL_STATUSES) {
    if (wanted.has(status) !== props.activeStatuses.has(status)) emit('toggle-status', status);
  }
};
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <AdminUiSegmented :model-value="statusChoice" :options="statusOptions" testid-prefix="reports-status" @update:model-value="selectStatus" />
    <AdminUiSegmented :model-value="source" :options="sourceOptions" testid-prefix="reports-source" @update:model-value="emit('update:source', $event)" />
    <button
      type="button"
      data-testid="orphaned-filter"
      :aria-pressed="orphaned"
      class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
      :class="
        orphaned
          ? 'border-transparent bg-brand/15 text-brand hover:bg-brand/25'
          : 'border-hairline text-ink-muted hover:bg-surface-hover hover:text-ink'
      "
      @click="emit('update:orphaned', !orphaned)"
    >
      <UiBaseIcon :path="mdiLinkVariantOff" :size="14" w="w-3.5" h="h-3.5" />
      {{ t('reports.admin.filters.orphaned') }}
    </button>
  </div>
</template>
