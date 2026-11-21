<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { usePlayerStore } from '~/stores/player';

/**
 * The player's volume, for the bar and listening mode alike: a range input over the store's volume, in the
 * theme's ink. Width and visibility are the caller's, through `class`.
 */
const { t } = useI18n();
const playerStore = usePlayerStore();
const { volume } = storeToRefs(playerStore);

const volumePercent = computed(() => Math.round(volume.value * 100));

const onVolumeInput = (event: Event) => {
  playerStore.setVolume(Number((event.target as HTMLInputElement).value) / 100);
};
</script>

<template>
  <input
    type="range"
    min="0"
    max="100"
    step="1"
    :value="volumePercent"
    :style="{ '--volume-fill': `${volumePercent}%` }"
    class="player-volume"
    :aria-label="t('player.controls.volume')"
    :aria-valuetext="`${volumePercent}%`"
    @input="onVolumeInput"
    @change="playerStore.trackVolumeChange()"
  />
</template>

<style scoped>
/* The gradient paints the filled track consistently across engines; native range styling does not. */
.player-volume {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

/* Separate rules per engine: a selector list one engine does not recognise is dropped whole. */
.player-volume::-webkit-slider-runnable-track {
  height: 0.25rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--ink) var(--volume-fill), color-mix(in srgb, var(--ink) 20%, transparent) var(--volume-fill));
}

.player-volume::-moz-range-track {
  height: 0.25rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--ink) var(--volume-fill), color-mix(in srgb, var(--ink) 20%, transparent) var(--volume-fill));
}

.player-volume::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 9999px;
  background: var(--ink);
  /* Centres a 0.75rem thumb on the 0.25rem track. */
  margin-top: -0.25rem;
}

.player-volume::-moz-range-thumb {
  width: 0.75rem;
  height: 0.75rem;
  border: none;
  border-radius: 9999px;
  background: var(--ink);
}

.player-volume:focus-visible {
  outline: 2px solid rgb(248 113 113);
  outline-offset: 4px;
}
</style>
