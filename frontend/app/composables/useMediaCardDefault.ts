/**
 * Default only the disclosure's initial state; any reader can toggle it. CLOSED keeps the card to one
 * line above the sentences, which are what the page is for; the details stay in the markup either
 * way, so nothing is lost to search engines. Account preferences already arrive with the SSR session,
 * so another cookie would add cache fragmentation without improving rendering. Anonymous pages always
 * start at the default.
 */
export const MEDIA_CARD_DEFAULTS = ['OPEN', 'CLOSED'] as const;
export type MediaCardDefault = (typeof MEDIA_CARD_DEFAULTS)[number];

export const DEFAULT_MEDIA_CARD_DEFAULT: MediaCardDefault = 'CLOSED';

export function useMediaCardDefault() {
  const user = userStore();

  const preference = computed<MediaCardDefault>(() => {
    if (!user.isLoggedIn) return DEFAULT_MEDIA_CARD_DEFAULT;
    // An explicit choice either way wins; only a reader who never chose gets the default.
    const chosen = user.preferences?.mediaCardDefault;
    return chosen === 'OPEN' || chosen === 'CLOSED' ? chosen : DEFAULT_MEDIA_CARD_DEFAULT;
  });

  /** The same answer as a boolean, which is the shape the card actually seeds from. */
  const startsOpen = computed(() => preference.value === 'OPEN');

  return { preference, startsOpen };
}
