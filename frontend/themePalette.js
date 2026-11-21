/**
 * Theme-aware Tailwind palette.
 *
 * The templates were written for a dark-only site and use Tailwind's own colours (`text-white`,
 * `bg-neutral-700`, `text-gray-400`…) about six times as often as the semantic tokens in
 * assets/css/tailwind.css. Rewriting each of those by hand would change the dark theme in a
 * thousand small ways. Instead every palette colour reads a CSS variable:
 *
 * - Dark (the default) sets each variable to Tailwind's own value, so the dark site renders exactly
 *   as before.
 * - Light inverts every scale (50 <-> 950, 100 <-> 900 … 500 stays) and swaps white and black, so a
 *   light-on-dark contrast becomes dark-on-light with the same strength.
 *
 * Colours that must not flip (white text on a saturated button, black scrims over video) use the
 * fixed names below: `text-on-accent`, `bg-fixed-black/60`.
 */
import colors from 'tailwindcss/colors';

const FAMILIES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** `#rrggbb` -> `r g b`, the form `rgb(var(--x) / <alpha-value>)` needs. */
function channels(hex) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)).join(' ');
}

const ref = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** Tailwind `theme.extend.colors` entries: every palette colour as a variable. */
export const paletteColors = {
  white: ref('white'),
  black: ref('black'),
  ...Object.fromEntries(
    FAMILIES.map((family) => [family, Object.fromEntries(STEPS.map((step) => [step, ref(`${family}-${step}`)]))]),
  ),
  // Never flip with the theme.
  'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
  'border-default': 'rgb(var(--c-border-default) / <alpha-value>)',
  fixed: {
    white: '#ffffff',
    black: '#000000',
    // Modal scrims: neutral-900, the colour they always had.
    scrim: '#171717',
  },
};

/** The CSS variables for one mode. */
export function paletteVariables(mode) {
  const light = mode === 'light';
  const vars = {
    // Pure black, not neutral-900: the faint `text-white/40` labels need the extra contrast on a light page.
    '--c-white': light ? channels(colors.black) : channels(colors.white),
    '--c-black': light ? channels(colors.white) : channels(colors.black),
    // A bare `border` takes Tailwind's default (gray-200): light on the dark site, but inverted it would be a near
    // black outline, so it gets its own soft grey in light.
    '--c-border-default': light ? channels('#c9c9d0') : channels(colors.gray[200]),
  };
  for (const family of FAMILIES) {
    STEPS.forEach((step, index) => {
      const source = light ? STEPS[STEPS.length - 1 - index] : step;
      vars[`--c-${family}-${step}`] = channels(colors[family][source]);
    });
    if (light && GREYS.includes(family)) {
      for (const [step, hex] of Object.entries(LIGHT_GREY_SURFACES)) vars[`--c-${family}-${step}`] = channels(hex);
    }
  }
  return vars;
}

/**
 * On the dark site, greys from 600 up are what panels, chips and buttons are painted with (`bg-neutral-700`,
 * `bg-gray-800`). Inverted, they came out as mid greys on a grey page, which is what made the light theme look
 * dull. In light they become what a light interface uses instead: white panels and very soft greys. Steps 50-500
 * (text, on the dark site) keep inverting.
 */
const GREYS = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const LIGHT_GREY_SURFACES = {
  600: '#e4e4e7',
  700: '#efeff1',
  800: '#ffffff',
  900: '#fafafa',
  950: '#f3f3f5',
};

/**
 * Borders in the light theme. Grey borders from 600 up were drawn to sit on dark panels; on white ones they would
 * vanish, so they take the line colour. A solid white border (outlined buttons) would invert to a harsh black one,
 * so it takes a stronger line instead. Translucent white borders (`border-white/10`) already invert well.
 */
export function lightBorderRules(selector) {
  const rules = {
    [`${selector} [class~="border-white"]`]: { borderColor: 'var(--line-strong)' },
  };
  for (const family of GREYS) {
    for (const step of [600, 700, 800, 900, 950]) {
      rules[`${selector} [class~="border-${family}-${step}"]`] = { borderColor: 'var(--line)' };
      rules[`${selector} [class~="divide-${family}-${step}"] > :not([hidden]) ~ :not([hidden])`] = {
        borderColor: 'var(--line)',
      };
    }
  }
  return rules;
}

/**
 * The semantic tokens of the light theme. The dark ones are the defaults in assets/css/tailwind.css;
 * these override them. Kept here so `light` and `system` share one list.
 */
export const lightTokens = {
  'color-scheme': 'light',
  '--background': '#f5f5f7',
  '--surface': '#ffffff',
  '--surface-hover': '#f0f0f3',
  '--surface-lift': 'rgb(0 0 0 / 0.04)',
  '--lift-strong': 'rgb(0 0 0 / 0.07)',
  '--ink': '#1f1f1f',
  '--line': '#e3e3e8',
  '--line-strong': '#c9c9d0',
  '--ink-muted': '#55555c',
  '--ink-faint': '#71717a',
  '--accent': '#d63c39',
  '--accent-hover': '#b83230',
  '--accent-soft': '#b4485a',
  '--danger': '#dc2626',
  '--danger-hover': '#b91c1c',
  '--shadow-menu': '0 12px 32px -8px rgb(0 0 0 / 0.14)',
  '--shadow-card': '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.04)',
  '--header-background': 'var(--surface)',
  '--scrollbar-thumb': '#b4b4bb',
};

/**
 * Faint text (`text-white/40`) reads at ~3.6:1 on the dark page but under 3:1 on the light one, because a
 * translucent dark ink loses more against a bright background. In the light theme only, these steps get 15
 * points more opacity. Dark is untouched.
 */
export function lightFaintTextRules(selector) {
  const rules = {};
  for (let step = 15; step <= 60; step += 5) {
    rules[`${selector} [class~="text-white/${step}"]`] = { color: `rgb(var(--c-white) / ${(step + 15) / 100})` };
  }
  return rules;
}

/**
 * A light custom theme paints its header in the accent, like the dark site does. White text has to stay white there,
 * so the header gets the dark greys back. Its menus open on the page, though, so they take the page's own values again
 * (`--page-*` keeps a copy of them, resolved on <html> with the theme's inline colours already applied).
 */
const HEADER_KEYS = () =>
  Object.keys(paletteVariables('dark')).filter(
    (key) =>
      ['--c-white', '--c-black', '--c-border-default'].includes(key) || GREYS.some((g) => key.startsWith(`--c-${g}-`)),
  );

export function accentHeaderRules(root) {
  const keys = HEADER_KEYS();
  const dark = paletteVariables('dark');
  const page = {};
  const header = {};
  const menu = {};
  for (const key of keys) {
    page[`--page${key.slice(1)}`] = `var(${key})`;
    header[key] = dark[key];
    menu[key] = `var(--page${key.slice(1)})`;
  }
  for (const key of ['--line', '--line-strong']) {
    page[`--page${key.slice(1)}`] = `var(${key})`;
    menu[key] = `var(--page${key.slice(1)})`;
  }
  header['--line'] = 'rgb(255 255 255 / 0.25)';
  header['--line-strong'] = 'rgb(255 255 255 / 0.6)';
  header['box-shadow'] = 'none';
  return {
    [root]: page,
    [`${root} .nd-site-header`]: header,
    [`${root} .nd-site-header .nd-menu`]: menu,
  };
}
