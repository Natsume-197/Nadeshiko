<script setup lang="ts">
import { computed, ref } from 'vue';
import { mdiReplay } from '@mdi/js';

/**
 * A kanji's stroke order (KanjiVG paths, 109×109 view box): every stroke drawn faintly, then inked one at a time in
 * writing order with its number, and a replay button. Fills its parent, which sets the size: the word card's kanji
 * view draws it small, the kanji's own page large. Static for readers who prefer reduced motion.
 */
const props = defineProps<{
  kanji: string;
  strokes: string[];
  /** Where each stroke's number goes, `[x, y]`; empty for none. */
  numbers: Array<[number, number]>;
  /** Draw it on a practice-sheet grid (田字格): a frame with a dashed cross, as a learner writes kanji. */
  grid?: boolean;
}>();

/** Bumped by the replay button: a new key remounts the strokes and restarts the animation. */
const drawing = ref(0);

/** Seconds between strokes: half a second each, but a 29-stroke kanji still finishes in about six. */
const strokeStep = computed(() => Math.min(0.5, 6 / Math.max(props.strokes.length, 1)));
</script>

<template>
  <div class="kanji-strokes">
    <svg :key="drawing" viewBox="0 0 109 109" role="img" :style="{ '--step': `${strokeStep}s` }">
      <title>{{ $t('tokenTooltip.kanjiStrokeOrder', { kanji }) }}</title>
      <g v-if="grid" class="kanji-strokes__grid" aria-hidden="true">
        <line x1="54.5" y1="2" x2="54.5" y2="107" />
        <line x1="2" y1="54.5" x2="107" y2="54.5" />
      </g>
      <g class="kanji-strokes__ghost">
        <path v-for="(d, i) in strokes" :key="`g${i}`" :d="d" />
      </g>
      <g class="kanji-strokes__ink">
        <path v-for="(d, i) in strokes" :key="`i${i}`" :d="d" pathLength="1" :style="{ '--i': i }" />
      </g>
      <g class="kanji-strokes__numbers" aria-hidden="true">
        <text v-for="([x, y], i) in numbers" :key="`n${i}`" :x="x" :y="y" :style="{ '--i': i }">{{ i + 1 }}</text>
      </g>
    </svg>
    <button
      type="button"
      class="kanji-strokes__replay"
      data-testid="kanji-replay"
      :aria-label="$t('tokenTooltip.kanjiReplay')"
      :title="$t('tokenTooltip.kanjiReplay')"
      @click="drawing += 1"
    >
      <UiBaseIcon :path="mdiReplay" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.kanji-strokes {
  position: relative;
  width: 100%;
  height: 100%;
}

.kanji-strokes svg {
  width: 100%;
  height: 100%;
}

.kanji-strokes path {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.kanji-strokes__grid line {
  /* Mixed from the ink, not --line: the light theme's --line is near white and the guides vanished. */
  stroke: color-mix(in srgb, var(--ink) 16%, transparent);
  stroke-width: 0.6;
  stroke-dasharray: 2 2.5;
}

.kanji-strokes__ghost path {
  /* The strokes still to be written: visible in both themes while the animation runs. */
  stroke: color-mix(in srgb, var(--ink) 20%, transparent);
}

.kanji-strokes__ink path {
  stroke: var(--ink);
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: kanji-strokes-draw calc(var(--step) * 0.9) ease-out forwards;
  animation-delay: calc(var(--i) * var(--step));
}

@keyframes kanji-strokes-draw {
  to {
    stroke-dashoffset: 0;
  }
}

.kanji-strokes__numbers text {
  font-size: 8px;
  fill: var(--ink-faint);
  opacity: 0;
  animation: kanji-strokes-number 0.2s ease-out forwards;
  animation-delay: calc(var(--i) * var(--step));
}

@keyframes kanji-strokes-number {
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kanji-strokes__ink path {
    animation: none;
    stroke-dashoffset: 0;
  }

  .kanji-strokes__numbers text {
    animation: none;
    opacity: 1;
  }
}

.kanji-strokes__replay {
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

.kanji-strokes__replay:hover {
  background: var(--surface-lift);
  color: var(--ink);
}

.kanji-strokes__replay:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}
</style>
