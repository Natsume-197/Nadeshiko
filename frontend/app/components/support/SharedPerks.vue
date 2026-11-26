<script setup lang="ts">
import {
  mdiBellOutline,
  mdiBellRing,
  mdiBookOpenPageVariantOutline,
  mdiEyeOffOutline,
  mdiLock,
  mdiRocketLaunch,
  mdiSync,
  mdiThumbUp,
} from '@mdi/js';
import { ANILIST_ICON_PATH, MYANIMELIST_ICON_PATH } from '~/utils/trackerIcons';

/**
 * What every paid tier unlocks, one card per perk: a short title, then a stage with a small working demo of it.
 * Each demo plays by itself until the reader touches it (never with reduced motion). Frames and sentences are real
 * catalogue data saved under public/assets/supporters; the requests are real titles with made-up votes, and the
 * dictionaries and lists are made up.
 */

const { t } = useI18n();
const { prefersReducedMotion } = useMotionPreference();

const SHOW = 'BOCCHI THE ROCK!';
const EPISODES = 6;
const SHOW_EPISODES = 12;

const DICTIONARIES = [
  { name: 'JMdict', gloss: 'to meet; to encounter; to see', lang: 'en' },
  { name: '大辞林', gloss: '人と顔を合わせる。', lang: 'ja' },
  { name: 'JPDB', gloss: '#182', lang: 'en' },
] as const;

const SEARCH_ROWS = [
  { id: 'bocchi', line: 'ありがとう！んっ', media: 'BOCCHI THE ROCK!', planning: false },
  { id: 'hinamatsuri', line: 'あ… ありがとう…', media: 'HINAMATSURI', planning: true },
  { id: 'suzume', line: 'ありがとう、ダイジン', media: 'Suzume', planning: false },
];

/** Each list filters the search to its own titles; the frames stand in for those results. */
const CUSTOM_LISTS = [
  { name: 'Rewatch', shots: ['ep1', 'ep3', 'row-suzume'] },
  { name: 'Favourites', shots: ['row-bocchi', 'ep2', 'ep5'] },
  { name: 'Summer 2026', shots: ['ep4', 'row-hinamatsuri', 'ep6'] },
  { name: 'Comfy', shots: ['ep6', 'ep2', 'row-bocchi'] },
];

/** Open requests with their votes; a boost adds `BOOST_VOTES` (backend `REQUEST_BOOST_WEIGHT`). */
const BOOST_VOTES = 5;
const REQUESTS = [
  { id: 'oshinoko', title: 'OSHI NO KO', votes: 12 },
  { id: 'oshinoko2', title: 'OSHI NO KO Season 2', votes: 9 },
  { id: 'oshinoko3', title: 'OSHI NO KO Season 3', votes: 7 },
  { id: 'fmab', title: 'Fullmetal Alchemist: Brotherhood', votes: 6 },
];

const ALERT_WORD = '会う';
const ALERT_SHOTS = ['ep2', 'ep5', 'row-bocchi'];

const watched = ref(3);
const activeDictionary = ref(0);
const hidePlanning = ref(true);
const synced = ref(true);
const activeList = ref(0);
const boosted = ref<string | null>(null);
const following = ref(true);
const alertShown = ref(true);

/** Which demos the reader has taken over; a demo they touched stops playing by itself. */
const touched = reactive({
  spoilers: false,
  dictionaries: false,
  planning: false,
  lists: false,
  boosts: false,
  alerts: false,
});

function pickEpisode(n: number) {
  touched.spoilers = true;
  watched.value = n;
}
function pickDictionary(i: number) {
  touched.dictionaries = true;
  activeDictionary.value = i;
}
function togglePlanning() {
  touched.planning = true;
  hidePlanning.value = !hidePlanning.value;
}
function pickList(i: number) {
  touched.lists = true;
  activeList.value = i;
}
function toggleBoost(id: string) {
  touched.boosts = true;
  boosted.value = boosted.value === id ? null : id;
}
function toggleFollow() {
  touched.alerts = true;
  following.value = !following.value;
  alertShown.value = following.value;
}

/** Highest score first, as /requests ranks them. */
const ranked = computed(() =>
  REQUESTS.map((request) => ({ ...request, score: request.votes + (boosted.value === request.id ? BOOST_VOTES : 0) })).sort(
    (a, b) => b.score - a.score,
  ),
);

const timers: ReturnType<typeof setInterval>[] = [];
function autoplay(step: () => void, ms: number) {
  timers.push(setInterval(step, ms));
}

onMounted(() => {
  if (prefersReducedMotion()) return;
  autoplay(() => {
    if (!touched.spoilers) watched.value = watched.value >= EPISODES - 1 ? 2 : watched.value + 1;
  }, 2200);
  autoplay(() => {
    if (!touched.dictionaries) activeDictionary.value = (activeDictionary.value + 1) % DICTIONARIES.length;
  }, 2600);
  autoplay(() => {
    if (!touched.planning) hidePlanning.value = !hidePlanning.value;
  }, 2800);
  autoplay(() => {
    synced.value = !synced.value;
  }, 2400);
  autoplay(() => {
    if (!touched.lists) activeList.value = (activeList.value + 1) % CUSTOM_LISTS.length;
  }, 3000);
  autoplay(() => {
    if (!touched.boosts) boosted.value = boosted.value ? null : 'fmab';
  }, 3200);
  autoplay(() => {
    if (!touched.alerts) alertShown.value = !alertShown.value;
  }, 2900);
});
onBeforeUnmount(() => {
  for (const timer of timers) clearInterval(timer);
});

const progress = computed(() => (synced.value ? EPISODES : EPISODES - 1));
</script>

<template>
  <div id="perks" class="supporters-band supporters-band-soft scroll-mt-16" data-testid="support-shared-perks">
    <!-- biome-ignore lint/a11y/noHeaderScope: vue-i18n scope, not a table header -->
    <i18n-t keypath="support.shared.headline" tag="h2" scope="global" data-reveal class="text-center text-3xl font-bold leading-tight tracking-[-0.03em] text-ink md:text-[2.6rem]">
      <template #accent>
        <span class="text-brand">{{ t('support.shared.headlineAccent') }}</span>
      </template>
    </i18n-t>

    <ul class="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      <!-- No spoilers: real frames, blurred past the last watched episode -->
      <li class="perk-card md:col-span-2" data-reveal style="--reveal-step: 0">
        <div class="perk-head">
          <h3 class="perk-title">
            {{ t('support.shared.titles.spoilers') }}
          </h3>
          <span class="perk-example">{{ t('support.shared.example') }}</span>
        </div>
        <p class="perk-desc">{{ t('support.shared.descriptions.spoilers') }}</p>
        <div class="perk-stage p-3">
          <div class="grid h-full grid-cols-3 grid-rows-2 gap-2">
            <button
              v-for="n in EPISODES"
              :key="n"
              type="button"
              class="group relative overflow-hidden rounded-xl bg-surface-lift"
              :aria-label="t('support.shared.episode', { n })"
              :aria-pressed="n <= watched"
              data-testid="perk-episode"
              @click="pickEpisode(n)"
            >
              <img
                :src="`/assets/supporters/ep${n}.webp`"
                alt=""
                width="480"
                height="270"
                loading="lazy"
                class="absolute inset-0 h-full w-full object-cover transition-[filter,transform] duration-500"
                :class="n > watched ? 'scale-110 blur-lg brightness-75' : 'group-hover:scale-105'"
              />
              <span class="absolute bottom-1.5 left-1.5 rounded-md bg-[#000]/55 px-1.5 py-0.5 text-[11px] font-semibold text-[#fff]">
                {{ t('support.shared.episode', { n }) }}
              </span>
              <span v-if="n > watched" class="absolute inset-0 flex items-center justify-center text-[#fff]">
                <UiBaseIcon :path="mdiLock" :size="20" />
              </span>
            </button>
          </div>
          <span class="absolute left-5 top-5 rounded-full bg-[#000]/55 px-2.5 py-1 text-[11px] font-semibold text-[#fff]">{{ SHOW }}</span>
        </div>
      </li>

      <!-- Your dictionaries: one word card, read from each dictionary in turn -->
      <li class="perk-card" data-reveal style="--reveal-step: 1">
        <div class="perk-head">
          <h3 class="perk-title">{{ t('support.shared.titles.dictionaries') }}</h3>
          <span class="perk-example">{{ t('support.shared.example') }}</span>
        </div>
        <p class="perk-desc">{{ t('support.shared.descriptions.dictionaries') }}</p>
        <div class="perk-stage flex flex-col justify-center gap-6 p-4">
          <div class="flex gap-1.5">
            <button
              v-for="(d, i) in DICTIONARIES"
              :key="d.name"
              type="button"
              class="flex-1 rounded-full px-2 py-1.5 text-xs font-semibold transition-colors"
              :class="i === activeDictionary ? 'bg-brand-solid text-on-accent' : 'bg-surface-lift text-ink-muted hover:text-ink'"
              :aria-pressed="i === activeDictionary"
              data-testid="perk-dictionary"
              @click="pickDictionary(i)"
            >
              {{ d.name }}
            </button>
          </div>
          <!-- The word card sits on a stack, one sheet per dictionary. -->
          <div class="relative mx-1" aria-hidden="true">
            <span class="perk-sub absolute inset-x-6 -bottom-4 top-4 opacity-40" />
            <span class="perk-sub absolute inset-x-3 -bottom-2 top-2 opacity-70" />
          <div class="perk-sub relative p-4">
            <div class="flex items-baseline gap-2">
              <span lang="ja" class="text-3xl font-bold text-ink">会う</span>
              <span lang="ja" class="text-sm text-ink-muted">あう</span>
              <span class="ms-auto flex items-center gap-1 text-[11px] font-bold text-brand">
                <UiBaseIcon :path="mdiBookOpenPageVariantOutline" :size="13" />
                {{ DICTIONARIES[activeDictionary]?.name }}
              </span>
            </div>
            <p :key="activeDictionary" :lang="DICTIONARIES[activeDictionary]?.lang" class="perk-swap mt-2 text-[15px] text-ink">
              {{ DICTIONARIES[activeDictionary]?.gloss }}
            </p>
          </div>
          </div>
        </div>
      </li>

      <!-- Hide Plan to Watch: the planned title folds away -->
      <li class="perk-card" data-reveal style="--reveal-step: 0">
        <div class="perk-head">
          <h3 class="perk-title">{{ t('support.shared.titles.planning') }}</h3>
          <button
            type="button"
            role="switch"
            class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            :class="hidePlanning ? 'bg-brand-solid' : 'bg-surface-lift'"
            :aria-checked="hidePlanning"
            :aria-label="t('support.shared.hidePlanning')"
            data-testid="perk-hide-planning"
            @click="togglePlanning"
          >
            <span class="absolute top-0.5 h-5 w-5 rounded-full bg-[#fff] shadow transition-[left]" :class="hidePlanning ? 'left-[1.375rem]' : 'left-0.5'" />
          </button>
        </div>
        <p class="perk-desc">{{ t('support.shared.descriptions.planning') }}</p>
        <div class="perk-stage flex flex-col justify-center gap-2 p-4" aria-hidden="true">
          <div
            v-for="row in SEARCH_ROWS"
            :key="row.id"
            class="grid transition-[grid-template-rows,opacity,margin] duration-500"
            :class="row.planning && hidePlanning ? '-my-1 grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
          >
            <div class="overflow-hidden">
              <div class="perk-sub flex items-center gap-3 p-2">
                <img :src="`/assets/supporters/row-${row.id}.webp`" alt="" width="240" height="135" loading="lazy" class="h-11 w-[4.9rem] shrink-0 rounded-lg object-cover" />
                <div class="min-w-0 flex-1">
                  <p lang="ja" class="truncate text-sm font-medium text-ink">{{ row.line }}</p>
                  <p class="truncate text-[11px] text-ink-faint">{{ row.media }}</p>
                </div>
                <UiBaseIcon v-if="row.planning" :path="mdiEyeOffOutline" :size="16" class="me-1 text-ink-faint" />
              </div>
            </div>
          </div>
        </div>
      </li>

      <!-- Daily sync: your list moves Nadeshiko's progress along -->
      <li class="perk-card" data-reveal style="--reveal-step: 1">
        <div class="perk-head">
          <h3 class="perk-title">
            {{ t('support.shared.titles.sync') }}
          </h3>
          <span class="perk-example">{{ t('support.shared.example') }}</span>
        </div>
        <p class="perk-desc">{{ t('support.shared.descriptions.sync') }}</p>
        <div class="perk-stage flex flex-col justify-between p-4" aria-hidden="true">
          <div class="flex flex-1 items-center justify-center gap-2.5">
            <div class="flex flex-col gap-2">
              <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f2631] text-[#02a9ff]">
                <UiBaseIcon :path="ANILIST_ICON_PATH" :size="22" />
              </span>
              <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2e51a2] text-[#fff]">
                <UiBaseIcon :path="MYANIMELIST_ICON_PATH" :size="22" />
              </span>
            </div>
            <span class="sync-line h-0.5 w-8 rounded-full" />
            <UiBaseIcon :path="mdiSync" :size="20" class="text-brand motion-safe:animate-[spin_3s_linear_infinite]" />
            <span class="sync-line h-0.5 w-8 rounded-full" />
            <img src="/logo-38d6e06a.webp" alt="" class="h-12 w-12 rounded-xl" />
          </div>
          <div class="perk-sub flex items-center gap-3 p-2.5">
            <img src="/assets/supporters/ep6.webp" alt="" width="480" height="270" loading="lazy" class="h-12 w-[5.3rem] shrink-0 rounded-lg object-cover" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-semibold text-ink">{{ SHOW }}</p>
              <div class="mt-2 flex items-center gap-2">
                <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-lift">
                  <span class="block h-full rounded-full bg-brand-solid transition-[width] duration-700" :style="{ width: `${(progress / SHOW_EPISODES) * 100}%` }" />
                </span>
                <span :key="progress" class="perk-swap text-[11px] font-semibold tabular-nums text-ink">{{ progress }}/{{ SHOW_EPISODES }}</span>
              </div>
            </div>
          </div>
        </div>
      </li>

      <!-- Your AniList lists: each list filters the results below it -->
      <li class="perk-card" data-reveal style="--reveal-step: 2">
        <div class="perk-head">
          <h3 class="perk-title">
            {{ t('support.shared.titles.lists') }}
          </h3>
          <span class="perk-example">{{ t('support.shared.example') }}</span>
        </div>
        <p class="perk-desc">{{ t('support.shared.descriptions.lists') }}</p>
        <div class="perk-stage flex flex-col justify-between gap-3 p-4">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="(list, i) in CUSTOM_LISTS"
              :key="list.name"
              type="button"
              class="rounded-full px-3 py-1 text-xs font-semibold transition-colors"
              :class="i === activeList ? 'bg-brand-solid text-on-accent' : 'bg-surface-lift text-ink-muted hover:text-ink'"
              :aria-pressed="i === activeList"
              data-testid="perk-custom-list"
              @click="pickList(i)"
            >
              {{ list.name }}
            </button>
          </div>
          <div class="grid min-h-0 flex-1 grid-cols-2 grid-rows-[1.4fr_1fr] gap-2" aria-hidden="true">
            <img
              v-for="(shot, i) in CUSTOM_LISTS[activeList]?.shots"
              :key="`${activeList}-${shot}`"
              :src="`/assets/supporters/${shot}.webp`"
              alt=""
              loading="lazy"
              class="perk-swap h-full min-h-0 w-full rounded-lg object-cover"
              :class="i === 0 ? 'col-span-2' : ''"
              :style="{ animationDelay: `${i * 70}ms` }"
              data-testid="perk-custom-list-shot"
            />
          </div>
        </div>
      </li>

      <!-- Request boosts: one boost is worth five votes and moves a title up the ranking -->
      <li class="perk-card md:col-span-2" data-reveal style="--reveal-step: 0">
        <div class="perk-head">
          <h3 class="perk-title">{{ t('support.shared.titles.boosts') }}</h3>
          <span class="perk-example">{{ t('support.shared.example') }}</span>
        </div>
        <p class="perk-desc">{{ t('support.shared.descriptions.boosts') }}</p>
        <div class="perk-stage p-3">
          <TransitionGroup tag="ol" name="perk-rank" class="relative flex flex-col gap-1.5">
            <li v-for="(request, i) in ranked" :key="request.id" class="perk-sub flex items-center gap-3 p-1.5 pe-2" :data-testid="`perk-request-${request.id}`">
              <span class="w-7 shrink-0 text-center text-sm font-bold tabular-nums" :class="i === 0 ? 'text-brand' : 'text-ink-muted'">#{{ i + 1 }}</span>
              <img :src="`/assets/supporters/cover-${request.id}.webp`" alt="" width="120" height="169" loading="lazy" class="h-10 w-7 shrink-0 rounded-md object-cover" />
              <p class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ request.title }}</p>
              <span class="relative flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums text-ink">
                <UiBaseIcon :path="mdiThumbUp" :size="14" class="text-ink-faint" />
                <span :key="request.score" class="perk-swap" data-testid="perk-request-score">{{ request.score }}</span>
                <span v-if="boosted === request.id" class="perk-plus absolute -top-3 right-0 text-xs font-bold text-brand">+{{ BOOST_VOTES }}</span>
              </span>
              <button
                type="button"
                class="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
                :class="boosted === request.id ? 'bg-brand-solid text-on-accent' : 'bg-surface-lift text-ink-muted hover:text-ink'"
                :aria-pressed="boosted === request.id"
                :aria-label="t('requests.boost.action')"
                data-testid="perk-boost"
                @click="toggleBoost(request.id)"
              >
                <UiBaseIcon :path="mdiRocketLaunch" :size="13" />
                <span class="hidden sm:inline">{{ boosted === request.id ? t('requests.boost.boosted') : t('requests.boost.action') }}</span>
              </button>
            </li>
          </TransitionGroup>
        </div>
      </li>

      <!-- Word alerts: follow a word and hear when new sentences with it arrive -->
      <li class="perk-card" data-reveal style="--reveal-step: 1">
        <div class="perk-head">
          <h3 class="perk-title">{{ t('notifications.alerts.title') }}</h3>
          <span class="perk-example">{{ t('support.shared.example') }}</span>
        </div>
        <p class="perk-desc">{{ t('support.shared.descriptions.alerts') }}</p>
        <div class="perk-stage flex flex-col justify-center gap-3 p-4">
          <div class="perk-sub flex items-center gap-2 p-3">
            <span lang="ja" class="text-2xl font-bold text-ink">{{ ALERT_WORD }}</span>
            <span lang="ja" class="text-sm text-ink-muted">あう</span>
            <button
              type="button"
              class="ms-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
              :class="following ? 'bg-brand-solid text-on-accent' : 'bg-surface-lift text-ink-muted hover:text-ink'"
              :aria-pressed="following"
              data-testid="perk-follow"
              @click="toggleFollow"
            >
              <UiBaseIcon :path="following ? mdiBellRing : mdiBellOutline" :size="14" />
              {{ following ? t('notifications.watch.following') : t('notifications.watch.follow') }}
            </button>
          </div>
          <div class="h-[7.5rem]" aria-hidden="true">
            <div v-if="following && alertShown" class="perk-sub perk-swap p-3" data-testid="perk-alert">
              <p class="flex items-center gap-2 text-sm font-semibold text-ink">
                <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                  <UiBaseIcon :path="mdiBellRing" :size="13" />
                </span>
                {{ t('notifications.kinds.wordDigest', { count: ALERT_SHOTS.length, word: ALERT_WORD }) }}
              </p>
              <div class="mt-2.5 grid grid-cols-3 gap-1.5">
                <img v-for="shot in ALERT_SHOTS" :key="shot" :src="`/assets/supporters/${shot}.webp`" alt="" loading="lazy" class="aspect-video w-full rounded-md object-cover" />
              </div>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.perk-card {
  /* Grid items default to their content's width; truncated text inside needs them free to shrink. */
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-radius: 1.5rem;
  background: var(--card-background);
  padding: 1.5rem;
}
.perk-head {
  display: flex;
  min-height: 1.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0 0.25rem;
}
.perk-title {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.25;
  color: var(--ink);
}
.perk-desc {
  margin-top: 0.375rem;
  margin-bottom: 1.25rem;
  padding: 0 0.25rem;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--ink-muted);
}
.perk-example {
  flex-shrink: 0;
  border-radius: 9999px;
  background: var(--surface-lift);
  padding: 0.1875rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ink-muted);
}
/* The stage every demo sits on: one height across the grid, a step below the card. */
.perk-stage {
  position: relative;
  margin-top: auto;
  height: 16rem;
  overflow: hidden;
  border-radius: 1.125rem;
  background: var(--background);
}
/* A raised card on the stage, as the real UI would draw it. */
.perk-sub {
  border-radius: 0.875rem;
  background: var(--card-background);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.08),
    0 8px 24px -12px rgb(0 0 0 / 0.25);
}
.perk-swap {
  animation: perk-swap 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes perk-swap {
  from {
    opacity: 0;
    transform: translateY(0.375rem);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.perk-rank-move {
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
.perk-plus {
  animation: perk-plus 0.9s ease-out both;
}
@keyframes perk-plus {
  0% {
    opacity: 0;
    transform: translateY(0.5rem);
  }
  30% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(-0.5rem);
  }
}
.sync-line {
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  background-size: 200% 100%;
  animation: sync-flow 1.6s linear infinite;
}
@keyframes sync-flow {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}
</style>
