<script setup lang="ts">
import {
  mdiArrowRight,
  mdiChevronDoubleUp,
  mdiClockOutline,
  mdiClose,
  mdiDeleteOutline,
  mdiEmailOutline,
  mdiFire,
  mdiHelpCircleOutline,
  mdiLayersOutline,
  mdiLockOutline,
  mdiMagnify,
  mdiOpenInNew,
  mdiPatreon,
  mdiPlus,
  mdiThumbUp,
  mdiThumbUpOutline,
  mdiViewColumnOutline,
} from '@mdi/js';
import RequestCover from '~/components/requests/RequestCover.vue';
import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import {
  REQUEST_CATEGORIES as CATEGORIES,
  REQUEST_CATEGORY_ICONS as CATEGORY_ICONS,
  type RequestCategory as Category,
  type RequestStatus as Status,
} from '~/utils/contentRequests';
import { httpUrl } from '~/utils/strings';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

/**
 * Content requests (task 49): anyone signed in asks for an anime, a drama, an audiobook or a YouTube channel, everyone
 * votes, and patrons boost. The list is public and rendered on the server; what the reader voted for loads after.
 */

type PublicTab = 'ACTIVE' | 'IN_PROGRESS' | 'RELEASED' | 'DECLINED';
type PersonalTab = 'MINE' | 'VOTED';
type PersonalStatus = 'ALL' | PublicTab;
type ListStatus = PublicTab | PersonalTab;
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
  ownCount?: number;
  votedCount?: number;
  boosts: { perMonth: number; used: number; remaining: number; resetsAt: string };
  votedIds: string[];
  boostedIds: string[];
  ownIds: string[];
}

const PAGE_SIZE = 24;
const BOOST_WEIGHT = 5;
const PUBLIC_TABS: readonly PublicTab[] = ['ACTIVE', 'IN_PROGRESS', 'RELEASED', 'DECLINED'];
const PERSONAL_TABS: readonly PersonalTab[] = ['MINE', 'VOTED'];
const PERSONAL_STATUSES: readonly PersonalStatus[] = ['ALL', 'ACTIVE', 'IN_PROGRESS', 'RELEASED', 'DECLINED'];

function isPersonalTab(status: ListStatus): status is PersonalTab {
  return status === 'MINE' || status === 'VOTED';
}

function isActiveItem(item: ContentRequest): boolean {
  return item.status === 'OPEN' || item.status === 'PLANNED' || item.status === 'IN_PROGRESS';
}
/** The "how requests work" cards, in order, with their semantic icon and accent tint. */
const HOW_ITEMS = [
  { key: 'vote', icon: mdiThumbUpOutline, tone: 'bg-brand/15 text-brand' },
  { key: 'boost', icon: mdiChevronDoubleUp, tone: 'bg-amber-400/15 text-amber-300' },
  { key: 'limits', icon: mdiLayersOutline, tone: 'bg-sky-400/15 text-sky-300' },
  { key: 'news', icon: mdiEmailOutline, tone: 'bg-emerald-400/15 text-emerald-300' },
] as const;
const SORT_OPTIONS = [
  { value: 'TOP', icon: mdiFire },
  { value: 'RECENT', icon: mdiClockOutline },
] as const;

const { t, locale } = useI18n();
const route = useRoute();
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

const initialQuery = typeof route.query.q === 'string' ? route.query.q.trim().slice(0, 100) : '';
const filters = reactive({
  status: 'ACTIVE' as ListStatus,
  personalStatus: 'ALL' as PersonalStatus,
  category: null as Category | null,
  sort: 'TOP' as 'TOP' | 'RECENT',
  q: initialQuery,
  page: 1,
});
const search = ref(initialQuery);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.q = value.trim();
    filters.page = 1;
  }, 300);
});
onScopeDispose(() => {
  clearTimeout(searchTimer);
});

const { data, error, pending, refresh } = await useAsyncData(
  'content-requests',
  () => {
    if (isPersonalTab(filters.status)) {
      return $fetch<{ items: ContentRequest[]; total: number }>('/v1/requests/mine', {
        query: {
          scope: filters.status === 'MINE' ? 'OWN' : 'VOTED',
          sort: filters.sort,
          page: filters.page,
          take: PAGE_SIZE,
          ...(filters.personalStatus !== 'ALL' ? { status: filters.personalStatus } : {}),
          ...(filters.category ? { category: filters.category } : {}),
          ...(filters.q ? { q: filters.q } : {}),
        },
      });
    }
    return $fetch<{ items: ContentRequest[]; total: number }>('/v1/requests', {
      query: {
        status: filters.status,
        sort: filters.sort,
        page: filters.page,
        take: PAGE_SIZE,
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.q ? { q: filters.q } : {}),
      },
    });
  },
  { watch: [filters] },
);
const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const hasLoadedOnce = ref(Boolean(data.value));
watch(
  data,
  (value) => {
    if (value) hasLoadedOnce.value = true;
  },
  { immediate: true },
);

function setStatus(status: ListStatus) {
  if (isPersonalTab(status) && !user.isLoggedIn) {
    openLoginModal('content_request');
    return;
  }
  filters.status = status;
  filters.personalStatus = 'ALL';
  filters.page = 1;
}

function setPersonalStatus(status: PersonalStatus) {
  filters.personalStatus = status;
  filters.page = 1;
}

function setCategory(category: Category | null) {
  filters.category = category;
  filters.page = 1;
}

function setSort(sort: 'TOP' | 'RECENT') {
  filters.sort = sort;
  filters.page = 1;
}

function clearSearch() {
  clearTimeout(searchTimer);
  search.value = '';
  filters.q = '';
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
  (loggedIn) => {
    if (!loggedIn && isPersonalTab(filters.status)) {
      filters.status = 'ACTIVE';
      filters.page = 1;
    }
    loadAllowance();
  },
);

function personalCount(tab: PersonalTab): number {
  if (!allowance.value) return 0;
  if (tab === 'MINE') return allowance.value.ownCount ?? own.value.size;
  return allowance.value.votedCount ?? new Set([...allowance.value.votedIds, ...allowance.value.boostedIds]).size;
}

// The form, help modal, confirmation dialogs, and non-patron boost nudge.
const formOpen = ref(false);
const howOpen = ref(false);
const boostTarget = ref<ContentRequest | null>(null);
const unlockBoostTarget = ref<ContentRequest | null>(null);
const withdrawTarget = ref<ContentRequest | null>(null);
const boostNudgeItemId = ref<string | null>(null);
const boostNudgeDismissed = ref(false);
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

/** Live category hint for the request form as the reader pastes a link or ASIN. */
const detectedCategory = computed<Category | null>(() => {
  try {
    const url = new URL(normalizedLink(sourceUrl.value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');
    if (host === 'anilist.co') return 'ANIME';
    if (host === 'themoviedb.org' || host === 'mydramalist.com') return 'JDRAMA';
    if (host.startsWith('audible.') || host.startsWith('amazon.')) return 'AUDIOBOOK';
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') return 'YOUTUBE';
    return null;
  } catch {
    return null;
  }
});

function rankTone(rank: number | null): string {
  if (rank === 1) return 'text-amber-300';
  if (rank === 2) return 'text-ink';
  if (rank === 3) return 'text-orange-300';
  return 'text-ink-faint';
}

function statusTextClass(status: Status): string {
  if (status === 'OPEN') return 'text-ink-muted';
  if (status === 'DECLINED') return 'text-red-300';
  if (status === 'RELEASED') return 'text-emerald-300';
  if (status === 'PLANNED') return 'text-sky-300';
  return 'text-violet-300';
}

function openForm() {
  if (!user.isLoggedIn) {
    openLoginModal('content_request');
    return;
  }
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  formError.value = null;
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
    filters.status = result.request.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'ACTIVE';
    filters.category = null;
    filters.page = 1;
    clearSearch();
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
  if (busyId.value === item.id) return;
  busyId.value = item.id;

  const remove = voted.value.has(item.id);
  const delta = remove ? -1 : 1;
  const previousItem: ContentRequest = { ...item };
  const previousAllowance: Allowance | null = allowance.value
    ? {
        ...allowance.value,
        votedIds: [...allowance.value.votedIds],
        boostedIds: [...allowance.value.boostedIds],
        ownIds: [...allowance.value.ownIds],
        boosts: { ...allowance.value.boosts },
      }
    : null;

  // Apply optimistic vote state immediately so clicking feels instantaneous.
  replaceItem({
    ...item,
    voteCount: Math.max(0, item.voteCount + delta),
    score: Math.max(0, item.score + delta),
  });
  if (allowance.value) {
    const nextVoted = new Set(allowance.value.votedIds);
    if (remove) nextVoted.delete(item.id);
    else nextVoted.add(item.id);
    const alreadyBoosted = boosted.value.has(item.id);
    allowance.value = {
      ...allowance.value,
      votedIds: [...nextVoted],
      ...(allowance.value.votedCount !== undefined && !alreadyBoosted
        ? { votedCount: Math.max(0, allowance.value.votedCount + delta) }
        : {}),
    };
  }
  if (!remove && !canBoost.value && !boostNudgeDismissed.value && item.status !== 'IN_PROGRESS') {
    boostNudgeItemId.value = item.id;
  } else if (remove && boostNudgeItemId.value === item.id) {
    boostNudgeItemId.value = null;
  }

  try {
    replaceItem(await $fetch<ContentRequest>(`/v1/requests/${item.id}/vote`, { method: remove ? 'DELETE' : 'POST' }));
    if (remove && filters.status === 'VOTED' && !boosted.value.has(item.id)) {
      await Promise.all([refresh(), loadAllowance()]);
    } else {
      await loadAllowance();
    }
  } catch (caught) {
    replaceItem(previousItem);
    allowance.value = previousAllowance;
    if (!remove && boostNudgeItemId.value === item.id) boostNudgeItemId.value = null;
    handleApiError('requests.vote', caught);
  } finally {
    busyId.value = null;
  }
}

function dismissBoostNudge() {
  boostNudgeDismissed.value = true;
  boostNudgeItemId.value = null;
}

function requestBoost(item: ContentRequest) {
  if (!canBoost.value) {
    unlockBoostTarget.value = item;
    return;
  }
  boostTarget.value = item;
}

function signInFromUnlock() {
  unlockBoostTarget.value = null;
  openLoginModal('content_request');
}

async function confirmBoost() {
  const item = boostTarget.value;
  if (!item) return;
  busyId.value = item.id;
  try {
    replaceItem(await $fetch<ContentRequest>(`/v1/requests/${item.id}/boost`, { method: 'POST' }));
    boostTarget.value = null;
    useToastSuccess(t('requests.boost.done', { title: item.title }));
    await loadAllowance();
  } catch (caught) {
    handleApiError('requests.boost', caught, { toastKey: 'requests.boost.failed' });
  } finally {
    busyId.value = null;
  }
}

function requestWithdraw(item: ContentRequest) {
  withdrawTarget.value = item;
}

async function confirmWithdraw() {
  const item = withdrawTarget.value;
  if (!item) return;
  busyId.value = item.id;
  try {
    await $fetch(`/v1/requests/${item.id}`, { method: 'DELETE' });
    withdrawTarget.value = null;
    await Promise.all([refresh(), loadAllowance()]);
  } catch (caught) {
    handleApiError('requests.withdraw', caught, { toastKey: 'requests.withdrawFailed' });
  } finally {
    busyId.value = null;
  }
}

const canBoost = computed(() => Boolean(allowance.value?.isPatron && allowance.value.boosts.perMonth > 0));

function showBoostControl(item: ContentRequest): boolean {
  if (!isActiveItem(item)) return false;
  if (item.status === 'IN_PROGRESS') return canBoost.value && boosted.value.has(item.id);
  return true;
}
const dateFormats = computed(() => ({
  longMonthDay: new Intl.DateTimeFormat(locale.value, { month: 'long', day: 'numeric', timeZone: 'UTC' }),
  short: new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  full: new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
}));

const resetDate = computed(() =>
  allowance.value ? dateFormats.value.longMonthDay.format(new Date(allowance.value.boosts.resetsAt)) : '',
);

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.getUTCFullYear() === new Date().getUTCFullYear()
    ? dateFormats.value.short.format(date)
    : dateFormats.value.full.format(date);
}

function rowDate(item: ContentRequest): { iso: string; label: string } | null {
  if (item.status === 'RELEASED' && item.releasedAt) {
    const formatted = formatShortDate(item.releasedAt);
    if (formatted) return { iso: item.releasedAt, label: t('requests.releasedOn', { date: formatted }) };
  }
  if (item.createdAt) {
    const formatted = formatShortDate(item.createdAt);
    if (formatted) return { iso: item.createdAt, label: formatted };
  }
  return null;
}

function canWithdraw(item: ContentRequest) {
  return own.value.has(item.id) && item.status === 'OPEN' && item.voteCount <= 1 && item.boostCount === 0;
}

function statusLabel(status: Status) {
  return t(`requests.status.${status}`);
}

function scoreBreakdown(item: ContentRequest): string {
  const votes = t('requests.votes', { count: item.voteCount });
  if (!item.boostCount) return votes;
  return `${votes} + ${t('requests.boosts', { count: item.boostCount })} (+${item.boostCount * BOOST_WEIGHT})`;
}

/** Place in the most-wanted ranking, shown on the poster; only meaningful for open requests sorted by score. */
function rankOf(index: number): number | null {
  if (filters.status !== 'ACTIVE' || filters.sort !== 'TOP' || filters.q) return null;
  return (filters.page - 1) * PAGE_SIZE + index + 1;
}
</script>

<template>
  <div class="requests-page nd-page px-4 pb-16 pt-5 text-ink md:px-0 sm:pt-7">
    <header class="border-b border-hairline">
      <div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0">
          <h1 class="text-3xl font-extrabold tracking-tight text-ink sm:text-[2.125rem] sm:leading-tight">
            {{ t('requests.title') }}
          </h1>
          <p class="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted sm:text-[15px]">
            {{ t('requests.intro') }}
          </p>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="requests-new"
            class="nd-btn-accent h-10 flex-1 min-w-fit whitespace-nowrap px-4 shadow-sm sm:flex-none"
            @click="openForm"
          >
            <UiBaseIcon :path="mdiPlus" w="w-4" h="h-4" size="18" />
            <span>{{ t('requests.newRequest') }}</span>
          </button>
          <NuxtLink
            v-if="user.isAdmin"
            data-testid="requests-admin-link"
            :to="localePath('/user/admin/requests')"
            class="inline-flex h-10 flex-1 min-w-fit items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-hairline bg-surface px-3.5 text-sm font-semibold text-ink-muted transition hover:border-line-hover hover:bg-surface-hover hover:text-ink sm:flex-none"
          >
            <UiBaseIcon :path="mdiViewColumnOutline" w="w-4" h="h-4" size="16" />
            <span>{{ t('requests.manageAdmin') }}</span>
          </NuxtLink>
        </div>
      </div>

      <div
        v-if="allowance && (allowance.openLimit !== null || canBoost)"
        data-testid="requests-allowance"
        class="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-faint"
      >
        <span v-if="allowance.openLimit !== null">
          {{ t('requests.allowance.open', { count: allowance.openCount, limit: allowance.openLimit }) }}
        </span>
        <span v-if="allowance.openLimit !== null && canBoost" aria-hidden="true">·</span>
        <span v-if="canBoost" class="inline-flex items-center gap-1 text-ink-muted">
          <UiBaseIcon :path="mdiChevronDoubleUp" w="w-3.5" h="h-3.5" size="14" class="text-amber-300" />
          {{ t('requests.allowance.boosts', { remaining: allowance.boosts.remaining, total: allowance.boosts.perMonth, date: resetDate }) }}
        </span>
      </div>

      <div class="-mb-px mt-5 flex items-center justify-between gap-2">
        <div
          class="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide"
          role="tablist"
          :aria-label="t('requests.title')"
        >
          <button
            v-for="status in PUBLIC_TABS"
            :key="status"
            type="button"
            role="tab"
            :aria-selected="filters.status === status"
            :data-testid="`requests-tab-${status}`"
            class="shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3.5 pb-3 pt-1 text-sm font-semibold transition"
            :class="
              filters.status === status
                ? 'border-brand-solid text-ink'
                : 'border-transparent text-ink-muted hover:border-line-hover hover:text-ink'
            "
            @click="setStatus(status)"
          >
            {{ t(`requests.tabs.${status}`) }}
          </button>

          <span class="mx-1.5 mb-2 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden="true" />

          <button
            v-for="status in PERSONAL_TABS"
            :key="status"
            type="button"
            role="tab"
            :aria-selected="filters.status === status"
            :data-testid="`requests-tab-${status}`"
            class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3.5 pb-3 pt-1 text-sm font-semibold transition"
            :class="
              filters.status === status
                ? 'border-brand-solid text-ink'
                : 'border-transparent text-ink-muted hover:border-line-hover hover:text-ink'
            "
            @click="setStatus(status)"
          >
            <span>{{ t(`requests.tabs.${status}`) }}</span>
            <span
              v-if="personalCount(status) > 0"
              class="text-xs font-medium tabular-nums text-ink-faint"
            >
              {{ personalCount(status) }}
            </span>
          </button>
        </div>

        <button
          type="button"
          data-testid="requests-how-trigger"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 pb-3 pt-1 text-xs font-medium text-ink-faint transition hover:text-ink"
          :aria-label="t('requests.how.title')"
          @click="howOpen = true"
        >
          <UiBaseIcon :path="mdiHelpCircleOutline" w="w-4" h="h-4" size="16" />
          <span class="hidden sm:inline">{{ t('requests.how.title') }}</span>
        </button>
      </div>
    </header>

    <CommonBaseModal
      :open="howOpen"
      labelledby="requests-how-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-lg flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="howOpen = false"
    >
      <template v-if="howOpen">
        <div class="nd-modal-header">
          <h2 id="requests-how-title" class="font-bold text-ink">{{ t('requests.how.title') }}</h2>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="howOpen = false"
          >
            <span class="sr-only">{{ t('common.close') }}</span>
            <UiBaseIcon :path="mdiClose" :size="18" />
          </button>
        </div>
        <ul class="divide-y divide-hairline px-5 py-2">
          <li
            v-for="item in HOW_ITEMS"
            :key="item.key"
            class="flex items-start gap-3.5 py-4"
          >
            <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg" :class="item.tone" aria-hidden="true">
              <UiBaseIcon :path="item.icon" w="w-4" h="h-4" size="17" />
            </span>
            <p class="text-sm leading-relaxed text-ink-muted">{{ t(`requests.how.${item.key}`) }}</p>
          </li>
        </ul>
      </template>
    </CommonBaseModal>

    <CommonBaseModal
      :open="Boolean(boostTarget)"
      labelledby="requests-boost-confirm-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-md flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="boostTarget = null"
    >
      <template v-if="boostTarget">
        <div class="nd-modal-header">
          <h2 id="requests-boost-confirm-title" class="inline-flex items-center gap-1.5 font-bold text-ink">
            <UiBaseIcon :path="mdiChevronDoubleUp" w="w-4" h="h-4" size="18" class="text-amber-400" />
            <span>{{ t('requests.boost.confirmHeading') }}</span>
          </h2>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="boostTarget = null"
          >
            <span class="sr-only">{{ t('common.cancel') }}</span>
            <UiBaseIcon :path="mdiClose" :size="18" />
          </button>
        </div>
        <div class="flex flex-col gap-4 p-5">
          <p class="text-sm leading-relaxed text-ink-muted">
            {{ t('requests.boost.confirmBody', { title: boostTarget.title }) }}
          </p>
          <p
            v-if="allowance"
            class="inline-flex items-center gap-1.5 text-xs text-ink-muted"
          >
            <UiBaseIcon :path="mdiChevronDoubleUp" w="w-3.5" h="h-3.5" size="14" class="text-amber-300" />
            <span>
              {{
                t('requests.boost.remainingAfter', {
                  remaining: Math.max(0, allowance.boosts.remaining - 1),
                  total: allowance.boosts.perMonth,
                })
              }}
            </span>
          </p>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="nd-btn" @click="boostTarget = null">{{ t('common.cancel') }}</button>
            <button
              type="button"
              data-testid="requests-boost-confirm"
              class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-amber-400 disabled:pointer-events-none disabled:opacity-50"
              :disabled="busyId === boostTarget.id"
              @click="confirmBoost"
            >
              <UiBaseIcon :path="mdiChevronDoubleUp" w="w-4" h="h-4" size="16" />
              <span>{{ t('requests.boost.action') }}</span>
            </button>
          </div>
        </div>
      </template>
    </CommonBaseModal>

    <CommonBaseModal
      :open="Boolean(unlockBoostTarget)"
      labelledby="requests-boost-unlock-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-md flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="unlockBoostTarget = null"
    >
      <template v-if="unlockBoostTarget">
        <div data-testid="requests-boost-unlock-modal">
          <div class="nd-modal-header">
            <h2 id="requests-boost-unlock-title" class="inline-flex items-center gap-1.5 font-bold text-ink">
              <UiBaseIcon :path="mdiChevronDoubleUp" w="w-4" h="h-4" size="18" class="text-amber-400" />
              <span>{{ t('requests.boost.unlockHeading') }}</span>
            </h2>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
              @click="unlockBoostTarget = null"
            >
              <span class="sr-only">{{ t('common.close') }}</span>
              <UiBaseIcon :path="mdiClose" :size="18" />
            </button>
          </div>
          <div class="flex flex-col gap-4 p-5">
            <p class="text-sm leading-relaxed text-ink-muted">
              {{ t('requests.boost.unlockBody', { title: unlockBoostTarget.title }) }}
            </p>
            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                v-if="!user.isLoggedIn"
                type="button"
                class="text-xs font-medium text-ink-faint underline underline-offset-2 transition hover:text-ink"
                @click="signInFromUnlock"
              >
                {{ t('requests.boost.alreadyPatronSignIn') }}
              </button>
              <div class="ms-auto flex items-center gap-2">
                <button type="button" class="nd-btn" @click="unlockBoostTarget = null">{{ t('common.cancel') }}</button>
                <NuxtLink
                  data-testid="requests-boost-unlock-cta"
                  :to="`${localePath('/supporters')}#support`"
                  class="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-amber-400"
                  @click="unlockBoostTarget = null"
                >
                  <UiBaseIcon :path="mdiPatreon" w="w-4" h="h-4" size="15" />
                  <span>{{ t('requests.boostWithPatreon') }}</span>
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>
      </template>
    </CommonBaseModal>

    <CommonBaseModal
      :open="Boolean(withdrawTarget)"
      labelledby="requests-withdraw-confirm-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-md flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="withdrawTarget = null"
    >
      <template v-if="withdrawTarget">
        <div class="nd-modal-header">
          <h2 id="requests-withdraw-confirm-title" class="font-bold text-ink">{{ t('requests.withdraw') }}</h2>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="withdrawTarget = null"
          >
            <span class="sr-only">{{ t('common.cancel') }}</span>
            <UiBaseIcon :path="mdiClose" :size="18" />
          </button>
        </div>
        <div class="flex flex-col gap-4 p-5">
          <p class="text-sm leading-relaxed text-ink-muted">
            {{ t('requests.withdrawConfirm', { title: withdrawTarget.title }) }}
          </p>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="nd-btn" @click="withdrawTarget = null">{{ t('common.cancel') }}</button>
            <button
              type="button"
              data-testid="requests-withdraw-confirm"
              class="nd-btn-danger"
              :disabled="busyId === withdrawTarget.id"
              @click="confirmWithdraw"
            >
              <UiBaseIcon :path="mdiDeleteOutline" w="w-4" h="h-4" size="16" />
              <span>{{ t('requests.withdraw') }}</span>
            </button>
          </div>
        </div>
      </template>
    </CommonBaseModal>

    <CommonBaseModal
      :open="formOpen"
      labelledby="request-form-title"
      overlay-class="items-end justify-center sm:items-center bg-fixed-scrim/60"
      panel-class="w-full max-w-lg flex flex-col bg-background border border-hairline shadow-sm rounded-t-xl sm:rounded-xl"
      @close="closeForm"
    >
      <template v-if="formOpen">
        <div class="nd-modal-header">
          <h2 id="request-form-title" class="font-bold text-ink">{{ t('requests.form.heading') }}</h2>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-lift hover:text-ink"
            @click="closeForm"
          >
            <span class="sr-only">{{ t('requests.form.cancel') }}</span>
            <UiBaseIcon :path="mdiClose" :size="18" />
          </button>
        </div>
        <form data-testid="requests-form" class="flex flex-col gap-4 p-5" @submit.prevent="submitRequest">
          <p class="text-sm leading-relaxed text-ink-muted">{{ t('requests.form.help') }}</p>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-hidden="true">
            <span
              v-for="category in CATEGORIES"
              :key="category"
              class="inline-flex items-center gap-1 transition"
              :class="detectedCategory === category ? 'font-semibold text-brand' : 'text-ink-faint'"
            >
              <UiBaseIcon :path="CATEGORY_ICONS[category]" w="w-3.5" h="h-3.5" size="13" />
              {{ t(`requests.category.${category}`) }}
            </span>
          </div>

          <label class="block">
            <span class="mb-1.5 block text-sm font-semibold text-ink">{{ t('requests.form.url') }}</span>
            <input
              id="request-url"
              v-model="sourceUrl"
              data-autofocus
              required
              maxlength="1000"
              class="nd-input w-full"
              :placeholder="t('requests.form.urlPlaceholder')"
            >
          </label>
          <label v-if="needsTitle" class="block">
            <span class="mb-1.5 block text-sm font-semibold text-ink">{{ t('requests.form.titleLabel') }}</span>
            <input v-model="title" maxlength="180" class="nd-input w-full" data-testid="requests-title">
          </label>
          <label class="block">
            <span class="mb-1.5 block text-sm font-semibold text-ink">{{ t('requests.form.note') }}</span>
            <textarea
              v-model="note"
              maxlength="1000"
              rows="3"
              class="nd-input w-full resize-y"
              :placeholder="t('requests.form.notePlaceholder')"
            />
          </label>
          <p
            v-if="formError"
            data-testid="requests-form-error"
            class="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {{ formError }}
          </p>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="nd-btn" @click="closeForm">{{ t('requests.form.cancel') }}</button>
            <button type="submit" class="nd-btn-accent" :disabled="submitting">{{ t('requests.form.submit') }}</button>
          </div>
        </form>
      </template>
    </CommonBaseModal>

    <section class="pt-4" :aria-label="t('requests.title')">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <fieldset class="flex flex-wrap items-center gap-1 border-0 p-0">
          <legend class="sr-only">{{ t('requests.categoryLabel') }}</legend>
          <button
            type="button"
            class="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium transition-colors"
            :class="
              filters.category === null
                ? 'bg-lift-strong text-ink'
                : 'text-ink-muted hover:bg-lift hover:text-ink'
            "
            :aria-pressed="filters.category === null"
            @click="setCategory(null)"
          >
            {{ t('requests.category.ALL') }}
          </button>
          <button
            v-for="category in CATEGORIES"
            :key="category"
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors"
            :class="
              filters.category === category
                ? 'bg-lift-strong text-ink'
                : 'text-ink-muted hover:bg-lift hover:text-ink'
            "
            :aria-pressed="filters.category === category"
            :data-testid="`requests-category-${category}`"
            @click="setCategory(category)"
          >
            <UiBaseIcon :path="CATEGORY_ICONS[category]" w="w-3.5" h="h-3.5" size="14" />
            <span>{{ t(`requests.category.${category}`) }}</span>
          </button>
        </fieldset>

        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <fieldset
            v-if="filters.status === 'ACTIVE' || filters.status === 'IN_PROGRESS' || isPersonalTab(filters.status)"
            class="inline-flex h-9 w-full shrink-0 items-center rounded-lg border border-hairline bg-surface p-0.5 sm:w-auto"
          >
            <legend class="sr-only">{{ t('requests.sortLabel') }}</legend>
            <button
              v-for="option in SORT_OPTIONS"
              :key="option.value"
              type="button"
              class="inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition-colors sm:flex-none"
              :class="
                filters.sort === option.value
                  ? 'bg-lift-strong text-ink shadow-sm'
                  : 'text-ink-faint hover:text-ink-muted'
              "
              :aria-pressed="filters.sort === option.value"
              @click="setSort(option.value)"
            >
              <UiBaseIcon :path="option.icon" w="w-3.5" h="h-3.5" size="14" />
              <span>{{ t(`requests.sort.${option.value}`) }}</span>
            </button>
          </fieldset>

          <label class="relative block w-full sm:w-64 lg:w-52 xl:w-64">
            <span class="sr-only">{{ t('requests.searchLabel') }}</span>
            <UiBaseIcon
              :path="mdiMagnify"
              w="w-4"
              h="h-4"
              size="16"
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              v-model="search"
              type="text"
              inputmode="search"
              maxlength="100"
              class="nd-input w-full pl-9"
              :class="search ? 'pr-8' : ''"
              :placeholder="t('requests.searchLabel')"
            >
            <button
              v-if="search"
              type="button"
              class="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition hover:bg-lift hover:text-ink"
              :aria-label="t('common.clearSearch')"
              @click="clearSearch"
            >
              <UiBaseIcon :path="mdiClose" w="w-4" h="h-4" size="15" />
            </button>
          </label>
        </div>
      </div>

      <fieldset
        v-if="isPersonalTab(filters.status)"
        class="mt-3 flex flex-wrap items-center gap-1.5 border-0 p-0"
      >
        <legend class="sr-only">{{ t('requests.title') }}</legend>
        <button
          v-for="subStatus in PERSONAL_STATUSES"
          :key="subStatus"
          type="button"
          :data-testid="`requests-personal-status-${subStatus}`"
          class="inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium transition"
          :class="
            filters.personalStatus === subStatus
              ? 'border-line-hover bg-lift-strong text-ink'
              : 'border-hairline bg-surface/60 text-ink-faint hover:text-ink-muted'
          "
          :aria-pressed="filters.personalStatus === subStatus"
          @click="setPersonalStatus(subStatus)"
        >
          {{ subStatus === 'ALL' ? t('requests.category.ALL') : t(`requests.tabs.${subStatus}`) }}
        </button>
      </fieldset>

      <div
        class="min-h-[26rem] transition-opacity duration-150"
        :class="pending && hasLoadedOnce ? 'opacity-65' : 'opacity-100'"
      >
        <div v-if="error" class="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 p-5 text-sm text-red-200">
          {{ t('requests.loadError') }}
        </div>

        <div v-else-if="pending && !hasLoadedOnce" class="mt-4 overflow-hidden rounded-xl border border-hairline bg-surface divide-y divide-hairline">
          <div v-for="n in 5" :key="n" class="flex items-center gap-3.5 px-4 py-3.5 sm:gap-4 sm:px-5 sm:py-4">
            <div class="hidden h-5 w-7 rounded bg-lift sm:block" />
            <div class="h-[4.25rem] w-14 shrink-0 rounded-lg bg-lift sm:h-[5.25rem] sm:w-[4.25rem]" />
            <div class="flex flex-1 flex-col gap-2">
              <div class="h-3 w-24 rounded bg-lift" />
              <div class="h-4 w-2/3 rounded bg-lift" />
              <div class="h-3 w-1/3 rounded bg-lift" />
            </div>
            <div class="h-14 w-14 shrink-0 rounded-xl bg-lift" />
          </div>
        </div>

        <div
          v-else-if="!items.length"
          class="mt-5 flex flex-col items-center gap-4 rounded-xl border border-dashed border-hairline bg-surface/50 px-6 py-14 text-center"
        >
          <p data-testid="requests-empty" class="text-sm text-ink-muted">
            {{ t(filters.q ? 'requests.emptySearch' : `requests.empty.${filters.status}`) }}
          </p>
          <button
            v-if="filters.status === 'ACTIVE' || filters.status === 'MINE'"
            type="button"
            data-testid="requests-empty-new"
            class="nd-btn-accent inline-flex items-center gap-1.5"
            @click="openForm"
          >
            <UiBaseIcon :path="mdiPlus" w="w-4" h="h-4" size="18" />
            <span>{{ t('requests.newRequest') }}</span>
          </button>
        </div>

        <ol
          v-else
          class="mt-4 divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface"
          data-testid="requests-list"
        >
        <li
          v-for="(item, index) in items"
          :key="item.id"
          :data-testid="`request-${item.id}`"
          class="group transition-colors hover:bg-surface-hover/55"
        >
          <div class="flex items-center gap-3 px-3.5 py-3.5 sm:gap-4 sm:px-5 sm:py-4">
          <div
            v-if="rankOf(index)"
            class="hidden w-8 shrink-0 text-center tabular-nums sm:block"
            aria-hidden="true"
          >
            <span class="text-sm font-black" :class="rankTone(rankOf(index))">
              <span class="text-[11px] font-bold opacity-55">#</span>{{ rankOf(index) }}
            </span>
          </div>

          <RequestCover
            :category="item.category"
            :cover-url="item.coverUrl"
            hover-zoom
            class="h-[4.25rem] w-14 rounded-lg sm:h-[5.25rem] sm:w-[4.25rem]"
          />

          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
              <span
                v-if="rankOf(index)"
                class="font-black tabular-nums sm:hidden"
                :class="rankTone(rankOf(index))"
              >
                #{{ rankOf(index) }}
              </span>
              <span class="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                <UiBaseIcon :path="CATEGORY_ICONS[item.category]" w="w-3.5" h="h-3.5" size="13" />
                {{ t(`requests.category.${item.category}`) }}
              </span>
              <template v-if="item.status !== 'OPEN' || isPersonalTab(filters.status)">
                <span class="text-ink-faint/50" aria-hidden="true">·</span>
                <span class="font-semibold" :class="statusTextClass(item.status)">
                  {{ statusLabel(item.status) }}
                </span>
              </template>
              <template v-if="item.kind === 'UPDATE'">
                <span class="text-ink-faint/50" aria-hidden="true">·</span>
                <span class="font-medium text-ink-muted">{{ t('requests.kindUpdate') }}</span>
              </template>
              <template v-if="!isPersonalTab(filters.status) && own.has(item.id)">
                <span class="text-ink-faint/50" aria-hidden="true">·</span>
                <span
                  :data-testid="`request-yours-${item.id}`"
                  class="font-medium text-brand"
                >
                  {{ t('requests.yours') }}
                </span>
              </template>
            </div>

            <h2 class="line-clamp-2 text-[15px] font-bold leading-snug text-ink sm:text-base" :title="item.title">
              {{ item.title }}
            </h2>

            <p v-if="item.note" class="line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
              {{ item.note }}
            </p>
            <p v-if="item.declineReason" class="line-clamp-2 text-[13px] leading-relaxed text-red-300/85">
              {{ t('requests.declinedBecause', { reason: item.declineReason }) }}
            </p>

            <div
              v-if="item.boostCount || rowDate(item)"
              class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-faint tabular-nums"
            >
              <span v-if="item.boostCount" class="inline-flex items-center gap-0.5 font-semibold text-amber-300/90">
                <UiBaseIcon :path="mdiChevronDoubleUp" w="w-3.5" h="h-3.5" size="13" />
                {{ t('requests.boosts', { count: item.boostCount }) }}
              </span>
              <template v-if="rowDate(item)">
                <span v-if="item.boostCount" aria-hidden="true">·</span>
                <time :datetime="rowDate(item)?.iso">{{ rowDate(item)?.label }}</time>
              </template>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <NuxtLink
              v-if="item.media"
              :to="localePath(`/media/${item.media.slug}`)"
              class="inline-flex size-11 items-center justify-center rounded-xl border border-brand/35 bg-brand/10 text-brand transition hover:border-brand/55 hover:bg-brand/15 sm:size-[52px]"
              :title="item.status === 'RELEASED' ? t('requests.searchIt') : t('requests.onNadeshiko')"
            >
              <span class="sr-only">{{ item.status === 'RELEASED' ? t('requests.searchIt') : t('requests.onNadeshiko') }}</span>
              <UiBaseIcon :path="mdiArrowRight" w="w-[18px]" h="h-[18px]" size="18" />
            </NuxtLink>

            <a
              v-if="httpUrl(item.sourceUrl)"
              :href="httpUrl(item.sourceUrl) ?? undefined"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex size-11 items-center justify-center rounded-xl border border-hairline bg-background/60 text-ink-muted transition hover:border-line-hover hover:bg-surface-hover hover:text-ink sm:size-[52px]"
              :title="t('requests.viewSource')"
            >
              <span class="sr-only">{{ t('requests.viewSource') }}</span>
              <UiBaseIcon :path="mdiOpenInNew" w="w-[18px]" h="h-[18px]" size="18" />
            </a>

            <button
              v-if="isActiveItem(item) && canWithdraw(item)"
              type="button"
              :data-testid="`request-withdraw-${item.id}`"
              class="inline-flex size-11 items-center justify-center rounded-xl border border-hairline bg-background/60 text-ink-muted transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50 sm:size-[52px]"
              :disabled="busyId === item.id"
              :title="t('requests.withdraw')"
              @click="requestWithdraw(item)"
            >
              <span class="sr-only">{{ t('requests.withdraw') }}</span>
              <UiBaseIcon :path="mdiDeleteOutline" w="w-[18px]" h="h-[18px]" size="18" />
            </button>

            <button
              v-if="showBoostControl(item)"
              type="button"
              :data-testid="`request-boost-${item.id}`"
              class="relative inline-flex size-11 items-center justify-center rounded-xl border transition sm:size-[52px]"
              :class="
                boosted.has(item.id)
                  ? 'border-amber-400/45 bg-amber-400/15 text-amber-300'
                  : !canBoost
                    ? 'border-hairline bg-background/40 text-ink-faint opacity-75 hover:border-amber-400/45 hover:bg-amber-400/10 hover:text-amber-300 hover:opacity-100'
                    : 'border-hairline bg-background/60 text-ink-muted hover:border-amber-400/45 hover:bg-amber-400/10 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50'
              "
              :disabled="canBoost && (busyId === item.id || boosted.has(item.id) || (allowance?.boosts.remaining ?? 0) === 0)"
              :title="!canBoost ? t('requests.boost.patronsOnly') : boosted.has(item.id) ? t('requests.boost.already') : t('requests.boost.hint')"
              @click="requestBoost(item)"
            >
              <span class="sr-only">
                {{ !canBoost ? t('requests.boost.patronsOnly') : boosted.has(item.id) ? t('requests.boost.boosted') : t('requests.boost.action') }}
              </span>
              <UiBaseIcon :path="mdiChevronDoubleUp" w="w-5" h="h-5" size="20" />
              <UiBaseIcon
                v-if="!canBoost"
                :path="mdiLockOutline"
                w="w-3"
                h="h-3"
                size="11"
                class="absolute bottom-1.5 right-1.5 opacity-80"
              />
            </button>

            <button
              v-if="isActiveItem(item)"
              type="button"
              :data-testid="`request-vote-${item.id}`"
              class="flex h-11 min-w-[2.75rem] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 tabular-nums transition sm:h-[52px] sm:min-w-[3.25rem] sm:gap-1 sm:px-2.5"
              :class="
                voted.has(item.id)
                  ? 'border-transparent bg-brand-solid text-on-accent shadow-sm'
                  : 'border-hairline bg-background/60 text-ink hover:border-brand/50 hover:bg-brand/10 hover:text-brand'
              "
              :aria-pressed="voted.has(item.id)"
              :aria-label="voted.has(item.id) ? t('requests.unvote') : t('requests.vote')"
              :title="scoreBreakdown(item)"
              @click="toggleVote(item)"
            >
              <UiBaseIcon :path="voted.has(item.id) ? mdiThumbUp : mdiThumbUpOutline" w="w-4" h="h-4" size="16" />
              <span class="text-sm font-extrabold leading-none">{{ item.score }}</span>
            </button>

            <div
              v-else
              class="flex h-11 min-w-[2.75rem] flex-col items-center justify-center gap-0.5 rounded-xl border border-hairline/70 bg-background/30 px-2 text-ink-faint tabular-nums sm:h-[52px] sm:min-w-[3.25rem] sm:gap-1 sm:px-2.5"
              :aria-label="t('requests.votes', { count: item.score })"
              :title="scoreBreakdown(item)"
            >
              <UiBaseIcon :path="mdiThumbUpOutline" w="w-4" h="h-4" size="15" class="opacity-65" />
              <span class="text-sm font-bold leading-none">{{ item.score }}</span>
            </div>
          </div>
          </div>

          <div
            v-if="!canBoost && !boostNudgeDismissed && boostNudgeItemId === item.id && voted.has(item.id)"
            data-testid="requests-boost-nudge"
            class="flex flex-wrap items-center justify-between gap-2 border-t border-amber-400/15 bg-amber-400/[0.06] px-4 py-2 text-xs sm:px-5"
          >
            <span class="inline-flex items-center gap-1.5 text-amber-200/90">
              <UiBaseIcon :path="mdiChevronDoubleUp" w="w-3.5" h="h-3.5" size="14" class="shrink-0 text-amber-400" />
              <span>{{ t('requests.boost.nudge', { title: item.title }) }}</span>
            </span>
            <div class="ms-auto flex items-center gap-2">
              <NuxtLink
                :to="`${localePath('/supporters')}#support`"
                class="inline-flex items-center gap-1 font-semibold text-amber-300 transition hover:text-amber-200"
              >
                <UiBaseIcon :path="mdiPatreon" w="w-3.5" h="h-3.5" size="13" class="text-[#FF424D]" />
                <span>{{ t('requests.boostWithPatreon') }}</span>
              </NuxtLink>
              <button
                type="button"
                data-testid="requests-boost-nudge-dismiss"
                class="inline-flex size-6 items-center justify-center rounded text-ink-faint transition hover:bg-lift hover:text-ink"
                :aria-label="t('common.close')"
                @click="dismissBoostNudge"
              >
                <UiBaseIcon :path="mdiClose" w="w-3.5" h="h-3.5" size="14" />
              </button>
            </div>
          </div>
        </li>
      </ol>

      <nav
        v-if="pageCount > 1"
        class="mt-6 flex items-center justify-center gap-3"
        :aria-label="t('requests.pagination')"
      >
        <button type="button" class="nd-btn" :disabled="filters.page <= 1" @click="filters.page--">
          {{ t('requests.previous') }}
        </button>
        <span class="text-sm font-medium text-ink-muted tabular-nums">{{ filters.page }} / {{ pageCount }}</span>
        <button type="button" class="nd-btn" :disabled="filters.page >= pageCount" @click="filters.page++">
          {{ t('requests.next') }}
        </button>
      </nav>
      </div>
    </section>
  </div>
</template>
