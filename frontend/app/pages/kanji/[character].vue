<script setup lang="ts">
import { isJoyoKanji } from '#shared/data/joyoKanji';
import KanjiStrokes from '~/components/search/segment/KanjiStrokes.vue';
import WordCardKanji from '~/components/search/segment/WordCardKanji.vue';
import { stripUnreadTokenFields } from '~/composables/useSearchFetch';
import {
  type KanjiCardData,
  type KanjiCardExample,
  type KanjiCardWordRef,
  kanjiBadges,
  splitKunReading,
} from '~/utils/kanjiLookup';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';
import { resolveSearchResponse } from '~/utils/resolvers';
import type { SdkSearchResponse, SearchResponse } from '~/types/search';

/**
 * A kanji's own page (task 44). What no dictionary site has: the kanji in real sentences from anime, drama,
 * audiobooks and YouTube, with screenshot, audio and translation.
 *
 * One column, in the order a learner asks, each fact said once:
 *   1. What is it: the kanji, its meaning, its levels, and one line of facts (strokes, rank, how many sentences).
 *   2. How is it read: one row per reading, most used first, with its share of the sentences and its words. A row
 *      is also the filter for the sentences below.
 *   3. Where do I meet it: the sentences, all of them or one reading's.
 *   4. More words: the frequent words not already shown under a reading.
 *   5. How is it written: stroke order, the parts it is built from, the radical.
 *   6. Related kanji.
 * Server-rendered so search engines read it; only the 2,136 jōyō kanji are indexed (and in the sitemap), the rest
 * are `noindex, follow` so thousands of rare kanji do not flood the crawl.
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();

const character = computed(() => String(route.params.character ?? ''));
const glossLocale = computed<'en' | 'es'>(() => (locale.value === 'es' ? 'es' : 'en'));

/** How many of the other words show before "Show all". */
const WORDS_SHOWN = 12;

// One character only (a kanji outside the BMP is two UTF-16 units).
if ([...character.value].length !== 1) {
  throw createError({ statusCode: 404, statusMessage: 'Kanji Not Found' });
}

/** How many sentences and titles have the kanji: the page's own figure, which no dictionary can give. */
interface KanjiTotals {
  sentences: number;
  titles: number;
}

const [{ data: card, error }, { data: sentenceData }] = await Promise.all([
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
    async (): Promise<{ sentences: SearchResponse; totals: KanjiTotals | null } | null> => {
      try {
        const raw = await $fetch<SdkSearchResponse & { totals: KanjiTotals | null }>(
          `/api/dictionary/kanji-sentences/${encodeURIComponent(character.value)}`,
        );
        return { sentences: stripUnreadTokenFields(resolveSearchResponse(raw)), totals: raw.totals ?? null };
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

// How many sentences each reading's example words have: the readings' order and share. One batch search for every
// word; the readings show without it.
const readingWords = [...new Set(card.value.readings.flatMap((entry) => entry.examples.map((example) => example.headword)))];
const { data: wordCounts } = await useAsyncData(
  () => `kanji-word-counts-${character.value}`,
  async (): Promise<Record<string, number> | null> => {
    if (readingWords.length === 0) return null;
    try {
      const answer = await $fetch<{ counts: Record<string, number> }>('/api/dictionary/word-counts', {
        query: { words: readingWords.join(',') },
      });
      return answer.counts;
    } catch {
      return null;
    }
  },
  { server: true, lazy: false },
);

const allSentences = computed(() => sentenceData.value?.sentences ?? null);
const totals = computed(() => sentenceData.value?.totals ?? null);
const formatCount = (count: number) => new Intl.NumberFormat(locale.value).format(count);

// Rare kanji stay reachable and followable, but out of the index.
useRobotsRule(isJoyoKanji(character.value) ? undefined : 'noindex, follow');

const meaningsTag = computed(() =>
  card.value && card.value.meaningsLanguage !== glossLocale.value ? card.value.meaningsLanguage.toUpperCase() : null,
);
/** A still from the first sentence, for link previews of kanji without their own image. */
const shareImage = computed(() => allSentences.value?.results[0]?.segment.urls.imageUrl ?? null);

// 1. What is it: the levels a learner studies by as badges, the rest as one plain line.
const LEVELS = ['jlpt', 'kanken', 'grade'];
const badges = computed(() => (card.value ? kanjiBadges(card.value, t) : []));
const levelBadges = computed(() => badges.value.filter((badge) => LEVELS.includes(badge.id)));
const facts = computed(() => {
  const list = badges.value.filter((badge) => !LEVELS.includes(badge.id)).map((badge) => badge.text);
  if (totals.value && totals.value.sentences > 0) {
    list.push(
      `${formatCount(totals.value.sentences)} ${t('tokenTooltip.kanjiSentenceCount', totals.value.sentences)} · ${formatCount(totals.value.titles)} ${t('tokenTooltip.kanjiTitleCount', totals.value.titles)}`,
    );
  }
  return list;
});

// 2. How is it read.
interface ReadingRow {
  /** `on:ショク`, `kun:た.べる`: also the key of its sentences. */
  key: string;
  kind: 'on' | 'kun';
  stem: string;
  okurigana: string;
  examples: KanjiCardExample[];
  /** Sentences with its words, added up (a sentence with two of them counts twice: close enough); null until the
   *  counts are in. A reading without example words has none we can find. */
  count: number | null;
  /** Its part of all the readings' sentences, as a whole percent; null without counts. */
  share: number | null;
}

const readingRows = computed<ReadingRow[]>(() => {
  const rows = (card.value?.readings ?? []).map((entry) => {
    let count: number | null = 0;
    if (entry.examples.length > 0) {
      count = wordCounts.value
        ? entry.examples.reduce((sum, example) => sum + (wordCounts.value?.[example.headword] ?? 0), 0)
        : null;
    }
    return {
      key: `${entry.kind}:${entry.reading}`,
      kind: entry.kind,
      ...(entry.kind === 'kun' ? splitKunReading(entry.reading) : { stem: entry.reading, okurigana: '' }),
      examples: entry.examples,
      count,
      share: null as number | null,
    };
  });
  const total = rows.reduce((sum, row) => sum + (row.count ?? 0), 0);
  for (const row of rows) row.share = total > 0 && row.count !== null ? Math.round((row.count / total) * 100) : null;
  // Most used first once the counts are in; the dictionary's order (on, then kun) until then.
  return wordCounts.value ? [...rows].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)) : rows;
});

/** A reading the sentences can be narrowed to: it has words, and they have sentences (or we do not know yet). */
const canPick = (row: ReadingRow) => row.examples.length > 0 && row.count !== 0;

// 3. Where do I meet it: every sentence, or one reading's, loaded once on first pick.
const activeReading = ref<string | null>(null);
/** Each reading's sentences once loaded; null when its search failed (retried on the next pick). */
const readingSentences = reactive<Record<string, SearchResponse | null>>({});
const readingLoading = ref(false);
const activeRow = computed(() => readingRows.value.find((row) => row.key === activeReading.value) ?? null);

async function pickReading(key: string | null): Promise<void> {
  activeReading.value = activeReading.value === key ? null : key;
  const picked = activeReading.value;
  if (picked === null || readingSentences[picked]) return;
  const row = readingRows.value.find((candidate) => candidate.key === picked);
  if (!row) return;
  readingLoading.value = true;
  try {
    const raw = await $fetch<SdkSearchResponse>('/api/dictionary/word-sentences', {
      query: { words: row.examples.map((example) => example.headword).join(',') },
    });
    readingSentences[picked] = stripUnreadTokenFields(resolveSearchResponse(raw));
  } catch {
    readingSentences[picked] = null;
  } finally {
    // A later pick owns the spinner.
    if (activeReading.value === picked) readingLoading.value = false;
  }
}

const sentences = computed(() =>
  activeReading.value === null ? allSentences.value : (readingSentences[activeReading.value] ?? null),
);

// 4. More words: the frequent ones not already under a reading.
const allWords = ref(false);
const moreWords = computed(() => {
  const shown = new Set((card.value?.readings ?? []).flatMap((entry) => entry.examples.map((example) => example.headword)));
  return (card.value?.words ?? []).filter((word) => !shown.has(word.headword));
});
const listedWords = computed(() => (allWords.value ? moreWords.value : moreWords.value.slice(0, WORDS_SHOWN)));

// 5. How is it written.
/** Whether a part is the radical the kanji is filed under, as KRADFILE or the radical table writes it. */
const isRadicalPart = (part: string) =>
  !!card.value?.radical && (part === card.value.radical.character || part === card.value.radical.glyph);
const hasRelated = computed(() => !!card.value && (card.value.sameRadical.length > 0 || card.value.containedIn.length > 0));

// Search and link previews.
const meaning = computed(() => card.value?.meanings.slice(0, 3).join(', ') ?? '');
const readingsText = computed(() =>
  (card.value?.readings ?? [])
    .slice(0, 4)
    .map((reading) => reading.reading)
    .join('、'),
);
const title = computed(() => t('seo.kanji.title', { kanji: character.value, meaning: meaning.value }));
const description = computed(() =>
  t('seo.kanji.description', { kanji: character.value, meaning: meaning.value, readings: readingsText.value }),
);

// A jōyō kanji shares an image of itself (server/routes/og/kanji); any other kanji, a frame of one of its sentences.
const requestOrigin = useRequestURL().origin;
const ogImage = computed(() =>
  isJoyoKanji(character.value)
    ? {
        url: `${requestOrigin}/og/kanji/${glossLocale.value}/${encodeURIComponent(character.value)}.png`,
        width: 1200,
        height: 630,
      }
    : { url: shareImage.value ?? `${requestOrigin}${DEFAULT_OG_IMAGE_PATH}`, width: undefined, height: undefined },
);

useSeoMeta({
  title: () => title.value,
  description: () => description.value,
  ogTitle: () => title.value,
  ogDescription: () => description.value,
  ogImage: () => ogImage.value.url,
  ogImageWidth: () => ogImage.value.width,
  ogImageHeight: () => ogImage.value.height,
  twitterCard: 'summary_large_image',
  twitterTitle: () => title.value,
  twitterDescription: () => description.value,
});

// Structured data: the page is a kanji's entry (a DefinedTerm in the set of kanji the index lists), under Home → Kanji.
useSchemaOrg(
  computed(() => [
    defineWebPage(),
    defineBreadcrumb({
      itemListElement: [
        { name: t('navbar.buttons.home'), item: localePath('/') },
        { name: t('kanjiIndex.title'), item: localePath('/kanji') },
        { name: character.value, item: route.path },
      ],
    }),
    ...(card.value
      ? [
          {
            '@type': 'DefinedTerm',
            name: character.value,
            inLanguage: 'ja',
            ...(card.value.meanings.length ? { description: card.value.meanings.slice(0, 5).join(', ') } : {}),
            ...(card.value.readings.length
              ? { alternateName: card.value.readings.map((reading) => reading.reading.replace('.', '')) }
              : {}),
            inDefinedTermSet: {
              '@type': 'DefinedTermSet',
              name: t('kanjiIndex.title'),
              url: `${requestOrigin}${localePath('/kanji')}`,
            },
          },
        ]
      : []),
  ]),
);

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
    <!-- 1. What is it. -->
    <header class="nd-page kanji-head">
      <NuxtLink :to="localePath('/kanji')" class="kanji-head__back" data-testid="kanji-page-index">
        ← {{ $t('kanjiIndex.title') }}
      </NuxtLink>
      <div class="kanji-head__main">
        <span class="kanji-head__glyph" lang="ja" aria-hidden="true">{{ character }}</span>
        <div class="kanji-head__text">
          <h1 class="kanji-head__title">
            <span class="sr-only" lang="ja">{{ character }}: </span>
            <span v-if="meaningsTag" class="kanji-head__lang">{{ meaningsTag }}</span>
            <span>{{ card.meanings[0] }}</span>
            <span v-if="card.meanings.length > 1" class="kanji-head__meaning-rest">{{ card.meanings.slice(1).join(', ') }}</span>
          </h1>
          <div v-if="levelBadges.length > 0" class="kanji-head__badges">
            <span
              v-for="badge in levelBadges"
              :key="badge.id"
              class="kanji-head__badge"
              :class="{ 'is-strong': badge.strong }"
            >{{ badge.text }}</span>
          </div>
          <p v-if="facts.length > 0" class="kanji-head__facts" data-testid="kanji-page-totals">
            <template v-for="(fact, fi) in facts" :key="fi"><span v-if="fi > 0" class="kanji-head__dot" aria-hidden="true">·</span>{{ fact }}</template>
          </p>
        </div>
      </div>
    </header>

    <div class="nd-page kanji-page__body">
      <!-- 2. How is it read. Each row is also the filter for the sentences below. -->
      <section v-if="readingRows.length > 0" class="kanji-section" data-testid="kanji-readings">
        <div class="kanji-section__head">
          <h2 class="kanji-section__title">{{ $t('tokenTooltip.kanjiReadingsHeading') }}</h2>
          <p class="kanji-section__hint">{{ $t('tokenTooltip.kanjiReadingHint') }}</p>
        </div>
        <ul class="kanji-readings">
          <li
            v-for="row in readingRows"
            :key="row.key"
            class="kanji-reading"
            :class="[`is-${row.kind}`, { 'is-active': activeReading === row.key, 'is-quiet': !canPick(row) }]"
          >
            <button
              v-if="canPick(row)"
              type="button"
              class="kanji-reading__pick"
              :aria-pressed="activeReading === row.key"
              :aria-label="$t('tokenTooltip.kanjiReadingOpen', { reading: row.stem + row.okurigana })"
              data-testid="kanji-reading"
              @click="pickReading(row.key)"
            >
              <span class="kanji-reading__kind">{{ $t(row.kind === 'on' ? 'tokenTooltip.kanjiOn' : 'tokenTooltip.kanjiKun') }}</span>
              <span class="kanji-reading__text" lang="ja">{{ row.stem }}<span v-if="row.okurigana" class="kanji-reading__okurigana">{{ row.okurigana }}</span></span>
              <span
                v-if="row.share !== null"
                class="kanji-reading__share"
                :title="$t('tokenTooltip.kanjiReadingShare', { percent: row.share })"
              >
                <span class="kanji-reading__bar" aria-hidden="true"><span :style="{ width: `${Math.max(row.share, 3)}%` }" /></span>
                <span class="kanji-reading__percent">{{ row.share }}%</span>
              </span>
            </button>
            <div v-else class="kanji-reading__pick" data-testid="kanji-reading">
              <span class="kanji-reading__kind">{{ $t(row.kind === 'on' ? 'tokenTooltip.kanjiOn' : 'tokenTooltip.kanjiKun') }}</span>
              <span class="kanji-reading__text" lang="ja">{{ row.stem }}<span v-if="row.okurigana" class="kanji-reading__okurigana">{{ row.okurigana }}</span></span>
              <span class="kanji-reading__none">{{ $t('tokenTooltip.kanjiReadingNoSentences') }}</span>
            </div>
            <span v-if="row.examples.length > 0" class="kanji-reading__words" lang="ja">
              <template v-for="(example, ei) in row.examples" :key="example.id">
                <span v-if="ei > 0" class="kanji-reading__sep" aria-hidden="true">、</span>
                <NuxtLink
                  :to="wordPath(example)"
                  class="kanji-reading__word"
                  :aria-label="example.reading ? `${example.headword} (${example.reading})` : example.headword"
                ><template v-if="example.furigana.length > 0"><template v-for="(seg, si) in example.furigana" :key="si"><ruby v-if="seg.ruby">{{ seg.text }}<rt>{{ seg.ruby }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template><template v-else>{{ example.headword }}</template></NuxtLink>
              </template>
            </span>
          </li>
        </ul>
      </section>

      <!-- 3. Where do I meet it. -->
      <section class="kanji-section" data-testid="kanji-page-sentences-section">
        <div class="kanji-section__head">
          <h2 class="kanji-section__title">{{ $t('tokenTooltip.kanjiSentencesHeading', { kanji: character }) }}</h2>
          <button
            v-if="activeRow"
            type="button"
            class="kanji-section__filter"
            :class="`is-${activeRow.kind}`"
            :aria-label="$t('tokenTooltip.kanjiClearReading')"
            data-testid="kanji-reading-filter"
            @click="pickReading(null)"
          ><span lang="ja">{{ activeRow.stem }}{{ activeRow.okurigana }}</span><span aria-hidden="true">×</span></button>
        </div>
        <p v-if="readingLoading" class="kanji-section__empty">{{ $t('tokenTooltip.loading') }}</p>
        <template v-else-if="sentences && sentences.results.length > 0">
          <SearchSegmentContainer :searchData="sentences" :isLoading="false" />
          <NuxtLink :to="sentencesPath" class="kanji-section__more" data-testid="kanji-page-sentences">
            {{ $t('tokenTooltip.kanjiAllSentences', { kanji: character }) }} →
          </NuxtLink>
        </template>
        <p v-else-if="sentences" class="kanji-section__empty">{{ $t('tokenTooltip.kanjiNoSentences', { kanji: character }) }}</p>
        <p v-else class="kanji-section__empty">{{ $t('tokenTooltip.kanjiSentencesFailed') }}</p>
      </section>

      <!-- 4. More words. -->
      <section v-if="moreWords.length > 0" class="kanji-section">
        <div class="kanji-section__head">
          <h2 class="kanji-section__title">{{ $t('tokenTooltip.kanjiMoreWords') }}</h2>
        </div>
        <ul class="kanji-words">
          <li v-for="word in listedWords" :key="word.id">
            <NuxtLink :to="wordPath(word)" class="kanji-words__row" data-testid="kanji-page-word">
              <span class="kanji-words__text" lang="ja">{{ word.headword }}</span>
              <span v-if="word.reading && word.reading !== word.headword" class="kanji-words__reading" lang="ja">{{ word.reading }}</span>
              <span v-if="word.gloss" class="kanji-words__gloss">{{ word.gloss }}</span>
              <span
                v-if="word.frequency"
                class="kanji-words__rank"
                :title="$t('tokenTooltip.kanjiWordRank', { rank: word.frequency })"
              >#{{ word.frequency }}</span>
            </NuxtLink>
          </li>
        </ul>
        <button
          v-if="moreWords.length > WORDS_SHOWN"
          type="button"
          class="kanji-section__more"
          data-testid="kanji-page-more-words"
          @click="allWords = !allWords"
        >{{ allWords ? $t('tokenTooltip.showLess') : $t('tokenTooltip.kanjiAllWords', { count: moreWords.length }) }}</button>
      </section>

      <!-- 5. How is it written. -->
      <section class="kanji-section">
        <div class="kanji-section__head">
          <h2 class="kanji-section__title">{{ $t('tokenTooltip.kanjiWritingHeading') }}</h2>
        </div>
        <div class="kanji-writing">
          <div v-if="card.strokes.length > 0" class="kanji-writing__strokes">
            <KanjiStrokes :kanji="character" :strokes="card.strokes" :numbers="card.strokeNumbers" grid />
          </div>
          <div class="kanji-writing__parts">
            <div v-if="card.components.length > 0" class="kanji-build" data-testid="kanji-build">
              <span class="kanji-build__tile is-self" lang="ja">{{ card.character }}</span>
              <span class="kanji-build__op" aria-hidden="true">=</span>
              <template v-for="(part, pi) in card.components" :key="part.character">
                <span v-if="pi > 0" class="kanji-build__op" aria-hidden="true">+</span>
                <button
                  v-if="part.hasCard"
                  type="button"
                  class="kanji-build__tile"
                  :class="{ 'is-radical': isRadicalPart(part.character) }"
                  :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: part.character })"
                  @click="openKanji(part.character)"
                >
                  <span class="kanji-build__glyph" lang="ja">{{ part.character }}</span>
                  <span v-if="part.meaning" class="kanji-build__note">{{ part.meaning }}</span>
                </button>
                <span v-else class="kanji-build__tile" :class="{ 'is-radical': isRadicalPart(part.character) }">
                  <span class="kanji-build__glyph" lang="ja">{{ part.character }}</span>
                  <span v-if="part.meaning" class="kanji-build__note">{{ part.meaning }}</span>
                </span>
              </template>
            </div>
            <p v-if="card.radical" class="kanji-writing__radical" data-testid="kanji-radical">
              <span class="kanji-writing__label">{{ $t('tokenTooltip.kanjiRadical') }}</span>
              <button
                v-if="card.radical.character && card.radical.character !== card.character"
                type="button"
                class="kanji-writing__radical-glyph is-link"
                lang="ja"
                :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: card.radical.character })"
                @click="openKanji(card.radical.character)"
              >{{ card.radical.glyph }}</button>
              <span v-else class="kanji-writing__radical-glyph" lang="ja">{{ card.radical.glyph }}</span>
              <span lang="ja">{{ card.radical.reading }}</span>
              <span class="kanji-head__dot" aria-hidden="true">·</span>
              <span>{{ card.radical.meaning }}</span>
            </p>
          </div>
        </div>
      </section>

      <!-- 6. Somewhere to go next. -->
      <section v-if="hasRelated" class="kanji-section">
        <div class="kanji-section__head">
          <h2 class="kanji-section__title">{{ $t('tokenTooltip.kanjiRelatedHeading') }}</h2>
        </div>
        <div class="kanji-related">
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
/* On/kun tones: two hues pulled toward the ink, so they read in either theme without shouting. */
.kanji-page {
  --tone-on: color-mix(in srgb, #3d9be0 62%, var(--ink));
  --tone-kun: color-mix(in srgb, #c06bd6 62%, var(--ink));
  padding-bottom: 64px;
}

/* 1. What is it. */
.kanji-head {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 16px 28px;
}

.kanji-head__back {
  align-self: flex-start;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-muted);
}

.kanji-head__back:hover {
  color: var(--accent-soft);
}

.kanji-head__main {
  display: flex;
  align-items: center;
  gap: 28px;
}

/* The kanji on a practice-sheet square: a frame and a faint cross. */
.kanji-head__glyph {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168px;
  height: 168px;
  border: 1.5px solid var(--line);
  border-radius: 16px;
  background:
    linear-gradient(color-mix(in srgb, var(--ink) 10%, transparent), color-mix(in srgb, var(--ink) 10%, transparent))
      center / 1px 100% no-repeat,
    linear-gradient(color-mix(in srgb, var(--ink) 10%, transparent), color-mix(in srgb, var(--ink) 10%, transparent))
      center / 100% 1px no-repeat,
    var(--background);
  font-size: 120px;
  line-height: 1;
  color: var(--ink);
}

.kanji-head__text {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.kanji-head__title {
  font-size: 34px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.kanji-head__meaning-rest {
  display: block;
  margin-top: 4px;
  font-size: 17px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--ink-muted);
}

.kanji-head__lang {
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

.kanji-head__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kanji-head__badge {
  padding: 3px 11px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-muted);
}

.kanji-head__badge.is-strong {
  border-color: color-mix(in srgb, var(--accent-soft) 45%, transparent);
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  color: var(--accent-soft);
}

.kanji-head__facts {
  font-size: 14px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.kanji-head__dot {
  margin: 0 8px;
  color: var(--ink-faint);
}

/* The sections: one rhythm, a title and an optional hint or control on its line. */
.kanji-page__body {
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 8px 16px 0;
}

.kanji-section__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
  margin-bottom: 14px;
}

.kanji-section__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
}

.kanji-section__hint {
  font-size: 13px;
  color: var(--ink-faint);
}

.kanji-section__empty {
  padding: 16px 0;
  font-size: 14px;
  color: var(--ink-muted);
}

.kanji-section__more {
  display: inline-block;
  margin-top: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent-soft);
  cursor: pointer;
}

.kanji-section__more:hover {
  text-decoration: underline;
}

.kanji-section__filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  background: transparent;
  cursor: pointer;
}

.kanji-section__filter.is-on {
  border-color: color-mix(in srgb, var(--tone-on) 50%, transparent);
  background: color-mix(in srgb, var(--tone-on) 12%, transparent);
  color: var(--tone-on);
}

.kanji-section__filter.is-kun {
  border-color: color-mix(in srgb, var(--tone-kun) 50%, transparent);
  background: color-mix(in srgb, var(--tone-kun) 12%, transparent);
  color: var(--tone-kun);
}

/* 2. How is it read: one row per reading. */
.kanji-readings {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}

.kanji-reading {
  display: grid;
  grid-template-columns: minmax(250px, 320px) minmax(0, 1fr);
  align-items: center;
  gap: 4px 20px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  transition: background-color 0.12s ease;
}

.kanji-reading:first-child {
  border-top: 0;
}

.kanji-reading.is-active.is-on {
  background: color-mix(in srgb, var(--tone-on) 10%, transparent);
}

.kanji-reading.is-active.is-kun {
  background: color-mix(in srgb, var(--tone-kun) 10%, transparent);
}

.kanji-reading__pick {
  display: grid;
  grid-template-columns: 36px minmax(90px, auto) 1fr;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  text-align: left;
  color: inherit;
}

button.kanji-reading__pick {
  cursor: pointer;
  border-radius: 8px;
}

button.kanji-reading__pick:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

.kanji-reading__kind {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.kanji-reading.is-on .kanji-reading__kind,
.kanji-reading.is-on .kanji-reading__text {
  color: var(--tone-on);
}

.kanji-reading.is-kun .kanji-reading__kind,
.kanji-reading.is-kun .kanji-reading__text {
  color: var(--tone-kun);
}

.kanji-reading__text {
  font-size: 22px;
  font-weight: 600;
  white-space: nowrap;
}

.kanji-reading__okurigana {
  opacity: 0.55;
}

button.kanji-reading__pick:hover .kanji-reading__text {
  text-decoration: underline;
  text-underline-offset: 4px;
}

.kanji-reading__share {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kanji-reading__bar {
  position: relative;
  flex: 1;
  max-width: 120px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 10%, transparent);
}

.kanji-reading__bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: currentColor;
}

.kanji-reading.is-on .kanji-reading__bar {
  color: var(--tone-on);
}

.kanji-reading.is-kun .kanji-reading__bar {
  color: var(--tone-kun);
}

.kanji-reading__percent {
  min-width: 36px;
  font-size: 13px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.kanji-reading__none {
  font-size: 12px;
  color: var(--ink-faint);
}

.kanji-reading.is-quiet .kanji-reading__kind,
.kanji-reading.is-quiet .kanji-reading__text,
.kanji-reading.is-quiet .kanji-reading__words {
  color: var(--ink-faint);
}

.kanji-reading__words {
  font-size: 16px;
  line-height: 2;
  color: var(--ink);
}

.kanji-reading__word:hover {
  color: var(--accent-soft);
}

.kanji-reading__word rt {
  font-size: 9px;
  color: var(--ink-faint);
}

.kanji-reading__sep {
  color: var(--ink-faint);
}

/* 4. More words: a two-column list, each row a search for that word. */
.kanji-words {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  column-gap: 24px;
}

.kanji-words__row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
  transition: background-color 0.12s ease;
}

.kanji-words__row:hover {
  background: var(--surface-lift);
}

.kanji-words__row:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

.kanji-words__text {
  flex-shrink: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
}

.kanji-words__reading {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ink-muted);
}

.kanji-words__gloss {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ink-faint);
}

.kanji-words__rank {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

/* 5. How is it written: the stroke order beside the parts and the radical. */
.kanji-writing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px 36px;
}

.kanji-writing__strokes {
  flex: 0 0 auto;
  width: 200px;
  height: 200px;
  padding: 6px;
  border: 1.5px solid var(--line);
  border-radius: 16px;
  background: var(--background);
}

.kanji-writing__parts {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.kanji-writing__label {
  margin-right: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
}

.kanji-writing__radical {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  color: var(--ink-muted);
}

.kanji-writing__radical-glyph {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 22px;
  color: var(--ink);
}

.kanji-writing__radical-glyph.is-link {
  cursor: pointer;
}

.kanji-writing__radical-glyph.is-link:hover {
  color: var(--accent-soft);
}

.kanji-build {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.kanji-build__tile {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 68px;
  max-width: 110px;
  padding: 10px 10px 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink);
}

button.kanji-build__tile {
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease;
}

button.kanji-build__tile:hover {
  border-color: var(--accent-soft);
  background: var(--surface-lift);
}

button.kanji-build__tile:focus-visible,
.kanji-section__filter:focus-visible,
.kanji-section__more:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

.kanji-build__tile.is-self {
  border-style: dashed;
  background: transparent;
  font-size: 36px;
  line-height: 1.2;
}

.kanji-build__tile.is-radical {
  border-color: color-mix(in srgb, var(--accent-soft) 45%, transparent);
}

.kanji-build__glyph {
  font-size: 28px;
  line-height: 1.2;
}

.kanji-build__note {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ink-muted);
}

.kanji-build__op {
  font-size: 18px;
  color: var(--ink-faint);
}

/* 6. Related kanji. */
.kanji-related {
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
}

@media (max-width: 640px) {
  .kanji-head__main {
    gap: 18px;
  }

  .kanji-head__glyph {
    width: 108px;
    height: 108px;
    font-size: 76px;
  }

  .kanji-head__title {
    font-size: 26px;
  }

  .kanji-reading {
    grid-template-columns: minmax(0, 1fr);
  }

  .kanji-words {
    grid-template-columns: minmax(0, 1fr);
  }

  .kanji-writing__strokes {
    width: 160px;
    height: 160px;
  }
}
</style>
