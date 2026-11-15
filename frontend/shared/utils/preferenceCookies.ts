// Every SSR useCookiePreference cookie must appear here so shared caches never serve one reader
// another reader's preferences. nd-locale-preference is excluded: it selects redirects, while page locale is in the URL.
export const RENDER_FORKING_PREFERENCE_COOKIES = [
  'nd_lang_prefs',
  'nd_hiragana',
  'nd_dict_links',
  'nd-motion',
  'nd_media_sort',
  'nd_theme',
  'nd_custom_theme',
] as const;

export type RenderForkingPreferenceCookie = (typeof RENDER_FORKING_PREFERENCE_COOKIES)[number];

export const LANG_PREFS_COOKIE = 'nd_lang_prefs' satisfies RenderForkingPreferenceCookie;

export const HIRAGANA_COOKIE = 'nd_hiragana' satisfies RenderForkingPreferenceCookie;

export const DICT_LINKS_COOKIE = 'nd_dict_links' satisfies RenderForkingPreferenceCookie;
// SSR stamps data-motion. Preserve the hyphenated cookie name so existing preferences are not orphaned.
export const MOTION_COOKIE = 'nd-motion' satisfies RenderForkingPreferenceCookie;

// SSR sorts the search media filter by it, so the list arrives in the reader's order.
export const MEDIA_SORT_COOKIE = 'nd_media_sort' satisfies RenderForkingPreferenceCookie;

// SSR stamps data-theme so the first paint is already in the reader's theme.
export const THEME_COOKIE = 'nd_theme' satisfies RenderForkingPreferenceCookie;

// A patron's custom theme colours (`light-d6457a-fdf2f6`), stamped as inline variables during SSR.
export const CUSTOM_THEME_COOKIE = 'nd_custom_theme' satisfies RenderForkingPreferenceCookie;

// Reserve retired names and clear their cookies. Remove entries only after the one-year max-age has elapsed
// for all readers, or a reused name could parse values from an unrelated retired feature.
export const RETIRED_PREFERENCE_COOKIES = ['nd_tooltip_reading'] as const;
