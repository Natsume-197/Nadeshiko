<script setup lang="ts">
import {
  cardForms,
  cardSenses,
  headwordFurigana,
  pageGlossPreference,
  kanjiIn,
  pitchMorae,
  type ShirabeWord,
} from '~/utils/wordCard';
import { CATEGORY_LABEL_KEYS } from '~/utils/categories';
import PitchGraph from '~/components/search/segment/PitchGraph.vue';
import { type EntryBrief, toHiragana } from '#shared/utils/wordEntry';

/**
 * The dictionary entry above a word search (`/search/食べる`): what the word means, how it is read and said, how
 * common it is in each kind of media, its other spellings, the words and kanji it is made of. Server-rendered, so
 * the word's page on this site carries its definition as well as its sentences. Always Nadeshiko's own dictionary.
 *
 * Laid out as the word card (SegmentTokenText's `token-tooltip`), row for row, so a reader who knows one reads the
 * other: head, inflection line, badges, pitch, parts, senses, other spellings, kanji. The entry adds the other
 * words the search can be.
 */
const props = withDefaults(
  defineProps<{
    entry: ShirabeWord;
    /** Other words the search can be (はし: 箸, 端), each a link to its own page. */
    others?: EntryBrief[];
    /** The search when it is a conjugated form of the entry (食べた for 食べる); null otherwise. */
    inflectedFrom?: string | null;
  }>(),
  { others: () => [], inflectedFrom: null },
);

const { t, locale } = useI18n();
const localePath = useLocalePath();

/** How many senses show before "Show all": the entry introduces the sentences, it must not push them down. */
const SENSES_SHOWN = 3;
const ALL_SENSES = 40;

const preference = computed(() => pageGlossPreference(locale.value));

const allSenses = ref(false);
const senses = computed(() => cardSenses(props.entry, preference.value, allSenses.value ? ALL_SENSES : SENSES_SHOWN));
const sensesTotal = computed(() => cardSenses(props.entry, preference.value, ALL_SENSES).length);

const furigana = computed(() => headwordFurigana(props.entry));
const reading = computed(() => {
  const value = props.entry.reading ? toHiragana(props.entry.reading) : '';
  return value && value !== props.entry.headword ? value : '';
});

const formatNumber = (value: number) => new Intl.NumberFormat(locale.value).format(value);

const pitch = computed(() => {
  const read = reading.value || props.entry.headword;
  return (props.entry.pitch ?? []).slice(0, 2).map((pattern) => ({
    downstep: pattern.downstep,
    morae: pitchMorae(read, pattern.downstep),
  }));
});

const byCategory = computed(() =>
  (props.entry.frequencyByCategory ?? []).flatMap((entry) => {
    const labelKey = CATEGORY_LABEL_KEYS[entry.category as keyof typeof CATEGORY_LABEL_KEYS];
    return labelKey ? [{ ...entry, label: t(labelKey) }] : [];
  }),
);
/** The card's inflection line (useWordCardContent): the labels outermost first, joined the same way. */
const inflectionLine = computed(() => (props.entry.inflection ?? []).join(' · '));

/** The rank by kind of media, behind the "#N ▾" badge as on the card. */
const frequencyOpen = ref(false);

const otherForms = computed(() => cardForms(props.entry).filter((form) => form !== props.entry.headword));
const parts = computed(() => (props.entry.parts ?? []).filter((part) => part.lemma));
const kanji = computed(() => kanjiIn(props.entry.headword));

const wordPath = (word: string) => localePath(`/search/${encodeURIComponent(word)}`);
const kanjiPath = (character: string) => localePath(`/kanji/${encodeURIComponent(character)}`);
</script>

<template>
  <section class="word-entry" :aria-label="$t('wordEntry.label')" data-testid="word-entry">
    <div class="word-entry__head">
      <span class="word-entry__word" lang="ja">
        <template v-if="furigana.length > 0">
          <template v-for="(segment, index) in furigana" :key="index">
            <ruby v-if="segment.reading">{{ segment.text }}<rt>{{ segment.reading }}</rt></ruby>
            <template v-else>{{ segment.text }}</template>
          </template>
        </template>
        <template v-else>{{ entry.headword }}</template>
      </span>
      <span v-if="reading && furigana.length === 0" class="word-entry__reading" lang="ja">{{ reading }}</span>
    </div>

    <!-- A conjugated search (食べた) says what the conjugation does, as the card does for a word met in a
         sentence: "past", "negative · polite". Same labels, from the same parser. -->
    <p v-if="inflectedFrom && inflectionLine" class="word-entry__inflection" data-testid="word-entry-inflected">
      {{ inflectionLine }}
    </p>

    <div class="word-entry__badges">
      <span v-if="entry.common" class="word-entry__badge is-common">{{ $t('wordEntry.common') }}</span>
      <span v-if="entry.jlpt" class="word-entry__badge is-jlpt">{{ entry.jlpt }}</span>
      <button
        v-if="typeof entry.frequency === 'number' && byCategory.length > 0"
        type="button"
        class="word-entry__badge is-freq word-entry__badge--button"
        :aria-expanded="frequencyOpen"
        :title="$t('tokenTooltip.frequencyByCategory')"
        data-testid="word-entry-rank"
        @click="frequencyOpen = !frequencyOpen"
      >#{{ formatNumber(entry.frequency) }} <span aria-hidden="true">{{ frequencyOpen ? '▴' : '▾' }}</span></button>
      <span v-else-if="typeof entry.frequency === 'number'" class="word-entry__badge is-freq" data-testid="word-entry-rank">
        #{{ formatNumber(entry.frequency) }}
      </span>
    </div>
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

    <div v-if="parts.length > 0" class="word-entry__parts">
      <span class="word-entry__parts-label">{{ $t('tokenTooltip.parts') }}</span>
      <NuxtLink
        v-for="part in parts"
        :key="part.id || part.lemma"
        :to="wordPath(part.lemma)"
        class="word-entry__part"
        lang="ja"
        data-testid="word-entry-part"
      >{{ part.text }}</NuxtLink>
    </div>

    <ol class="word-entry__senses">
      <li v-for="(sense, index) in senses" :key="index" class="word-entry__sense" :class="`is-indent-${sense.indent}`">
        <span class="word-entry__sense-number">{{ sense.number }}</span>
        <div class="word-entry__sense-body">
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
          <span v-for="row in sense.glosses" :key="row.lang" class="word-entry__gloss-row">
            <span v-if="row.label" class="word-entry__lang">{{ row.label }}</span>
            <span class="word-entry__gloss">{{ row.text }}</span>
          </span>
          <span v-for="note in sense.notes" :key="note" class="word-entry__note">{{ note }}</span>
        </div>
      </li>
    </ol>
    <button
      v-if="sensesTotal > SENSES_SHOWN"
      type="button"
      class="word-entry__more"
      :aria-expanded="allSenses"
      @click="allSenses = !allSenses"
    >
      {{ allSenses ? $t('wordEntry.fewerSenses') : $t('wordEntry.allSenses', { count: sensesTotal }) }}
    </button>

    <!-- How the word sounds, after what it means, as on the card. -->
    <div v-if="pitch.length > 0" class="word-entry__pitch">
      <span class="word-entry__pitch-label">{{ $t('tokenTooltip.pitchAccent') }}</span>
      <PitchGraph v-for="(pattern, index) in pitch" :key="index" :morae="pattern.morae" :downstep="pattern.downstep" />
    </div>

    <div v-if="otherForms.length > 0" class="word-entry__forms">
      <span class="word-entry__forms-label">{{ $t('wordEntry.forms') }}</span>
      <NuxtLink v-for="form in otherForms" :key="form" :to="wordPath(form)" class="word-entry__form" lang="ja">{{ form }}</NuxtLink>
    </div>

    <div v-if="kanji.length > 0" class="word-entry__kanji">
      <NuxtLink
        v-for="character in kanji"
        :key="character"
        :to="kanjiPath(character)"
        class="word-entry__kanji-link"
        lang="ja"
        data-testid="word-entry-kanji"
      >{{ character }}</NuxtLink>
    </div>

    <!-- Homographs: the search can also be another word (はし: 箸, 端). Each opens its own page. -->
    <div v-if="others.length > 0" class="word-entry__forms" data-testid="word-entry-others">
      <span class="word-entry__forms-label">{{ $t('wordEntry.others') }}</span>
      <NuxtLink
        v-for="other in others"
        :key="other.headword"
        :to="wordPath(other.headword)"
        class="word-entry__other"
        data-testid="word-entry-other"
      >
        <span lang="ja" class="word-entry__form">{{ other.headword }}</span>
        <span v-if="other.gloss" class="word-entry__other-gloss">{{ other.gloss }}</span>
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
/* Every value below is the word card's (SegmentTokenText.vue, `.token-tooltip__*`); keep them in step. */
.word-entry {
  margin: 8px 16px 14px;
  padding: 10px 14px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
}

@media (min-width: 768px) {
  .word-entry {
    margin: 14px 0 16px;
  }
}

.word-entry__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.word-entry__word {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.25;
  color: rgb(var(--c-white));
}

.word-entry__reading {
  font-size: 13px;
  color: var(--accent-soft);
}

.word-entry__inflection {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ink-faint);
}

.word-entry__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 7px;
}

.word-entry__badge {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}

.word-entry__badge.is-common {
  background: rgb(34 60 42);
  color: rgb(150 219 170);
}

.word-entry__badge.is-jlpt {
  background: rgb(38 52 66);
  color: rgb(158 197 236);
}

.word-entry__badge.is-freq {
  background: rgb(48 48 48);
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
  gap: 2px 12px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.word-entry__freq-split strong {
  color: var(--ink);
  font-weight: 600;
}

.word-entry__pitch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 20px;
  margin-top: 8px;
}

.word-entry__pitch-label {
  flex: 0 0 100%;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

.word-entry__parts,
.word-entry__forms {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin-top: 8px;
}

.word-entry__parts-label,
.word-entry__forms-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

.word-entry__part {
  padding: 1px 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  font-size: 13px;
  transition: background-color 0.12s ease;
}

.word-entry__part:hover {
  background: var(--surface-lift);
}

.word-entry__senses {
  margin: 8px 0 0;
  padding-left: 0;
  list-style: none;
}

.word-entry__sense {
  display: grid;
  grid-template-columns: 1rem 1fr;
  align-items: baseline;
  gap: 4px;
  margin: 5px 0;
  font-size: var(--definition-size, 14px);
  line-height: 1.5;
  color: var(--ink);
}

.word-entry__sense.is-indent-1 {
  padding-left: 14px;
}

.word-entry__sense.is-indent-2 {
  padding-left: 28px;
}

.word-entry__sense-number {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

.word-entry__sense-body {
  min-width: 0;
}

.word-entry__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 3px;
}

.word-entry__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, currentColor 26%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
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

.word-entry__lang {
  display: inline-flex;
  min-width: 1.55rem;
  justify-content: center;
  margin-right: 6px;
  padding: 1px 4px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 1.4;
  color: var(--ink-muted);
  vertical-align: 1px;
}

.word-entry__note {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-style: italic;
  color: var(--ink-muted);
}

.word-entry__more {
  margin: 2px 0 0 1.25rem;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-soft);
}

.word-entry__form {
  font-size: 13px;
  color: var(--ink);
}

.word-entry__other {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  margin-right: 6px;
}

.word-entry__other-gloss {
  max-width: 16em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ink-muted);
}

.word-entry__kanji {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
}

.word-entry__kanji-link {
  min-width: 30px;
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: 7px;
  font-size: 17px;
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

.word-entry__more:hover,
.word-entry__form:hover,
.word-entry__other:hover .word-entry__form {
  color: var(--accent-soft);
  text-decoration: underline;
}
</style>
