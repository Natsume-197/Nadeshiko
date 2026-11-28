<script setup lang="ts">
import { mdiCheck, mdiChevronRight, mdiDeleteOutline, mdiDotsVertical, mdiFlagOutline } from '@mdi/js';
import SearchDropdownContainer from '~/components/search/dropdown/DropdownContainer.vue';
import { buildMediaSearchPath, buildSentencePath } from '~/utils/routes';
import AdminUiBadge from '../ui/Badge.vue';
import AdminUiEmpty from '../ui/Empty.vue';
import { ALL_STATUSES, type ReportGroup, sourceTone, statusDot, statusTone } from './reportHelpers';

const props = defineProps<{
  groups: ReportGroup[];
  isLoading: boolean;
  hasMore: boolean;
  expandedGroups: Set<number>;
  selectedIndices: Set<number>;
  /** Notes drafts keyed by report id; edited in place and read back by the parent on save. */
  editingNotes: Record<number, string>;
}>();

const emit = defineEmits<{
  'toggle-expand': [idx: number];
  'toggle-select': [idx: number];
  'toggle-select-all': [];
  'update-status': [reportId: number, status: string];
  'delete-report': [reportId: number];
  'save-notes': [reportId: number];
  'load-more': [];
}>();

const { t } = useI18n();
const { formatNumber, formatDate, formatRelativeTime } = useFormat();
const localePath = useLocalePath();

const COLUMNS = 9;

const statusLabel = (status: string) => t(`reports.statuses.${status}`);
const sourceLabel = (source: string) => t(`reports.admin.sources.${source}`);
const targetTypeLabel = (type: string) => t(`reports.admin.targetTypes.${type}`);
const reportReasonLabel = (reason: string) => t(`reports.reasons.${reason}`);

const episodeOf = (target: ReportGroup['target']) =>
  target.type !== 'MEDIA' && 'episodeNumber' in target ? target.episodeNumber : undefined;
const segmentOf = (target: ReportGroup['target']) =>
  target.type === 'SEGMENT' && 'segmentPublicId' in target ? target.segmentPublicId : undefined;

const sentencePathOf = (target: ReportGroup['target']) => {
  const segment = segmentOf(target);
  return segment ? localePath(buildSentencePath(segment)) : undefined;
};

const reportTargetSearchPath = (target: ReportGroup['target']) =>
  localePath(buildMediaSearchPath(target.mediaPublicId, 'episodeNumber' in target ? target.episodeNumber : undefined));

const allVisibleSelected = computed(() => {
  return props.groups.length > 0 && props.groups.every((_, i) => props.selectedIndices.has(i));
});

const startEditNotes = (reportId: number, adminNotes: string | null | undefined) => {
  props.editingNotes[reportId] = adminNotes || '';
};

// Notes quote the sentence being reported, so they are often Japanese and Enter
// may be confirming an IME conversion rather than saving -- see #399. One row
// per open draft, so the listeners are built per id; the guard itself is keyed
// by element and survives that.
const notesEnterSubmit = (reportId: number) => useEnterSubmit(() => emit('save-notes', reportId));
</script>

<template>
  <div>
    <div class="nd-admin-table-wrap">
      <table class="nd-admin-table min-w-[860px]">
        <thead>
          <tr>
            <th class="w-8 !pl-4 !pr-1">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :aria-label="t('reports.admin.selectAll')"
                class="size-3.5 cursor-pointer align-middle accent-brand"
                @change="emit('toggle-select-all')"
              />
            </th>
            <th class="w-6 !px-1" />
            <th>{{ t('reports.table.target') }}</th>
            <th>{{ t('reports.table.type') }}</th>
            <th class="text-right">{{ t('reports.admin.count') }}</th>
            <th>{{ t('reports.table.status') }}</th>
            <th>{{ t('reports.admin.reported') }}</th>
            <th>{{ t('reports.admin.updated') }}</th>
            <th class="w-12" />
          </tr>
        </thead>

        <tbody v-if="isLoading && groups.length === 0" role="status" :aria-label="t('reports.loading')">
          <tr v-for="n in 6" :key="n">
            <td class="!pl-4 !pr-1"><span class="block size-3.5 animate-pulse rounded bg-surface-lift" /></td>
            <td class="!px-1" />
            <td>
              <span class="block h-3 w-44 animate-pulse rounded bg-surface-lift" />
              <span class="mt-1.5 block h-2.5 w-20 animate-pulse rounded bg-surface-lift" />
            </td>
            <td><span class="block h-4 w-16 animate-pulse rounded bg-surface-lift" /></td>
            <td><span class="ml-auto block h-3 w-6 animate-pulse rounded bg-surface-lift" /></td>
            <td><span class="block h-4 w-16 animate-pulse rounded bg-surface-lift" /></td>
            <td><span class="block h-3 w-14 animate-pulse rounded bg-surface-lift" /></td>
            <td><span class="block h-3 w-14 animate-pulse rounded bg-surface-lift" /></td>
            <td />
          </tr>
        </tbody>

        <tbody v-else-if="groups.length === 0">
          <tr>
            <td :colspan="COLUMNS">
              <!-- Sticky so the message stays in view while the empty table scrolls sideways on phones. -->
              <div class="sticky left-0 max-w-[calc(100vw-2rem)]">
                <AdminUiEmpty :icon="mdiFlagOutline" :text="t('reports.noReports')" />
              </div>
            </td>
          </tr>
        </tbody>

        <tbody v-else>
          <template v-for="(group, idx) in groups" :key="idx">
            <tr
              class="is-clickable"
              :class="{ 'is-active': selectedIndices.has(idx) }"
              data-testid="report-row"
              @click="emit('toggle-expand', idx)"
            >
              <!-- biome-ignore lint/a11y/useKeyWithClickEvents: only keeps the checkbox from toggling the row -->
              <td class="w-8 !pl-4 !pr-1" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedIndices.has(idx)"
                  class="size-3.5 cursor-pointer align-middle accent-brand"
                  @change="emit('toggle-select', idx)"
                />
              </td>
              <td class="w-6 !px-1 text-ink-faint">
                <UiBaseIcon
                  :path="mdiChevronRight"
                  :size="16"
                  w="w-4"
                  h="h-4"
                  class="transition-transform"
                  :class="{ 'rotate-90': expandedGroups.has(idx) }"
                />
              </td>
              <td class="max-w-[280px]" :title="group.mediaName || group.target.mediaPublicId || undefined">
                <template v-if="group.target.mediaPublicId">
                  <NuxtLink
                    :to="reportTargetSearchPath(group.target)"
                    class="block truncate font-medium text-ink hover:text-brand hover:underline"
                    @click.stop
                  >
                    {{ group.mediaName || group.target.mediaPublicId }}
                  </NuxtLink>
                  <div
                    v-if="episodeOf(group.target) || segmentOf(group.target)"
                    class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-faint"
                  >
                    <span v-if="episodeOf(group.target)" class="shrink-0">
                      {{ t('reports.admin.episode', { number: episodeOf(group.target) }) }}
                    </span>
                    <NuxtLink
                      v-if="segmentOf(group.target)"
                      :to="sentencePathOf(group.target)"
                      class="truncate font-mono text-[11px] text-ink-muted hover:text-brand hover:underline"
                      :title="segmentOf(group.target)"
                      @click.stop
                    >
                      {{ segmentOf(group.target) }}
                    </NuxtLink>
                  </div>
                </template>
                <AdminUiBadge v-else tone="danger">{{ t('reports.admin.deletedTarget') }}</AdminUiBadge>
              </td>
              <td>
                <AdminUiBadge>{{ targetTypeLabel(group.target.type) }}</AdminUiBadge>
              </td>
              <td class="text-right">
                <span class="font-medium tabular-nums text-ink">{{ formatNumber(group.reportCount) }}</span>
                <span
                  v-if="group.reporterCount > 0"
                  class="block cursor-help whitespace-nowrap text-[11px] text-ink-faint"
                  :title="[...new Set(group.reports.map(r => r.reporterName))].join(', ')"
                >
                  {{ t('reports.admin.reporters', { count: formatNumber(group.reporterCount) }) }}
                </span>
              </td>
              <td>
                <AdminUiBadge :tone="statusTone(group.status)" dot>{{ statusLabel(group.status) }}</AdminUiBadge>
              </td>
              <td class="whitespace-nowrap text-xs text-ink-muted" :title="formatDate(group.firstReportedAt, 'dateTime')">
                {{ formatRelativeTime(group.firstReportedAt) }}
              </td>
              <td class="whitespace-nowrap text-xs text-ink-muted" :title="group.lastStatusChange ? formatDate(group.lastStatusChange, 'dateTime') : ''">
                {{ formatRelativeTime(group.lastStatusChange) }}
              </td>
              <!-- biome-ignore lint/a11y/useKeyWithClickEvents: only keeps the row menu from toggling the row -->
              <td class="w-12 text-right" @click.stop>
                <SearchDropdownContainer
                  v-for="first in group.reports.slice(0, 1)"
                  :key="first.id"
                  dropdown-id="nd-report-row-actions"
                  teleport
                  teleport-align="end"
                  dropdown-container-class="min-w-[11rem]"
                >
                  <template #default="{ toggle, isOpen }">
                    <button
                      type="button"
                      data-testid="report-row-menu"
                      class="inline-flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
                      aria-haspopup="menu"
                      :aria-expanded="isOpen"
                      :aria-label="t('reports.admin.moreActions')"
                      @click="toggle"
                    >
                      <UiBaseIcon :path="mdiDotsVertical" :size="16" w="w-4" h="h-4" />
                    </button>
                  </template>
                  <template #content>
                    <div class="nd-menu-header">{{ t('reports.admin.setStatus') }}</div>
                    <button
                      v-for="status in ALL_STATUSES"
                      :key="status"
                      type="button"
                      class="nd-menu-item !gap-x-2.5 !py-1.5 !text-[13px]"
                      :class="{ 'is-selected': group.status === status }"
                      @click="emit('update-status', first.id, status)"
                    >
                      <span class="size-1.5 shrink-0 rounded-full" :class="statusDot(status)" />
                      <span class="flex-1">{{ statusLabel(status) }}</span>
                      <UiBaseIcon v-if="group.status === status" :path="mdiCheck" :size="14" w="w-3.5" h="h-3.5" />
                    </button>
                    <div class="nd-menu-divider" />
                    <button
                      type="button"
                      class="nd-menu-item is-danger !gap-x-2.5 !py-1.5 !text-[13px]"
                      @click="emit('delete-report', first.id)"
                    >
                      <UiBaseIcon :path="mdiDeleteOutline" :size="16" w="w-4" h="h-4" />
                      {{ t('reports.admin.delete') }}
                    </button>
                  </template>
                </SearchDropdownContainer>
              </td>
            </tr>

            <tr
              v-if="expandedGroups.has(idx)"
              v-for="report in group.reports"
              :key="report.id"
              class="bg-background"
            >
              <td class="!pl-4 !pr-1" />
              <td class="!px-1" />
              <td :colspan="COLUMNS - 2" class="!py-2">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <AdminUiBadge :tone="sourceTone(report.source)">{{ sourceLabel(report.source) }}</AdminUiBadge>
                  <span class="font-medium text-ink">{{ reportReasonLabel(report.reason) }}</span>
                  <span
                    v-if="report.description"
                    class="min-w-0 max-w-[360px] truncate text-ink-muted"
                    :title="report.description"
                  >
                    {{ report.description }}
                  </span>
                  <span class="text-xs text-ink-faint">{{ report.reporterName }}</span>
                  <span class="text-xs text-ink-faint" :title="formatDate(report.createdAt, 'dateTime')">
                    {{ formatRelativeTime(report.createdAt) }}
                  </span>
                  <div class="ml-auto flex min-w-0 items-center gap-1.5">
                    <template v-if="editingNotes[report.id] !== undefined">
                      <input
                        v-model="editingNotes[report.id]"
                        class="nd-input !h-7 w-56 !text-xs"
                        v-on="notesEnterSubmit(report.id)"
                        @keyup.escape="delete editingNotes[report.id]"
                      />
                      <button type="button" class="nd-btn !h-7 !text-xs" @click="emit('save-notes', report.id)">
                        {{ t('reports.admin.save') }}
                      </button>
                    </template>
                    <button
                      v-else
                      type="button"
                      class="block max-w-[220px] cursor-pointer truncate rounded px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-surface-hover"
                      :class="report.adminNotes ? 'text-ink-muted hover:text-ink' : 'text-ink-faint hover:text-ink-muted'"
                      :title="report.adminNotes || ''"
                      @click="startEditNotes(report.id, report.adminNotes)"
                    >
                      {{ report.adminNotes || t('reports.admin.notePlaceholder') }}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="hasMore" class="mt-3 flex justify-center">
      <button type="button" :disabled="isLoading" class="nd-btn !h-8 !text-[13px]" @click="emit('load-more')">
        <span v-if="isLoading" class="nd-spinner" />
        {{ isLoading ? t('reports.loading') : t('reports.loadMore') }}
      </button>
    </div>
  </div>
</template>
