<script setup lang="ts">
import { handleApiError } from '~/utils/apiError';
import { httpUrl } from '~/utils/strings';

/**
 * Admin side of content requests (task 49): triage by score, move requests between statuses (IN_PROGRESS and
 * RELEASED email the voters), decline with a public reason, link the published media, and merge duplicates.
 * English only, like the rest of the admin panel.
 */

type Category = 'ANIME' | 'JDRAMA' | 'YOUTUBE' | 'AUDIOBOOK';
type Status = 'OPEN' | 'PLANNED' | 'IN_PROGRESS' | 'RELEASED' | 'DECLINED';
interface AdminRequest {
  id: string;
  category: Category;
  kind: 'NEW' | 'UPDATE';
  status: Status;
  title: string;
  note: string;
  sourceUrl: string;
  coverUrl: string | null;
  declineReason: string | null;
  voteCount: number;
  boostCount: number;
  score: number;
  media: { id: string; slug: string; name: string } | null;
  createdAt: string;
  releasedAt: string | null;
  externalSource: string | null;
  externalId: string | null;
  requester: { id: number; username: string } | null;
  possibleDuplicateOf: { id: string; title: string; status: Status } | null;
}
interface Draft {
  status: Status;
  title: string;
  declineReason: string;
  mediaId: string;
  mergeInto: string;
}

const STATUSES: readonly Status[] = ['OPEN', 'PLANNED', 'IN_PROGRESS', 'RELEASED', 'DECLINED'];
const CATEGORIES: readonly Category[] = ['ANIME', 'JDRAMA', 'AUDIOBOOK', 'YOUTUBE'];
const PAGE_SIZE = 50;

const filters = reactive({ status: 'OPEN' as Status | '', category: '' as Category | '', flagged: false, q: '' });
const page = ref(1);
const items = ref<AdminRequest[]>([]);
const total = ref(0);
const loading = ref(true);
const savingId = ref<string | null>(null);
const drafts = reactive<Record<string, Draft>>({});

function draftFor(item: AdminRequest): Draft {
  const existing = drafts[item.id];
  if (existing) return existing;
  const draft: Draft = {
    status: item.status,
    title: item.title,
    declineReason: item.declineReason ?? '',
    mediaId: item.media?.id ?? '',
    mergeInto: item.possibleDuplicateOf?.id ?? '',
  };
  drafts[item.id] = draft;
  return drafts[item.id] ?? draft;
}

async function load() {
  loading.value = true;
  try {
    const response = await $fetch<{ items: AdminRequest[]; total: number }>('/v1/admin/requests', {
      query: {
        page: page.value,
        take: PAGE_SIZE,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.flagged ? { flagged: true } : {}),
        ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
      },
    });
    items.value = response.items;
    total.value = response.total;
    for (const key of Object.keys(drafts)) delete drafts[key];
  } catch (error) {
    handleApiError('admin.requests.load', error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(
  () => ({ ...filters }),
  () => {
    page.value = 1;
    load();
  },
);
watch(page, load);

function replace(updated: AdminRequest) {
  const index = items.value.findIndex((item) => item.id === updated.id);
  if (index >= 0) items.value.splice(index, 1, updated);
  delete drafts[updated.id];
}

async function save(item: AdminRequest) {
  const draft = draftFor(item);
  if (draft.status !== item.status && (draft.status === 'IN_PROGRESS' || draft.status === 'RELEASED')) {
    const ok = window.confirm(
      `Move “${item.title}” to ${draft.status.replace('_', ' ')}? Everyone who voted for it (${item.voteCount}) gets an email.`,
    );
    if (!ok) return;
  }
  savingId.value = item.id;
  try {
    replace(
      await $fetch<AdminRequest>(`/v1/admin/requests/${item.id}`, {
        method: 'PATCH',
        body: {
          status: draft.status,
          title: draft.title,
          declineReason: draft.declineReason.trim() || null,
          mediaId: draft.mediaId.trim() || null,
        },
      }),
    );
    useToastSuccess('Request saved.');
  } catch (error) {
    handleApiError('admin.requests.save', error);
  } finally {
    savingId.value = null;
  }
}

async function dismissDuplicate(item: AdminRequest) {
  savingId.value = item.id;
  try {
    replace(
      await $fetch<AdminRequest>(`/v1/admin/requests/${item.id}`, {
        method: 'PATCH',
        body: { dismissDuplicate: true },
      }),
    );
  } catch (error) {
    handleApiError('admin.requests.dismiss', error);
  } finally {
    savingId.value = null;
  }
}

async function merge(item: AdminRequest) {
  const into = draftFor(item).mergeInto.trim();
  if (!into) return;
  if (!window.confirm(`Merge “${item.title}” into ${into}? Its votes and boosts move over and it is declined.`)) return;
  savingId.value = item.id;
  try {
    await $fetch(`/v1/admin/requests/${item.id}/merge`, { method: 'POST', body: { intoId: into } });
    useToastSuccess('Requests merged.');
    await load();
  } catch (error) {
    handleApiError('admin.requests.merge', error);
  } finally {
    savingId.value = null;
  }
}

/** The admin panel is English only, so its dates are too. */
const dateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
function formatDate(value: string) {
  return dateFormat.format(new Date(value));
}
</script>

<template>
  <div class="space-y-3 text-white">
    <div class="nd-settings-card space-y-4">
      <div>
        <h1 class="nd-settings-title">Content requests</h1>
        <p class="mt-1 text-sm text-white/45">
          Sorted by score (votes + 5 per boost). Moving a request to In progress or Released emails its voters; ingest
          moves matching requests to In progress on its own when it creates the media. Release after production is checked.
        </p>
      </div>
      <div class="grid gap-2 md:grid-cols-4">
        <select v-model="filters.status" class="nd-select" aria-label="Status">
          <option value="">All statuses</option>
          <option v-for="status in STATUSES" :key="status" :value="status">{{ status.replace('_', ' ') }}</option>
        </select>
        <select v-model="filters.category" class="nd-select" aria-label="Category">
          <option value="">All categories</option>
          <option v-for="category in CATEGORIES" :key="category" :value="category">{{ category }}</option>
        </select>
        <input v-model.lazy="filters.q" type="search" class="nd-input" placeholder="Title" aria-label="Title">
        <label class="flex items-center gap-2 text-sm text-white/70"><input v-model="filters.flagged" type="checkbox"> Possible duplicates only</label>
      </div>
      <p class="text-xs text-white/40">{{ total }} requests</p>
    </div>

    <div v-if="loading" class="nd-settings-card flex justify-center"><span class="nd-spinner" /></div>
    <div v-else-if="!items.length" class="nd-settings-card text-center text-white/40">No requests match.</div>
    <template v-else>
      <article v-for="item in items" :key="item.id" :data-testid="`admin-request-${item.id}`" class="nd-settings-card">
        <div class="flex gap-4">
          <img v-if="item.coverUrl" :src="item.coverUrl" alt="" class="hidden h-24 w-16 shrink-0 rounded object-cover sm:block" referrerpolicy="no-referrer">
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-white/55">
              <span class="font-bold text-white">{{ item.score }}</span>
              <span>({{ item.voteCount }} votes, {{ item.boostCount }} boosts)</span>
              <span class="rounded bg-white/10 px-1.5 py-0.5">{{ item.category }}</span>
              <span class="rounded bg-white/10 px-1.5 py-0.5">{{ item.kind }}</span>
              <span>{{ formatDate(item.createdAt) }}</span>
              <span v-if="item.requester">by {{ item.requester.username }} (#{{ item.requester.id }})</span>
              <span v-if="item.externalSource" class="font-mono">{{ item.externalSource }} {{ item.externalId }}</span>
              <a v-if="httpUrl(item.sourceUrl)" :href="httpUrl(item.sourceUrl) ?? undefined" target="_blank" rel="noopener" class="text-red-300 hover:text-red-200">Open link ↗</a>
              <span class="font-mono text-white/30">{{ item.id }}</span>
            </div>
            <p v-if="item.note" class="whitespace-pre-line text-sm text-white/65">{{ item.note }}</p>
            <div v-if="item.possibleDuplicateOf" class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              Possible duplicate of “{{ item.possibleDuplicateOf.title }}” ({{ item.possibleDuplicateOf.status }}, {{ item.possibleDuplicateOf.id }}).
              <button type="button" class="underline" :disabled="savingId === item.id" @click="dismissDuplicate(item)">Not a duplicate</button>
            </div>
            <div class="grid gap-2 md:grid-cols-2">
              <input v-model="draftFor(item).title" maxlength="180" class="nd-input md:col-span-2" aria-label="Title">
              <select v-model="draftFor(item).status" class="nd-select" aria-label="Status">
                <option v-for="status in STATUSES" :key="status" :value="status">{{ status.replace('_', ' ') }}</option>
              </select>
              <input v-model="draftFor(item).mediaId" maxlength="32" class="nd-input" placeholder="Media public id (once on Nadeshiko)" aria-label="Media public id">
              <input v-if="draftFor(item).status === 'DECLINED'" v-model="draftFor(item).declineReason" maxlength="500" class="nd-input md:col-span-2" placeholder="Why (shown publicly), e.g. No Japanese subtitles exist." aria-label="Decline reason">
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <input v-model="draftFor(item).mergeInto" class="nd-input w-80 max-w-full font-mono text-xs" placeholder="Merge into request id" aria-label="Merge into request id">
                <button type="button" class="nd-btn" :disabled="savingId === item.id || !draftFor(item).mergeInto.trim()" @click="merge(item)">Merge</button>
              </div>
              <button type="button" class="nd-btn-accent" :disabled="savingId === item.id" @click="save(item)">Save</button>
            </div>
          </div>
        </div>
      </article>
      <nav v-if="total > PAGE_SIZE" class="flex items-center justify-center gap-3">
        <button type="button" class="nd-btn" :disabled="page <= 1" @click="page--">Previous</button>
        <span class="text-sm text-white/55">{{ page }} / {{ Math.ceil(total / PAGE_SIZE) }}</span>
        <button type="button" class="nd-btn" :disabled="page * PAGE_SIZE >= total" @click="page++">Next</button>
      </nav>
    </template>
  </div>
</template>
