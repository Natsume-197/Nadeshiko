<script setup lang="ts">
/**
 * A circular arrow with the seek step written inside, as podcast players draw it. MDI only ships these for 5
 * seconds and up, and the player steps by 1: clips are a few seconds long, so a bigger step would skip the
 * sentence it is meant to replay.
 *
 * Only the arrow is mirrored for `forward`; the number must read the same way in both.
 */
const props = withDefaults(
  defineProps<{
    direction: 'back' | 'forward';
    seconds?: number;
    size?: number;
  }>(),
  { seconds: 1, size: 24 },
);
</script>

<template>
  <svg :width="props.size" :height="props.size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <g
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      :transform="props.direction === 'forward' ? 'matrix(-1 0 0 1 24 0)' : undefined"
    >
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
    </g>
    <text
      x="12"
      y="12.5"
      fill="currentColor"
      font-size="8.5"
      font-weight="700"
      text-anchor="middle"
      dominant-baseline="central"
      font-family="ui-sans-serif, system-ui, sans-serif"
    >
      {{ props.seconds }}
    </text>
  </svg>
</template>
