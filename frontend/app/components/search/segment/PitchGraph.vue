<script setup lang="ts">
import type { PitchMora } from '~/utils/wordCard';

/**
 * One pitch accent drawn as a line graph: each mora a dot, high or low, joined by lines, its kana above it, and a
 * hollow dot after the word for the particle that follows (high after a flat word, low after any other). Coloured
 * by accent type, the usual convention: flat (heiban) blue, head-high (atamadaka) red, middle (nakadaka) orange,
 * tail (odaka) green. Shared by the word card and the dictionary entry above a word search.
 */
const props = defineProps<{
  morae: PitchMora[];
  downstep: number;
}>();

const HIGH_Y = 26;
const LOW_Y = 44;
const TEXT_Y = 11;
const PAD = 8;
const HEIGHT = 50;
/** Width of a mora's column: a mora of two kana (しゃ) needs more room than one. */
const columnWidth = (text: string) => Math.max(26, [...text].length * 15 + 8);

type Kind = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka';
const kind = computed<Kind>(() => {
  if (props.downstep === 0) return 'heiban';
  if (props.downstep === 1) return 'atamadaka';
  return props.downstep >= props.morae.length ? 'odaka' : 'nakadaka';
});

const points = computed(() => {
  let x = PAD;
  const out: Array<{ x: number; y: number; text: string; particle: boolean }> = [];
  for (const mora of props.morae) {
    const width = columnWidth(mora.text);
    out.push({ x: x + width / 2, y: mora.high ? HIGH_Y : LOW_Y, text: mora.text, particle: false });
    x += width;
  }
  // The particle after the word: only a flat word keeps it high.
  out.push({ x: x + 13, y: kind.value === 'heiban' ? HIGH_Y : LOW_Y, text: '', particle: true });
  return out;
});

const width = computed(() => (points.value.at(-1)?.x ?? 0) + PAD);
const path = computed(() => points.value.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' '));
const label = computed(() => `${props.morae.map((mora) => mora.text).join('')} [${props.downstep}]`);
</script>

<template>
  <svg
    class="pitch-graph"
    :class="`is-${kind}`"
    :width="width"
    :height="HEIGHT"
    :viewBox="`0 0 ${width} ${HEIGHT}`"
    role="img"
    :aria-label="label"
    data-testid="pitch-graph"
  >
    <title>{{ label }}</title>
    <path :d="path" class="pitch-graph__line" />
    <template v-for="(point, index) in points" :key="index">
      <circle :cx="point.x" :cy="point.y" r="4.5" :class="point.particle ? 'pitch-graph__particle' : 'pitch-graph__dot'" />
      <text v-if="!point.particle" :x="point.x" :y="TEXT_Y" class="pitch-graph__kana" lang="ja">{{ point.text }}</text>
    </template>
  </svg>
</template>

<style scoped>
.pitch-graph {
  --pitch-color: rgb(96 165 250);
  display: block;
  overflow: visible;
}

.pitch-graph.is-atamadaka {
  --pitch-color: rgb(248 113 113);
}

.pitch-graph.is-nakadaka {
  --pitch-color: rgb(251 146 60);
}

.pitch-graph.is-odaka {
  --pitch-color: rgb(74 222 128);
}

.pitch-graph__line {
  fill: none;
  stroke: var(--pitch-color);
  stroke-width: 2;
  stroke-linejoin: round;
}

.pitch-graph__dot {
  fill: var(--pitch-color);
}

.pitch-graph__particle {
  fill: var(--surface);
  stroke: var(--pitch-color);
  stroke-width: 2;
}

.pitch-graph__kana {
  fill: var(--pitch-color);
  font-size: 14px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: middle;
}
</style>
