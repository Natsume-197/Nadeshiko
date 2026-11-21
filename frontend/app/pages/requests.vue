<script setup lang="ts">
import {
  mdiArrowRight,
  mdiBookOpenVariant,
  mdiChevronDoubleUp,
  mdiDeleteOutline,
  mdiFilmstrip,
  mdiMagnify,
  mdiPatreon,
  mdiPlus,
  mdiTelevisionClassic,
  mdiThumbUp,
  mdiThumbUpOutline,
  mdiYoutube,
} from '@mdi/js';
import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import { httpUrl } from '~/utils/strings';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

/**
 * Content requests (task 49): anyone signed in asks for an anime, a drama, an audiobook or a YouTube channel, everyone
 * votes, and patrons boost. The list is public and rendered on the server; what the reader voted for loads after.
 */

type Category = 'ANIME' | 'JDRAMA' | 'YOUTUBE' | 'AUDIOBOOK';
type Status = 'OPEN' | 'PLANNED' | 'IN_PROGRESS' | 'RELEASED' | 'DECLINED';
type ListStatus = 'ACTIVE' | 'RELEASED' | 'DECLINED';
interface ContentRequest {
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
}
interface Allowance {
  isPatron: boolean;
  openCount: number;
  openLimit: number | null;
  boosts: { perMonth: number; used: number; remaining: number; resetsAt: string };
  votedIds: string[];
  boostedIds: string[];
  ownIds: string[];
}

const PAGE_SIZE = 24;
const CATEGORIES: readonly Category[] = ['ANIME', 'JDRAMA', 'AUDIOBOOK', 'YOUTUBE'];
const LIST_STATUSES: readonly ListStatus[] = ['ACTIVE', 'RELEASED', 'DECLINED'];
/**
 * Categories that can be requested but that we cannot ingest yet (decided 2026-11-21: drama requests open anyway, to
 * measure demand). Empty this list when a drama ingest exists.
 */
const NO_INGEST_YET: ReadonlySet<Category> = new Set(['JDRAMA']);
const CATEGORY_ICONS: Record<Category, string> = {
  ANIME: mdiFilmstrip,
  JDRAMA: mdiTelevisionClassic,
  AUDIOBOOK: mdiBookOpenVariant,
  YOUTUBE: mdiYoutube,
};

const { t, locale } = useI18n();
const localePath = useLocalePath();
const user = userStore();
const { openLoginModal } = useLoginModal();

useSeoMeta({
  title: () => t('requests.seoTitle'),
  description: () => t('requests.seoDescription'),
  ogTitle: () => t('requests.seoTitle'),
  ogDescription: () => t('requests.seoDescription'),
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
});

const filters = reactive({
  status: 'ACTIVE' as ListStatus,
  category: null as Category | null,
  sort: 'TOP' as 'TOP' | 'RECENT',
  q: '',
  page: 1,
});
const search = ref('');
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.q = value.trim();
    filters.page = 1;
  }, 300);
});

const { data, error, pending, refresh } = await useAsyncData(
  'content-requests',
  () =>
    $fetch<{ items: ContentRequest[]; total: number }>('/v1/requests', {
      query: {
        status: filters.status,
        sort: filters.sort,
        page: filters.page,
        take: PAGE_SIZE,
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.q ? { q: filters.q } : {}),
      },
    }),
  { watch: [filters] },
);
const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

function setStatus(status: ListStatus) {
  filters.status = status;
  filters.page = 1;
}

function setCategory(category: Category | null) {
  filters.category = category;
  filters.page = 1;
}

// What the signed-in reader voted for, boosted and filed; loaded in the browser only.
const allowance = ref<Allowance | null>(null);
const voted = computed(() => new Set(allowance.value?.votedIds ?? []));
const boosted = computed(() => new Set(allowance.value?.boostedIds ?? []));
const own = computed(() => new Set(allowance.value?.ownIds ?? []));

async function loadAllowance() {
  if (!user.isLoggedIn) {
    allowance.value = null;
    return;
  }
  try {
    allowance.value = await $fetch<Allowance>('/v1/requests/me');
  } catch (caught) {
    handleApiError('requests.allowance', caught, { toastKey: false });
  }
}

onMounted(loadAllowance);
watch(
  () => user.isLoggedIn,
  () => loadAllowance(),
);

// The form.
const formOpen = ref(false);
const sourceUrl = ref('');
const title = ref('');
const note = ref('');
const needsTitle = ref(false);
const formError = ref<string | null>(null);
const submitting = ref(false);
const busyId = ref<string | null>(null);

/** A bare ASIN is accepted and sent as an Audible Japan link. */
function normalizedLink(raw: string): string {
  const value = raw.trim();
  return /^(B0[0-9A-Z]{8}|\d{9}[\dX])$/i.test(value) ? `https://www.audible.co.jp/pd/${value.toUpperCase()}` : value;
}

const SUPPORTED_HOSTS =
  /^(?:www\.|m\.)?(?:anilist\.co|themoviedb\.org|mydramalist\.com|audible\.[a-z.]+|amazon\.[a-z.]+|youtube\.com|youtu\.be|music\.youtube\.com)$/i;

function isSupportedLink(raw: string): boolean {
  try {
    const url = new URL(normalizedLink(raw));
    return (url.protocol === 'https:' || url.protocol === 'http:') && SUPPORTED_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

function openForm() {
  if (!user.isLoggedIn) {
    openLoginModal('content_request');
    return;
  }
  formOpen.value = true;
  nextTick(() => document.getElementById('request-url')?.focus());
}

function resetForm() {
  sourceUrl.value = '';
  title.value = '';
  note.value = '';
  needsTitle.value = false;
  formError.value = null;
}

async function submitRequest() {
  formError.value = null;
  if (!isSupportedLink(sourceUrl.value)) {
    formError.value = t('requests.form.unsupported');
    return;
  }
  submitting.value = true;
  try {
    const result = await $fetch<{ request: ContentRequest; outcome: 'created' | 'voted' | 'already_voted' }>(
      '/v1/requests',
      {
        method: 'POST',
        body: {
          sourceUrl: normalizedLink(sourceUrl.value),
          ...(title.value.trim() ? { title: title.value.trim() } : {}),
          ...(note.value.trim() ? { note: note.value.trim() } : {}),
        },
      },
    );
    useToastSuccess(t(`requests.outcome.${result.outcome}`, { title: result.request.title }));
    resetForm();
    formOpen.value = false;
    filters.status = 'ACTIVE';
    await Promise.all([refresh(), loadAllowance()]);
  } catch (caught) {
    const status = apiErrorStatus(caught);
    if (status === 400) {
      needsTitle.value = true;
      formError.value = t(title.value.trim() ? 'requests.form.unsupported' : 'requests.form.needsTitle');
    } else if (status === 403) {
      formError.value = t('requests.form.limit', {
        limit: allowance.value?.openLimit ?? 10,
      });
    } else {
      handleApiError('requests.create', caught);
    }
  } finally {
    submitting.value = false;
  }
}

function replaceItem(updated: ContentRequest) {
  const list = data.value?.items;
  if (!list) return;
  const index = list.findIndex((item) => item.id === updated.id);
  if (index >= 0) list.splice(index, 1, updated);
}

async function toggleVote(item: ContentRequest) {
  if (!user.isLoggedIn) {
    openLoginModal('content_request');
    return;
  }
  busyId.value = item.id;
  const remove = voted.value.has(item.id);
  try {
    replaceItem(await $fetch<ContentRequest>(`/v1/requests/${item.id}/vote`, { method: remove ? 'DELETE' : 'POST' }));
    await loadAllowance();
  } catch (caught) {
    handleApiError('requests.vote', caught);
  } finally {
    busyId.value = null;
  }
}

async function boost(item: ContentRequest) {
  busyId.value = item.id;
  try {
    replaceItem(await $fetch<ContentRequest>(`/v1/requests/${item.id}/boost`, { method: 'POST' }));
    useToastSuccess(t('requests.boost.done', { title: item.title }));
    await loadAllowance();
  } catch (caught) {
    handleApiError('requests.boost', caught, { toastKey: 'requests.boost.failed' });
  } finally {
    busyId.value = null;
  }
}

async function withdraw(item: ContentRequest) {
  if (!window.confirm(t('requests.withdrawConfirm', { title: item.title }))) return;
  busyId.value = item.id;
  try {
    await $fetch(`/v1/requests/${item.id}`, { method: 'DELETE' });
    await Promise.all([refresh(), loadAllowance()]);
  } catch (caught) {
    handleApiError('requests.withdraw', caught, { toastKey: 'requests.withdrawFailed' });
  } finally {
    busyId.value = null;
  }
}

const canBoost = computed(() => Boolean(allowance.value?.isPatron && allowance.value.boosts.perMonth > 0));
const resetDate = computed(() =>
  allowance.value
    ? new Intl.DateTimeFormat(locale.value, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
        new Date(allowance.value.boosts.resetsAt),
      )
    : '',
);

function canWithdraw(item: ContentRequest) {
  return own.value.has(item.id) && item.status === 'OPEN' && item.voteCount <= 1 && item.boostCount === 0;
}

function statusLabel(status: Status) {
  return t(`requests.status.${status}`);
}
</script>

<template>
  <div class="requests-page -mt-3 pb-16 text-white">
    <section class="border-b border-white/10 bg-[var(--background)] px-4 py-12 md:py-14">
      <div class="nd-page">
        <h1 class="max-w-3xl text-4xl font-black leading-[1.04] tracking-tight md:text-5xl">{{ t('requests.title') }}</h1>
        <p class="mt-5 max-w-2xl text-base leading-relaxed text-white/65 md:text-lg">{{ t('requests.intro') }}</p>
        <div class="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" data-testid="requests-new" class="nd-btn-accent inline-flex h-11 items-center gap-2 px-5" @click="openForm">
            <UiBaseIcon :path="mdiPlus" size="19" /> {{ t('requests.newRequest') }}
          </button>
          <NuxtLink :to="`${localePath('/supporters')}#support`" class="nd-btn inline-flex h-11 items-center gap-2 px-5">
            <UiBaseIcon :path="mdiPatreon" size="18" /> {{ t('requests.boostWithPatreon') }}
          </NuxtLink>
        </div>
        <p v-if="allowance" data-testid="requests-allowance" class="mt-5 text-sm text-white/55">
          <span v-if="allowance.openLimit !== null">{{ t('requests.allowance.open', { count: allowance.openCount, limit: allowance.openLimit }) }}</span>
          <span v-if="allowance.openLimit !== null && canBoost"> · </span>
          <span v-if="canBoost">{{ t('requests.allowance.boosts', { remaining: allowance.boosts.remaining, total: allowance.boosts.perMonth, date: resetDate }) }}</span>
        </p>
      </div>
    </section>

    <section v-if="formOpen" id="request-form" class="border-b border-white/10 bg-[var(--surface)] px-4 py-10">
      <form data-testid="requests-form" class="nd-page mx-auto max-w-2xl space-y-4" @submit.prevent="submitRequest">
        <h2 class="text-2xl font-bold">{{ t('requests.form.heading') }}</h2>
        <p class="text-sm text-white/55">{{ t('requests.form.help') }}</p>
        <label class="block">
          <span class="mb-1.5 block text-sm text-white/65">{{ t('requests.form.url') }}</span>
          <input id="request-url" v-model="sourceUrl" required maxlength="1000" class="nd-input w-full" :placeholder="t('requests.form.urlPlaceholder')">
        </label>
        <label v-if="needsTitle" class="block">
          <span class="mb-1.5 block text-sm text-white/65">{{ t('requests.form.titleLabel') }}</span>
          <input v-model="title" maxlength="180" class="nd-input w-full" data-testid="requests-title">
        </label>
        <label class="block">
          <span class="mb-1.5 block text-sm text-white/65">{{ t('requests.form.note') }}</span>
          <textarea v-model="note" maxlength="1000" rows="3" class="nd-input w-full resize-y" :placeholder="t('requests.form.notePlaceholder')" />
        </label>
        <p v-if="formError" data-testid="requests-form-error" class="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{{ formError }}</p>
        <div class="flex flex-wrap gap-3">
          <button type="submit" class="nd-btn-accent" :disabled="submitting">{{ t('requests.form.submit') }}</button>
          <button type="button" class="nd-btn" @click="formOpen = false">{{ t('requests.form.cancel') }}</button>
        </div>
      </form>
    </section>

    <main class="nd-page px-4 pt-8 md:px-0">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="inline-flex rounded-full bg-white/[0.06] p-1 ring-1 ring-white/10" role="tablist" :aria-label="t('requests.title')">
          <button
            v-for="status in LIST_STATUSES"
            :key="status"
            type="button"
            role="tab"
            :aria-selected="filters.status === status"
            :data-testid="`requests-tab-${status}`"
            class="rounded-full px-4 py-1.5 text-sm font-bold transition"
            :class="filters.status === status ? 'bg-brand-solid text-on-accent shadow' : 'text-white/60 hover:text-white'"
            @click="setStatus(status)"
          >
            {{ t(`requests.tabs.${status}`) }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="relative">
            <span class="sr-only">{{ t('requests.searchLabel') }}</span>
            <UiBaseIcon :path="mdiMagnify" size="18" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input v-model="search" type="search" maxlength="100" class="nd-input w-56 pl-9" :placeholder="t('requests.searchLabel')">
          </label>
          <select v-if="filters.status === 'ACTIVE'" v-model="filters.sort" class="nd-select" :aria-label="t('requests.sortLabel')">
            <option value="TOP">{{ t('requests.sort.TOP') }}</option>
            <option value="RECENT">{{ t('requests.sort.RECENT') }}</option>
          </select>
        </div>
      </div>

      <fieldset class="mt-5 flex flex-wrap gap-2 border-0 p-0">
        <legend class="sr-only">{{ t('requests.categoryLabel') }}</legend>
        <button
          type="button"
          class="rounded-full border px-3 py-1 text-sm font-semibold transition"
          :class="filters.category === null ? 'border-[var(--accent)] text-white' : 'border-white/15 text-white/60 hover:text-white'"
          :aria-pressed="filters.category === null"
          @click="setCategory(null)"
        >
          {{ t('requests.category.ALL') }}
        </button>
        <button
          v-for="category in CATEGORIES"
          :key="category"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold transition"
          :class="filters.category === category ? 'border-[var(--accent)] text-white' : 'border-white/15 text-white/60 hover:text-white'"
          :aria-pressed="filters.category === category"
          :data-testid="`requests-category-${category}`"
          @click="setCategory(category)"
        >
          <UiBaseIcon :path="CATEGORY_ICONS[category]" size="15" /> {{ t(`requests.category.${category}`) }}
        </button>
      </fieldset>

      <div v-if="error" class="mt-8 rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-red-200">{{ t('requests.loadError') }}</div>
      <div v-else-if="pending && !items.length" class="flex justify-center py-16"><span class="nd-spinner" /></div>
      <p v-else-if="!items.length" data-testid="requests-empty" class="mt-8 rounded-lg border border-dashed border-white/10 p-10 text-center text-sm text-white/40">
        {{ t(filters.q ? 'requests.emptySearch' : `requests.empty.${filters.status}`) }}
      </p>

      <ol v-else class="mt-8 grid grid-cols-1 gap-4" data-testid="requests-list">
        <li v-for="(item, index) in items" :key="item.id" :data-testid="`request-${item.id}`" class="flex min-w-0 gap-4 rounded-xl border border-white/10 bg-[var(--surface)] p-4">
          <div class="flex w-14 shrink-0 flex-col items-center gap-1">
            <button
              v-if="filters.status === 'ACTIVE'"
              type="button"
              :data-testid="`request-vote-${item.id}`"
              class="flex flex-col items-center rounded-lg border px-2 py-1.5 transition"
              :class="voted.has(item.id) ? 'border-[var(--accent)] bg-brand/15 text-brand-hover' : 'border-white/15 text-white/70 hover:border-white/40 hover:text-white'"
              :aria-pressed="voted.has(item.id)"
              :aria-label="voted.has(item.id) ? t('requests.unvote') : t('requests.vote')"
              :disabled="busyId === item.id"
              @click="toggleVote(item)"
            >
              <UiBaseIcon :path="voted.has(item.id) ? mdiThumbUp : mdiThumbUpOutline" size="18" />
              <span class="text-sm font-bold">{{ item.score }}</span>
            </button>
            <span v-else class="text-sm font-bold text-white/50">{{ item.score }}</span>
            <span v-if="filters.status === 'ACTIVE' && filters.sort === 'TOP' && filters.page === 1 && index < 3" class="text-[10px] font-bold uppercase tracking-wide text-[var(--accent-soft)]">#{{ index + 1 }}</span>
          </div>

          <img v-if="item.coverUrl" :src="item.coverUrl" alt="" loading="lazy" referrerpolicy="no-referrer" class="hidden h-24 w-16 shrink-0 rounded-md object-cover sm:block">

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 font-semibold text-white/70">
                <UiBaseIcon :path="CATEGORY_ICONS[item.category]" size="13" />{{ t(`requests.category.${item.category}`) }}
              </span>
              <span v-if="item.kind === 'UPDATE'" class="rounded-full bg-sky-500/15 px-2 py-0.5 font-semibold text-sky-200">{{ t('requests.kindUpdate') }}</span>
              <span v-if="NO_INGEST_YET.has(item.category) && item.status !== 'RELEASED' && item.status !== 'DECLINED'" :data-testid="`request-no-ingest-${item.id}`" class="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-200" :title="t('requests.noIngestYetHint')">{{ t('requests.noIngestYet') }}</span>
              <span class="rounded-full px-2 py-0.5 font-semibold" :class="item.status === 'DECLINED' ? 'bg-red-500/15 text-red-200' : item.status === 'RELEASED' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-white/60'">
                {{ statusLabel(item.status) }}
              </span>
            </div>
            <h2 class="mt-1.5 truncate text-lg font-bold" :title="item.title">{{ item.title }}</h2>
            <p v-if="item.note" class="mt-1 line-clamp-2 text-sm text-white/55">{{ item.note }}</p>
            <p v-if="item.declineReason" class="mt-1 text-sm text-red-200/80">{{ t('requests.declinedBecause', { reason: item.declineReason }) }}</p>
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/45">
              <span>{{ t('requests.votes', { count: item.voteCount }) }}<template v-if="item.boostCount"> · {{ t('requests.boosts', { count: item.boostCount }) }}</template></span>
              <a v-if="httpUrl(item.sourceUrl)" :href="httpUrl(item.sourceUrl) ?? undefined" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 font-semibold text-brand hover:text-brand-hover">
                {{ t('requests.viewSource') }} <UiBaseIcon :path="mdiArrowRight" size="13" />
              </a>
              <NuxtLink v-if="item.media" :to="localePath(`/media/${item.media.slug}`)" class="inline-flex items-center gap-1 font-semibold text-brand hover:text-brand-hover">
                {{ item.status === 'RELEASED' ? t('requests.searchIt') : t('requests.onNadeshiko') }} <UiBaseIcon :path="mdiArrowRight" size="13" />
              </NuxtLink>
            </div>
          </div>

          <div v-if="filters.status === 'ACTIVE' && (canBoost || canWithdraw(item))" class="flex shrink-0 flex-col items-end justify-center gap-2">
            <button
              v-if="canBoost"
              type="button"
              :data-testid="`request-boost-${item.id}`"
              class="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition"
              :class="boosted.has(item.id) ? 'border-amber-400/50 text-amber-200' : 'border-white/15 text-white/70 hover:border-amber-400/60 hover:text-amber-200'"
              :disabled="busyId === item.id || boosted.has(item.id) || (allowance?.boosts.remaining ?? 0) === 0"
              :title="boosted.has(item.id) ? t('requests.boost.already') : t('requests.boost.hint')"
              @click="boost(item)"
            >
              <UiBaseIcon :path="mdiChevronDoubleUp" size="15" />{{ boosted.has(item.id) ? t('requests.boost.boosted') : t('requests.boost.action') }}
            </button>
            <button v-if="canWithdraw(item)" type="button" class="inline-flex items-center gap-1 text-xs text-white/45 hover:text-red-200" :disabled="busyId === item.id" @click="withdraw(item)">
              <UiBaseIcon :path="mdiDeleteOutline" size="14" />{{ t('requests.withdraw') }}
            </button>
          </div>
        </li>
      </ol>

      <nav v-if="pageCount > 1" class="mt-8 flex items-center justify-center gap-3" :aria-label="t('requests.pagination')">
        <button type="button" class="nd-btn" :disabled="filters.page <= 1" @click="filters.page--">{{ t('requests.previous') }}</button>
        <span class="text-sm text-white/55">{{ filters.page }} / {{ pageCount }}</span>
        <button type="button" class="nd-btn" :disabled="filters.page >= pageCount" @click="filters.page++">{{ t('requests.next') }}</button>
      </nav>

      <section class="mx-auto mt-14 max-w-3xl rounded-xl border border-white/10 bg-[var(--surface)] p-6 text-sm leading-relaxed text-white/60">
        <h2 class="mb-2 text-base font-bold text-white">{{ t('requests.how.title') }}</h2>
        <ul class="list-disc space-y-1 pl-5">
          <li>{{ t('requests.how.vote') }}</li>
          <li>{{ t('requests.how.boost') }}</li>
          <li>{{ t('requests.how.limits') }}</li>
          <li>{{ t('requests.how.news') }}</li>
        </ul>
      </section>
    </main>
  </div>
</template>
