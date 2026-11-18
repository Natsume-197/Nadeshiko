<script setup lang="ts">
import { isJoyoKanji } from '#shared/data/joyoKanji';
import WordCardKanji from '~/components/search/segment/WordCardKanji.vue';
import type { KanjiCardData, KanjiCardWordRef } from '~/utils/kanjiLookup';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

/**
 * A kanji's own page (task 44): the word card's kanji view with room to breathe. Every word and every related kanji
 * the card only starts, a link to the sentences that use it, and an address a reader can share. Server-rendered so
 * search engines can read it; only the 2,136 jōyō kanji are indexed (and listed in the sitemap), the rest are
 * `noindex, follow` so thousands of rare kanji do not flood the crawl.
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();

const character = computed(() => String(route.params.character ?? ''));
const glossLocale = computed<'en' | 'es'>(() => (locale.value === 'es' ? 'es' : 'en'));

// One character only (a kanji outside the BMP is two UTF-16 units).
if ([...character.value].length !== 1) {
  throw createError({ statusCode: 404, statusMessage: 'Kanji Not Found' });
}

const { data: card, error } = await useAsyncData(
  () => `kanji-${character.value}-${glossLocale.value}`,
  () =>
    $fetch<KanjiCardData>(`/api/dictionary/kanji/${encodeURIComponent(character.value)}`, {
      query: { locale: glossLocale.value, related: 'all' },
    }),
  { server: true, lazy: false },
);

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
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
  twitterTitle: () => title.value,
  twitterDescription: () => description.value,
});

const openKanji = (other: string) => {
  void router.push(localePath(`/kanji/${encodeURIComponent(other)}`));
};

/** A word goes to its sentences: on this site, that is the page for a word. */
const openWord = (word: KanjiCardWordRef) => {
  void router.push(localePath(`/search/${encodeURIComponent(word.headword)}`));
};

const sentencesPath = computed(() => ({
  path: localePath(`/search/${encodeURIComponent(character.value)}`),
  query: { match: 'contains' },
}));
</script>

<template>
  <div class="nd-page px-4 md:px-0 pb-16 pt-6">
    <header class="kanji-page__head">
      <h1 class="kanji-page__kanji" lang="ja">{{ character }}</h1>
      <NuxtLink :to="sentencesPath" class="kanji-page__sentences" data-testid="kanji-page-sentences">
        {{ $t('tokenTooltip.searchKanji', { kanji: character }) }}
      </NuxtLink>
    </header>

    <WordCardKanji
      :kanji="character"
      :card="card ?? null"
      state="shown"
      :locale="glossLocale"
      full
      @open-kanji="openKanji"
      @open-word="openWord"
    />
  </div>
</template>

<style scoped>
.kanji-page__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.kanji-page__kanji {
  font-size: 44px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ink);
}

.kanji-page__sentences {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent-soft);
}

.kanji-page__sentences:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
