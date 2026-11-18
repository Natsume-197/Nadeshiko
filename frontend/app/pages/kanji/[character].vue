<script setup lang="ts">
import { isJoyoKanji } from '#shared/data/joyoKanji';
import KanjiStrokes from '~/components/search/segment/KanjiStrokes.vue';
import WordCardKanji from '~/components/search/segment/WordCardKanji.vue';
import { stripUnreadTokenFields } from '~/composables/useSearchFetch';
import { type KanjiCardData, type KanjiCardWordRef, kanjiBadges, splitKunReading } from '~/utils/kanjiLookup';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';
import { resolveSearchResponse } from '~/utils/resolvers';
import type { SdkSearchResponse, SearchResponse } from '~/types/search';

/**
 * A kanji's own page (task 44). What no dictionary site has: the kanji in real sentences from anime, drama and
 * YouTube, with screenshot, audio and translation, beside everything the word card knows about it.
 *
 * Header: the kanji drawn stroke by stroke on a practice-sheet grid, its meaning as the headline, its on and kun
 * readings, its badges, and the way to all its sentences. Below, two columns on wide screens: the entry (readings,
 * composition, related kanji) on the left, the words written with it and its sentences on the right; one column on
 * a phone. Server-rendered so search engines read it; only the 2,136 jōyō kanji are indexed (and in the sitemap), the
 * rest are `noindex, follow` so thousands of rare kanji do not flood the crawl.
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();

const character = computed(() => String(route.params.character ?? ''));
const glossLocale = computed<'en' | 'es'>(() => (locale.value === 'es' ? 'es' : 'en'));

/** How many words show before "Show all". */
const WORDS_SHOWN = 12;

// One character only (a kanji outside the BMP is two UTF-16 units).
if ([...character.value].length !== 1) {
  throw createError({ statusCode: 404, statusMessage: 'Kanji Not Found' });
}

const [{ data: card, error }, { data: sentences }] = await Promise.all([
  useAsyncData(
    () => `kanji-${character.value}-${glossLocale.value}`,
    () =>
      $fetch<KanjiCardData>(`/api/dictionary/kanji/${encodeURIComponent(character.value)}`, {
        query: { locale: glossLocale.value, related: 'all' },
      }),
    { server: true, lazy: false },
  ),
  // The sentences are the page's reason to exist, but the entry stands without them: a failed search leaves the
  // section saying so rather than failing the page.
  useAsyncData(
    () => `kanji-sentences-${character.value}`,
    async (): Promise<SearchResponse | null> => {
      try {
        const raw = await $fetch<SdkSearchResponse>(
          `/api/dictionary/kanji-sentences/${encodeURIComponent(character.value)}`,
        );
        return stripUnreadTokenFields(resolveSearchResponse(raw));
      } catch {
        return null;
      }
    },
    { server: true, lazy: false },
  ),
]);

if (error.value) {
  const status = (error.value as { statusCode?: number }).statusCode;
  throw createError(
    status === 404
      ? { statusCode: 404, statusMessage: 'Kanji Not Found' }
      : { statusCode: 503, statusMessage: 'Dictionary temporarily unavailable' },
  );
}
if (!card.value) throw createError({ statusCode: 404, statusMessage: 'Kanji Not Found' });

// Rare kanji stay reachable and followable, but out of the index.
useRobotsRule(isJoyoKanji(character.value) ? undefined : 'noindex, follow');

const badges = computed(() => (card.value ? kanjiBadges(card.value, t) : []));
const meaningsTag = computed(() =>
  card.value && card.value.meaningsLanguage !== glossLocale.value ? card.value.meaningsLanguage.toUpperCase() : null,
);
/** A still from the first sentence, for link previews only. */
const shareImage = computed(() => sentences.value?.results[0]?.segment.urls.imageUrl ?? null);

/** The readings in the header, on then kun, okurigana set apart. */
const headerReadings = computed(() => {
  const list = card.value?.readings ?? [];
  return (['on', 'kun'] as const)
    .map((kind) => ({
      kind,
      readings: list
        .filter((entry) => entry.kind === kind)
        .map((entry) => (kind === 'kun' ? splitKunReading(entry.reading) : { stem: entry.reading, okurigana: '' })),
    }))
    .filter((group) => group.readings.length > 0);
});

const allWords = ref(false);
const shownWords = computed(() =>
  allWords.value ? (card.value?.words ?? []) : (card.value?.words.slice(0, WORDS_SHOWN) ?? []),
);

const meaning = computed(() => card.value?.meanings.slice(0, 3).join(', ') ?? '');
const readings = computed(() =>
  (card.value?.readings ?? [])
    .slice(0, 4)
    .map((reading) => reading.reading)
    .join('、'),
);
const title = computed(() => t('seo.kanji.title', { kanji: character.value, meaning: meaning.value }));
const description = computed(() =>
  t('seo.kanji.description', { kanji: character.value, meaning: meaning.value, readings: readings.value }),
);

useSeoMeta({
  title: () => title.value,
  description: () => description.value,
  ogTitle: () => title.value,
  ogDescription: () => description.value,
  ogImage: () => shareImage.value ?? `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
  twitterTitle: () => title.value,
  twitterDescription: () => description.value,
});

const openKanji = (other: string) => {
  void router.push(localePath(`/kanji/${encodeURIComponent(other)}`));
};

/** A word goes to its sentences: on this site, that is the page for a word. */
const wordPath = (word: KanjiCardWordRef) => localePath(`/search/${encodeURIComponent(word.headword)}`);
const openWord = (word: KanjiCardWordRef) => {
  void router.push(wordPath(word));
};

const sentencesPath = computed(() => ({
  path: localePath(`/search/${encodeURIComponent(character.value)}`),
  query: { match: 'contains' },
}));
</script>

<template>
  <div v-if="card" class="kanji-page">
    <!-- The header: the kanji written stroke by stroke on a practice grid, beside what it means and how it is read. -->
    <section class="kanji-hero">
      <div class="nd-page kanji-hero__inner">
        <div class="kanji-hero__tile">
          <KanjiStrokes
            v-if="card.strokes.length > 0"
            :kanji="character"
            :strokes="card.strokes"
            :numbers="card.strokeNumbers"
            grid
          />
          <span v-else class="kanji-hero__glyph" lang="ja">{{ character }}</span>
        </div>

        <div class="kanji-hero__text">
          <h1 class="kanji-hero__title">
            <span class="sr-only" lang="ja">{{ character }}: </span>
            <span v-if="meaningsTag" class="kanji-hero__lang">{{ meaningsTag }}</span>{{ card.meanings.join(', ') }}
          </h1>

          <dl v-if="headerReadings.length > 0" class="kanji-hero__readings">
            <div v-for="group in headerReadings" :key="group.kind" class="kanji-hero__reading-group">
              <dt class="kanji-hero__reading-kind">{{ $t(group.kind === 'on' ? 'tokenTooltip.kanjiOn' : 'tokenTooltip.kanjiKun') }}</dt>
              <dd lang="ja">
                <template v-for="(reading, ri) in group.readings" :key="ri"><span v-if="ri > 0" class="kanji-hero__dot">・</span>{{ reading.stem }}<span v-if="reading.okurigana" class="kanji-hero__okurigana">{{ reading.okurigana }}</span></template>
              </dd>
            </div>
          </dl>

          <div class="kanji-hero__badges">
            <span
              v-for="badge in badges"
              :key="badge.id"
              class="kanji-hero__badge"
              :class="{ 'is-strong': badge.strong }"
            >{{ badge.text }}</span>
          </div>

          <NuxtLink :to="sentencesPath" class="kanji-hero__cta" data-testid="kanji-page-sentences">
            {{ $t('tokenTooltip.kanjiAllSentences', { kanji: character }) }}
          </NuxtLink>
        </div>
      </div>
    </section>

    <div class="nd-page kanji-page__body">
      <!-- The entry beside the words written with the kanji. -->
      <div class="kanji-page__top">
        <aside class="kanji-page__entry">
          <WordCardKanji
            :kanji="character"
            :card="card"
            state="shown"
            :locale="glossLocale"
            full
            part="entry"
            @open-kanji="openKanji"
            @open-word="openWord"
          />
        </aside>

        <section v-if="card.words.length > 0" class="kanji-page__words-section">
          <h2 class="kanji-page__heading">{{ $t('tokenTooltip.kanjiWords') }}</h2>
          <ul class="kanji-page__words">
            <li v-for="word in shownWords" :key="word.id">
              <NuxtLink :to="wordPath(word)" class="kanji-page__word" data-testid="kanji-page-word">
                <span class="kanji-page__word-text" lang="ja">{{ word.headword }}</span>
                <span v-if="word.reading && word.reading !== word.headword" class="kanji-page__word-reading" lang="ja">{{ word.reading }}</span>
                <span v-if="word.gloss" class="kanji-page__word-gloss">{{ word.gloss }}</span>
              </NuxtLink>
            </li>
          </ul>
          <button
            v-if="card.words.length > WORDS_SHOWN"
            type="button"
            class="kanji-page__more"
            data-testid="kanji-page-more-words"
            @click="allWords = !allWords"
          >{{ allWords ? $t('tokenTooltip.showLess') : $t('tokenTooltip.kanjiAllWords', { count: card.words.length }) }}</button>
        </section>
      </div>

      <!-- The sentences, the page's reason to exist, at the full width the search page gives them. -->
      <section class="kanji-page__section" data-testid="kanji-page-sentences-section">
        <h2 class="kanji-page__heading">{{ $t('tokenTooltip.kanjiSentencesHeading', { kanji: character }) }}</h2>
        <template v-if="sentences && sentences.results.length > 0">
          <SearchSegmentContainer :searchData="sentences" :isLoading="false" />
          <NuxtLink :to="sentencesPath" class="kanji-page__all-sentences">
            {{ $t('tokenTooltip.kanjiAllSentences', { kanji: character }) }} →
          </NuxtLink>
        </template>
        <p v-else-if="sentences" class="kanji-page__empty">{{ $t('tokenTooltip.kanjiNoSentences', { kanji: character }) }}</p>
        <p v-else class="kanji-page__empty">{{ $t('tokenTooltip.kanjiSentencesFailed') }}</p>
      </section>

      <!-- The kanji around it, last: somewhere to go next. -->
      <section v-if="card.sameRadical.length > 0 || card.containedIn.length > 0" class="kanji-page__section">
        <h2 class="kanji-page__heading">{{ $t('tokenTooltip.kanjiRelatedHeading') }}</h2>
        <div class="kanji-page__related">
          <WordCardKanji
            :kanji="character"
            :card="card"
            state="shown"
            :locale="glossLocale"
            full
            part="related"
            @open-kanji="openKanji"
            @open-word="openWord"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* The header. */
.kanji-hero {
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, var(--surface), var(--background));
}

.kanji-hero__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px 36px;
  padding: 36px 16px 32px;
}

/* A practice-sheet square: frame here, dashed cross from KanjiStrokes. */
.kanji-hero__tile {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 196px;
  height: 196px;
  padding: 6px;
  border: 1.5px solid var(--line);
  border-radius: 16px;
  background: var(--background);
}

.kanji-hero__glyph {
  font-size: 140px;
  line-height: 1;
  color: var(--ink);
}

.kanji-hero__text {
  flex: 1 1 320px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.kanji-hero__title {
  font-size: 32px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.kanji-hero__lang {
  display: inline-flex;
  margin-right: 10px;
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ink-muted);
  vertical-align: 7px;
}

.kanji-hero__readings {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 24px;
}

.kanji-hero__reading-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.kanji-hero__reading-kind {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
}

.kanji-hero__reading-group dd {
  font-size: 20px;
  color: var(--ink);
}

.kanji-hero__dot,
.kanji-hero__okurigana {
  color: var(--ink-faint);
}

.kanji-hero__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kanji-hero__badge {
  padding: 3px 11px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.kanji-hero__badge.is-strong {
  border-color: color-mix(in srgb, var(--accent-soft) 45%, transparent);
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  color: var(--accent-soft);
}

.kanji-hero__cta {
  align-self: flex-start;
  margin-top: 2px;
  padding: 9px 18px;
  border-radius: 999px;
  background: var(--accent);
  font-size: 14px;
  font-weight: 700;
  color: rgb(var(--c-white));
  transition: filter 0.12s ease;
}

.kanji-hero__cta:hover {
  filter: brightness(1.1);
}

/* The body: entry and words side by side, then sentences and related kanji at full width. */
.kanji-page__body {
  display: flex;
  flex-direction: column;
  gap: 44px;
  padding: 28px 16px 64px;
}

.kanji-page__top {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 32px;
}

/* On a phone the words come before the entry (the header already gives the readings). */
.kanji-page__entry {
  order: 2;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
}

.kanji-page__words-section {
  order: 1;
  min-width: 0;
}

@media (min-width: 1024px) {
  .kanji-page__top {
    grid-template-columns: 360px minmax(0, 1fr);
    align-items: start;
  }

  .kanji-page__top > .kanji-page__entry {
    order: 0;
  }
}

.kanji-page__section {
  min-width: 0;
}

.kanji-page__related {
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
}

.kanji-page__heading {
  margin-bottom: 12px;
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
}

/* Words: a grid of small cards, each a search for that word. */
.kanji-page__words {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.kanji-page__word {
  display: flex;
  flex-direction: column;
  gap: 2px;
  height: 100%;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease;
}

.kanji-page__word:hover {
  border-color: var(--accent-soft);
  background: var(--surface-lift);
}

.kanji-page__word-text {
  font-size: 20px;
  font-weight: 600;
  color: var(--ink);
}

.kanji-page__word-reading {
  font-size: 13px;
  color: var(--ink-muted);
}

.kanji-page__word-gloss {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 13px;
  color: var(--ink-muted);
}

.kanji-page__more,
.kanji-page__all-sentences {
  display: inline-block;
  margin-top: 12px;
  padding: 0;
  border: 0;
  background: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent-soft);
  cursor: pointer;
}

.kanji-page__more:hover,
.kanji-page__all-sentences:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.kanji-page__empty {
  font-size: 14px;
  color: var(--ink-muted);
}

.kanji-page__word:focus-visible,
.kanji-page__more:focus-visible,
.kanji-page__all-sentences:focus-visible,
.kanji-hero__cta:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .kanji-page__words {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .kanji-hero__inner {
    padding: 24px 16px 22px;
  }

  .kanji-hero__tile {
    width: 156px;
    height: 156px;
  }

  .kanji-hero__title {
    font-size: 24px;
  }

  .kanji-hero__reading-group dd {
    font-size: 17px;
  }
}
</style>
