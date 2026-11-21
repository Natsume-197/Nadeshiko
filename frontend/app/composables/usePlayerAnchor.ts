import { shallowRef } from 'vue';

/**
 * The floating player's dock, when the page has one: a sticky box at the end of the results column
 * that the player teleports its bar into (see `SearchContainer` and `AudioPlayer`).
 *
 * Module-level rather than `useState`: it holds a DOM node, which is only ever set on the client and
 * must never be serialised into the SSR payload. A page registers its dock on mount and clears it on
 * unmount; with none registered the bar floats, fixed and centred.
 */
const dock = shallowRef<HTMLElement | null>(null);

export const usePlayerAnchor = () => dock;
