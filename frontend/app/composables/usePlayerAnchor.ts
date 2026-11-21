import { ref } from 'vue';

/**
 * The player bar's height in px while it is on screen, 0 otherwise. The title filter takes it off its
 * own height so the two never overlap, and the layout keeps that much room at the page's end (as
 * `--player-bar-height`). Written by a ResizeObserver on the bar, so it changes when the bar does
 * (shown, hidden, wrapped), never on scroll.
 */
const barHeight = ref(0);

export const usePlayerBarHeight = () => barHeight;
