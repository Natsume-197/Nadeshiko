<script setup lang="ts">
import {
  mdiAlertOutline,
  mdiCheck,
  mdiChevronDoubleUp,
  mdiChevronRight,
  mdiClose,
  mdiContentCopy,
  mdiMagnify,
  mdiMerge,
  mdiOpenInNew,
  mdiRefresh,
  mdiThumbUpOutline,
} from '@mdi/js';
import { useTimeoutFn } from '@vueuse/core';
import type { AdminContentRequest as AdminRequest } from '@brigadasos/nadeshiko-sdk';
import RequestMediaPicker from '~/components/admin/RequestMediaPicker.vue';
import RequestCover from '~/components/requests/RequestCover.vue';
import { handleApiError } from '~/utils/apiError';
import {
  REQUEST_BOOST_WEIGHT,
  REQUEST_CATEGORIES as CATEGORIES,
  REQUEST_CATEGORY_ICONS as CATEGORY_ICONS,
  type RequestCategory as Category,
  formatRequestDate,
  type RequestStatus as Status,
} from '~/utils/contentRequests';
import { httpUrl } from '~/utils/strings';
import AdminUiBadge, { type AdminTone } from './ui/Badge.vue';
import AdminUiPageHeader from './ui/PageHeader.vue';
import AdminUiSegmented, { type AdminSegment } from './ui/Segmented.vue';

/**
 * Admin side of content requests (task 49): Trello-style Kanban board for triaging by score, moving requests across
 * statuses (IN_PROGRESS and RELEASED email voters), declining with a public reason, linking published media, and
 * merging duplicates.
 */

interface EditDraft {
  status: Status;
  title: string;
  coverUrl: string;
  declineReason: string;
  mediaId: string;
  mergeInto: string;
}

interface PendingMove {
  item: AdminRequest;
  targetStatus: Status;
  declineReason: string;
  mediaId: string;
  /** When triggered from the detail modal, carry any edited title and cover along too. */
  title?: string;
  coverUrl?: string | null;
}

const STATUS_META: ReadonlyArray<{
  status: Status;
  tone: AdminTone;
  dot: string;
  columnGlow: string;
}> = [
  { status: 'OPEN', tone: 'neutral', dot: 'bg-ink-faint', columnGlow: 'border-brand/60 bg-brand/5' },
  { status: 'PLANNED', tone: 'info', dot: 'bg-sky-400', columnGlow: 'border-sky-400/60 bg-sky-500/5' },
  { status: 'IN_PROGRESS', tone: 'violet', dot: 'bg-violet-400', columnGlow: 'border-violet-400/60 bg-violet-500/5' },
  { status: 'RELEASED', tone: 'success', dot: 'bg-emerald-400', columnGlow: 'border-emerald-400/60 bg-emerald-500/5' },
  { status: 'DECLINED', tone: 'danger', dot: 'bg-red-400', columnGlow: 'border-red-400/60 bg-red-500/5' },
];

const STATUS_META_BY_STATUS = Object.fromEntries(STATUS_META.map((meta) => [meta.status, meta])) as Record<
  Status,
  (typeof STATUS_META)[number]
>;

const DECLINE_PRESET_KEYS = ['noSubtitles', 'alreadyOn', 'unsupported'] as const;

const BOARD_TAKE = 100;

const { t, locale } = useI18n();
const localePath = useLocalePath();
const mounted = ref(false);
onMounted(() => (mounted.value = true));

const declinePresets = computed(() => DECLINE_PRESET_KEYS.map((key) => t(`requests.admin.declinePresets.${key}`)));

function statusLabel(status: Status): string {
  return t(`requests.status.${status}`);
}

function categoryLabel(category: Category): string {
  return t(`requests.category.${category}`);
}

const categoryOptions = computed<AdminSegment<Category | ''>[]>(() => [
  { value: '', label: t('requests.category.ALL') },
  ...CATEGORIES.map((category) => ({ value: category, label: categoryLabel(category), icon: CATEGORY_ICONS[category] })),
]);

const statusOptions = computed<AdminSegment<Status>[]>(() =>
  STATUS_META.map((meta) => ({ value: meta.status, label: statusLabel(meta.status), dot: meta.dot })),
);

/** The merge field is rarely used; it stays folded unless the request is flagged as a duplicate. */
const showMerge = ref(false);

const filters = reactive({
  category: '' as Category | '',
  q: '',
});
const searchInput = ref('');
const { start: scheduleSearch, stop: cancelSearch } = useTimeoutFn(
  () => {
    filters.q = searchInput.value.trim();
  },
  250,
  { immediate: false },
);
watch(searchInput, () => scheduleSearch());

const page = ref(1);
const items = ref<AdminRequest[]>([]);
const total = ref(0);
const loading = ref(true);
const hasLoadedOnce = ref(false);
const savingId = ref<string | null>(null);

// Drag-and-drop state.
const draggingId = ref<string | null>(null);
const dragOverStatus = ref<Status | null>(null);

// Detail modal + move/merge confirmation state.
const selectedItem = ref<AdminRequest | null>(null);
const editDraft = reactive<EditDraft>({
  status: 'OPEN',
  title: '',
  coverUrl: '',
  declineReason: '',
  mediaId: '',
  mergeInto: '',
});
const mergeConfirmTarget = ref<{ source: AdminRequest; intoId: string; intoTitle?: string } | null>(null);
const pendingMove = ref<PendingMove | null>(null);
const copiedId = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    const response = await $fetch<{ items: AdminRequest[]; total: number }>('/v1/admin/requests', {
      query: {
        page: page.value,
        take: BOARD_TAKE,
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.q ? { q: filters.q } : {}),
      },
    });
    items.value = response.items;
    total.value = response.total;
    if (selectedItem.value) {
      const refreshed = response.items.find((r) => r.id === selectedItem.value?.id) ?? null;
      selectedItem.value = refreshed;
      if (refreshed) syncDraft(refreshed);
    }
  } catch (error) {
    handleApiError('admin.requests.load', error);
  } finally {
    loading.value = false;
    hasLoadedOnce.value = true;
  }
}

onMounted(load);
watch(
  () => ({
    category: filters.category,
    q: filters.q,
  }),
  () => {
    page.value = 1;
    load();
  },
);
watch(page, load);

const itemsByStatus = computed<Record<Status, AdminRequest[]>>(() => {
  const groups: Record<Status, AdminRequest[]> = {
    OPEN: [],
    PLANNED: [],
    IN_PROGRESS: [],
    RELEASED: [],
    DECLINED: [],
  };
  for (const item of items.value) {
    groups[item.status].push(item);
  }
  return groups;
});

function statusMeta(status: Status) {
  return STATUS_META_BY_STATUS[status];
}

function scoreTitle(item: AdminRequest): string {
  const votes = t('requests.votes', item.voteCount);
  if (!item.boostCount) return votes;
  return `${votes} + ${t('requests.boosts', item.boostCount)} (+${item.boostCount * REQUEST_BOOST_WEIGHT})`;
}

function formatShortDate(value: string) {
  return formatRequestDate(value, locale.value);
}

function syncDraft(item: AdminRequest) {
  editDraft.status = item.status;
  editDraft.title = item.title;
  editDraft.coverUrl = item.coverUrl ?? '';
  editDraft.declineReason = item.declineReason ?? '';
  editDraft.mediaId = item.media?.id ?? '';
  editDraft.mergeInto = item.possibleDuplicateOf?.id ?? '';
}

function openDetail(item: AdminRequest) {
  selectedItem.value = item;
  showMerge.value = false;
  syncDraft(item);
}

function closeDetail() {
  selectedItem.value = null;
}

const isDetailDirty = computed(() => {
  const item = selectedItem.value;
  if (!item) return false;
  return (
    editDraft.status !== item.status ||
    editDraft.title.trim() !== item.title ||
    (editDraft.coverUrl.trim() || null) !== (item.coverUrl ?? null) ||
    (editDraft.declineReason.trim() || null) !== (item.declineReason ?? null) ||
    (editDraft.mediaId.trim() || null) !== (item.media?.id ?? null)
  );
});

const mergeCandidates = computed(() => {
  const current = selectedItem.value;
  if (!current) return [];
  return items.value.filter((candidate) => candidate.id !== current.id && candidate.status !== 'DECLINED');
});

function replaceItem(updated: AdminRequest) {
  const index = items.value.findIndex((item) => item.id === updated.id);
  if (index >= 0) items.value.splice(index, 1, updated);
  if (selectedItem.value?.id === updated.id) {
    selectedItem.value = updated;
    syncDraft(updated);
  }
}

async function patchRequest(
  item: AdminRequest,
  body: {
    status?: Status;
    title?: string;
    coverUrl?: string | null;
    declineReason?: string | null;
    mediaId?: string | null;
    dismissDuplicate?: boolean;
    notify?: boolean;
  },
  successMessage?: string,
) {
  savingId.value = item.id;
  try {
    const updated = await $fetch<AdminRequest>(`/v1/admin/requests/${item.id}`, {
      method: 'PATCH',
      body,
    });
    replaceItem(updated);
    if (successMessage) useToastSuccess(successMessage);
    return updated;
  } catch (error) {
    handleApiError('admin.requests.save', error);
    return null;
  } finally {
    savingId.value = null;
  }
}

// Drag-and-drop handlers.
function onDragStart(item: AdminRequest, event: DragEvent) {
  draggingId.value = item.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
  }
}

function onDragEnd() {
  draggingId.value = null;
  dragOverStatus.value = null;
}

function onDragOver(status: Status) {
  if (!draggingId.value) return;
  dragOverStatus.value = status;
}

function onDragLeave(status: Status) {
  if (dragOverStatus.value === status) dragOverStatus.value = null;
}

async function onDrop(targetStatus: Status) {
  const id = draggingId.value;
  draggingId.value = null;
  dragOverStatus.value = null;
  if (!id) return;
  const item = items.value.find((candidate) => candidate.id === id);
  if (!item || item.status === targetStatus) return;

  if (targetStatus === 'IN_PROGRESS' || targetStatus === 'RELEASED' || targetStatus === 'DECLINED') {
    pendingMove.value = {
      item,
      targetStatus,
      declineReason: item.declineReason ?? '',
      mediaId: item.media?.id ?? '',
    };
    return;
  }

  // Moving to OPEN or PLANNED does not email voters; apply optimistically.
  const previous = { ...item };
  replaceItem({ ...item, status: targetStatus });
  const updated = await patchRequest(item, { status: targetStatus }, t('requests.admin.toast.moved', { status: statusLabel(targetStatus) }));
  if (!updated) replaceItem(previous);
}

/** IN_PROGRESS and RELEASED are the moves that email voters; the admin chooses each time whether they do. */
function emailsVoters(status: Status): boolean {
  return status === 'IN_PROGRESS' || status === 'RELEASED';
}

async function confirmPendingMove(notify = true) {
  const move = pendingMove.value;
  if (!move) return;
  if (move.targetStatus === 'DECLINED' && !move.declineReason.trim()) return;
  const quiet = emailsVoters(move.targetStatus) && !notify;
  const updated = await patchRequest(
    move.item,
    {
      status: move.targetStatus,
      ...(move.title ? { title: move.title } : {}),
      ...(move.coverUrl !== undefined ? { coverUrl: move.coverUrl } : {}),
      declineReason: move.targetStatus === 'DECLINED' ? move.declineReason.trim() : move.declineReason.trim() || null,
      mediaId: move.mediaId.trim() || null,
      ...(emailsVoters(move.targetStatus) ? { notify } : {}),
    },
    t(quiet ? 'requests.admin.toast.movedQuiet' : 'requests.admin.toast.moved', {
      status: statusLabel(move.targetStatus),
    }),
  );
  if (updated) {
    pendingMove.value = null;
    if (selectedItem.value?.id === updated.id) closeDetail();
  }
}

async function saveDetail() {
  const item = selectedItem.value;
  if (!item) return;
  const nextCover = editDraft.coverUrl.trim() || null;
  const coverChanged = nextCover !== (item.coverUrl ?? null);
  const statusChanged = editDraft.status !== item.status;
  if (statusChanged && (editDraft.status === 'IN_PROGRESS' || editDraft.status === 'RELEASED')) {
    pendingMove.value = {
      item,
      targetStatus: editDraft.status,
      declineReason: editDraft.declineReason,
      mediaId: editDraft.mediaId,
      title: editDraft.title.trim() || item.title,
      ...(coverChanged ? { coverUrl: nextCover } : {}),
    };
    return;
  }
  const updated = await patchRequest(
    item,
    {
      status: editDraft.status,
      title: editDraft.title.trim() || item.title,
      ...(coverChanged ? { coverUrl: nextCover } : {}),
      declineReason: editDraft.declineReason.trim() || null,
      mediaId: editDraft.mediaId.trim() || null,
    },
    t('requests.admin.toast.saved'),
  );
  if (updated) closeDetail();
}

async function dismissDuplicate(item: AdminRequest) {
  await patchRequest(item, { dismissDuplicate: true }, t('requests.admin.toast.duplicateDismissed'));
}

function askMerge(source: AdminRequest, intoId: string, intoTitle?: string) {
  const trimmed = intoId.trim();
  if (!trimmed || trimmed === source.id) return;
  const resolvedTitle = intoTitle ?? items.value.find((candidate) => candidate.id === trimmed)?.title;
  mergeConfirmTarget.value = { source, intoId: trimmed, intoTitle: resolvedTitle };
}

async function confirmMerge() {
  const pending = mergeConfirmTarget.value;
  if (!pending) return;
  savingId.value = pending.source.id;
  try {
    await $fetch(`/v1/admin/requests/${pending.source.id}/merge`, {
      method: 'POST',
      body: { intoId: pending.intoId },
    });
    mergeConfirmTarget.value = null;
    closeDetail();
    useToastSuccess(t('requests.admin.toast.merged'));
    await load();
  } catch (error) {
    handleApiError('admin.requests.merge', error);
  } finally {
    savingId.value = null;
  }
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    copiedId.value = id;
    setTimeout(() => {
      if (copiedId.value === id) copiedId.value = null;
    }, 1500);
  } catch {
    // Clipboard unavailable; ignore quietly.
  }
}

function clearSearch() {
  cancelSearch();
  searchInput.value = '';
  filters.q = '';
}
</script>

<template>
  <div class="space-y-5 text-ink">
    <AdminUiPageHeader :title="t('requests.admin.title')" :count="hasLoadedOnce ? total : null">
      <template #actions>
        <button
          type="button"
          data-testid="admin-requests-refresh"
          :disabled="mounted && loading"
          class="nd-btn !h-8 !text-[13px]"
          @click="load()"
        >
          <UiBaseIcon :path="mdiRefresh" :size="15" w="w-4" h="h-4" :class="{ 'animate-spin': mounted && loading }" />
          <span>{{ t('adminLayout.reload') }}</span>
        </button>
        <NuxtLink :to="localePath('/requests')" class="nd-btn !h-8 !text-[13px]">
          <span>{{ t('requests.admin.publicBoard') }}</span>
          <UiBaseIcon :path="mdiOpenInNew" :size="14" w="w-3.5" h="h-3.5" class="text-ink-faint" />
        </NuxtLink>
      </template>
    </AdminUiPageHeader>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-2">
      <fieldset data-testid="admin-category-filter" :aria-label="t('requests.categoryLabel')" class="max-w-full">
        <AdminUiSegmented v-model="filters.category" :options="categoryOptions" testid-prefix="admin-category" />
      </fieldset>
      <div class="relative w-full sm:w-64">
        <UiBaseIcon
          :path="mdiMagnify"
          :size="15"
          w="w-4"
          h="h-4"
          class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          v-model="searchInput"
          type="text"
          inputmode="search"
          class="nd-input w-full !h-8 !pl-8 !text-[13px]"
          :class="searchInput ? '!pr-8' : ''"
          :placeholder="t('requests.admin.searchPlaceholder')"
          :aria-label="t('requests.searchLabel')"
        >
        <button
          v-if="searchInput"
          type="button"
          class="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition hover:bg-surface-hover hover:text-ink"
          :aria-label="t('common.clearSearch')"
          @click="clearSearch"
        >
          <UiBaseIcon :path="mdiClose" :size="14" w="w-3.5" h="h-3.5" />
        </button>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading && !hasLoadedOnce" class="flex gap-3 overflow-hidden">
      <div
        v-for="col in STATUS_META"
        :key="col.status"
        class="min-w-[200px] flex-1 space-y-2 rounded-xl border border-hairline bg-surface/60 p-2"
      >
        <span class="block h-3 w-24 animate-pulse rounded bg-surface-lift" />
        <span v-for="n in 2" :key="n" class="block h-20 animate-pulse rounded-lg bg-surface-lift" />
      </div>
    </div>

    <!-- Kanban board -->
    <div
      v-else
      data-testid="admin-requests-board"
      class="flex min-h-[24rem] items-stretch gap-3 overflow-x-auto pb-3 transition-opacity duration-150"
      :class="loading ? 'opacity-60' : 'opacity-100'"
    >
      <div
        v-for="col in STATUS_META"
        :key="col.status"
        :data-testid="`admin-column-${col.status}`"
        role="listbox"
        :aria-label="statusLabel(col.status)"
        class="flex min-w-[200px] flex-1 flex-col rounded-xl border p-2 transition-colors"
        :class="dragOverStatus === col.status ? col.columnGlow : 'border-hairline bg-surface/60'"
        @dragover.prevent="onDragOver(col.status)"
        @dragleave="onDragLeave(col.status)"
        @drop.prevent="onDrop(col.status)"
      >
        <header class="flex h-8 items-center justify-between gap-2 px-1.5">
          <div class="flex min-w-0 items-center gap-2">
            <span class="size-2 shrink-0 rounded-full" :class="col.dot" aria-hidden="true" />
            <h2 class="truncate text-[13px] font-semibold text-ink">{{ statusLabel(col.status) }}</h2>
          </div>
          <AdminUiBadge>{{ itemsByStatus[col.status].length }}</AdminUiBadge>
        </header>

        <div class="mt-1 flex flex-1 flex-col gap-2">
          <div
            v-for="item in itemsByStatus[col.status]"
            :key="item.id"
            :data-testid="`admin-request-${item.id}`"
            role="option"
            :aria-selected="selectedItem?.id === item.id"
            draggable="true"
            tabindex="0"
            class="group cursor-pointer rounded-lg border border-hairline bg-card-background p-2.5 transition hover:border-line-hover hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            :class="{ 'opacity-50': draggingId === item.id }"
            @dragstart="onDragStart(item, $event)"
            @dragend="onDragEnd"
            @click="openDetail(item)"
            @keydown.enter.self="openDetail(item)"
            @keydown.space.self.prevent="openDetail(item)"
          >
            <div class="flex items-start gap-2.5">
              <RequestCover
                :category="item.category"
                :cover-url="item.coverUrl"
                compact
                icon-size="16"
                class="h-14 w-10 shrink-0 rounded-md"
              />

              <div class="min-w-0 flex-1">
                <h3 class="line-clamp-2 text-[13px] font-medium leading-snug text-ink" :title="item.title">
                  {{ item.title }}
                </h3>
                <div class="mt-1 flex items-center gap-1.5 text-xs text-ink-faint">
                  <UiBaseIcon :path="CATEGORY_ICONS[item.category]" :size="12" w="w-3" h="h-3" class="shrink-0" />
                  <span class="truncate">{{ categoryLabel(item.category) }}</span>
                  <AdminUiBadge v-if="item.kind === 'UPDATE'" tone="brand">{{ t('requests.admin.kindUpdate') }}</AdminUiBadge>
                </div>
              </div>

              <span
                class="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums"
                :class="item.boostCount > 0 ? 'text-amber-400' : 'text-ink-muted'"
                :title="scoreTitle(item)"
              >
                <UiBaseIcon
                  :path="item.boostCount > 0 ? mdiChevronDoubleUp : mdiThumbUpOutline"
                  :size="12"
                  w="w-3"
                  h="h-3"
                />
                {{ item.score }}
              </span>
            </div>

            <p v-if="item.note" class="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-muted">
              {{ item.note }}
            </p>
            <p v-if="item.declineReason" class="mt-1.5 line-clamp-2 text-xs leading-relaxed text-red-400">
              {{ item.declineReason }}
            </p>

            <AdminUiBadge v-if="item.possibleDuplicateOf" tone="warning" class="mt-2 max-w-full">
              <UiBaseIcon :path="mdiAlertOutline" :size="12" w="w-3" h="h-3" class="shrink-0" />
              <span class="truncate">{{ t('requests.admin.duplicateShort', { title: item.possibleDuplicateOf.title }) }}</span>
            </AdminUiBadge>

            <div class="mt-2 flex items-center justify-between gap-2 text-xs text-ink-faint">
              <span class="truncate">
                <template v-if="item.requester">{{ item.requester.username }} · </template>
                <span class="tabular-nums">{{ formatShortDate(item.createdAt) }}</span>
              </span>
              <a
                v-if="httpUrl(item.sourceUrl)"
                :href="httpUrl(item.sourceUrl) ?? undefined"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-60 transition hover:bg-surface-lift hover:text-ink group-hover:opacity-100"
                :title="t('requests.viewSource')"
                :aria-label="t('requests.viewSource')"
                @click.stop
              >
                <UiBaseIcon :path="mdiOpenInNew" :size="12" w="w-3" h="h-3" />
              </a>
            </div>
          </div>

          <div
            v-if="!itemsByStatus[col.status].length"
            class="flex h-24 items-center justify-center rounded-lg border border-dashed border-hairline px-3 text-center text-xs text-ink-faint"
          >
            {{ draggingId ? t('requests.admin.dropHere') : t('requests.admin.noRequests') }}
          </div>
        </div>
      </div>
    </div>

    <nav v-if="total > BOARD_TAKE" :aria-label="t('requests.pagination')" class="flex items-center justify-center gap-3">
      <button type="button" class="nd-btn !h-8 !text-[13px]" :disabled="page <= 1" @click="page--">
        {{ t('requests.previous') }}
      </button>
      <span class="text-xs tabular-nums text-ink-muted">{{ page }} / {{ Math.ceil(total / BOARD_TAKE) }}</span>
      <button type="button" class="nd-btn !h-8 !text-[13px]" :disabled="page * BOARD_TAKE >= total" @click="page++">
        {{ t('requests.next') }}
      </button>
    </nav>

    <!-- Detail / edit modal -->
    <CommonBaseModal
      :open="Boolean(selectedItem)"
      labelledby="admin-request-detail-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="closeDetail"
    >
      <template v-if="selectedItem">
        <div class="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div class="flex min-w-0 items-start gap-3">
            <RequestCover
              :category="selectedItem.category"
              :cover-url="selectedItem.coverUrl"
              :lazy="false"
              class="h-16 w-12 shrink-0 rounded-md bg-surface"
            />
            <div class="min-w-0 space-y-1.5">
              <div class="flex flex-wrap items-center gap-1.5">
                <AdminUiBadge :tone="statusMeta(selectedItem.status).tone" dot>
                  {{ statusLabel(selectedItem.status) }}
                </AdminUiBadge>
                <AdminUiBadge v-if="selectedItem.kind === 'UPDATE'" tone="brand">{{ t('requests.admin.kindUpdate') }}</AdminUiBadge>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-ink-faint transition hover:bg-surface-hover hover:text-ink"
                  :title="t('requests.admin.copyId')"
                  @click="copyId(selectedItem.id)"
                >
                  <UiBaseIcon
                    :path="copiedId === selectedItem.id ? mdiCheck : mdiContentCopy"
                    :size="12"
                    w="w-3"
                    h="h-3"
                  />
                  <span>{{ copiedId === selectedItem.id ? t('requests.admin.copied') : selectedItem.id.slice(0, 8) }}</span>
                </button>
              </div>
              <h2 id="admin-request-detail-title" class="text-[15px] font-semibold leading-snug text-ink">
                {{ selectedItem.title }}
              </h2>
            </div>
          </div>
          <button
            type="button"
            :aria-label="t('common.close')"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
            @click="closeDetail"
          >
            <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
          </button>
        </div>

        <div class="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <dl class="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt class="text-ink-faint">{{ t('requests.admin.fields.score') }}</dt>
            <dd class="text-ink">
              <span class="font-semibold tabular-nums">{{ selectedItem.score }}</span>
              <span class="ml-1.5 text-xs text-ink-muted">
                {{ t('requests.votes', selectedItem.voteCount) }} · {{ t('requests.boosts', selectedItem.boostCount) }}
              </span>
            </dd>
            <dt class="text-ink-faint">{{ t('requests.categoryLabel') }}</dt>
            <dd class="text-ink">{{ categoryLabel(selectedItem.category) }}</dd>
            <dt class="text-ink-faint">{{ t('requests.admin.fields.requested') }}</dt>
            <dd class="text-ink">
              <span class="tabular-nums">{{ formatShortDate(selectedItem.createdAt) }}</span>
              <span v-if="selectedItem.requester" class="ml-1.5 text-ink-muted">
                {{ selectedItem.requester.username }}
                <span class="text-xs text-ink-faint">#{{ selectedItem.requester.id }}</span>
              </span>
            </dd>
            <template v-if="selectedItem.externalSource || httpUrl(selectedItem.sourceUrl)">
              <dt class="text-ink-faint">{{ t('requests.admin.fields.source') }}</dt>
              <dd class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span v-if="selectedItem.externalSource" class="font-mono text-xs text-ink-muted">
                  {{ selectedItem.externalSource }} {{ selectedItem.externalId }}
                </span>
                <a
                  v-if="httpUrl(selectedItem.sourceUrl)"
                  :href="httpUrl(selectedItem.sourceUrl) ?? undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-brand hover:underline"
                >
                  <span>{{ t('requests.viewSource') }}</span>
                  <UiBaseIcon :path="mdiOpenInNew" :size="12" w="w-3" h="h-3" />
                </a>
              </dd>
            </template>
          </dl>

          <p
            v-if="selectedItem.note"
            class="whitespace-pre-line rounded-lg border border-hairline bg-surface px-3 py-2.5 text-[13px] text-ink-muted"
          >
            {{ selectedItem.note }}
          </p>

          <div
            v-if="selectedItem.possibleDuplicateOf"
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-400"
          >
            <span class="flex min-w-0 items-center gap-2">
              <UiBaseIcon :path="mdiAlertOutline" :size="14" w="w-3.5" h="h-3.5" class="shrink-0" />
              <span class="min-w-0">
                {{ t('requests.admin.duplicateOf', { title: selectedItem.possibleDuplicateOf.title }) }}
                <span class="text-xs opacity-80">· {{ statusLabel(selectedItem.possibleDuplicateOf.status) }}</span>
              </span>
            </span>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="nd-btn !h-7 !text-xs"
                :disabled="savingId === selectedItem.id"
                @click="dismissDuplicate(selectedItem)"
              >
                {{ t('requests.admin.notDuplicate') }}
              </button>
              <button
                type="button"
                class="nd-btn !h-7 !text-xs"
                :disabled="savingId === selectedItem.id"
                @click="askMerge(selectedItem, selectedItem.possibleDuplicateOf.id, selectedItem.possibleDuplicateOf.title)"
              >
                {{ t('requests.admin.mergeIntoIt') }}
              </button>
            </div>
          </div>

          <section class="space-y-2">
            <h3 class="text-[13px] font-semibold text-ink">{{ t('adminLayout.status') }}</h3>
            <AdminUiSegmented v-model="editDraft.status" :options="statusOptions" />
            <div v-if="editDraft.status === 'DECLINED'" class="space-y-2 pt-1">
              <label class="block">
                <span class="nd-admin-label">{{ t('requests.admin.fields.declineReason') }}</span>
                <input
                  v-model="editDraft.declineReason"
                  maxlength="500"
                  class="nd-input w-full !h-8 !text-[13px]"
                  :aria-label="t('requests.admin.fields.declineReason')"
                >
              </label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="preset in declinePresets"
                  :key="preset"
                  type="button"
                  class="nd-btn !h-7 !text-xs"
                  @click="editDraft.declineReason = preset"
                >
                  {{ preset }}
                </button>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-[13px] font-semibold text-ink">{{ t('requests.admin.sections.details') }}</h3>
            <label class="block">
              <span class="nd-admin-label">{{ t('requests.admin.fields.title') }}</span>
              <input
                v-model="editDraft.title"
                maxlength="180"
                class="nd-input w-full !h-8 !text-[13px]"
                :aria-label="t('requests.admin.fields.title')"
              >
            </label>
            <label class="block">
              <span class="nd-admin-label">{{ t('requests.admin.fields.cover') }}</span>
              <input
                v-model="editDraft.coverUrl"
                maxlength="1000"
                class="nd-input w-full !h-8 font-mono !text-xs"
                placeholder="https://…"
                :aria-label="t('requests.admin.fields.cover')"
              >
            </label>
            <RequestMediaPicker
              :key="selectedItem.id"
              v-model="editDraft.mediaId"
              :label="t('requests.admin.fields.media')"
              :initial-name="selectedItem.media?.name ?? null"
              search-test-id="admin-media-search"
              option-test-id-prefix="admin-media-option"
            />
          </section>

          <section class="rounded-lg border border-hairline">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-ink-muted transition hover:text-ink"
              :aria-expanded="showMerge"
              @click="showMerge = !showMerge"
            >
              <UiBaseIcon
                :path="mdiChevronRight"
                :size="16"
                w="w-4"
                h="h-4"
                class="transition-transform"
                :class="{ 'rotate-90': showMerge }"
              />
              <UiBaseIcon :path="mdiMerge" :size="14" w="w-3.5" h="h-3.5" />
              <span>{{ t('requests.admin.sections.merge') }}</span>
            </button>
            <div v-if="showMerge" class="flex flex-col gap-2 border-t border-hairline p-3 sm:flex-row">
              <input
                v-model="editDraft.mergeInto"
                list="admin-merge-targets"
                class="nd-input flex-1 !h-8 font-mono !text-xs"
                :placeholder="t('requests.admin.mergePlaceholder')"
                :aria-label="t('requests.admin.mergePlaceholder')"
              >
              <datalist id="admin-merge-targets">
                <option v-for="candidate in mergeCandidates" :key="candidate.id" :value="candidate.id">
                  {{ candidate.title }} ({{ statusLabel(candidate.status) }})
                </option>
              </datalist>
              <button
                type="button"
                class="nd-btn !h-8 shrink-0 !text-[13px]"
                :disabled="
                  savingId === selectedItem.id ||
                  !editDraft.mergeInto.trim() ||
                  editDraft.mergeInto.trim() === selectedItem.id
                "
                @click="askMerge(selectedItem, editDraft.mergeInto)"
              >
                {{ t('requests.admin.merge') }}
              </button>
            </div>
          </section>
        </div>

        <div class="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          <button type="button" class="nd-btn !h-8 !text-[13px]" @click="closeDetail">{{ t('common.cancel') }}</button>
          <button
            type="button"
            class="nd-btn-accent !h-8 !text-[13px]"
            :disabled="
              !isDetailDirty ||
              savingId === selectedItem.id ||
              (editDraft.status === 'DECLINED' && !editDraft.declineReason.trim())
            "
            @click="saveDetail"
          >
            <span v-if="savingId === selectedItem.id" class="nd-spinner" />
            {{ t('requests.admin.save') }}
          </button>
        </div>
      </template>
    </CommonBaseModal>

    <!-- Status transition confirmation (In progress / Released / Declined) -->
    <CommonBaseModal
      :open="Boolean(pendingMove)"
      labelledby="admin-move-confirm-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-md flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="pendingMove = null"
    >
      <template v-if="pendingMove">
        <div class="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <h2 id="admin-move-confirm-title" class="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <span class="size-2 rounded-full" :class="statusMeta(pendingMove.targetStatus).dot" aria-hidden="true" />
            <span>{{ t('requests.admin.move.title', { status: statusLabel(pendingMove.targetStatus) }) }}</span>
          </h2>
          <button
            type="button"
            :aria-label="t('common.cancel')"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
            @click="pendingMove = null"
          >
            <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
          </button>
        </div>

        <div class="space-y-4 px-5 py-4">
          <p class="text-[13px] leading-relaxed text-ink-muted">
            <strong class="font-medium text-ink">{{ pendingMove.item.title }}</strong>
            <template v-if="emailsVoters(pendingMove.targetStatus)">
              · {{ t('requests.admin.move.voters', pendingMove.item.voteCount) }}
            </template>
          </p>

          <template v-if="pendingMove.targetStatus === 'DECLINED'">
            <label class="block">
              <span class="nd-admin-label">{{ t('requests.admin.fields.declineReason') }}</span>
              <input
                v-model="pendingMove.declineReason"
                data-autofocus
                maxlength="500"
                class="nd-input w-full !h-8 !text-[13px]"
                :aria-label="t('requests.admin.fields.declineReason')"
              >
            </label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="preset in declinePresets"
                :key="preset"
                type="button"
                class="nd-btn !h-7 !text-xs"
                @click="pendingMove.declineReason = preset"
              >
                {{ preset }}
              </button>
            </div>
          </template>

          <RequestMediaPicker
            v-else
            :key="`${pendingMove.item.id}-${pendingMove.targetStatus}`"
            v-model="pendingMove.mediaId"
            :label="t('requests.admin.fields.mediaOptional')"
            :initial-name="pendingMove.item.media?.name ?? null"
          />
        </div>

        <div class="flex flex-wrap justify-end gap-2 border-t border-hairline px-5 py-3">
          <button type="button" class="nd-btn !h-8 !text-[13px]" @click="pendingMove = null">{{ t('common.cancel') }}</button>
          <button
            v-if="emailsVoters(pendingMove.targetStatus)"
            type="button"
            data-testid="admin-move-quiet"
            class="nd-btn !h-8 !text-[13px]"
            :disabled="savingId === pendingMove.item.id"
            @click="confirmPendingMove(false)"
          >
            {{ t('requests.admin.move.quiet') }}
          </button>
          <button
            type="button"
            data-testid="admin-move-confirm"
            class="!h-8 !text-[13px]"
            :class="pendingMove.targetStatus === 'DECLINED' ? 'nd-btn-danger' : 'nd-btn-accent'"
            :disabled="
              savingId === pendingMove.item.id ||
              (pendingMove.targetStatus === 'DECLINED' && !pendingMove.declineReason.trim())
            "
            @click="confirmPendingMove(true)"
          >
            {{ pendingMove.targetStatus === 'DECLINED' ? t('requests.admin.move.decline') : t('requests.admin.move.email') }}
          </button>
        </div>
      </template>
    </CommonBaseModal>

    <!-- Merge confirmation -->
    <CommonBaseModal
      :open="Boolean(mergeConfirmTarget)"
      labelledby="admin-merge-confirm-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-md flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="mergeConfirmTarget = null"
    >
      <template v-if="mergeConfirmTarget">
        <div class="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <h2 id="admin-merge-confirm-title" class="text-[15px] font-semibold text-ink">
            {{ t('requests.admin.mergeConfirm.title') }}
          </h2>
          <button
            type="button"
            :aria-label="t('common.cancel')"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
            @click="mergeConfirmTarget = null"
          >
            <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
          </button>
        </div>
        <div class="px-5 py-4">
          <p class="text-[13px] leading-relaxed text-ink-muted">
            {{
              t('requests.admin.mergeConfirm.body', {
                source: mergeConfirmTarget.source.title,
                target: mergeConfirmTarget.intoTitle ?? mergeConfirmTarget.intoId,
              })
            }}
          </p>
        </div>
        <div class="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          <button type="button" class="nd-btn !h-8 !text-[13px]" @click="mergeConfirmTarget = null">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="nd-btn-danger !h-8 !text-[13px]"
            :disabled="savingId === mergeConfirmTarget.source.id"
            @click="confirmMerge"
          >
            {{ t('requests.admin.mergeConfirm.confirm') }}
          </button>
        </div>
      </template>
    </CommonBaseModal>
  </div>
</template>
