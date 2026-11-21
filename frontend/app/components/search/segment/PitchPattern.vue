<script setup lang="ts">
import type { PitchPatternView } from '~/utils/wordCard';
import PitchGraph from './PitchGraph.vue';

/**
 * One pitch accent as the word card and the word's dictionary entry show it: a play button for the pattern's
 * recording (when it has one) in front of the graph that names the accent it plays. The root takes the caller's
 * class for its layout; the default slot goes after the graph (the card's pitch-dictionary name).
 */
withDefaults(
  defineProps<{
    pattern: PitchPatternView;
    /** This pattern's clip is the one playing. */
    playing?: boolean;
    /** The graph's drawn size, 1 the card's. */
    scale?: number;
  }>(),
  { playing: false, scale: 1 },
);

const emit = defineEmits<{ play: [audioUrl: string] }>();
</script>

<template>
  <span>
    <button
      v-if="pattern.audioUrl"
      type="button"
      class="pitch-pattern__audio"
      :class="{ 'is-playing': playing }"
      :aria-label="$t('tokenTooltip.playAudio')"
      :title="$t('tokenTooltip.playAudio')"
      data-testid="pitch-audio"
      @click="emit('play', pattern.audioUrl)"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8.5 2.75 4.9 5.75H2.4v4.5h2.5l3.6 3z" fill="currentColor" stroke="none" />
        <path d="M11 6a3 3 0 0 1 0 4" />
        <path d="M13 4a6 6 0 0 1 0 8" />
      </svg>
    </button>
    <PitchGraph :morae="pattern.morae" :downstep="pattern.downstep" :scale="scale" :title="pattern.source || undefined" />
    <slot />
  </span>
</template>

<style scoped>
/* Quiet beside the pitch until pointed at, and accented while a clip runs so a second click reads as "again" rather
   than "did that do anything". Sized to a comfortable tap target rather than to the 14px glyph inside it, which is
   why it centres against a row of morae rather than sitting on their baseline. The word card sets its own hover
   wash through `--pitch-audio-hover`. */
.pitch-pattern__audio {
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

.pitch-pattern__audio:hover {
  background: var(--pitch-audio-hover, color-mix(in srgb, var(--ink) 12%, transparent));
  color: var(--ink);
}

.pitch-pattern__audio.is-playing {
  color: var(--accent-soft);
}
</style>
