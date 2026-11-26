<script setup lang="ts">
import {
  mdiAlertOutline,
  mdiCheck,
  mdiChevronDoubleUp,
  mdiClose,
  mdiContentCopy,
  mdiMagnify,
  mdiMerge,
  mdiOpenInNew,
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

/**
 * Admin side of content requests (task 49): Trello-style Kanban board for triaging by score, moving requests across
 * statuses (IN_PROGRESS and RELEASED email voters), declining with a public reason, linking published media, and
 * merging duplicates. English only, like the rest of the admin panel.
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
  label: string;
  dot: string;
  columnGlow: string;
}> = [
  {
    status: 'OPEN',
    label: 'Open',
    dot: 'bg-ink-faint',
    columnGlow: 'border-brand/60 bg-brand/[0.04]',
  },
  {
    status: 'PLANNED',
    label: 'Planned',
    dot: 'bg-sky-400',
    columnGlow: 'border-sky-400/60 bg-sky-500/[0.05]',
  },
  {
    status: 'IN_PROGRESS',
    label: 'In progress',
    dot: 'bg-violet-400',
    columnGlow: 'border-violet-400/60 bg-violet-500/[0.05]',
  },
  {
    status: 'RELEASED',
    label: 'Released',
    dot: 'bg-emerald-400',
    columnGlow: 'border-emerald-400/60 bg-emerald-500/[0.05]',
  },
  {
    status: 'DECLINED',
    label: 'Declined',
    dot: 'bg-red-400',
    columnGlow: 'border-red-400/60 bg-red-500/[0.05]',
  },
];

const STATUS_META_BY_STATUS = Object.fromEntries(STATUS_META.map((meta) => [meta.status, meta])) as Record<
  Status,
  (typeof STATUS_META)[number]
>;

const CATEGORY_LABELS: Record<Category, string> = {
  ANIME: 'Anime',
  JDRAMA: 'Dramas',
  AUDIOBOOK: 'Audiobooks',
  YOUTUBE: 'YouTube',
};
const DECLINE_PRESETS = [
  'No Japanese subtitles exist.',
  'Already on Nadeshiko.',
  'Unsupported source or format.',
] as const;

const BOARD_TAKE = 100;

const localePath = useLocalePath();

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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function formatShortDate(value: string) {
  return formatRequestDate(value, 'en');
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
  const updated = await patchRequest(item, { status: targetStatus }, `Moved to ${statusMeta(targetStatus).label}.`);
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
    `Moved to ${statusMeta(move.targetStatus).label}${quiet ? ', no email sent' : ''}.`,
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
    'Request saved.',
  );
  if (updated) closeDetail();
}

async function dismissDuplicate(item: AdminRequest) {
  await patchRequest(item, { dismissDuplicate: true }, 'Duplicate flag dismissed.');
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
    useToastSuccess('Requests merged.');
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
  <div class="space-y-4 text-ink">
    <div class="nd-settings-card space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-baseline gap-2">
            <h1 class="text-xl font-bold tracking-tight text-ink">Content requests</h1>
            <span class="text-xs font-medium text-ink-faint tabular-nums">{{ total }}</span>
          </div>
          <p class="mt-1 text-sm text-ink-muted">
            Drag cards across columns to triage. Moving a request to In progress or Released asks whether to email its voters.
          </p>
        </div>

        <NuxtLink
          :to="localePath('/requests')"
          class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-background/50 px-3 text-xs font-semibold text-ink-muted transition hover:border-line-hover hover:bg-surface-hover hover:text-ink"
        >
          <span>Public board</span>
          <UiBaseIcon :path="mdiOpenInNew" w="w-3.5" h="h-3.5" size="13" />
        </NuxtLink>
      </div>

      <div class="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <fieldset class="flex flex-wrap items-center gap-1 border-0 p-0">
          <legend class="sr-only">Filter by category</legend>
          <button
            type="button"
            class="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium transition-colors"
            :class="
              filters.category === ''
                ? 'bg-lift-strong text-ink'
                : 'text-ink-muted hover:bg-lift hover:text-ink'
            "
            :aria-pressed="filters.category === ''"
            @click="filters.category = ''"
          >
            All
          </button>
          <button
            v-for="category in CATEGORIES"
            :key="category"
            type="button"
            :data-testid="`admin-category-${category}`"
            class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors"
            :class="
              filters.category === category
                ? 'bg-lift-strong text-ink'
                : 'text-ink-muted hover:bg-lift hover:text-ink'
            "
            :aria-pressed="filters.category === category"
            @click="filters.category = category"
          >
            <UiBaseIcon :path="CATEGORY_ICONS[category]" w="w-3.5" h="h-3.5" size="14" />
            <span>{{ CATEGORY_LABELS[category] }}</span>
          </button>
        </fieldset>

        <label class="relative block w-full xl:w-64">
          <span class="sr-only">Filter by title</span>
          <UiBaseIcon
            :path="mdiMagnify"
            w="w-4"
            h="h-4"
            size="16"
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            v-model="searchInput"
            type="text"
            inputmode="search"
            class="nd-input w-full pl-9"
            :class="searchInput ? 'pr-8' : ''"
            placeholder="Search title…"
            aria-label="Search title"
          >
          <button
            v-if="searchInput"
            type="button"
            class="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition hover:bg-lift hover:text-ink"
            aria-label="Clear search"
            @click="clearSearch"
          >
            <UiBaseIcon :path="mdiClose" w="w-4" h="h-4" size="15" />
          </button>
        </label>
      </div>
    </div>

    <div v-if="loading && !hasLoadedOnce" class="nd-settings-card flex justify-center py-12">
      <span class="nd-spinner" />
    </div>

    <!-- Trello / Kanban Board View -->
    <div
      v-else
      data-testid="admin-requests-board"
      class="flex min-h-[24rem] items-start gap-3 overflow-x-auto pb-3 transition-opacity duration-150"
      :class="loading ? 'opacity-65' : 'opacity-100'"
    >
      <div
        v-for="col in STATUS_META"
        :key="col.status"
        :data-testid="`admin-column-${col.status}`"
        role="listbox"
        :aria-label="`${col.label} requests`"
        class="flex w-[268px] shrink-0 flex-col rounded-xl border p-2.5 transition-colors"
        :class="dragOverStatus === col.status ? col.columnGlow : 'border-hairline bg-surface/60'"
        @dragover.prevent="onDragOver(col.status)"
        @dragleave="onDragLeave(col.status)"
        @drop.prevent="onDrop(col.status)"
      >
        <header class="mb-2.5 flex items-center justify-between px-1">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full" :class="col.dot" aria-hidden="true" />
            <h2 class="text-xs font-bold uppercase tracking-wider text-ink-muted">{{ col.label }}</h2>
          </div>
          <span class="text-xs font-medium text-ink-faint tabular-nums">
            {{ itemsByStatus[col.status].length }}
          </span>
        </header>

        <div class="flex min-h-[7rem] flex-col gap-2">
          <div
            v-for="item in itemsByStatus[col.status]"
            :key="item.id"
            :data-testid="`admin-request-${item.id}`"
            role="option"
            :aria-selected="selectedItem?.id === item.id"
            draggable="true"
            tabindex="0"
            class="group cursor-pointer rounded-xl border border-hairline bg-surface p-3 shadow-sm transition hover:border-line-hover hover:bg-surface-hover/70"
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
                icon-size="18"
                class="h-14 w-11 rounded-md"
              />

              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-1.5">
                  <span class="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                    <UiBaseIcon :path="CATEGORY_ICONS[item.category]" w="w-3" h="h-3" size="12" />
                    <span class="truncate">{{ CATEGORY_LABELS[item.category] }}</span>
                    <template v-if="item.kind === 'UPDATE'">
                      <span aria-hidden="true">·</span>
                      <span class="normal-case tracking-normal text-ink-muted">Update</span>
                    </template>
                  </span>
                  <span
                    class="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold tabular-nums"
                    :class="item.boostCount > 0 ? 'text-amber-300' : 'text-ink-muted'"
                    :title="`${plural(item.voteCount, 'vote', 'votes')}${item.boostCount ? ` + ${plural(item.boostCount, 'boost', 'boosts')} (+${item.boostCount * REQUEST_BOOST_WEIGHT})` : ''}`"
                  >
                    <UiBaseIcon :path="item.boostCount > 0 ? mdiChevronDoubleUp : mdiThumbUpOutline" w="w-3.5" h="h-3.5" size="12" />
                    {{ item.score }}
                  </span>
                </div>

                <h3 class="mt-1 line-clamp-2 text-[13px] font-bold leading-snug text-ink" :title="item.title">
                  {{ item.title }}
                </h3>
              </div>
            </div>

            <p v-if="item.note" class="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-muted">
              {{ item.note }}
            </p>
            <p v-if="item.declineReason" class="mt-1.5 line-clamp-2 text-xs leading-relaxed text-red-300/90">
              {{ item.declineReason }}
            </p>

            <div
              v-if="item.possibleDuplicateOf"
              class="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-200"
            >
              <UiBaseIcon :path="mdiAlertOutline" w="w-3.5" h="h-3.5" size="13" class="shrink-0 text-amber-400" />
              <span class="truncate">Dup: {{ item.possibleDuplicateOf.title }}</span>
            </div>

            <div class="mt-2.5 flex items-center justify-between gap-2 border-t border-hairline/70 pt-2 text-[11px] text-ink-faint">
              <span class="truncate">
                <template v-if="item.requester">{{ item.requester.username }} · </template>
                {{ formatShortDate(item.createdAt) }}
              </span>
              <a
                v-if="httpUrl(item.sourceUrl)"
                :href="httpUrl(item.sourceUrl) ?? undefined"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex shrink-0 items-center gap-0.5 font-medium text-ink-faint transition hover:text-ink"
                title="Open source link"
                @click.stop
              >
                <UiBaseIcon :path="mdiOpenInNew" w="w-3.5" h="h-3.5" size="13" />
              </a>
            </div>
          </div>

          <div
            v-if="!itemsByStatus[col.status].length"
            class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-hairline px-3 py-8 text-center text-xs text-ink-faint"
          >
            {{ draggingId ? `Drop to move to ${col.label}` : 'No requests' }}
          </div>
        </div>
      </div>
    </div>

    <nav v-if="total > BOARD_TAKE" class="flex items-center justify-center gap-3 pt-1">
      <button type="button" class="nd-btn" :disabled="page <= 1" @click="page--">Previous</button>
      <span class="text-sm text-ink-muted tabular-nums">{{ page }} / {{ Math.ceil(total / BOARD_TAKE) }}</span>
      <button type="button" class="nd-btn" :disabled="page * BOARD_TAKE >= total" @click="page++">Next</button>
    </nav>

    <!-- Card Detail / Edit Modal -->
    <CommonBaseModal
      :open="Boolean(selectedItem)"
      labelledby="admin-request-detail-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="closeDetail"
    >
      <template v-if="selectedItem">
        <div class="nd-modal-header">
          <div class="flex min-w-0 items-center gap-2">
            <h2 id="admin-request-detail-title" class="truncate font-bold text-ink">Manage request</h2>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-0.5 font-mono text-[11px] text-ink-faint transition hover:border-line-hover hover:text-ink"
              :title="`Copy request ID: ${selectedItem.id}`"
              @click="copyId(selectedItem.id)"
            >
              <UiBaseIcon :path="copiedId === selectedItem.id ? mdiCheck : mdiContentCopy" w="w-3" h="h-3" size="12" />
              <span>{{ copiedId === selectedItem.id ? 'Copied' : selectedItem.id.slice(0, 8) }}</span>
            </button>
          </div>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="closeDetail"
          >
            <span class="sr-only">Close</span>
            <UiBaseIcon :path="mdiClose" :size="18" />
          </button>
        </div>

        <div class="flex flex-col gap-5 p-5">
          <div class="flex gap-3.5">
            <RequestCover
              :category="selectedItem.category"
              :cover-url="selectedItem.coverUrl"
              :lazy="false"
              class="h-20 w-16 rounded-lg bg-surface"
            />

            <div class="min-w-0 flex-1 space-y-1 text-xs text-ink-muted">
              <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span class="font-bold text-ink tabular-nums">Score {{ selectedItem.score }}</span>
                <span>({{ plural(selectedItem.voteCount, 'vote', 'votes') }}, {{ plural(selectedItem.boostCount, 'boost', 'boosts') }})</span>
                <span aria-hidden="true">·</span>
                <span class="font-semibold text-ink-muted">{{ CATEGORY_LABELS[selectedItem.category] }}</span>
              </div>
              <p class="text-ink-faint">
                {{ formatShortDate(selectedItem.createdAt) }}
                <template v-if="selectedItem.requester"> · by {{ selectedItem.requester.username }} (#{{ selectedItem.requester.id }})</template>
              </p>
              <div class="flex flex-wrap items-center gap-3 pt-0.5">
                <span v-if="selectedItem.externalSource" class="font-mono text-ink-faint">
                  {{ selectedItem.externalSource }} {{ selectedItem.externalId }}
                </span>
                <a
                  v-if="httpUrl(selectedItem.sourceUrl)"
                  :href="httpUrl(selectedItem.sourceUrl) ?? undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 font-semibold text-brand hover:text-brand-hover"
                >
                  <span>Open source</span>
                  <UiBaseIcon :path="mdiOpenInNew" w="w-3" h="h-3" size="12" />
                </a>
              </div>
            </div>
          </div>

          <p v-if="selectedItem.note" class="rounded-lg border border-hairline bg-surface px-3.5 py-2.5 text-sm whitespace-pre-line text-ink-muted">
            {{ selectedItem.note }}
          </p>

          <div
            v-if="selectedItem.possibleDuplicateOf"
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-200"
          >
            <span>
              Possible duplicate of <strong>“{{ selectedItem.possibleDuplicateOf.title }}”</strong>
              ({{ statusMeta(selectedItem.possibleDuplicateOf.status).label }}).
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-md bg-amber-500/20 px-2.5 py-1 font-semibold text-amber-100 transition hover:bg-amber-500/30"
                :disabled="savingId === selectedItem.id"
                @click="askMerge(selectedItem, selectedItem.possibleDuplicateOf.id, selectedItem.possibleDuplicateOf.title)"
              >
                Merge into it
              </button>
              <button
                type="button"
                class="underline text-amber-200/80 hover:text-amber-100"
                :disabled="savingId === selectedItem.id"
                @click="dismissDuplicate(selectedItem)"
              >
                Not a duplicate
              </button>
            </div>
          </div>

          <div class="space-y-4">
            <fieldset class="border-0 p-0">
              <legend class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-faint">Status</legend>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="meta in STATUS_META"
                  :key="meta.status"
                  type="button"
                  class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition"
                  :class="
                    editDraft.status === meta.status
                      ? 'border-line-hover bg-lift-strong text-ink shadow-sm'
                      : 'border-hairline bg-surface text-ink-muted hover:border-line-hover hover:text-ink'
                  "
                  :aria-pressed="editDraft.status === meta.status"
                  @click="editDraft.status = meta.status"
                >
                  <span class="size-2 rounded-full" :class="meta.dot" aria-hidden="true" />
                  <span>{{ meta.label }}</span>
                </button>
              </div>
            </fieldset>

            <label class="block">
              <span class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-faint">Title</span>
              <input v-model="editDraft.title" maxlength="180" class="nd-input w-full" aria-label="Title">
            </label>

            <label class="block">
              <span class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-faint">Cover image URL</span>
              <input
                v-model="editDraft.coverUrl"
                maxlength="1000"
                class="nd-input w-full font-mono text-xs"
                placeholder="https://…"
                aria-label="Cover image URL"
              >
            </label>

            <RequestMediaPicker
              :key="selectedItem.id"
              v-model="editDraft.mediaId"
              label="Linked Nadeshiko media"
              :initial-name="selectedItem.media?.name ?? null"
              search-test-id="admin-media-search"
              option-test-id-prefix="admin-media-option"
              side-by-side
            />

            <div v-if="editDraft.status === 'DECLINED'" class="space-y-2">
              <label class="block">
                <span class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  Decline reason (shown publicly)
                </span>
                <input
                  v-model="editDraft.declineReason"
                  maxlength="500"
                  class="nd-input w-full"
                  placeholder="e.g. No Japanese subtitles exist."
                  aria-label="Decline reason"
                >
              </label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="preset in DECLINE_PRESETS"
                  :key="preset"
                  type="button"
                  class="rounded-md border border-hairline bg-surface px-2 py-1 text-[11px] text-ink-muted transition hover:border-line-hover hover:text-ink"
                  @click="editDraft.declineReason = preset"
                >
                  {{ preset }}
                </button>
              </div>
            </div>

            <div class="flex justify-end gap-2">
              <button type="button" class="nd-btn" @click="closeDetail">Cancel</button>
              <button
                type="button"
                class="nd-btn-accent"
                :disabled="!isDetailDirty || savingId === selectedItem.id || (editDraft.status === 'DECLINED' && !editDraft.declineReason.trim())"
                @click="saveDetail"
              >
                Save changes
              </button>
            </div>
          </div>

          <div class="border-t border-hairline pt-4">
            <span class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              <UiBaseIcon :path="mdiMerge" w="w-3.5" h="h-3.5" size="14" />
              <span>Merge duplicate into another request</span>
            </span>
            <div class="flex flex-col gap-2 sm:flex-row">
              <input
                v-model="editDraft.mergeInto"
                list="admin-merge-targets"
                class="nd-input flex-1 font-mono text-xs"
                placeholder="Pick a request or paste its UUID"
                aria-label="Merge into request id"
              >
              <datalist id="admin-merge-targets">
                <option v-for="candidate in mergeCandidates" :key="candidate.id" :value="candidate.id">
                  {{ candidate.title }} ({{ statusMeta(candidate.status).label }})
                </option>
              </datalist>
              <button
                type="button"
                class="nd-btn shrink-0"
                :disabled="savingId === selectedItem.id || !editDraft.mergeInto.trim() || editDraft.mergeInto.trim() === selectedItem.id"
                @click="askMerge(selectedItem, editDraft.mergeInto)"
              >
                Merge
              </button>
            </div>
          </div>
        </div>
      </template>
    </CommonBaseModal>

    <!-- Status Transition Confirmation Modal (In progress / Released / Declined) -->
    <CommonBaseModal
      :open="Boolean(pendingMove)"
      labelledby="admin-move-confirm-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-md flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="pendingMove = null"
    >
      <template v-if="pendingMove">
        <div class="nd-modal-header">
          <h2 id="admin-move-confirm-title" class="flex items-center gap-2 font-bold text-ink">
            <span class="size-2.5 rounded-full" :class="statusMeta(pendingMove.targetStatus).dot" aria-hidden="true" />
            <span>Move to {{ statusMeta(pendingMove.targetStatus).label }}</span>
          </h2>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="pendingMove = null"
          >
            <span class="sr-only">Cancel</span>
            <UiBaseIcon :path="mdiClose" :size="18" />
          </button>
        </div>

        <div class="flex flex-col gap-4 p-5">
          <p v-if="pendingMove.targetStatus === 'DECLINED'" class="text-sm leading-relaxed text-ink-muted">
            Provide a public reason for declining <strong class="text-ink">“{{ pendingMove.item.title }}”</strong>.
          </p>
          <p v-else class="text-sm leading-relaxed text-ink-muted">
            Move <strong class="text-ink">“{{ pendingMove.item.title }}”</strong> to
            <strong class="text-ink">{{ statusMeta(pendingMove.targetStatus).label }}</strong>?
            Email {{ plural(pendingMove.item.voteCount, 'voter', 'voters') }}?
          </p>

          <template v-if="pendingMove.targetStatus === 'DECLINED'">
            <input
              v-model="pendingMove.declineReason"
              data-autofocus
              maxlength="500"
              class="nd-input w-full"
              placeholder="e.g. No Japanese subtitles exist."
              aria-label="Decline reason"
            >
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="preset in DECLINE_PRESETS"
                :key="preset"
                type="button"
                class="rounded-md border border-hairline bg-surface px-2 py-1 text-[11px] text-ink-muted transition hover:border-line-hover hover:text-ink"
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
            label="Link Nadeshiko media (optional)"
            :initial-name="pendingMove.item.media?.name ?? null"
            search-placeholder="Search Nadeshiko media by title…"
          />

          <div class="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" class="nd-btn" @click="pendingMove = null">Cancel</button>
            <button
              v-if="emailsVoters(pendingMove.targetStatus)"
              type="button"
              data-testid="admin-move-quiet"
              class="nd-btn"
              :disabled="savingId === pendingMove.item.id"
              @click="confirmPendingMove(false)"
            >
              Move without email
            </button>
            <button
              type="button"
              data-testid="admin-move-confirm"
              :class="pendingMove.targetStatus === 'DECLINED' ? 'nd-btn-danger' : 'nd-btn-accent'"
              :disabled="
                savingId === pendingMove.item.id ||
                (pendingMove.targetStatus === 'DECLINED' && !pendingMove.declineReason.trim())
              "
              @click="confirmPendingMove(true)"
            >
              {{ pendingMove.targetStatus === 'DECLINED' ? 'Decline request' : 'Move and email' }}
            </button>
          </div>
        </div>
      </template>
    </CommonBaseModal>

    <!-- Merge Confirmation Modal -->
    <CommonBaseModal
      :open="Boolean(mergeConfirmTarget)"
      labelledby="admin-merge-confirm-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-md flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="mergeConfirmTarget = null"
    >
      <template v-if="mergeConfirmTarget">
        <div class="nd-modal-header">
          <h2 id="admin-merge-confirm-title" class="font-bold text-ink">Merge requests?</h2>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="mergeConfirmTarget = null"
          >
            <span class="sr-only">Cancel</span>
            <UiBaseIcon :path="mdiClose" :size="18" />
          </button>
        </div>
        <div class="flex flex-col gap-4 p-5">
          <p class="text-sm leading-relaxed text-ink-muted">
            Merge <strong class="text-ink">“{{ mergeConfirmTarget.source.title }}”</strong> into
            <strong class="text-ink">{{ mergeConfirmTarget.intoTitle ? `“${mergeConfirmTarget.intoTitle}”` : mergeConfirmTarget.intoId }}</strong>?
            Its votes and boosts move over and this request is declined.
          </p>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="nd-btn" @click="mergeConfirmTarget = null">Cancel</button>
            <button
              type="button"
              class="nd-btn-danger"
              :disabled="savingId === mergeConfirmTarget.source.id"
              @click="confirmMerge"
            >
              Merge requests
            </button>
          </div>
        </div>
      </template>
    </CommonBaseModal>
  </div>
</template>
