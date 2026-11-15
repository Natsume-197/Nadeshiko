/**
 * Custom themes (a patron perk): a light or dark base plus an accent and a page background. Everything else is
 * derived from those two colours, so a reader picks two swatches and the whole site follows.
 *
 * The base decides which palette the Tailwind colours use (see themePalette.js); the derived tokens below override
 * the semantic ones from assets/css/tailwind.css through an inline style on <html>.
 */

export type CustomThemeBase = 'dark' | 'light';
export type CustomThemePreset = 'sepia' | 'indigo' | 'midnight' | 'matcha' | 'ocean' | 'sunset' | 'lavender' | 'custom';

export interface CustomTheme {
  preset?: CustomThemePreset;
  base: CustomThemeBase;
  accent: string;
  background: string;
}

export const CUSTOM_THEME_PRESETS: Record<Exclude<CustomThemePreset, 'custom'>, CustomTheme> = {
  sepia: { preset: 'sepia', base: 'light', accent: '#a0522d', background: '#f4ecd8' },
  indigo: { preset: 'indigo', base: 'light', accent: '#2f5d8a', background: '#eef2f7' },
  midnight: { preset: 'midnight', base: 'dark', accent: '#6c8cff', background: '#10141f' },
  matcha: { preset: 'matcha', base: 'dark', accent: '#558b2f', background: '#161b16' },
  ocean: { preset: 'ocean', base: 'dark', accent: '#1a8a9a', background: '#0c1a20' },
  sunset: { preset: 'sunset', base: 'dark', accent: '#d2602a', background: '#1c1411' },
  lavender: { preset: 'lavender', base: 'dark', accent: '#8466e8', background: '#16131f' },
};

export type CustomThemePresetId = keyof typeof CUSTOM_THEME_PRESETS;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isCustomTheme(value: unknown): value is CustomTheme {
  const theme = value as CustomTheme | null;
  return (
    !!theme &&
    (theme.base === 'dark' || theme.base === 'light') &&
    typeof theme.accent === 'string' &&
    HEX.test(theme.accent) &&
    typeof theme.background === 'string' &&
    HEX.test(theme.background)
  );
}

/** Cookie form: `light-d6457a-fdf2f6`. Short, and safe in a cookie without encoding. */
export function encodeCustomTheme(theme: CustomTheme): string {
  return `${theme.base}-${theme.accent.slice(1)}-${theme.background.slice(1)}`.toLowerCase();
}

export function decodeCustomTheme(raw: string | null | undefined): CustomTheme | null {
  const match = raw?.match(/^(dark|light)-([0-9a-f]{6})-([0-9a-f]{6})$/i);
  if (!match) return null;
  return { base: match[1] as CustomThemeBase, accent: `#${match[2]}`, background: `#${match[3]}` };
}

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `amount` of `other` mixed into `hex`. */
function mix(hex: string, other: string, amount: number): string {
  const a = toRgb(hex);
  const b = toRgb(other);
  return toHex(a.map((v, i) => v + ((b[i] ?? v) - v) * amount) as Rgb);
}

function luminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The body text colour of each base (`--ink` in tailwind.css and themePalette.js). */
export const BASE_INK: Record<CustomThemeBase, string> = { dark: '#e8e8e8', light: '#1f1f1f' };

/**
 * What a reader should be told before saving: body text must read on the background (4.5:1, WCAG AA) and white
 * button text on the accent (3:1, AA for large/bold text, which buttons are).
 */
export function customThemeWarnings(theme: CustomTheme): Array<'text' | 'accent'> {
  const warnings: Array<'text' | 'accent'> = [];
  if (contrastRatio(BASE_INK[theme.base], theme.background) < 4.5) warnings.push('text');
  if (contrastRatio('#ffffff', theme.accent) < 3) warnings.push('accent');
  return warnings;
}

/** The semantic tokens a custom theme overrides. */
export function customThemeVariables(theme: CustomTheme): Record<string, string> {
  const { accent, background } = theme;
  if (theme.base === 'dark') {
    return {
      '--background': background,
      '--surface': mix(background, '#ffffff', 0.05),
      '--surface-hover': mix(background, '#ffffff', 0.09),
      '--line': mix(background, '#ffffff', 0.16),
      '--accent': accent,
      '--accent-hover': mix(accent, '#000000', 0.15),
      '--accent-soft': mix(accent, '#ffffff', 0.3),
      '--header-background': accent,
      '--c-brand': channels(mix(accent, '#ffffff', 0.3)),
      '--c-brand-hover': channels(mix(accent, '#ffffff', 0.5)),
      '--c-brand-solid': channels(accent),
    };
  }
  // Light: the header carries the accent, and the greys the templates paint panels and buttons with (see
  // LIGHT_GREY_SURFACES in themePalette.js) take the background's tint, so nothing reads as stray white or cold grey.
  const tint = (amount: number) => mix(mix(background, '#000000', amount), accent, amount * 0.6);
  const surfaces: Record<number, string> = {
    600: tint(0.1),
    700: tint(0.05),
    800: mix(background, '#ffffff', 0.55),
    900: mix(background, '#ffffff', 0.3),
    950: mix(background, '#000000', 0.02),
  };
  const greys: Record<string, string> = {};
  for (const family of ['slate', 'gray', 'zinc', 'neutral', 'stone']) {
    for (const [step, hex] of Object.entries(surfaces)) greys[`--c-${family}-${step}`] = channels(hex);
  }
  const lineStrong = mix(mix(background, '#000000', 0.2), accent, 0.1);
  return {
    '--background': background,
    '--surface': surfaces[800] ?? background,
    '--surface-hover': mix(background, '#000000', 0.04),
    '--line': mix(mix(background, '#000000', 0.1), accent, 0.08),
    '--line-strong': lineStrong,
    '--c-border-default': channels(lineStrong),
    '--accent': accent,
    '--accent-hover': mix(accent, '#000000', 0.15),
    '--accent-soft': mix(accent, '#000000', 0.1),
    '--header-background': accent,
    '--c-brand': channels(accent),
    '--c-brand-hover': channels(mix(accent, '#000000', 0.2)),
    '--c-brand-solid': channels(accent),
    ...greys,
  };
}

/** `#rrggbb` as the `r g b` channels the palette variables hold. */
function channels(hex: string): string {
  return toRgb(hex).join(' ');
}

/** The inline style for <html>. */
export function customThemeStyle(theme: CustomTheme): string {
  return Object.entries(customThemeVariables(theme))
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
}
