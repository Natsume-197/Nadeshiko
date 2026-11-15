import { CUSTOM_THEME_COOKIE, THEME_COOKIE } from '#shared/utils/preferenceCookies';
import { useCookiePreference } from '~/composables/useCookiePreference';
import { type CustomTheme, customThemeStyle, decodeCustomTheme, encodeCustomTheme } from '~/utils/customTheme';

/**
 * dark is the site as it has always been; light inverts it; system follows the OS; custom is a patron's own theme
 * (utils/customTheme.ts). Cookies keep it right for signed-out readers and in the server's first render, as with
 * motion. The colours live in themePalette.js and assets/css/tailwind.css.
 */
export const THEMES = ['dark', 'light', 'system', 'custom'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'dark';

const isTheme = (value: string | null): value is Theme => !!value && (THEMES as readonly string[]).includes(value);

export function useThemePreference() {
  const { state, set } = useCookiePreference<Theme>(THEME_COOKIE, 'theme-preference', {
    parse: (raw) => (isTheme(raw) ? raw : DEFAULT_THEME),
    // The default is the absence of a choice, so it clears rather than writes.
    serialize: (value) => (value === DEFAULT_THEME ? null : value),
  });

  const custom = useCookiePreference<CustomTheme | null>(CUSTOM_THEME_COOKIE, 'custom-theme', {
    parse: (raw) => decodeCustomTheme(raw),
    serialize: (value) => (value ? encodeCustomTheme(value) : null),
  });

  /** `custom` without saved colours (a cleared or tampered cookie) falls back to the default. */
  const active = computed<CustomTheme | null>(() => (state.value === 'custom' ? custom.state.value : null));

  /** What `data-theme` says: a custom theme renders on its base palette. */
  const attribute = computed(() => {
    if (state.value !== 'custom') return state.value;
    return active.value?.base ?? DEFAULT_THEME;
  });

  /** A light custom theme paints its header in the accent (see accentHeaderRules in themePalette.js). */
  const header = computed(() => (active.value?.base === 'light' ? 'accent' : undefined));

  /** Inline variables for <html>, or nothing. */
  const style = computed(() => (active.value ? customThemeStyle(active.value) : undefined));

  /** Switch to a custom theme. The caller has already saved it on the server (that is where patron status is checked). */
  const setCustomTheme = (theme: CustomTheme) => {
    custom.set(theme);
    set('custom');
  };

  /** Drop the custom theme, for example when the server no longer returns one (a lapsed membership). */
  const clearCustomTheme = () => {
    custom.set(null);
    if (state.value === 'custom') set(DEFAULT_THEME);
  };

  return {
    preference: state,
    setPreference: set,
    customTheme: custom.state,
    attribute,
    header,
    style,
    setCustomTheme,
    clearCustomTheme,
  };
}
