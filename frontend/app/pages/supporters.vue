<script setup lang="ts">
import {
  mdiArrowRight,
  mdiBookOpenPageVariantOutline,
  mdiCardsOutline,
  mdiCardTextOutline,
  mdiCheck,
  mdiFilterOutline,
  mdiHistory,
  mdiKeyOutline,
  mdiMapOutline,
  mdiPatreon,
  mdiThumbUpOutline,
  mdiTools,
  mdiTranslate,
  mdiYoutube,
} from '@mdi/js';
import { PATREON_URL } from '#shared/utils/socialLinks';
import { httpUrl } from '~/utils/strings';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

type Status = 'PROPOSED' | 'CONSIDERING' | 'PLANNED' | 'IN_PROGRESS' | 'RELEASED' | 'DECLINED';
interface RoadmapItem {
  id: string;
  kind: 'CONTENT' | 'FEATURE';
  status: Status;
  title: string;
  description: string;
  sourceUrl: string | null;
  coverUrl: string | null;
  targetDate: string | null;
  introducedInVersion: string | null;
  sortOrder: number;
  createdAt: string;
  proposerName: string | null;
}
const { t, locale } = useI18n();
const localePath = useLocalePath();

useSeoMeta({
  title: () => t('supporters.seoTitle'),
  description: () => t('supporters.seoDescription'),
  ogTitle: () => t('supporters.seoTitle'),
  ogDescription: () => t('supporters.seoDescription'),
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
});

const { data, error } = await useAsyncData('roadmap', () =>
  $fetch<{ items: RoadmapItem[]; patreonUrl: string }>('/v1/roadmap'),
);
const items = computed(() => data.value?.items ?? []);

/**
 * The page's two views, as tabs under the hero. The hash names the open one (`#support`, `#roadmap`), so links from
 * the footer, Settings and the old `/roadmap` URL open the right tab. Both stay in the server HTML (`v-show`) so
 * crawlers see the tiers and the roadmap alike.
 */
type PageTab = 'support' | 'roadmap';
const PAGE_TABS: readonly PageTab[] = ['support', 'roadmap'];
const pageTab = ref<PageTab>('support');

function tabFromHash(): PageTab {
  return window.location.hash === '#roadmap' ? 'roadmap' : 'support';
}

function selectPageTab(tab: PageTab) {
  pageTab.value = tab;
  history.replaceState(history.state, '', `#${tab}`);
}

function syncTabFromHash() {
  pageTab.value = tabFromHash();
}

onMounted(() => {
  syncTabFromHash();
  window.addEventListener('hashchange', syncTabFromHash);
});
onBeforeUnmount(() => window.removeEventListener('hashchange', syncTabFromHash));

/** Only feature roadmap entries live here; title requests moved to `/requests`. */
const featureItems = computed(() =>
  items.value
    .filter((item) => item.kind === 'FEATURE')
    .sort((a, b) => {
      const aReleased = a.status === 'RELEASED';
      const bReleased = b.status === 'RELEASED';
      if (aReleased !== bReleased) return aReleased ? 1 : -1;
      if (!aReleased) return a.sortOrder - b.sortOrder;
      return (b.targetDate ?? '').localeCompare(a.targetDate ?? '') || a.sortOrder - b.sortOrder;
    }),
);

const featureIcons: Record<string, string> = {
  'Content requests': mdiThumbUpOutline,
  'Better search filters': mdiFilterOutline,
  'Public roadmap': mdiMapOutline,
  'Seven interface languages': mdiTranslate,
  'YouTube playback in search': mdiYoutube,
  'Word cards': mdiCardTextOutline,
  'Your own dictionaries': mdiBookOpenPageVariantOutline,
  'Rich Anki mining': mdiCardsOutline,
  'Search history and familiar titles': mdiHistory,
  'Granular API keys': mdiKeyOutline,
};

const featureTranslationKeys: Record<string, string> = {
  'Content requests': 'contentRequests',
  'Better search filters': 'searchFilters',
  'Public roadmap': 'publicRoadmap',
  'Seven interface languages': 'interfaceLanguages',
  'YouTube playback in search': 'youtubePlayback',
  'Word cards': 'wordCards',
  'Your own dictionaries': 'ownDictionaries',
  'Rich Anki mining': 'ankiMining',
  'Search history and familiar titles': 'searchHistory',
  'Granular API keys': 'apiKeys',
};

function featureIcon(item: RoadmapItem) {
  return featureIcons[item.title] ?? mdiTools;
}

function featureTitle(item: RoadmapItem) {
  const key = featureTranslationKeys[item.title];
  return key ? t(`roadmap.features.${key}.title`) : item.title;
}

function featureDescription(item: RoadmapItem) {
  const key = featureTranslationKeys[item.title];
  return key ? t(`roadmap.features.${key}.description`) : item.description;
}

function featureDate(item: RoadmapItem) {
  if (item.status !== 'RELEASED') return t('roadmap.featureSoon');
  if (!item.targetDate) return t('roadmap.featureReleased');
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${item.targetDate}T00:00:00Z`));
}
</script>

<template>
  <div class="roadmap-page -mt-3 pb-16 text-ink">
    <!-- Hero keeps a dedicated dark backdrop + scrim behind the Haruhi banner so contrast holds on every theme. -->
    <section
      class="roadmap-banner relative flex min-h-[16rem] items-center overflow-hidden border-b border-hairline bg-[#161214] px-4 py-10 text-white md:min-h-[17.5rem] md:py-12"
    >
      <div class="roadmap-banner-image absolute inset-0" aria-hidden="true" />
      <div class="absolute inset-0 bg-gradient-to-r from-black/75 via-black/50 to-black/25" aria-hidden="true" />
      <div class="nd-page relative">
        <h1 class="max-w-3xl text-4xl font-black leading-[1.04] tracking-tight text-white md:text-5xl">
          {{ t('supporters.title') }}
        </h1>
        <p class="mt-4 max-w-2xl text-base leading-relaxed text-white/80 md:text-lg">{{ t('supporters.intro') }}</p>
        <div class="mt-6 flex flex-wrap gap-3">
          <a
            :href="PATREON_URL"
            target="_blank"
            rel="noopener"
            data-testid="supporters-hero-patreon-cta"
            class="inline-flex h-11 items-center gap-2 rounded-lg bg-[#ff424d] px-5 font-semibold text-white transition-colors hover:bg-[#ff5962]"
          >
            <UiBaseIcon :path="mdiPatreon" size="19" /> {{ t('roadmap.support') }}
          </a>
          <NuxtLink
            :to="localePath('/requests')"
            data-testid="supporters-requests-cta"
            class="inline-flex h-11 items-center justify-center rounded-lg border border-white/25 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            {{ t('roadmap.proposeCta') }}
          </NuxtLink>
        </div>
      </div>
    </section>

    <main class="nd-page px-4 md:px-0">
      <div class="flex justify-center pt-8" role="tablist" :aria-label="t('supporters.title')">
        <div class="inline-flex rounded-full border border-hairline bg-surface p-1">
          <button
            v-for="tab in PAGE_TABS"
            :id="`tab-${tab}`"
            :key="tab"
            type="button"
            role="tab"
            :aria-selected="pageTab === tab"
            :aria-controls="`panel-${tab}`"
            :data-testid="`supporters-tab-${tab}`"
            class="rounded-full px-6 py-2 text-sm font-bold transition"
            :class="pageTab === tab ? 'bg-brand-solid text-on-accent shadow-sm' : 'text-ink-muted hover:text-ink'"
            @click="selectPageTab(tab)"
          >
            {{ tab === 'support' ? t('supporters.tabs.tiers') : t('roadmap.title') }}
          </button>
        </div>
      </div>

      <div v-show="pageTab === 'support'" id="panel-support" role="tabpanel" aria-labelledby="tab-support" class="pt-8">
        <SupportTiers />
      </div>

      <section
        v-show="pageTab === 'roadmap'"
        id="panel-roadmap"
        role="tabpanel"
        aria-labelledby="tab-roadmap"
        class="pt-8"
      >
        <p class="text-center text-sm text-ink-muted">
          {{ t('roadmap.intro') }}
          <NuxtLink :to="localePath('/requests')" class="text-brand hover:underline">{{
            t('roadmap.requestsLink')
          }}</NuxtLink>
        </p>

        <div id="features" class="py-8 md:py-10">
          <div v-if="error" class="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-400">
            {{ t('roadmap.loadError') }}
          </div>
          <ol v-else class="roadmap-timeline relative mx-auto max-w-4xl">
            <li
              v-for="item in featureItems"
              :key="item.id"
              class="feature-roadmap-item relative grid gap-3 pb-8 pl-8 md:grid-cols-[10rem_2rem_1fr] md:gap-x-3 md:gap-y-0 md:pl-0"
            >
              <span
                class="roadmap-timeline-dot absolute left-0 top-0 z-10 flex size-5 items-center justify-center overflow-hidden rounded-full border-[3px] md:left-[11.125rem] md:top-[calc(50%-1rem)] md:-translate-y-1/2"
                :class="
                  item.status === 'RELEASED'
                    ? 'border-transparent bg-ink-faint text-background'
                    : 'border-[var(--accent)] bg-background'
                "
              >
                <UiBaseIcon v-if="item.status === 'RELEASED'" :path="mdiCheck" w="w-3" h="h-3" size="12" />
              </span>
              <div
                class="flex self-stretch flex-col items-start justify-center text-sm font-semibold md:items-end md:text-right"
                :class="item.status === 'RELEASED' ? 'text-ink-faint' : 'text-brand'"
              >
                <time>{{ featureDate(item) }}</time>
                <span v-if="item.introducedInVersion" class="text-xs text-ink-faint"
                  >v{{ item.introducedInVersion }}</span
                >
              </div>
              <span class="hidden md:block" aria-hidden="true" />
              <article class="feature-roadmap-content relative">
                <h2 class="flex items-center gap-2 text-xl font-bold text-ink">
                  <UiBaseIcon :path="featureIcon(item)" size="21" class="shrink-0 text-ink-muted" />{{
                    featureTitle(item)
                  }}
                </h2>
                <p v-if="item.description" class="mt-2 max-w-2xl leading-relaxed text-ink-muted">
                  {{ featureDescription(item) }}
                </p>
                <a
                  v-if="httpUrl(item.sourceUrl)"
                  :href="httpUrl(item.sourceUrl) ?? undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-hover"
                >
                  {{ t('roadmap.viewSource') }} <UiBaseIcon :path="mdiArrowRight" size="14" />
                </a>
              </article>
            </li>
            <li
              v-if="!featureItems.length"
              class="rounded-lg border border-dashed border-hairline p-8 text-center text-sm text-ink-faint"
            >
              {{ t('roadmap.emptyFeatures') }}
            </li>
          </ol>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.roadmap-banner-image {
  background-image: url('/assets/roadmap-haruhi.webp');
  background-position: center 82%;
  background-size: cover;
  filter: grayscale(12%) saturate(72%) brightness(58%);
  opacity: 0.45;
}
.feature-roadmap-item::before,
.feature-roadmap-item::after {
  content: '';
  position: absolute;
  left: 0.5625rem;
  width: 2px;
  background: var(--line);
}
.feature-roadmap-item::before {
  top: 0;
  height: 0.625rem;
}
.feature-roadmap-item::after {
  top: 0.625rem;
  bottom: 0;
}
.feature-roadmap-item:first-child::before,
.feature-roadmap-item:last-child::after {
  display: none;
}
@media (min-width: 768px) {
  .feature-roadmap-item::before,
  .feature-roadmap-item::after {
    left: 11.6875rem;
  }
  .feature-roadmap-item::before {
    height: calc(50% - 1rem);
  }
  .feature-roadmap-item::after {
    top: calc(50% - 1rem);
  }
}
.feature-roadmap-content::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1rem;
  left: 0;
  height: 1px;
  background: var(--line);
}
</style>
