<script setup lang="ts">
import { computed, ref } from 'vue';
import { mdiReplay } from '@mdi/js';
import { type KanjiCardData, type KanjiCardWord, splitKunReading } from '~/utils/kanjiLookup';
import type { KanjiViewState } from '~/composables/useKanjiView';

/**
 * The word card's kanji view (task 44): what the card shows when a reader opens one of a word's kanji. Readings and
 * meanings from KANJIDIC2, parts from KRADFILE, the stroke order from KanjiVG, and the words written with it that
 * Nadeshiko's own subtitles use most. Words and parts open inside the same card; the sentences link (in the card's
 * footer, not here) searches for them.
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
  'open-word': [word: KanjiCardWord];
}>();

const { t } = useI18n();

/** Bumped by the replay button: a new key remounts the strokes and restarts the animation. */
const drawing = ref(0);

/** Seconds between strokes: half a second each, but a 29-stroke kanji still finishes in about six. */
const strokeStep = computed(() => Math.min(0.5, 6 / Math.max(props.card?.strokes.length ?? 1, 1)));

const kunReadings = computed(() => (props.card?.kunReadings ?? []).map(splitKunReading));

const details = computed(() => {
  const card = props.card;
  if (!card) return [];
  const parts = [t('tokenTooltip.kanjiStrokes', { count: card.strokeCount }, card.strokeCount)];
  if (card.grade !== null) {
    if (card.grade <= 6) parts.push(t('tokenTooltip.kanjiGrade', { grade: card.grade }));
    else if (card.grade === 8) parts.push(t('tokenTooltip.kanjiJoyo'));
    else parts.push(t('tokenTooltip.kanjiJinmeiyo'));
  }
  if (card.frequency !== null) parts.push(t('tokenTooltip.kanjiNewspaper', { rank: card.frequency }));
  return parts;
});

/** Meanings fell back to English for a reader who reads Spanish: say so with the same tag the senses use. */
const meaningsTag = computed(() =>
  props.card && props.card.meaningsLanguage !== props.locale ? props.card.meaningsLanguage.toUpperCase() : null,
);
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
        <!-- Stroke order: every stroke drawn faintly, then inked one at a time in writing order. -->
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
          <p v-if="card.onReadings.length > 0" class="kanji-view__readings">
            <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiOn') }}</span>
            <span lang="ja">{{ card.onReadings.join('、') }}</span>
          </p>
          <p v-if="kunReadings.length > 0" class="kanji-view__readings">
            <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiKun') }}</span>
            <span lang="ja"><template v-for="(reading, i) in kunReadings" :key="i"><template v-if="i > 0">、</template>{{ reading.stem }}<span v-if="reading.okurigana" class="kanji-view__okurigana">{{ reading.okurigana }}</span></template></span>
          </p>
          <p class="kanji-view__details">{{ details.join(' · ') }}</p>
        </div>
      </div>

      <div v-if="card.components.length > 0" class="kanji-view__row">
        <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiParts') }}</span>
        <template v-for="part in card.components" :key="part.character">
          <button
            v-if="part.hasCard"
            type="button"
            class="kanji-view__part"
            lang="ja"
            :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: part.character })"
            @click="emit('open-kanji', part.character)"
          >{{ part.character }}</button>
          <span v-else class="kanji-view__part is-static" lang="ja">{{ part.character }}</span>
        </template>
      </div>

      <div v-if="card.words.length > 0" class="kanji-view__words">
        <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiWords') }}</span>
        <button
          v-for="word in card.words"
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

.kanji-view__readings {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  color: var(--ink);
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
</style>
