<script setup lang="ts">
import {
  cardForms,
  cardSenses,
  headwordFurigana,
  pageGlossPreference,
  kanjiIn,
  pitchMorae,
  type DictionaryWord,
} from '~/utils/wordCard';
import { CATEGORY_LABEL_KEYS } from '~/utils/categories';
import { inflectionLanguage, inflectionLine as joinInflection } from '~/utils/inflectionLabels';
import PitchGraph from '~/components/search/segment/PitchGraph.vue';
import YomitanContent from '~/components/search/segment/YomitanContent.vue';
import { type EntryBrief, toHiragana } from '#shared/utils/wordEntry';

/**
 * The dictionary entry above a word search (`/search/食べる`): what the word means, how it is read and said, how
 * common it is in each kind of media, its other spellings, the words and kanji it is made of. Server-rendered, so
 * the word's page on this site carries its definition as well as its sentences. Always Nadeshiko's own dictionary.
 *
 * Two zones on a wide screen: what the word is and means on the left, the reference matter (pitch, spellings,
 * parts, kanji) in a quieter column on the right; one column on a phone. A search that can be several words
 * (はし: 端, 橋, 箸) shows them as chips on top, and each opens in place.
 */
const props = withDefaults(
  defineProps<{
    entry: DictionaryWord;
    /** Other words the search can be (はし: 箸, 端). With their entry they open in place, else as a link. */
    others?: Array<EntryBrief & { entry?: DictionaryWord }>;
    /** The search when it is a conjugated form of the entry (食べた for 食べる); null otherwise. */
    inflectedFrom?: string | null;
    /** Each kanji's first reading and meaning, by character (商: ショウ, "make a deal"). */
    kanjiInfo?: Record<string, { reading: string | null; meaning: string | null }>;
  }>(),
  { others: () => [], inflectedFrom: null, kanjiInfo: () => ({}) },
);

const { t, locale } = useI18n();
const localePath = useLocalePath();

/** How many senses show before "Show all": the entry introduces the sentences, it must not push them down. */
const SENSES_SHOWN = 3;
const ALL_SENSES = 40;

const preference = computed(() => pageGlossPreference(locale.value));

/** Which of the words the search can be is on show: 0 the entry, then the others in order. */
const selected = ref(0);
watch(
  () => props.entry,
  () => {
    selected.value = 0;
    allSenses.value = false;
    frequencyOpen.value = false;
    pickedSource.value = '';
  },
);

/** First English meaning, first synonym only: a chip is a hint, not a definition. From JMdict when it answers: a
 * reader's own monolingual dictionary would put a whole Japanese definition in the chip. */
const chipGloss = (word: DictionaryWord): string => {
  const entries = word.entries ?? [];
  const builtin = entries.filter((entry) => !entry.dictionary.startsWith('custom:'));
  const source = builtin.length > 0 && builtin.length < entries.length ? { ...word, entries: builtin } : word;
  return (
    cardSenses(source, preference.value, 3)
      .flatMap((sense) => sense.glosses)[0]
      ?.text.split(';')[0]
      ?.trim() ?? ''
  );
};

interface Choice {
  headword: string;
  reading: string;
  gloss: string;
  word: DictionaryWord | null;
}

const choices = computed<Choice[]>(() => {
  if (props.others.length === 0) return [];
  const readingOf = (reading?: string | null) => (reading ? toHiragana(reading) : '');
  return [
    { headword: props.entry.headword, reading: readingOf(props.entry.reading), gloss: chipGloss(props.entry), word: props.entry },
    ...props.others.map((other) => ({
      headword: other.headword,
      reading: readingOf(other.reading),
      gloss: other.entry ? chipGloss(other.entry) : (other.gloss?.split(';')[0]?.trim() ?? ''),
      word: other.entry ?? null,
    })),
  ];
});

const shown = computed<DictionaryWord>(() => choices.value[selected.value]?.word ?? props.entry);
const isPrimary = computed(() => selected.value === 0);

function choose(index: number) {
  selected.value = index;
  allSenses.value = false;
  frequencyOpen.value = false;
}

const allSenses = ref(false);
const everySense = computed(() => cardSenses(shown.value, preference.value, ALL_SENSES));

/**
 * The dictionaries that answer, in the reader's stack order. With the reader's own dictionaries (task 48) there can
 * be several, and stacking them would make the entry as tall as all of them together: each gets a tab and one shows
 * at a time, so the entry is as tall as one dictionary however many the reader has.
 */
const sources = computed(() => [...new Set(everySense.value.map((sense) => sense.dictionary))]);
const pickedSource = ref('');
const activeSource = computed(() =>
  sources.value.includes(pickedSource.value) ? pickedSource.value : (sources.value[0] ?? ''),
);
function pickSource(source: string) {
  pickedSource.value = source;
  allSenses.value = false;
}

const sourceSenses = computed(() =>
  sources.value.length > 1 ? everySense.value.filter((sense) => sense.dictionary === activeSource.value) : everySense.value,
);
const senses = computed(() => (allSenses.value ? sourceSenses.value : sourceSenses.value.slice(0, SENSES_SHOWN)));
const sensesTotal = computed(() => sourceSenses.value.length);
/** A monolingual dictionary's entry is often one long block: it is cut to a few lines until the reader opens it. */
const hasLongContent = computed(() =>
  sourceSenses.value.some((sense) => sense.glosses.some((row) => row.structuredContent !== undefined)),
);
const canExpand = computed(() => sensesTotal.value > SENSES_SHOWN || hasLongContent.value);

const furigana = computed(() => headwordFurigana(shown.value));
const reading = computed(() => {
  const value = shown.value.reading ? toHiragana(shown.value.reading) : '';
  return value && value !== shown.value.headword ? value : '';
});

const formatNumber = (value: number) => new Intl.NumberFormat(locale.value).format(value);

/** In katakana, as the word card draws it, each with its recording when there is one. */
const pitch = computed(() => {
  const read = shown.value.reading || shown.value.headword;
  return (shown.value.pitch ?? []).slice(0, 2).map((pattern) => ({
    downstep: pattern.downstep,
    morae: pitchMorae(read, pattern.downstep),
    audioUrl: pattern.audioUrl ?? '',
  }));
});

const { playingUrl, playHeadword, stopHeadword } = useHeadwordAudio();
// A clip belongs to the word shown: switching to a homograph stops it.
watch(shown, stopHeadword);

const byCategory = computed(() =>
  (shown.value.frequencyByCategory ?? []).flatMap((entry) => {
    const labelKey = CATEGORY_LABEL_KEYS[entry.category as keyof typeof CATEGORY_LABEL_KEYS];
    return labelKey ? [{ ...entry, label: t(labelKey) }] : [];
  }),
);
/** The card's inflection line (useWordCardContent): the labels outermost first, joined the same way. */
const inflectionLine = computed(() => joinInflection(props.entry.inflection ?? [], inflectionLanguage(locale.value)));

/** The rank by kind of media, behind the "#N ▾" badge as on the card. */
const frequencyOpen = ref(false);

const otherForms = computed(() => cardForms(shown.value).filter((form) => form !== shown.value.headword));
const parts = computed(() => (shown.value.parts ?? []).filter((part) => part.lemma));
const kanji = computed(() => kanjiIn(shown.value.headword));
const hasSide = computed(() => otherForms.value.length > 0 || parts.value.length > 0 || kanji.value.length > 0);

const wordPath = (word: string) => localePath(`/search/${encodeURIComponent(word)}`);
const kanjiPath = (character: string) => localePath(`/kanji/${encodeURIComponent(character)}`);
</script>

<template>
  <section class="word-entry" :aria-label="$t('wordEntry.label')" data-testid="word-entry">
    <!-- Homographs: the search can be several words (はし: 端, 橋, 箸). Each opens here, in place. -->
    <fieldset v-if="choices.length > 1" class="word-entry__choices" data-testid="word-entry-others">
      <legend class="sr-only">{{ $t('wordEntry.others') }}</legend>
      <template v-for="(choice, index) in choices" :key="choice.headword">
        <button
          v-if="choice.word"
          type="button"
          class="word-entry__choice"
          :class="{ 'is-active': index === selected }"
          :aria-pressed="index === selected"
          data-testid="word-entry-other"
          @click="choose(index)"
        >
          <span class="word-entry__choice-word" lang="ja">{{ choice.headword }}</span>
          <span v-if="choice.gloss" class="word-entry__choice-gloss">{{ choice.gloss }}</span>
        </button>
        <NuxtLink v-else :to="wordPath(choice.headword)" class="word-entry__choice" data-testid="word-entry-other">
          <span class="word-entry__choice-word" lang="ja">{{ choice.headword }}</span>
          <span v-if="choice.gloss" class="word-entry__choice-gloss">{{ choice.gloss }}</span>
        </NuxtLink>
      </template>
    </fieldset>

    <div class="word-entry__grid" :class="{ 'has-side': hasSide }">
      <div class="word-entry__main">
        <div class="word-entry__head">
          <span class="word-entry__word" lang="ja">
            <template v-if="furigana.length > 0">
              <template v-for="(segment, index) in furigana" :key="index">
                <ruby v-if="segment.reading">{{ segment.text }}<rt>{{ segment.reading }}</rt></ruby>
                <template v-else>{{ segment.text }}</template>
              </template>
            </template>
            <template v-else>{{ shown.headword }}</template>
          </span>
          <span v-if="reading && furigana.length === 0" class="word-entry__reading" lang="ja">{{ reading }}</span>

          <div class="word-entry__badges">
            <span v-if="shown.common" class="word-entry__badge is-common">{{ $t('wordEntry.common') }}</span>
            <span v-if="shown.jlpt" class="word-entry__badge is-jlpt">{{ shown.jlpt }}</span>
            <button
              v-if="typeof shown.frequency === 'number' && byCategory.length > 0"
              type="button"
              class="word-entry__badge is-freq word-entry__badge--button"
              :aria-expanded="frequencyOpen"
              :title="$t('tokenTooltip.frequencyByCategory')"
              data-testid="word-entry-rank"
              @click="frequencyOpen = !frequencyOpen"
            >#{{ formatNumber(shown.frequency) }} <span aria-hidden="true">{{ frequencyOpen ? '▴' : '▾' }}</span></button>
            <span v-else-if="typeof shown.frequency === 'number'" class="word-entry__badge is-freq" data-testid="word-entry-rank">
              #{{ formatNumber(shown.frequency) }}
            </span>
          </div>

          <!-- How the word is said, on the word's line: the card's graph, smaller. -->
          <span
            v-if="pitch.length > 0"
            class="word-entry__pitch-line"
            :title="$t('tokenTooltip.pitchAccent')"
            data-testid="word-entry-pitch"
          >
            <span v-for="(pattern, index) in pitch" :key="index" class="word-entry__pitch-pattern">
              <button
                v-if="pattern.audioUrl"
                type="button"
                class="word-entry__audio"
                :class="{ 'is-playing': playingUrl === pattern.audioUrl }"
                :aria-label="$t('tokenTooltip.playAudio')"
                :title="$t('tokenTooltip.playAudio')"
                data-testid="word-entry-audio"
                @click="playHeadword(pattern.audioUrl)"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M8.5 2.75 4.9 5.75H2.4v4.5h2.5l3.6 3z" fill="currentColor" stroke="none" />
                  <path d="M11 6a3 3 0 0 1 0 4" />
                  <path d="M13 4a6 6 0 0 1 0 8" />
                </svg>
              </button>
              <PitchGraph :morae="pattern.morae" :downstep="pattern.downstep" :scale="0.8" />
            </span>
          </span>
        </div>

        <!-- A conjugated search (食べた) says what the conjugation does, as the card does for a word met in a
             sentence: "past", "negative · polite". Same labels, from the same parser. -->
        <p v-if="isPrimary && inflectedFrom && inflectionLine" class="word-entry__inflection" data-testid="word-entry-inflected">
          {{ inflectionLine }}
        </p>

        <ul
          v-if="frequencyOpen && byCategory.length > 0"
          class="word-entry__freq-split"
          :aria-label="$t('tokenTooltip.frequencyByCategory')"
          data-testid="word-entry-ranks"
        >
          <li v-for="split in byCategory" :key="split.category">
            {{ split.label }} <strong>#{{ formatNumber(split.rank) }}</strong>
          </li>
        </ul>

        <div class="word-entry__meaning-head">
        <span class="word-entry__label">{{ $t('wordEntry.meaning') }}</span>
        <!-- The reader's own dictionaries (task 48): one tab each, one dictionary on show at a time. -->
        <div
          v-if="sources.length > 1"
          class="word-entry__sources"
          role="tablist"
          :aria-label="$t('wordEntry.dictionaries')"
          data-testid="word-entry-sources"
        >
          <button
            v-for="source in sources"
            :key="source"
            type="button"
            role="tab"
            class="word-entry__source-tab"
            :class="{ 'is-active': source === activeSource }"
            :aria-selected="source === activeSource"
            data-testid="word-entry-source"
            @click="pickSource(source)"
          >
            {{ source }}
          </button>
        </div>
        </div>

        <ol
          class="word-entry__senses"
          :class="{ 'is-clamped': hasLongContent && !allSenses }"
          data-testid="word-entry-senses"
        >
          <li
            v-for="(sense, index) in senses"
            :key="index"
            class="word-entry__sense"
            :class="[`is-indent-${sense.indent}`, { 'is-single': sensesTotal === 1 }]"
          >
            <!-- A dictionary that gives one entry numbers its own senses inside it (❶❷): ours would be a second number. -->
            <span v-if="sensesTotal > 1" class="word-entry__sense-number">{{ sense.number }}</span>
            <div class="word-entry__sense-body">
              <span v-for="row in sense.glosses" :key="row.lang" class="word-entry__gloss-row">
                <YomitanContent v-if="row.structuredContent !== undefined" :content="row.structuredContent" />
                <span v-else class="word-entry__gloss">{{ row.text }}</span>
              </span>
              <span v-if="sense.partsOfSpeech.length > 0 || sense.tags.length > 0" class="word-entry__chips">
                <span
                  v-for="chip in sense.partsOfSpeech"
                  :key="`p-${chip.label}`"
                  class="word-entry__chip word-entry__chip--pos"
                  :title="chip.title"
                >{{ chip.label }}</span>
                <span
                  v-for="chip in sense.tags"
                  :key="`t-${chip.label}`"
                  class="word-entry__chip"
                  :class="`word-entry__chip--${chip.category}`"
                  :title="chip.title"
                >{{ chip.label }}</span>
              </span>
              <span v-for="note in sense.notes" :key="note" class="word-entry__note">{{ note }}</span>
            </div>
          </li>
        </ol>
        <button
          v-if="canExpand"
          type="button"
          class="word-entry__more"
          :aria-expanded="allSenses"
          data-testid="word-entry-more"
          @click="allSenses = !allSenses"
        >
          {{
            allSenses
              ? $t('wordEntry.fewerSenses')
              : sensesTotal > SENSES_SHOWN
                ? $t('wordEntry.allSenses', { count: sensesTotal })
                : $t('wordEntry.showMore')
          }}
          <span aria-hidden="true">{{ allSenses ? '▴' : '▾' }}</span>
        </button>

        <!-- Another word than the one searched is on show: its own sentences are one click away. -->
        <NuxtLink v-if="!isPrimary" :to="wordPath(shown.headword)" class="word-entry__search" data-testid="word-entry-search">
          {{ $t('tokenTooltip.moreSentences') }} →
        </NuxtLink>
      </div>

      <aside v-if="hasSide" class="word-entry__side">
        <!-- The kanji first, each with its reading and meaning, as a dictionary page lists them. -->
        <div v-if="kanji.length > 0" class="word-entry__section word-entry__kanji">
          <span class="word-entry__label">{{ $t('kanjiIndex.title') }}</span>
          <ul class="word-entry__kanji-list">
            <li v-for="character in kanji" :key="character" class="word-entry__kanji-row">
              <NuxtLink
                :to="kanjiPath(character)"
                class="word-entry__kanji-link"
                lang="ja"
                data-testid="word-entry-kanji"
              >{{ character }}</NuxtLink>
              <span v-if="kanjiInfo[character]?.reading" class="word-entry__kanji-reading" lang="ja">{{
                kanjiInfo[character]?.reading
              }}</span>
              <span v-if="kanjiInfo[character]?.meaning" class="word-entry__kanji-meaning">{{
                kanjiInfo[character]?.meaning
              }}</span>
            </li>
          </ul>
        </div>

        <div v-if="otherForms.length > 0" class="word-entry__section word-entry__forms">
          <span class="word-entry__label word-entry__forms-label">{{ $t('wordEntry.forms') }}</span>
          <div class="word-entry__row">
            <NuxtLink v-for="form in otherForms" :key="form" :to="wordPath(form)" class="word-entry__form" lang="ja">{{ form }}</NuxtLink>
          </div>
        </div>

        <div v-if="parts.length > 0" class="word-entry__section word-entry__parts">
          <span class="word-entry__label word-entry__parts-label">{{ $t('tokenTooltip.parts') }}</span>
          <div class="word-entry__row">
            <NuxtLink
              v-for="part in parts"
              :key="part.id || part.lemma"
              :to="wordPath(part.lemma)"
              class="word-entry__part"
              lang="ja"
              data-testid="word-entry-part"
            >{{ part.text }}</NuxtLink>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* Colours and chips are the word card's (SegmentTokenText.vue, `.token-tooltip__*`); sizes are larger, for a page. */
.word-entry {
  margin: 8px 16px 14px;
  padding: 16px 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
}

@media (min-width: 768px) {
  .word-entry {
    margin: 14px 0 16px;
    padding: 18px 22px;
  }
}

/* Homograph chips */
.word-entry__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  margin: -2px 0 14px;
  padding: 0 0 14px;
  border: 0;
  border-bottom: 1px solid var(--line);
}

.word-entry__choice {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.word-entry__choice:hover,
.word-entry__choice:focus-visible {
  background: var(--surface-lift);
  color: var(--ink);
}

.word-entry__choice.is-active {
  border-color: var(--accent-soft);
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  color: var(--ink);
}

.word-entry__choice-word {
  font-size: 15px;
  font-weight: 600;
  color: rgb(var(--c-white));
}

.word-entry__choice-gloss {
  max-width: 14em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

/* Two zones */
.word-entry__grid {
  display: grid;
  gap: 16px;
}

@media (min-width: 900px) {
  .word-entry__grid.has-side {
    grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
    gap: 28px;
  }
}

.word-entry__main {
  min-width: 0;
}

.word-entry__side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

@media (min-width: 900px) {
  .word-entry__side {
    padding: 2px 0 2px 24px;
    border-top: 0;
    border-left: 1px solid var(--line);
  }
}

/* Head: the word, then its badges on the same line */
.word-entry__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 6px 14px;
}

.word-entry__word {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  color: rgb(var(--c-white));
}

.word-entry__word rt {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-muted);
}

.word-entry__reading {
  font-size: 16px;
  color: var(--accent-soft);
  padding-bottom: 5px;
}

.word-entry__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-bottom: 7px;
}

.word-entry__inflection {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--ink-faint);
}

.word-entry__badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}

/* Tinted from the theme's own surface and ink, so the badges read in dark, light and the patron themes. */
.word-entry__badge.is-common {
  background: color-mix(in srgb, rgb(34 197 94) 16%, var(--surface));
  color: color-mix(in srgb, rgb(34 197 94) 50%, var(--ink));
}

.word-entry__badge.is-jlpt {
  background: color-mix(in srgb, rgb(59 130 246) 16%, var(--surface));
  color: color-mix(in srgb, rgb(59 130 246) 50%, var(--ink));
}

.word-entry__badge.is-freq {
  background: color-mix(in srgb, var(--ink) 10%, var(--surface));
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.word-entry__badge--button {
  border: 0;
  cursor: pointer;
  font-family: inherit;
}

.word-entry__badge--button:hover,
.word-entry__badge--button:focus-visible {
  color: var(--ink);
}

.word-entry__freq-split {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.word-entry__freq-split strong {
  color: var(--ink);
  font-weight: 600;
}

/* Senses: the meaning first and largest, its grammar under it */
.word-entry__senses {
  margin: 10px 0 0;
  padding-left: 0;
  list-style: none;
}

/* "Meaning", and beside it one tab per dictionary when the reader's own dictionaries answer beside JMdict. */
.word-entry__meaning-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-top: 16px;
}

.word-entry__sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* A dictionary's own long entry reads as body text, a step below JMdict's short glosses. */
.word-entry__gloss-row .yomitan-content {
  font-size: 15px;
  line-height: 1.7;
}

.word-entry__source-tab {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgb(var(--c-white) / 0.14);
  font-size: 12px;
  color: var(--ink-faint);
  cursor: pointer;
}

.word-entry__source-tab:hover {
  color: rgb(var(--c-white) / 0.85);
}

.word-entry__source-tab.is-active {
  color: rgb(var(--c-white));
  border-color: rgb(var(--c-brand) / 0.7);
  background: rgb(var(--c-brand) / 0.15);
}

/* A long entry from a monolingual dictionary shows its start and fades, until "Show more". */
.word-entry__senses.is-clamped {
  max-height: 11rem;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 65%, transparent);
  mask-image: linear-gradient(to bottom, #000 65%, transparent);
}

.word-entry__sense {
  display: grid;
  grid-template-columns: 1.4rem 1fr;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 17px;
  line-height: 1.45;
  color: var(--ink);
}

.word-entry__sense.is-single {
  grid-template-columns: 1fr;
}

.word-entry__sense + .word-entry__sense {
  margin-top: 10px;
}

.word-entry__sense.is-indent-1 {
  padding-left: 16px;
}

.word-entry__sense.is-indent-2 {
  padding-left: 32px;
}

.word-entry__sense-number {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

.word-entry__sense-body {
  min-width: 0;
}

.word-entry__gloss {
  color: rgb(var(--c-white));
}

.word-entry__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.word-entry__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid color-mix(in srgb, currentColor 26%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
  color: var(--ink-faint);
}

.word-entry__chip--pos {
  color: var(--accent-soft);
}

.word-entry__chip--field {
  color: rgb(var(--c-blue-400));
}

.word-entry__chip--dialect {
  color: rgb(var(--c-violet-400));
}

.word-entry__gloss-row {
  display: block;
}

.word-entry__gloss-row + .word-entry__gloss-row {
  margin-top: 2px;
}

.word-entry__note {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  font-style: italic;
  color: var(--ink-muted);
}

.word-entry__more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0 0 calc(1.4rem + 6px);
  padding: 4px 12px;
  border: 1px solid color-mix(in srgb, var(--accent-soft) 40%, transparent);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-soft);
  transition: background-color 0.12s ease;
}

.word-entry__more:hover,
.word-entry__more:focus-visible {
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
}

.word-entry__search {
  display: block;
  width: fit-content;
  margin: 12px 0 0 calc(1.4rem + 6px);
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-soft);
}

.word-entry__search:hover {
  text-decoration: underline;
}

/* Side column: reference matter, quieter */
.word-entry__section {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.word-entry__section + .word-entry__section {
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
}

.word-entry__label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
}

.word-entry__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.word-entry__form {
  font-size: 15px;
  color: var(--ink);
}

.word-entry__form:hover {
  color: var(--accent-soft);
  text-decoration: underline;
}

.word-entry__part {
  padding: 2px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  font-size: 14px;
  transition: background-color 0.12s ease;
}

.word-entry__part:hover {
  background: var(--surface-lift);
}

.word-entry__kanji-link {
  min-width: 34px;
  padding: 2px 7px;
  border: 1px solid var(--line);
  border-radius: 7px;
  font-size: 19px;
  line-height: 1.2;
  text-align: center;
  color: var(--ink);
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.word-entry__kanji-link:hover {
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  border-color: var(--accent-soft);
  color: var(--accent-soft);
}

/* One kanji per row: the character, its reading, its meaning (商 ショウ make a deal). */
.word-entry__kanji-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.word-entry__kanji-row {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.word-entry__kanji-reading {
  font-size: 12px;
  color: var(--ink-soft, var(--ink-faint));
  white-space: nowrap;
}

.word-entry__kanji-meaning {
  overflow: hidden;
  font-size: 13px;
  color: var(--ink-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The pitch right under the word, as a dictionary page shows how it is said. */
.word-entry__pitch-line {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 2px 14px;
}

.word-entry__pitch-pattern {
  display: inline-flex;
  align-items: flex-end;
  gap: 6px;
}

/* The word card's play button, in the page's theme. */
.word-entry__audio {
  flex: 0 0 auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--surface-lift);
  color: var(--ink-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.word-entry__audio:hover {
  background: color-mix(in srgb, var(--ink) 12%, transparent);
  color: var(--ink);
}

.word-entry__audio.is-playing {
  color: var(--accent-soft);
}
</style>
