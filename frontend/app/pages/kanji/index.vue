<script setup lang="ts">
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

/**
 * The kanji index (task 44): every jōyō and JLPT kanji, one group at a time, by JLPT level (N5 first) or by school
 * grade. Each kanji is a tile leading to its own page, so this is how readers browse kanji by level and how search
 * engines reach the 2,136 kanji pages. The group is in the address (`?by=grade&level=g3`), each group a plain link,
 * so every group is its own crawlable page.
 */
interface IndexKanji {
  character: string;
  reading: string | null;
  meaning: string | null;
}
interface IndexAnswer {
  by: 'jlpt' | 'grade';
  level: string;
  groups: Array<{ id: string; count: number }>;
  kanji: IndexKanji[];
}

const { t, locale } = useI18n();
const route = useRoute();
const localePath = useLocalePath();

const by = computed<'jlpt' | 'grade'>(() => (route.query.by === 'grade' ? 'grade' : 'jlpt'));
const level = computed(() => (typeof route.query.level === 'string' ? route.query.level : ''));
const glossLocale = computed<'en' | 'es'>(() => (locale.value === 'es' ? 'es' : 'en'));

const { data, error } = await useAsyncData(
  () => `kanji-index-${glossLocale.value}-${by.value}-${level.value}`,
  () =>
    $fetch<IndexAnswer>('/api/dictionary/kanji-index', {
      query: { locale: glossLocale.value, by: by.value, ...(level.value ? { level: level.value } : {}) },
    }),
  { server: true, lazy: false, watch: [by, level] },
);
if (error.value) throw createError({ statusCode: 503, statusMessage: 'Dictionary temporarily unavailable' });

/** A group's name: N5…N1 and "no JLPT level"; grade 1…6, secondary school, and other kanji. */
const groupLabel = (id: string) => {
  if (/^n\d$/.test(id)) return id.toUpperCase();
  if (/^g\d$/.test(id)) return t('tokenTooltip.kanjiGrade', { grade: Number(id.slice(1)) });
  if (id === 'secondary') return t('kanjiIndex.secondary');
  if (id === 'none') return t('kanjiIndex.noJlpt');
  return t('tokenTooltip.kanjiOther');
};

const groupPath = (id: string) => ({ path: localePath('/kanji'), query: { by: by.value, level: id } });
const kanjiPath = (character: string) => localePath(`/kanji/${encodeURIComponent(character)}`);

const currentLabel = computed(() => (data.value ? groupLabel(data.value.level) : ''));
const title = computed(() => t('seo.kanjiIndex.title', { group: currentLabel.value }));
const description = computed(() =>
  t('seo.kanjiIndex.description', { group: currentLabel.value, count: data.value?.kanji.length ?? 0 }),
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
</script>

<template>
  <div class="nd-page kanji-index px-4 md:px-0 pb-16 pt-8">
    <header class="kanji-index__head">
      <h1 class="kanji-index__title">{{ $t('kanjiIndex.title') }}</h1>
      <p class="kanji-index__intro">{{ $t('kanjiIndex.intro') }}</p>

      <!-- How to group them: the two ways a learner already counts their kanji. -->
      <nav class="kanji-index__by" :aria-label="$t('kanjiIndex.groupBy')">
        <NuxtLink
          :to="{ path: localePath('/kanji'), query: { by: 'jlpt' } }"
          class="kanji-index__by-option"
          :aria-current="by === 'jlpt' ? 'page' : undefined"
        >JLPT</NuxtLink>
        <NuxtLink
          :to="{ path: localePath('/kanji'), query: { by: 'grade' } }"
          class="kanji-index__by-option"
          :aria-current="by === 'grade' ? 'page' : undefined"
        >{{ $t('kanjiIndex.byGrade') }}</NuxtLink>
      </nav>
    </header>

    <template v-if="data">
      <nav class="kanji-index__groups" :aria-label="$t('kanjiIndex.groups')">
        <NuxtLink
          v-for="group in data.groups"
          :key="group.id"
          :to="groupPath(group.id)"
          class="kanji-index__group"
          :aria-current="group.id === data.level ? 'page' : undefined"
          data-testid="kanji-index-group"
        >{{ groupLabel(group.id) }}<span class="kanji-index__group-count">{{ group.count }}</span></NuxtLink>
      </nav>

      <ul class="kanji-index__grid">
        <li v-for="kanji in data.kanji" :key="kanji.character">
          <NuxtLink :to="kanjiPath(kanji.character)" class="kanji-index__tile" data-testid="kanji-index-tile">
            <span class="kanji-index__kanji" lang="ja">{{ kanji.character }}</span>
            <span v-if="kanji.reading" class="kanji-index__reading" lang="ja">{{ kanji.reading }}</span>
            <span v-if="kanji.meaning" class="kanji-index__meaning">{{ kanji.meaning }}</span>
          </NuxtLink>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.kanji-index__head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
}

.kanji-index__title {
  font-size: 32px;
  font-weight: 800;
  color: var(--ink);
}

.kanji-index__intro {
  max-width: 640px;
  font-size: 15px;
  color: var(--ink-muted);
}

.kanji-index__by {
  display: inline-flex;
  align-self: flex-start;
  margin-top: 6px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
}

.kanji-index__by-option {
  padding: 5px 16px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-muted);
}

.kanji-index__by-option[aria-current='page'] {
  background: var(--surface-lift);
  color: var(--ink);
}

.kanji-index__groups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 20px;
}

.kanji-index__group {
  padding: 5px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-muted);
  transition:
    border-color 0.12s ease,
    color 0.12s ease;
}

.kanji-index__group:hover {
  border-color: var(--accent-soft);
  color: var(--ink);
}

.kanji-index__group[aria-current='page'] {
  border-color: color-mix(in srgb, var(--accent-soft) 45%, transparent);
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  color: var(--accent-soft);
}

.kanji-index__group-count {
  margin-left: 7px;
  font-size: 12px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.kanji-index__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}

.kanji-index__tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  height: 100%;
  padding: 12px 6px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  text-align: center;
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease;
}

.kanji-index__tile:hover {
  border-color: var(--accent-soft);
  background: var(--surface-lift);
}

.kanji-index__tile:focus-visible,
.kanji-index__group:focus-visible,
.kanji-index__by-option:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

.kanji-index__kanji {
  font-size: 32px;
  line-height: 1.2;
  color: var(--ink);
}

.kanji-index__reading {
  font-size: 12px;
  color: var(--ink-muted);
}

.kanji-index__meaning {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ink-faint);
}

@media (max-width: 640px) {
  .kanji-index__grid {
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  }

  .kanji-index__kanji {
    font-size: 28px;
  }
}
</style>
