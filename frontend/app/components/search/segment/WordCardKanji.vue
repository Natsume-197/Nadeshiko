<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { mdiReplay } from '@mdi/js';
import { type KanjiCardData, type KanjiCardWordRef, splitKunReading } from '~/utils/kanjiLookup';
import type { KanjiViewState } from '~/composables/useKanjiView';

/**
 * The word card's kanji view (task 44): what the card shows when a reader opens one of a word's kanji. Meanings,
 * readings and radical from KANJIDIC2, JLPT from Waller's lists, radical names from Kanji alive, parts from KRADFILE,
 * the stroke order from KanjiVG, and, from Nadeshiko's own subtitles, the words written with it that come up most,
 * also under the reading each one uses. Words, parts and related kanji open inside the same card; the sentences link
 * (in the card's footer, not here) searches for them.
 */
const props = defineProps<{
  kanji: string;
  card: KanjiCardData | null;
  state: KanjiViewState;
  /** The reader's gloss language, to say when the meanings had to fall back to English. */
  locale: 'en' | 'es';
}>();

const emit = defineEmits<{
  'open-kanji': [character: string];
  'open-word': [word: KanjiCardWordRef];
}>();

const { t } = useI18n();

/** How many words show before "Show all". */
const WORDS_SHOWN = 8;

/** Bumped by the replay button: a new key remounts the strokes and restarts the animation. */
const drawing = ref(0);
const allWords = ref(false);
// Another kanji starts with its list short again.
watch(
  () => props.card?.character,
  () => {
    allWords.value = false;
  },
);

/** Seconds between strokes: half a second each, but a 29-stroke kanji still finishes in about six. */
const strokeStep = computed(() => Math.min(0.5, 6 / Math.max(props.card?.strokes.length ?? 1, 1)));

const readings = computed(() =>
  (props.card?.readings ?? []).map((entry) => ({
    ...entry,
    ...(entry.kind === 'kun' ? splitKunReading(entry.reading) : { stem: entry.reading, okurigana: '' }),
  })),
);

const details = computed(() => {
  const card = props.card;
  if (!card) return [];
  const parts = [t('tokenTooltip.kanjiStrokes', { count: card.strokeCount }, card.strokeCount)];
  if (card.jlpt !== null) parts.push(t('tokenTooltip.kanjiJlpt', { level: card.jlpt }));
  if (card.grade !== null) {
    if (card.grade <= 6) parts.push(t('tokenTooltip.kanjiGrade', { grade: card.grade }));
    else if (card.grade === 8) parts.push(t('tokenTooltip.kanjiJoyo'));
    else parts.push(t('tokenTooltip.kanjiJinmeiyo'));
  }
  if (card.frequency !== null) parts.push(t('tokenTooltip.kanjiNewspaper', { rank: card.frequency }));
  return parts;
});

const shownWords = computed(() => (allWords.value ? props.card?.words : props.card?.words.slice(0, WORDS_SHOWN)) ?? []);

/** Meanings fell back to English for a reader who reads Spanish: say so with the same tag the senses use. */
const meaningsTag = computed(() =>
  props.card && props.card.meaningsLanguage !== props.locale ? props.card.meaningsLanguage.toUpperCase() : null,
);

/** A related kanji's tooltip: its reading and meaning. */
const relatedTitle = (kanji: { reading: string | null; meaning: string | null }) =>
  [kanji.reading, kanji.meaning].filter(Boolean).join(' · ');
</script>

<template>
  <div class="kanji-view">
    <p v-if="state === 'loading'" class="kanji-view__pending">
      <span class="kanji-view__spinner" aria-hidden="true" />
      <span>{{ $t('tokenTooltip.loading') }}</span>
    </p>
    <p v-else-if="state === 'missing'" class="kanji-view__pending">{{ $t('tokenTooltip.kanjiMissing') }}</p>
    <p v-else-if="state === 'unavailable'" class="kanji-view__pending">{{ $t('tokenTooltip.unavailable') }}</p>

    <template v-else-if="card">
      <div class="kanji-view__top">
        <!-- Stroke order: every stroke drawn faintly, then inked one at a time in writing order, with its number. -->
        <div v-if="card.strokes.length > 0" class="kanji-view__strokes">
          <svg
            :key="drawing"
            viewBox="0 0 109 109"
            role="img"
            :style="{ '--step': `${strokeStep}s` }"
          >
            <title>{{ $t('tokenTooltip.kanjiStrokeOrder', { kanji }) }}</title>
            <g class="kanji-view__ghost">
              <path v-for="(d, i) in card.strokes" :key="`g${i}`" :d="d" />
            </g>
            <g class="kanji-view__ink">
              <path v-for="(d, i) in card.strokes" :key="`i${i}`" :d="d" pathLength="1" :style="{ '--i': i }" />
            </g>
            <g class="kanji-view__numbers" aria-hidden="true">
              <text
                v-for="([x, y], i) in card.strokeNumbers"
                :key="`n${i}`"
                :x="x"
                :y="y"
                :style="{ '--i': i }"
              >{{ i + 1 }}</text>
            </g>
          </svg>
          <button
            type="button"
            class="kanji-view__replay"
            data-testid="kanji-replay"
            :aria-label="$t('tokenTooltip.kanjiReplay')"
            :title="$t('tokenTooltip.kanjiReplay')"
            @click="drawing += 1"
          >
            <UiBaseIcon :path="mdiReplay" :size="14" />
          </button>
        </div>

        <div class="kanji-view__facts">
          <p v-if="card.meanings.length > 0" class="kanji-view__meanings">
            <span v-if="meaningsTag" class="kanji-view__lang">{{ meaningsTag }}</span>{{ card.meanings.join(', ') }}
          </p>
          <p class="kanji-view__details">{{ details.join(' · ') }}</p>
          <p v-if="card.radical" class="kanji-view__radical" data-testid="kanji-radical">
            <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiRadical') }}</span>
            <button
              v-if="card.radical.character && card.radical.character !== card.character"
              type="button"
              class="kanji-view__radical-glyph is-link"
              lang="ja"
              :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: card.radical.character })"
              @click="emit('open-kanji', card.radical.character)"
            >{{ card.radical.glyph }}</button>
            <span v-else class="kanji-view__radical-glyph" lang="ja">{{ card.radical.glyph }}</span>
            <span lang="ja">{{ card.radical.reading }}</span>
            <span class="kanji-view__radical-meaning">{{ card.radical.meaning }}</span>
          </p>
        </div>
      </div>

      <!-- Each reading with the words it is heard in, from our own subtitles. A reading none of them uses is shown
           faint: it exists, but a reader of anime will rarely meet it. -->
      <div v-if="readings.length > 0" class="kanji-view__readings">
        <div
          v-for="entry in readings"
          :key="`${entry.kind}${entry.reading}`"
          class="kanji-view__reading"
          :class="{ 'is-rare': entry.examples.length === 0 }"
          data-testid="kanji-reading"
        >
          <span class="kanji-view__label">{{ $t(entry.kind === 'on' ? 'tokenTooltip.kanjiOn' : 'tokenTooltip.kanjiKun') }}</span>
          <span class="kanji-view__reading-text" lang="ja">{{ entry.stem }}<span v-if="entry.okurigana" class="kanji-view__okurigana">{{ entry.okurigana }}</span></span>
          <span class="kanji-view__examples">
            <button
              v-for="example in entry.examples"
              :key="example.id"
              type="button"
              class="kanji-view__example"
              lang="ja"
              :title="example.reading ?? undefined"
              @click="emit('open-word', example)"
            >{{ example.headword }}</button>
          </span>
        </div>
      </div>

      <div v-if="card.components.length > 0" class="kanji-view__row">
        <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiParts') }}</span>
        <template v-for="part in card.components" :key="part.character">
          <button
            v-if="part.hasCard"
            type="button"
            class="kanji-view__part"
            :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: part.character })"
            @click="emit('open-kanji', part.character)"
          ><span lang="ja">{{ part.character }}</span><span v-if="part.meaning" class="kanji-view__part-meaning">{{ part.meaning }}</span></button>
          <span v-else class="kanji-view__part is-static"><span lang="ja">{{ part.character }}</span><span v-if="part.meaning" class="kanji-view__part-meaning">{{ part.meaning }}</span></span>
        </template>
      </div>

      <div v-if="card.words.length > 0" class="kanji-view__words">
        <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiWords') }}</span>
        <button
          v-for="word in shownWords"
          :key="word.id"
          type="button"
          class="kanji-view__word"
          data-testid="kanji-word"
          @click="emit('open-word', word)"
        >
          <span class="kanji-view__word-text" lang="ja">{{ word.headword }}</span>
          <span v-if="word.reading && word.reading !== word.headword" class="kanji-view__word-reading" lang="ja">{{ word.reading }}</span>
          <span v-if="word.gloss" class="kanji-view__word-gloss">{{ word.gloss }}</span>
        </button>
        <button
          v-if="card.words.length > WORDS_SHOWN"
          type="button"
          class="kanji-view__more"
          data-testid="kanji-more-words"
          @click="allWords = !allWords"
        >{{ allWords ? $t('tokenTooltip.showLess') : $t('tokenTooltip.kanjiAllWords', { count: card.words.length }) }}</button>
      </div>

      <div v-if="card.sameRadical.length > 0" class="kanji-view__related" data-testid="kanji-same-radical">
        <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiSameRadical', { count: card.sameRadicalCount }) }}</span>
        <span class="kanji-view__related-list">
          <button
            v-for="other in card.sameRadical"
            :key="other.character"
            type="button"
            class="kanji-view__related-kanji"
            lang="ja"
            :title="relatedTitle(other)"
            :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: other.character })"
            @click="emit('open-kanji', other.character)"
          >{{ other.character }}</button>
        </span>
      </div>

      <div v-if="card.containedIn.length > 0" class="kanji-view__related" data-testid="kanji-contained-in">
        <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiContainedIn', { count: card.containedInCount }) }}</span>
        <span class="kanji-view__related-list">
          <button
            v-for="other in card.containedIn"
            :key="other.character"
            type="button"
            class="kanji-view__related-kanji"
            lang="ja"
            :title="relatedTitle(other)"
            :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: other.character })"
            @click="emit('open-kanji', other.character)"
          >{{ other.character }}</button>
        </span>
      </div>
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

.kanji-view__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 999px;
  animation: kanji-view-spin 0.8s linear infinite;
}

@keyframes kanji-view-spin {
  to {
    transform: rotate(360deg);
  }
}

.kanji-view__top {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-top: 6px;
}

.kanji-view__strokes {
  position: relative;
  flex: 0 0 auto;
  width: 92px;
  height: 92px;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.kanji-view__strokes svg {
  width: 100%;
  height: 100%;
}

.kanji-view__strokes path {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.kanji-view__ghost path {
  stroke: var(--line);
}

.kanji-view__ink path {
  stroke: var(--ink);
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: kanji-view-draw calc(var(--step) * 0.9) ease-out forwards;
  animation-delay: calc(var(--i) * var(--step));
}

@keyframes kanji-view-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kanji-view__ink path {
    animation: none;
    stroke-dashoffset: 0;
  }
}

.kanji-view__replay {
  position: absolute;
  right: 3px;
  bottom: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--ink-faint);
  background: transparent;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.kanji-view__replay:hover {
  background: var(--surface-lift);
  color: var(--ink);
}

.kanji-view__facts {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kanji-view__meanings {
  font-size: var(--definition-size, 14px);
  line-height: 1.4;
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
  vertical-align: 1px;
}

.kanji-view__label {
  flex: 0 0 auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

.kanji-view__okurigana {
  color: var(--ink-faint);
}

.kanji-view__details {
  font-size: 11px;
  color: var(--ink-muted);
}

.kanji-view__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin-top: 10px;
}

.kanji-view__part {
  min-width: 28px;
  padding: 2px 7px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: transparent;
  color: var(--ink);
  font-size: 15px;
  text-align: center;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}

.kanji-view__part:hover {
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  border-color: var(--accent-soft);
  color: var(--accent-soft);
}

.kanji-view__part.is-static {
  border-style: dashed;
  color: var(--ink-muted);
  cursor: default;
}

.kanji-view__part.is-static:hover {
  background: transparent;
  border-color: var(--line);
  color: var(--ink-muted);
}

.kanji-view__words {
  display: flex;
  flex-direction: column;
  margin-top: 10px;
}

.kanji-view__words > .kanji-view__label {
  margin-bottom: 2px;
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

.kanji-view__word:focus-visible,
.kanji-view__part:focus-visible,
.kanji-view__replay:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}

.kanji-view__word-text {
  flex: 0 0 auto;
  font-size: 15px;
  color: var(--ink);
}

.kanji-view__word-reading {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--accent-soft);
}

.kanji-view__word-gloss {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ink-muted);
}
.kanji-view__numbers text {
  font-size: 8px;
  fill: var(--ink-faint);
  opacity: 0;
  animation: kanji-view-number 0.2s ease-out forwards;
  animation-delay: calc(var(--i) * var(--step));
}

@keyframes kanji-view-number {
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kanji-view__numbers text {
    animation: none;
    opacity: 1;
  }
}

.kanji-view__radical {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  color: var(--ink);
}

.kanji-view__radical-glyph {
  font-size: 16px;
  color: var(--ink);
}

.kanji-view__radical-glyph.is-link {
  padding: 0 4px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.kanji-view__radical-glyph.is-link:hover {
  border-color: var(--accent-soft);
  color: var(--accent-soft);
}

.kanji-view__radical-meaning {
  font-size: 12px;
  color: var(--ink-muted);
}

.kanji-view__readings {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 10px;
}

.kanji-view__reading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.kanji-view__reading > .kanji-view__label {
  width: 2.2em;
}

.kanji-view__reading-text {
  flex: 0 0 auto;
  min-width: 4.5em;
  font-size: 14px;
  color: var(--ink);
}

.kanji-view__reading.is-rare .kanji-view__reading-text {
  color: var(--ink-faint);
}

.kanji-view__examples {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  min-width: 0;
}

.kanji-view__example {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 13px;
  color: var(--accent-soft);
  cursor: pointer;
}

.kanji-view__example:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.kanji-view__part {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}

.kanji-view__part-meaning {
  font-size: 11px;
  color: var(--ink-muted);
}

.kanji-view__more {
  align-self: flex-start;
  margin-top: 2px;
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

.kanji-view__related {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}

.kanji-view__related-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.kanji-view__related-kanji {
  min-width: 28px;
  padding: 2px 5px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: transparent;
  color: var(--ink);
  font-size: 15px;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}

.kanji-view__related-kanji:hover {
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  border-color: var(--accent-soft);
  color: var(--accent-soft);
}

.kanji-view__example:focus-visible,
.kanji-view__more:focus-visible,
.kanji-view__related-kanji:focus-visible,
.kanji-view__radical-glyph.is-link:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}
</style>
