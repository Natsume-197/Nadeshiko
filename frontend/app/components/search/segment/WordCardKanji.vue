<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  type CustomKanjiData,
  fetchCustomKanji,
  type KanjiCardData,
  type KanjiCardExample,
  type KanjiCardWordRef,
  kanjiBadges,
  meaningsTag as kanjiMeaningsTag,
  peekCustomKanji,
  splitReading,
} from '~/utils/kanjiLookup';
import KanjiStrokes from './KanjiStrokes.vue';
import MarkedKanji from './MarkedKanji.vue';
import YomitanContent from './YomitanContent.vue';
import type { KanjiViewState } from '~/composables/useKanjiView';

/**
 * The word card's kanji view (task 44): what the card shows when a reader opens one of a word's kanji.
 *
 * Laid out as a dictionary entry, most useful first, each block under its own rule:
 *   1. the kanji itself: stroke order, meaning, and a row of facts (JLPT, grade, strokes);
 *   2. readings, on then kun, each with the words it is heard in;
 *   3. the words written with it that Nadeshiko's subtitles use most;
 *   4. what it is made of: radical and parts;
 *   5. related kanji, kept short;
 *   6. after the readings, what the reader's own kanji dictionaries say (task 48), when they uploaded any.
 * Accent colour is kept for what responds to the pointer; at rest everything is ink.
 */
const props = defineProps<{
  kanji: string;
  card: KanjiCardData | null;
  state: KanjiViewState;
  /** The reader's gloss language, to say when the meanings had to fall back to English. */
  locale: 'en' | 'es';
  /** The kanji's own page: every word and every related kanji (grouped), a larger stroke order. The word card shows
   *  the first few and links to the page for the rest. */
  full?: boolean;
  /** On the kanji page, which part of the entry to draw beside the page's own header, words and sentences:
   *  `entry` (readings and composition) or `related` (the related kanji). Unset draws all of it. */
  part?: 'entry' | 'related';
  /** On the kanji page: how many sentences each reading's words have, by reading. A reading with none is faded and
   *  says so, since its tab is hidden. */
  readingCounts?: Record<string, number>;
}>();

const shows = computed(() => ({
  hero: !props.part,
  readings: !props.part || props.part === 'entry',
  words: !props.part,
  composition: !props.part || props.part === 'entry',
  related: !props.part || props.part === 'related',
}));

const emit = defineEmits<{
  'open-kanji': [character: string];
  'open-word': [word: KanjiCardWordRef];
  /** The card's "+N": the rest of a list lives on the kanji's own page. */
  'open-page': [];
}>();

const { t } = useI18n();

/** How many words show before "Show all". */
const WORDS_SHOWN = 6;
/** How many related kanji each row shows. */
const RELATED_SHOWN = 12;

/** On the page, how many kanji a related group shows before its "+N": school and name kanji get room, the rare
 *  ones a single row's worth. */
const GROUP_SHOWN = 24;
const OTHER_GROUP_SHOWN = 12;
const shownIn = (groupId: string) => (groupId === 'other' ? OTHER_GROUP_SHOWN : GROUP_SHOWN);

const allWords = ref(false);
/** Related groups the reader opened in full, by `row-group` id. */
const openGroups = ref(new Set<string>());
// Another kanji starts with its lists short again.
watch(
  () => props.card?.character,
  () => {
    allWords.value = false;
    openGroups.value = new Set();
  },
);

const groupKey = (rowId: string, groupId: string) => `${rowId}-${groupId}`;
const toggleGroup = (key: string) => {
  const next = new Set(openGroups.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openGroups.value = next;
};

interface ReadingRow {
  key: string;
  stem: string;
  okurigana: string;
  examples: KanjiCardExample[];
}

/** Whether the page found no sentences for a reading (the card itself never knows). */
const noSentences = (row: ReadingRow) => props.readingCounts?.[row.key] === 0;

/** Readings grouped by kind, so the on/kun label is written once per group. */
const readingGroups = computed(() => {
  const groups: Array<{ kind: 'on' | 'kun'; rows: ReadingRow[] }> = [];
  for (const entry of props.card?.readings ?? []) {
    const split = splitReading(entry, entry.reading);
    let group = groups.find((candidate) => candidate.kind === entry.kind);
    if (!group) {
      group = { kind: entry.kind, rows: [] };
      groups.push(group);
    }
    group.rows.push({ key: entry.reading, ...split, examples: entry.examples });
  }
  return groups;
});

/** On the page, each reading's share of the kanji's sentences as a whole percent, by row key; empty on the card
 *  (and when no reading has a sentence). */
const readingShares = computed(() => {
  const counts = props.readingCounts;
  const shares: Record<string, number> = {};
  if (!counts) return shares;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return shares;
  for (const group of readingGroups.value) {
    for (const row of group.rows) shares[row.key] = Math.round(((counts[row.key] ?? 0) / total) * 100);
  }
  return shares;
});

/** The facts row: short, scannable badges. */
const badges = computed(() => (props.card ? kanjiBadges(props.card, t) : []));

const shownWords = computed(
  () => (allWords.value || props.full ? props.card?.words : props.card?.words.slice(0, WORDS_SHOWN)) ?? [],
);

type RelatedKanji = KanjiCardData['sameRadical'][number];

/** On the page, a related list split the way a learner thinks of kanji: the jōyō list, names, and the rest. */
function relatedGroups(list: RelatedKanji[]) {
  const groups = [
    { id: 'joyo', label: t('tokenTooltip.kanjiJoyo'), list: list.filter((k) => k.grade !== null && k.grade <= 8) },
    { id: 'jinmeiyo', label: t('tokenTooltip.kanjiJinmeiyo'), list: list.filter((k) => k.grade !== null && k.grade > 8) },
    { id: 'other', label: t('tokenTooltip.kanjiOther'), list: list.filter((k) => k.grade === null) },
  ];
  return groups.filter((group) => group.list.length > 0);
}

/** Related kanji: one short row each on the card, every one (grouped) on the page. */
const related = computed(() => {
  const card = props.card;
  if (!card) return [];
  return [
    {
      id: 'same-radical',
      label: t('tokenTooltip.kanjiSameRadical', { count: card.sameRadicalCount }),
      list: card.sameRadical,
      total: card.sameRadicalCount,
    },
    {
      id: 'contained-in',
      label: t('tokenTooltip.kanjiContainedIn', { count: card.containedInCount }),
      list: card.containedIn,
      total: card.containedInCount,
    },
  ]
    .filter((row) => row.list.length > 0)
    .map((row) => ({
      ...row,
      list: props.full ? row.list : row.list.slice(0, RELATED_SHOWN),
      groups: props.full ? relatedGroups(row.list) : [],
    }));
});

/** The reader's own kanji dictionaries for this kanji. Asked in the browser only: the shared card above is cached for
 *  everyone, this part is the reader's. */
const custom = ref<CustomKanjiData | null>(null);
/** Long articles (a 漢和辞典's) open in full on the page; on the card, one at a time on request. */
const openArticles = ref(new Set<string>());

function loadCustom(character: string) {
  openArticles.value = new Set();
  openStats.value = new Set();
  custom.value = peekCustomKanji(character) ?? null;
  void fetchCustomKanji(character).then((answer) => {
    if (props.kanji === character) custom.value = answer;
  });
}

onMounted(() => loadCustom(props.kanji));
watch(
  () => props.kanji,
  (character) => {
    if (import.meta.client) loadCustom(character);
  },
);

const hasCustom = computed(() =>
  Boolean(custom.value && (custom.value.entries.length > 0 || custom.value.frequencies.length > 0)),
);

type CustomEntry = CustomKanjiData['entries'][number];

const articleKey = (entry: CustomEntry, index: number) => `${entry.dictionary}:${index}`;

/** Entries whose index numbers and codes the reader opened. */
const openStats = ref(new Set<string>());
const toggleStats = (key: string) => {
  const next = new Set(openStats.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openStats.value = next;
};

/** The figures a learner reads (Yomitan's `misc` stats: strokes, grade, JLPT, frequency) always; index numbers,
 *  classifications and codes (Heisig, SKIP, JIS...) behind a "+N", since a dictionary like KANJIDIC has dozens. */
function statRows(entry: CustomEntry, index: number) {
  const stats = entry.stats ?? [];
  if (openStats.value.has(articleKey(entry, index))) return { shown: stats, hidden: 0 };
  const shown = stats.filter((stat) => stat.category === 'misc');
  return { shown, hidden: stats.length - shown.length };
}

/** Word-like meanings (KANJIDIC's) read best as one line; sentences (Wiktionary's, variants notes) as a list. */
const shortMeanings = (meanings: string[]) => meanings.every((meaning) => meaning.length <= 40);
const toggleArticle = (key: string) => {
  const next = new Set(openArticles.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openArticles.value = next;
};

/** Meanings fell back to English for a reader who reads Spanish: say so with the same tag the senses use. */
const meaningsTag = computed(() => kanjiMeaningsTag(props.card, props.locale));

/** A related kanji's tooltip: its reading and meaning. */
const relatedTitle = (kanji: { reading: string | null; meaning: string | null }) =>
  [kanji.reading, kanji.meaning].filter(Boolean).join(' · ');
</script>

<template>
  <div class="kanji-view" :class="{ 'kanji-view--full': full }">
    <p v-if="state === 'loading'" class="kanji-view__pending">
      <span class="nd-ring-spinner kanji-view__spinner" aria-hidden="true" />
      <span>{{ $t('tokenTooltip.loading') }}</span>
    </p>
    <p v-else-if="state === 'missing'" class="kanji-view__pending">{{ $t('tokenTooltip.kanjiMissing') }}</p>
    <p v-else-if="state === 'unavailable'" class="kanji-view__pending">{{ $t('tokenTooltip.unavailable') }}</p>

    <template v-else-if="card">
      <!-- 1. The kanji: stroke order beside what it means. -->
      <div v-if="shows.hero" class="kanji-view__hero">
        <div v-if="card.strokes.length > 0" class="kanji-view__strokes">
          <KanjiStrokes :kanji="kanji" :strokes="card.strokes" :numbers="card.strokeNumbers" />
        </div>

        <div class="kanji-view__summary">
          <p v-if="card.meanings.length > 0" class="kanji-view__meanings">
            <span v-if="meaningsTag" class="kanji-view__lang">{{ meaningsTag }}</span>{{ card.meanings.join(', ') }}
          </p>
          <div class="kanji-view__badges">
            <span
              v-for="badge in badges"
              :key="badge.id"
              class="kanji-view__badge"
              :class="{ 'is-strong': badge.strong }"
            >{{ badge.text }}</span>
          </div>
        </div>
      </div>

      <!-- 2. Readings, the label once per group, each with the words it is heard in. A reading none of our words
           uses is shown faint: it exists, but a reader of anime will rarely meet it. -->
      <section
        v-if="shows.readings && readingGroups.length > 0"
        class="kanji-view__section"
        :class="{ 'is-first': part === 'entry' }"
      >
        <div class="kanji-view__readings">
          <template v-for="group in readingGroups" :key="group.kind">
            <template v-for="(row, ri) in group.rows" :key="`${group.kind}${row.key}`">
              <span class="kanji-view__label">{{ ri === 0 ? $t(group.kind === 'on' ? 'tokenTooltip.kanjiOn' : 'tokenTooltip.kanjiKun') : '' }}</span>
              <span class="kanji-view__reading">
                <span
                  class="kanji-view__reading-text"
                  :class="{ 'is-rare': row.examples.length === 0 || noSentences(row) }"
                  lang="ja"
                  data-testid="kanji-reading"
                >{{ row.stem }}<span v-if="row.okurigana" class="kanji-view__okurigana">{{ row.okurigana }}</span></span>
                <!-- On the page: how much of the kanji's sentences use this reading. -->
                <span
                  v-if="readingCounts && !noSentences(row)"
                  class="kanji-view__share"
                  :title="$t('tokenTooltip.kanjiReadingShare', { percent: readingShares[row.key] ?? 0 })"
                  data-testid="kanji-reading-share"
                >
                  <span class="kanji-view__share-bar" aria-hidden="true">
                    <span :style="{ width: `${Math.max(readingShares[row.key] ?? 0, 4)}%` }" />
                  </span>
                  <span class="kanji-view__share-text">{{ readingShares[row.key] === 0 ? '<1' : readingShares[row.key] }}%</span>
                </span>
                <span v-if="noSentences(row)" class="kanji-view__no-sentences">{{
                  $t('tokenTooltip.kanjiReadingNoSentences')
                }}</span>
              </span>
              <span class="kanji-view__examples" :class="{ 'is-rare': noSentences(row) }" lang="ja">
                <template v-for="(example, ei) in row.examples" :key="example.id">
                  <span v-if="ei > 0" class="kanji-view__sep" aria-hidden="true">、</span>
                  <button
                    type="button"
                    class="kanji-view__example"
                    :aria-label="example.reading ? `${example.headword} (${example.reading})` : example.headword"
                    @click="emit('open-word', example)"
                  ><template v-if="example.furigana.length > 0"><template v-for="(seg, si) in example.furigana" :key="si"><ruby v-if="seg.ruby"><MarkedKanji :text="seg.text" :kanji="kanji" /><rt>{{ seg.ruby }}</rt></ruby><MarkedKanji v-else :text="seg.text" :kanji="kanji" /></template></template><MarkedKanji v-else :text="example.headword" :kanji="kanji" /></button>
                </template>
              </span>
            </template>
          </template>
        </div>
      </section>

      <!-- 6. The reader's own kanji dictionaries, in their order, each under its name. -->
      <section v-if="shows.readings && hasCustom && custom" class="kanji-view__section" data-testid="kanji-custom">
        <div v-if="custom.frequencies.length > 0" class="kanji-view__badges kanji-view__custom-freq">
          <span
            v-for="freq in custom.frequencies"
            :key="freq.dictionary"
            class="kanji-view__badge"
            :title="freq.dictionaryName"
          >{{ freq.dictionaryName }}: {{ freq.displayValue }}</span>
        </div>
        <div
          v-for="(entry, index) in custom.entries"
          :key="articleKey(entry, index)"
          class="kanji-view__custom"
          data-testid="kanji-custom-entry"
        >
          <h4 class="kanji-view__heading">{{ entry.dictionaryName }}</h4>
          <div v-if="entry.onyomi || entry.kunyomi" class="kanji-view__facts">
            <template v-if="entry.onyomi">
              <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiOn') }}</span>
              <span class="kanji-view__fact" lang="ja">{{ entry.onyomi.join('、') }}</span>
            </template>
            <template v-if="entry.kunyomi">
              <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiKun') }}</span>
              <span class="kanji-view__fact" lang="ja">{{ entry.kunyomi.join('、') }}</span>
            </template>
          </div>
          <template v-if="entry.meanings">
            <p v-if="shortMeanings(entry.meanings)" class="kanji-view__custom-meanings is-inline">{{ entry.meanings.join(', ') }}</p>
            <ul v-else class="kanji-view__custom-meanings">
              <li v-for="(meaning, mi) in entry.meanings" :key="mi">{{ meaning }}</li>
            </ul>
          </template>
          <div
            v-if="entry.tags.length > 0 || (entry.stats && entry.stats.length > 0)"
            class="kanji-view__badges"
          >
            <span v-for="tag in entry.tags" :key="tag.code" class="kanji-view__badge" :title="tag.label">{{ tag.code }}</span>
            <span
              v-for="stat in statRows(entry, index).shown"
              :key="stat.code"
              class="kanji-view__badge"
            >{{ stat.label }}: {{ stat.value }}</span>
            <button
              v-if="statRows(entry, index).hidden > 0"
              type="button"
              class="kanji-view__more-kanji"
              data-testid="kanji-custom-stats-more"
              @click="toggleStats(articleKey(entry, index))"
            >+{{ statRows(entry, index).hidden }}</button>
          </div>
          <template v-if="entry.senses">
            <div
              class="kanji-view__article"
              :class="{ 'is-clamped': !full && !openArticles.has(articleKey(entry, index)) }"
              lang="ja"
            >
              <div v-for="sense in entry.senses" :key="sense.position">
                <template v-for="(definition, di) in sense.definitions" :key="di">
                  <YomitanContent v-if="definition.structuredContent !== undefined" :content="definition.structuredContent" />
                  <span v-else class="kanji-view__article-text">{{ definition.text }}</span>
                </template>
              </div>
            </div>
            <button
              v-if="!full"
              type="button"
              class="kanji-view__more"
              @click="toggleArticle(articleKey(entry, index))"
            >{{ openArticles.has(articleKey(entry, index)) ? $t('tokenTooltip.kanjiArticleLess') : $t('tokenTooltip.kanjiArticleMore') }}</button>
          </template>
        </div>
      </section>

      <!-- 3. Words, from our own subtitles. -->
      <section v-if="shows.words && card.words.length > 0" class="kanji-view__section">
        <h4 class="kanji-view__heading">{{ $t('tokenTooltip.kanjiWords') }}</h4>
        <div class="kanji-view__words">
          <button
            v-for="word in shownWords"
            :key="word.id"
            type="button"
            class="kanji-view__word"
            data-testid="kanji-word"
            @click="emit('open-word', word)"
          >
            <span class="kanji-view__word-text" lang="ja"><MarkedKanji :text="word.headword" :kanji="kanji" /></span>
            <span v-if="word.reading && word.reading !== word.headword" class="kanji-view__word-reading" lang="ja">{{ word.reading }}</span>
            <span v-if="word.gloss" class="kanji-view__word-gloss">{{ word.gloss }}</span>
          </button>
        </div>
        <button
          v-if="!full && card.words.length > WORDS_SHOWN"
          type="button"
          class="kanji-view__more"
          data-testid="kanji-more-words"
          @click="allWords = !allWords"
        >{{ allWords ? $t('tokenTooltip.showLess') : $t('tokenTooltip.kanjiAllWords', { count: card.words.length }) }}</button>
      </section>

      <!-- 4. What it is made of. -->
      <section v-if="shows.composition && (card.radical || card.components.length > 0)" class="kanji-view__section">
        <div class="kanji-view__facts">
          <template v-if="card.radical">
            <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiRadical') }}</span>
            <span class="kanji-view__fact" data-testid="kanji-radical">
              <button
                v-if="card.radical.character && card.radical.character !== card.character"
                type="button"
                class="kanji-view__glyph is-link"
                lang="ja"
                :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: card.radical.character })"
                @click="emit('open-kanji', card.radical.character)"
              >{{ card.radical.glyph }}</button>
              <span v-else class="kanji-view__glyph" lang="ja">{{ card.radical.glyph }}</span>
              <span class="kanji-view__note"><span lang="ja">{{ card.radical.reading }}</span> · {{ card.radical.meaning }}</span>
            </span>
          </template>
          <template v-if="card.components.length > 0">
            <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiParts') }}</span>
            <span class="kanji-view__fact kanji-view__parts">
              <template v-for="part in card.components" :key="part.character">
                <button
                  v-if="part.hasCard"
                  type="button"
                  class="kanji-view__part"
                  :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: part.character })"
                  @click="emit('open-kanji', part.character)"
                ><span class="kanji-view__glyph" lang="ja">{{ part.character }}</span><span v-if="part.meaning" class="kanji-view__note">{{ part.meaning }}</span></button>
                <span v-else class="kanji-view__part is-static"><span class="kanji-view__glyph" lang="ja">{{ part.character }}</span><span v-if="part.meaning" class="kanji-view__note">{{ part.meaning }}</span></span>
              </template>
            </span>
          </template>
        </div>
      </section>

      <!-- 5. Related kanji: one short row each on the card, ending in a link to the page for the rest; every one on
           the page, split into jōyō, names and others. -->
      <section
        v-if="shows.related && related.length > 0"
        class="kanji-view__section"
        :class="{ 'is-first': part === 'related' }"
      >
        <div class="kanji-view__facts" :class="{ 'is-stacked': full }">
          <template v-for="row in related" :key="row.id">
            <span class="kanji-view__label">{{ row.label }}</span>
            <span v-if="!full" class="kanji-view__related" :data-testid="`kanji-${row.id}`">
              <button
                v-for="other in row.list"
                :key="other.character"
                type="button"
                class="kanji-view__related-kanji"
                lang="ja"
                :title="relatedTitle(other)"
                :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: other.character })"
                @click="emit('open-kanji', other.character)"
              >{{ other.character }}</button>
              <button
                v-if="row.total > row.list.length"
                type="button"
                class="kanji-view__more-kanji"
                data-testid="kanji-related-more"
                :title="$t('tokenTooltip.kanjiPage')"
                @click="emit('open-page')"
              >+{{ row.total - row.list.length }}</button>
            </span>
            <span v-else class="kanji-view__related-groups" :data-testid="`kanji-${row.id}`">
              <span v-for="group in row.groups" :key="group.id" class="kanji-view__related-group">
                <span class="kanji-view__note">{{ group.label }} ({{ group.list.length }})</span>
                <span class="kanji-view__tiles">
                  <button
                    v-for="other in openGroups.has(groupKey(row.id, group.id)) ? group.list : group.list.slice(0, shownIn(group.id))"
                    :key="other.character"
                    type="button"
                    class="kanji-view__tile kanji-view__related-kanji"
                    :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: other.character })"
                    @click="emit('open-kanji', other.character)"
                  >
                    <span class="kanji-view__tile-kanji" lang="ja">{{ other.character }}</span>
                    <span v-if="other.reading" class="kanji-view__tile-reading" lang="ja">{{ other.reading }}</span>
                    <span v-if="other.meaning" class="kanji-view__tile-meaning">{{ other.meaning }}</span>
                  </button>
                  <button
                    v-if="group.list.length > shownIn(group.id)"
                    type="button"
                    class="kanji-view__tile is-more"
                    data-testid="kanji-group-toggle"
                    :aria-expanded="openGroups.has(groupKey(row.id, group.id))"
                    @click="toggleGroup(groupKey(row.id, group.id))"
                  >{{ openGroups.has(groupKey(row.id, group.id)) ? $t('tokenTooltip.showLess') : `+${group.list.length - shownIn(group.id)}` }}</button>
                </span>
              </span>
            </span>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.kanji-view__pending {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--ink-muted);
}

/* The ring itself is the global `nd-ring-spinner`; only its size is the card's. */
.kanji-view__spinner {
  width: 12px;
  height: 12px;
}

/* Blocks: one rhythm for all of them and a hairline between, so the eye can find each. */
.kanji-view__section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.kanji-view__heading,
.kanji-view__label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  color: var(--ink-faint);
}

.kanji-view__heading {
  margin-bottom: 4px;
}

.kanji-view__note {
  font-size: 12px;
  color: var(--ink-muted);
}

/* 1. The kanji. */
.kanji-view__hero {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-top: 6px;
}

.kanji-view__strokes {
  position: relative;
  flex: 0 0 auto;
  width: 88px;
  height: 88px;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.kanji-view__summary {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kanji-view__meanings {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--ink);
}

.kanji-view__lang {
  display: inline-flex;
  margin-right: 6px;
  padding: 1px 4px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
  vertical-align: 2px;
}

.kanji-view__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.kanji-view__badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--surface-lift);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.kanji-view__badge.is-strong {
  background: color-mix(in srgb, var(--accent-soft) 16%, transparent);
  color: var(--accent-soft);
}

/* 2. Readings: label | reading | words, in one grid so the columns line up. Rows leave room for the ruby over
   the examples. */
.kanji-view__readings {
  display: grid;
  grid-template-columns: auto auto 1fr;
  column-gap: 12px;
  row-gap: 6px;
  align-items: baseline;
}

/* On the page the list has room: more air between readings, a kun group set apart from the on group. */
.kanji-view--full .kanji-view__readings {
  column-gap: 16px;
  row-gap: 12px;
}

/* Furigana that never pushes the kanji apart: the reading sits over its base and may overhang it, instead of
   widening the base to the reading's width (which left gaps like 老 若 男女). */
.kanji-view__example ruby {
  position: relative;
  display: inline-block;
}

.kanji-view__example rt {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: -3px;
  line-height: 1;
  white-space: nowrap;
}

.kanji-view__reading-text {
  font-size: 15px;
  color: var(--ink);
  white-space: nowrap;
}

.kanji-view__reading-text.is-rare {
  color: var(--ink-faint);
}

.kanji-view__reading {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.kanji-view__share {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kanji-view__share-bar {
  position: relative;
  width: 32px;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 12%, transparent);
}

.kanji-view__share-bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: var(--accent-soft);
}

.kanji-view__share-text {
  font-size: 10px;
  line-height: 1;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.kanji-view__examples.is-rare {
  opacity: 0.6;
}

.kanji-view__no-sentences {
  margin-left: 8px;
  font-size: 11px;
  color: var(--ink-faint);
  white-space: nowrap;
}

.kanji-view__okurigana {
  color: var(--ink-faint);
}

.kanji-view__examples {
  min-width: 0;
  font-size: 13px;
  color: var(--ink-muted);
}

.kanji-view--full .kanji-view__examples {
  font-size: 14px;
}

.kanji-view__sep {
  color: var(--ink-faint);
}

.kanji-view__example {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.kanji-view__example {
  line-height: 1.9;
}

.kanji-view__example rt {
  font-size: 0.5em;
  color: var(--ink-faint);
}

.kanji-view__example:hover,
.kanji-view__example:hover rt {
  color: var(--accent-soft);
}

/* 3. Words. */
.kanji-view__words {
  display: flex;
  flex-direction: column;
}

.kanji-view__word {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 3px 6px;
  margin: 0 -6px;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.kanji-view__word:hover {
  background: var(--surface-lift);
}

.kanji-view__word-text {
  flex: 0 0 auto;
  font-size: 15px;
  color: var(--ink);
}

.kanji-view__word-reading {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--ink-muted);
}

.kanji-view__word-gloss {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ink-faint);
}

.kanji-view__more {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-soft);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.kanji-view__more:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 6. The reader's own kanji dictionaries. */
.kanji-view__custom + .kanji-view__custom,
.kanji-view__custom-freq + .kanji-view__custom {
  margin-top: 10px;
}

.kanji-view__custom > * + * {
  margin-top: 4px;
}

.kanji-view__custom-meanings {
  margin: 0;
  padding-left: 16px;
  list-style: disc;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ink);
}

.kanji-view__custom-meanings.is-inline {
  padding-left: 0;
}

.kanji-view__article {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.kanji-view__article.is-clamped {
  max-height: 9em;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}

.kanji-view__article-text {
  white-space: pre-line;
}

/* 4 and 5. Label | content rows, aligned like the readings. */
.kanji-view__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 12px;
  row-gap: 8px;
  align-items: baseline;
}

.kanji-view__fact {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.kanji-view__parts {
  gap: 4px 14px;
}

.kanji-view__glyph {
  font-size: 16px;
  color: var(--ink);
}

button.kanji-view__glyph {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

button.kanji-view__glyph:hover,
button.kanji-view__part:hover .kanji-view__glyph {
  color: var(--accent-soft);
}

.kanji-view__part {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}

button.kanji-view__part {
  cursor: pointer;
}

.kanji-view__related {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px;
  min-width: 0;
}

.kanji-view__related-kanji {
  padding: 1px 4px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink);
  font-size: 15px;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.kanji-view__more-kanji {
  padding: 1px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-soft);
  cursor: pointer;
}

.kanji-view__more-kanji:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.kanji-view__related-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.kanji-view__related-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* The kanji's own page: the same entry, given room. */
.kanji-view--full .kanji-view__strokes {
  width: 160px;
  height: 160px;
}

.kanji-view--full .kanji-view__meanings {
  font-size: 22px;
}

.kanji-view--full .kanji-view__reading-text,
.kanji-view--full .kanji-view__word-text,
.kanji-view--full .kanji-view__related-kanji {
  font-size: 18px;
}

.kanji-view--full .kanji-view__examples,
.kanji-view--full .kanji-view__word-gloss {
  font-size: 14px;
}

.kanji-view--full .kanji-view__section {
  margin-top: 20px;
  padding-top: 16px;
}

.kanji-view__related-kanji:hover {
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  color: var(--accent-soft);
}

.kanji-view__word:focus-visible,
.kanji-view__part:focus-visible,
.kanji-view__example:focus-visible,
.kanji-view__more:focus-visible,
.kanji-view__related-kanji:focus-visible,
button.kanji-view__glyph:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

/* The first block of the kanji page's aside: nothing above it to rule off. */
.kanji-view__section.is-first {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

/* The kanji page's related kanji: label above, then a grid of small tiles. */
.kanji-view__facts.is-stacked {
  grid-template-columns: minmax(0, 1fr);
  row-gap: 10px;
}

.kanji-view__facts.is-stacked > .kanji-view__label:not(:first-child) {
  margin-top: 10px;
}

.kanji-view__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.kanji-view__tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 0;
  padding: 10px 6px 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--background);
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease;
}

.kanji-view__tile:hover {
  border-color: var(--accent-soft);
  background: var(--surface-lift);
}

.kanji-view__tile:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

.kanji-view__tile-kanji {
  font-size: 26px;
  line-height: 1.2;
  color: var(--ink);
}

.kanji-view__tile-reading {
  font-size: 11px;
  color: var(--ink-muted);
}

.kanji-view__tile-meaning {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ink-faint);
}

.kanji-view__tile.is-more {
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-soft);
}
</style>
