<script setup lang="ts">
import { mdiBookOpenPageVariantOutline, mdiChevronDown, mdiChevronUp, mdiCogOutline, mdiTable } from '@mdi/js';
import {
  cardForms,
  cardSenses,
  frequencySplit,
  glossLanguageFor,
  headwordFurigana,
  pageGlossPreference,
  kanjiIn,
  pitchPatterns,
  type DictionaryWord,
} from '~/utils/wordCard';
import { buildConjugationTable } from '~/utils/japaneseConjugator';
import { inflectionLine as joinInflection } from '~/utils/inflectionLabels';
import { buildKanjiPath, buildWordSearchPath } from '~/utils/routes';
import { posthog } from '~/utils/posthogClient';
import { useWordEntryPreferences } from '~/composables/useWordEntryPreferences';
import ModalConjugations from '~/components/search/modal/ModalConjugations.vue';
import PitchPattern from '~/components/search/segment/PitchPattern.vue';
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
    /** The search, when the reader can follow its new sentences from here (task 52); null hides the button. */
    watchQuery?: string | null;
  }>(),
  { others: () => [], inflectedFrom: null, kanjiInfo: () => ({}), watchQuery: null },
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
  if (index !== selected.value) {
    posthog.capture('word_entry_interacted', {
      action: 'homograph_selected',
      index,
      total_choices: choices.value.length,
    });
  }
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
  if (source !== activeSource.value) {
    posthog.capture('word_entry_interacted', {
      action: 'dictionary_tab_selected',
      is_custom: source.startsWith('custom:'),
    });
  }
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

const { formatNumber } = useFormat();

/** In katakana, as the word card draws it, each with its recording when there is one. */
const pitch = computed(() => pitchPatterns(shown.value, shown.value.reading || shown.value.headword));

const { playingUrl, playHeadword, stopHeadword } = useHeadwordAudio('word-entry');
// A clip belongs to the word shown: switching to a homograph stops it.
watch(shown, stopHeadword);

const byCategory = computed(() => frequencySplit(shown.value));
/** The card's inflection line (useWordCardContent): the labels outermost first, joined the same way. */
const inflectionLine = computed(() => joinInflection(props.entry.inflection ?? [], glossLanguageFor(locale.value)));

/** The rank by kind of media, behind the "#N ▾" badge as on the card. */
const frequencyOpen = ref(false);

const { prefs, setPref } = useWordEntryPreferences();
const settingsOpen = ref(false);
const conjugationsOpen = ref(false);
const settingsEl = ref<HTMLElement | null>(null);
const localCollapsed = ref<boolean | null>(null);
const isCollapsed = computed(() => localCollapsed.value ?? prefs.collapsed);
const conjugations = computed(() => buildConjugationTable(shown.value));

watch(
  () => props.entry,
  () => {
    localCollapsed.value = null;
    conjugationsOpen.value = false;
  },
);

function toggleCollapsed() {
  const next = !isCollapsed.value;
  localCollapsed.value = next;
  posthog.capture('word_entry_interacted', { action: next ? 'collapsed' : 'expanded' });
}

function toggleFrequency() {
  const next = !frequencyOpen.value;
  frequencyOpen.value = next;
  if (next) {
    posthog.capture('word_entry_interacted', {
      action: 'frequency_breakdown_opened',
      categories: byCategory.value.length,
    });
  }
}

function openConjugations() {
  conjugationsOpen.value = true;
  posthog.capture('word_entry_interacted', { action: 'conjugations_opened' });
}

function onDocumentClick(event: MouseEvent) {
  if (!settingsOpen.value) return;
  if (settingsEl.value && !settingsEl.value.contains(event.target as Node)) {
    settingsOpen.value = false;
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && settingsOpen.value) {
    settingsOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
});

const otherForms = computed(() => cardForms(shown.value).filter((form) => form !== shown.value.headword));
const hasFormShares = computed(() => (shown.value.forms ?? []).some((f) => typeof f.share === 'number' && f.share > 0));
const formItems = computed(() => {
  const byText = new Map((shown.value.forms ?? []).map((f) => [f.text, f]));
  const texts = hasFormShares.value
    ? [shown.value.headword, ...otherForms.value]
    : otherForms.value;
  return texts.map((text) => {
    const meta = byText.get(text);
    return {
      text,
      isCurrent: text === shown.value.headword,
      frequency: meta?.frequency,
      share: meta?.share,
    };
  });
});
const formatFormShare = (share?: number): string => {
  if (typeof share !== 'number' || share <= 0) return '';
  const pct = Math.round(share * 100);
  return pct < 1 ? '<1%' : `${pct}%`;
};
const parts = computed(() => (shown.value.parts ?? []).filter((part) => part.lemma));
const kanji = computed(() => kanjiIn(shown.value.headword));
const hasSide = computed(() => otherForms.value.length > 0 || parts.value.length > 0 || kanji.value.length > 0);
const firstGlossPreview = computed(() => sourceSenses.value[0]?.glosses[0]?.text ?? '');
const hasHeaderMeta = computed(
  () =>
    pitch.value.length > 0 ||
    Boolean(shown.value.common) ||
    Boolean(shown.value.jlpt) ||
    typeof shown.value.frequency === 'number' ||
    (isCollapsed.value && Boolean(firstGlossPreview.value)),
);

const wordPath = (word: string) => localePath(buildWordSearchPath(word));
const kanjiPath = (character: string) => localePath(buildKanjiPath(character));
const dictionariesPath = computed(() => localePath('/user/dictionaries'));

/** Groups JMdict part-of-speech codes into distinct calm chip tones (verb / noun / adj / other). */
function posChipTone(code?: string): 'verb' | 'noun' | 'adj' | 'other' {
  if (!code) return 'other';
  if (/^(v[1245]|vk|vs|vi|vt|vn|vr|vz|aux-v|cop)/.test(code)) return 'verb';
  if (/^(n($|-)|pn|num|ctr)/.test(code)) return 'noun';
  if (/^(adj-|aux-adj)/.test(code)) return 'adj';
  return 'other';
}
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

    <div class="word-entry__header" :class="{ 'is-collapsed': isCollapsed }">
      <div class="word-entry__title">
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
      </div>

      <div v-if="hasHeaderMeta" class="word-entry__meta">
        <!-- How the word is said, on the word's line: the card's graph, smaller. -->
        <span
          v-if="pitch.length > 0"
          class="word-entry__pitch-line"
          :title="$t('tokenTooltip.pitchAccent')"
          data-testid="word-entry-pitch"
        >
          <PitchPattern
            v-for="(pattern, index) in pitch"
            :key="index"
            class="word-entry__pitch-pattern"
            :pattern="pattern"
            :playing="playingUrl === pattern.audioUrl"
            :scale="0.8"
            @play="playHeadword"
          />
        </span>

        <div
          v-if="shown.common || shown.jlpt || typeof shown.frequency === 'number'"
          class="word-entry__badges"
        >
          <span v-if="shown.common" class="word-entry__badge is-common">{{ $t('wordEntry.common') }}</span>
          <span v-if="shown.jlpt" class="word-entry__badge is-jlpt">{{ shown.jlpt }}</span>
          <button
            v-if="typeof shown.frequency === 'number' && byCategory.length > 0"
            type="button"
            class="word-entry__badge is-freq word-entry__badge--button"
            :aria-expanded="frequencyOpen"
            :title="$t('tokenTooltip.frequencyByCategory')"
            data-testid="word-entry-rank"
            @click="toggleFrequency"
          >#{{ formatNumber(shown.frequency) }} <span aria-hidden="true">{{ frequencyOpen ? '▴' : '▾' }}</span></button>
          <span v-else-if="typeof shown.frequency === 'number'" class="word-entry__badge is-freq" data-testid="word-entry-rank">
            #{{ formatNumber(shown.frequency) }}
          </span>
        </div>

        <span v-if="isCollapsed && firstGlossPreview" class="word-entry__collapsed-gloss">
          {{ firstGlossPreview }}
        </span>
      </div>

      <div class="word-entry__header-actions">
        <SearchWordWatchButton v-if="watchQuery" :query="watchQuery" mode="NEW_SENTENCES" />

        <button
          v-if="conjugations"
          type="button"
          class="word-entry__icon-btn"
          :aria-label="$t('wordEntry.conjugations.button')"
          :title="$t('wordEntry.conjugations.button')"
          data-testid="word-entry-conjugations-btn"
          @click="openConjugations"
        >
          <svg class="word-entry__icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path :d="mdiTable" />
          </svg>
        </button>

        <button
          type="button"
          class="word-entry__icon-btn"
          :aria-label="isCollapsed ? $t('wordEntry.settings.expand') : $t('wordEntry.settings.collapse')"
          :title="isCollapsed ? $t('wordEntry.settings.expand') : $t('wordEntry.settings.collapse')"
          :aria-expanded="!isCollapsed"
          data-testid="word-entry-collapse"
          @click="toggleCollapsed"
        >
          <svg class="word-entry__icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path :d="isCollapsed ? mdiChevronDown : mdiChevronUp" />
          </svg>
        </button>

        <div ref="settingsEl" class="word-entry__settings-wrap">
          <button
            type="button"
            class="word-entry__icon-btn"
            :class="{ 'is-open': settingsOpen }"
            :aria-label="$t('wordEntry.settings.title')"
            :title="$t('wordEntry.settings.title')"
            :aria-expanded="settingsOpen"
            aria-haspopup="menu"
            data-testid="word-entry-settings-btn"
            @click.stop="settingsOpen = !settingsOpen"
          >
            <svg class="word-entry__icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path :d="mdiCogOutline" />
            </svg>
          </button>

          <div
            v-if="settingsOpen"
            class="word-entry__settings-menu"
            role="menu"
            data-testid="word-entry-settings-menu"
          >
            <div class="word-entry__settings-title">{{ $t('wordEntry.settings.title') }}</div>

            <label class="word-entry__settings-row">
              <span>{{ $t('wordEntry.settings.collapsed') }}</span>
              <input
                type="checkbox"
                class="word-entry__switch"
                :checked="prefs.collapsed"
                data-testid="word-entry-pref-collapsed"
                @change="
                  setPref('collapsed', ($event.target as HTMLInputElement).checked);
                  localCollapsed = null;
                "
              />
            </label>

            <div class="word-entry__settings-footer">
              <NuxtLink
                :to="dictionariesPath"
                class="word-entry__settings-link"
                data-testid="word-entry-manage-dicts"
                @click="settingsOpen = false"
              >
                <svg class="word-entry__icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path :d="mdiBookOpenPageVariantOutline" />
                </svg>
                <span>{{ $t('wordEntry.settings.manageDictionaries') }}</span>
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>

      <!-- A conjugated search (食べた) says what the conjugation does, as the card does for a word met in a
           sentence: "past", "negative · polite". Same labels, from the same parser. -->
      <p
        v-if="!isCollapsed && isPrimary && inflectedFrom && inflectionLine"
        class="word-entry__inflection"
        data-testid="word-entry-inflected"
      >
        {{ inflectionLine }}
      </p>

      <ul
        v-if="!isCollapsed && frequencyOpen && byCategory.length > 0"
        class="word-entry__freq-split"
        :aria-label="$t('tokenTooltip.frequencyByCategory')"
        data-testid="word-entry-ranks"
      >
        <li v-for="split in byCategory" :key="split.category">
          {{ t(split.labelKey) }} <strong>#{{ formatNumber(split.rank) }}</strong>
        </li>
      </ul>
    </div>

    <div v-if="!isCollapsed" class="word-entry__body">
      <div class="word-entry__main">
        <div v-if="sources.length > 1" class="word-entry__meaning-head">
        <span class="word-entry__label">{{ $t('wordEntry.meaning') }}</span>
        <!-- The reader's own dictionaries (task 48): one tab each, one dictionary on show at a time. -->
        <div
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
              <div class="word-entry__sense-inline">
                <span v-for="row in sense.glosses" :key="row.lang" class="word-entry__gloss-row">
                  <YomitanContent v-if="row.structuredContent !== undefined" :content="row.structuredContent" />
                  <span v-else class="word-entry__gloss">{{ row.text }}</span>
                </span>
                <span v-if="sense.partsOfSpeech.length > 0 || sense.tags.length > 0" class="word-entry__chips">
                  <span
                    v-for="chip in sense.partsOfSpeech"
                    :key="`p-${chip.label}`"
                    class="word-entry__chip"
                    :class="`word-entry__chip--pos-${posChipTone(chip.code)}`"
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
              </div>
              <span v-for="note in sense.notes" :key="note" class="word-entry__note">{{ note }}</span>
              <span v-if="sense.seeAlso?.length" class="word-entry__xrefs" data-testid="word-entry-see-also">
                <span class="word-entry__xref-label">{{ $t('wordEntry.seeAlso') }}</span>
                <template v-for="(refItem, rIdx) in sense.seeAlso" :key="refItem.text">
                  <span v-if="rIdx > 0" class="word-entry__xref-sep">, </span>
                  <NuxtLink :to="wordPath(refItem.text)" class="word-entry__xref-link" lang="ja">
                    {{ refItem.text }}<span v-if="refItem.reading" class="word-entry__xref-reading"> ({{ refItem.reading }})</span>
                  </NuxtLink>
                </template>
              </span>
              <span v-if="sense.antonyms?.length" class="word-entry__xrefs" data-testid="word-entry-antonyms">
                <span class="word-entry__xref-label">{{ $t('wordEntry.antonym') }}</span>
                <template v-for="(refItem, rIdx) in sense.antonyms" :key="refItem.text">
                  <span v-if="rIdx > 0" class="word-entry__xref-sep">, </span>
                  <NuxtLink :to="wordPath(refItem.text)" class="word-entry__xref-link" lang="ja">
                    {{ refItem.text }}<span v-if="refItem.reading" class="word-entry__xref-reading"> ({{ refItem.reading }})</span>
                  </NuxtLink>
                </template>
              </span>
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
              <div v-if="kanjiInfo[character]?.reading || kanjiInfo[character]?.meaning" class="word-entry__kanji-meta">
                <span v-if="kanjiInfo[character]?.reading" class="word-entry__kanji-reading" lang="ja">{{
                  kanjiInfo[character]?.reading
                }}</span>
                <span v-if="kanjiInfo[character]?.meaning" class="word-entry__kanji-meaning">{{
                  kanjiInfo[character]?.meaning
                }}</span>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="formItems.length > 0" class="word-entry__section word-entry__forms">
          <span class="word-entry__label word-entry__forms-label">{{ $t('wordEntry.forms') }}</span>
          <div class="word-entry__row">
            <template v-for="item in formItems" :key="item.text">
              <span
                v-if="item.isCurrent"
                class="word-entry__form is-current"
                :title="typeof item.frequency === 'number' ? `#${formatNumber(item.frequency)}` : undefined"
                lang="ja"
                data-testid="word-entry-form"
              >
                <span>{{ item.text }}</span>
                <span v-if="formatFormShare(item.share)" class="word-entry__form-share">{{
                  formatFormShare(item.share)
                }}</span>
              </span>
              <NuxtLink
                v-else
                :to="wordPath(item.text)"
                class="word-entry__form"
                :title="typeof item.frequency === 'number' ? `#${formatNumber(item.frequency)}` : undefined"
                lang="ja"
                data-testid="word-entry-form"
              >
                <span>{{ item.text }}</span>
                <span v-if="formatFormShare(item.share)" class="word-entry__form-share">{{
                  formatFormShare(item.share)
                }}</span>
              </NuxtLink>
            </template>
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

    <ModalConjugations
      v-if="conjugations"
      :open="conjugationsOpen"
      :table="conjugations"
      @close="conjugationsOpen = false"
    />
  </section>
</template>

<style scoped>
/* Colours and chips are the word card's (SegmentTokenText.vue, `.token-tooltip__*`); sizes are larger, for a page. */
.word-entry {
  position: relative;
  min-width: 0;
  max-width: 100%;
  margin: 8px 16px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
}

@media (min-width: 768px) {
  .word-entry {
    margin: 10px 0 14px;
  }
}

/* Homograph chips */
.word-entry__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 9px 14px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
  border-radius: 13px 13px 0 0;
  background: color-mix(in srgb, var(--background) 25%, transparent);
}

@media (min-width: 768px) {
  .word-entry__choices {
    padding: 9px 18px;
  }
}

.word-entry__choice {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
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
  font-size: 14px;
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

/* Header bar: word + actions on row 1 and meta full-width below on small screens; single compact row on >= 640px */
.word-entry__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
}

.word-entry__header.is-collapsed {
  border-bottom: 0;
}

.word-entry__title {
  order: 1;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  min-width: 0;
}

.word-entry__meta {
  order: 3;
  flex: 1 0 100%;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.word-entry__header-actions {
  order: 2;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

@media (min-width: 640px) {
  .word-entry__header {
    gap: 6px 12px;
  }

  .word-entry__meta {
    order: 2;
    flex: 1 1 0%;
  }

  .word-entry__header-actions {
    order: 3;
  }
}

@media (min-width: 768px) {
  .word-entry__header {
    padding: 11px 18px;
  }
}

.word-entry__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--background) 45%, transparent);
  color: var(--ink-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.word-entry__icon-btn:hover,
.word-entry__icon-btn:focus-visible,
.word-entry__icon-btn.is-open {
  background: var(--surface-lift);
  border-color: color-mix(in srgb, var(--ink) 28%, transparent);
  color: var(--ink);
}

.word-entry__icon-svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Settings popover */
.word-entry__settings-wrap {
  position: relative;
}

.word-entry__settings-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: 248px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
}

.word-entry__settings-title {
  padding: 4px 8px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
}

.word-entry__settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.word-entry__settings-row:hover {
  background: var(--surface-lift);
}

.word-entry__switch {
  appearance: none;
  position: relative;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 20%, var(--background));
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.word-entry__switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: rgb(var(--c-white));
  transition: transform 0.15s ease;
}

.word-entry__switch:checked {
  background: rgb(var(--c-brand));
}

.word-entry__switch:checked::after {
  transform: translateX(14px);
}

.word-entry__settings-footer {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
}

.word-entry__settings-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-soft);
  transition: background-color 0.12s ease;
}

.word-entry__settings-link:hover {
  background: color-mix(in srgb, var(--accent-soft) 12%, transparent);
}

/* Body: full-width meanings, then a compact horizontal footer strip for Kanji / Forms / Parts */
.word-entry__body {
  display: flex;
  flex-direction: column;
}

.word-entry__main {
  min-width: 0;
  padding: 12px 14px;
}

@media (min-width: 768px) {
  .word-entry__main {
    padding: 12px 18px;
  }
}

.word-entry__side {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px 18px;
  padding: 9px 14px;
  border-top: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
  border-radius: 0 0 11px 11px;
  background: color-mix(in srgb, var(--background) 28%, transparent);
}

@media (min-width: 640px) {
  .word-entry__side {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
}

@media (min-width: 768px) {
  .word-entry__side {
    padding: 9px 18px;
  }
}

.word-entry__word {
  font-size: 27px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: rgb(var(--c-white));
}

.word-entry__word rt {
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-muted);
}

.word-entry__reading {
  font-size: 15px;
  color: var(--accent-soft);
}

.word-entry__badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.word-entry__collapsed-gloss {
  flex: 1 1 160px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ink-muted);
}

.word-entry__inflection {
  order: 4;
  flex: 1 0 100%;
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint);
}

.word-entry__badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}

/* Tinted from the theme's own surface and ink, so the badges read softly in dark, light and the patron themes. */
.word-entry__badge.is-common {
  background: color-mix(in srgb, rgb(134 239 172) 10%, var(--surface));
  border-color: color-mix(in srgb, rgb(134 239 172) 20%, transparent);
  color: color-mix(in srgb, rgb(134 239 172) 42%, var(--ink));
}

.word-entry__badge.is-jlpt {
  background: color-mix(in srgb, rgb(147 197 253) 10%, var(--surface));
  border-color: color-mix(in srgb, rgb(147 197 253) 20%, transparent);
  color: color-mix(in srgb, rgb(147 197 253) 42%, var(--ink));
}

.word-entry__badge.is-freq {
  background: color-mix(in srgb, var(--background) 65%, var(--surface));
  border-color: var(--line);
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.word-entry__badge--button {
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.word-entry__badge--button:hover,
.word-entry__badge--button:focus-visible {
  border-color: color-mix(in srgb, var(--ink) 28%, transparent);
  color: var(--ink);
}

.word-entry__freq-split {
  order: 5;
  flex: 1 0 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 2px 0 0;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--background) 45%, transparent);
  list-style: none;
  font-size: 12px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.word-entry__freq-split strong {
  color: var(--ink);
  font-weight: 600;
}

/* Senses: compact, inline POS chips right after the gloss */
.word-entry__senses {
  margin: 0;
  padding-left: 0;
  list-style: none;
}

.word-entry__meaning-head + .word-entry__senses {
  margin-top: 8px;
}

/* "Meaning", and beside it one tab per dictionary when the reader's own dictionaries answer beside JMdict. */
.word-entry__meaning-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.word-entry__sources {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

/* A dictionary's own long entry reads as body text, a step below JMdict's short glosses. */
.word-entry__gloss-row .yomitan-content {
  font-size: 14px;
  line-height: 1.65;
}

.word-entry__source-tab {
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid rgb(var(--c-white) / 0.14);
  font-size: 11px;
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
  max-height: 9.5rem;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 65%, transparent);
  mask-image: linear-gradient(to bottom, #000 65%, transparent);
}

.word-entry__sense {
  display: grid;
  grid-template-columns: 20px 1fr;
  align-items: baseline;
  gap: 7px;
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  color: var(--ink);
}

.word-entry__sense.is-single {
  grid-template-columns: 1fr;
}

.word-entry__sense + .word-entry__sense {
  margin-top: 6px;
}

.word-entry__sense.is-indent-1 {
  padding-left: 14px;
}

.word-entry__sense.is-indent-2 {
  padding-left: 28px;
}

.word-entry__sense-number {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

.word-entry__sense-body {
  min-width: 0;
}

.word-entry__sense-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
}

.word-entry__gloss {
  font-weight: 500;
  color: rgb(var(--c-white));
}

.word-entry__chips {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.word-entry__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ink) 8%, var(--surface));
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  white-space: nowrap;
  color: var(--ink-muted);
}

.word-entry__chip--pos-verb {
  background: color-mix(in srgb, rgb(134 239 172) 11%, var(--surface));
  color: color-mix(in srgb, rgb(134 239 172) 48%, var(--ink));
}

.word-entry__chip--pos-noun {
  background: color-mix(in srgb, rgb(147 197 253) 11%, var(--surface));
  color: color-mix(in srgb, rgb(147 197 253) 48%, var(--ink));
}

.word-entry__chip--pos-adj {
  background: color-mix(in srgb, rgb(253 224 140) 11%, var(--surface));
  color: color-mix(in srgb, rgb(253 224 140) 48%, var(--ink));
}

.word-entry__chip--pos-other {
  background: color-mix(in srgb, rgb(216 180 254) 11%, var(--surface));
  color: color-mix(in srgb, rgb(216 180 254) 48%, var(--ink));
}

.word-entry__chip--field {
  background: color-mix(in srgb, rgb(147 197 253) 10%, var(--surface));
  color: color-mix(in srgb, rgb(147 197 253) 42%, var(--ink));
}

.word-entry__chip--dialect {
  background: color-mix(in srgb, rgb(216 180 254) 10%, var(--surface));
  color: color-mix(in srgb, rgb(216 180 254) 42%, var(--ink));
}

.word-entry__gloss-row {
  display: inline;
  min-width: 0;
  max-width: 100%;
}

.word-entry__gloss-row + .word-entry__gloss-row {
  display: block;
  margin-top: 2px;
}

.word-entry__note {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  font-style: italic;
  color: var(--ink-muted);
}

.word-entry__xrefs {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--ink-faint);
}

.word-entry__xref-label {
  margin-right: 5px;
}

.word-entry__xref-link {
  color: color-mix(in srgb, rgb(147 197 253) 55%, var(--ink));
  transition: color 0.12s ease;
}

.word-entry__xref-link:hover {
  text-decoration: underline;
}

.word-entry__xref-reading {
  color: var(--ink-faint);
}

.word-entry__more {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 10px 0 0 27px;
  padding: 3px 10px;
  border: 1px solid color-mix(in srgb, var(--accent-soft) 40%, transparent);
  border-radius: 999px;
  font-size: 12px;
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
  margin: 10px 0 0 27px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-soft);
}

.word-entry__search:hover {
  text-decoration: underline;
}

/* Footer strip: reference matter in a single horizontal band */
.word-entry__section {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.word-entry__section + .word-entry__section {
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
}

@media (min-width: 640px) {
  .word-entry__section + .word-entry__section {
    padding-top: 0;
    border-top: 0;
    padding-left: 14px;
    border-left: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  }
}

.word-entry__label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
}

.word-entry__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.word-entry__form {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  font-size: 12px;
  color: var(--ink);
  transition: border-color 0.12s ease, color 0.12s ease;
}

.word-entry__form.is-current {
  border-color: color-mix(in srgb, var(--accent-soft) 45%, var(--line));
  background: color-mix(in srgb, var(--accent-soft) 10%, var(--surface));
  color: rgb(var(--c-white));
  font-weight: 600;
}

.word-entry__form-share {
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

.word-entry__form:hover {
  border-color: var(--accent-soft);
  color: var(--accent-soft);
}

.word-entry__part {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.word-entry__part:hover {
  background: var(--surface-lift);
  border-color: var(--accent-soft);
}

/* Horizontal kanji chips: [武 warrior · ブ] [勇 courage · ユウ] */
.word-entry__kanji-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.word-entry__kanji-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 3px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  min-width: 0;
}

.word-entry__kanji-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--background) 60%, transparent);
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  color: rgb(var(--c-white));
  transition: background-color 0.12s ease, color 0.12s ease;
}

.word-entry__kanji-link:hover {
  background: color-mix(in srgb, var(--accent-soft) 18%, transparent);
  color: var(--accent-soft);
}

.word-entry__kanji-meta {
  display: inline-flex;
  flex-direction: row-reverse;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.word-entry__kanji-meaning {
  max-width: 11em;
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.word-entry__kanji-reading {
  font-size: 11px;
  line-height: 1.2;
  color: var(--ink-faint);
  white-space: nowrap;
}

/* The pitch beside the word, cleanly separated without a heavy pill frame. */
.word-entry__pitch-line {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  max-width: 100%;
  overflow-x: auto;
}

@media (min-width: 640px) {
  .word-entry__pitch-line {
    padding-left: 12px;
    border-left: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
  }
}

.word-entry__pitch-pattern {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}
</style>
