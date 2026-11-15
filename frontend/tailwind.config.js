/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin';
import {
  accentHeaderRules,
  lightBorderRules,
  lightFaintTextRules,
  lightTokens,
  paletteColors,
  paletteVariables,
} from './themePalette.js';

export default {
  darkMode: ['class'],
  safelist: ['dark'],
  prefix: '',
  content: ['./app/**/*.{js,ts,vue}', './content/**/*.md'],
  theme: {
    container: {
      center: true,
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      // What a bare `border` draws with; see `--c-border-default` in themePalette.js.
      borderColor: {
        DEFAULT: 'rgb(var(--c-border-default) / <alpha-value>)',
      },
      screens: {
        '3xl': '1920px',
      },
      colors: {
        // Tailwind's palette, re-pointed at variables that follow the theme. See themePalette.js.
        ...paletteColors,
        background: 'var(--background)',
        surface: {
          DEFAULT: 'var(--surface)',
          soft: 'var(--surface-soft)',
          lift: 'var(--surface-lift)',
          hover: 'var(--surface-hover)',
        },
        // The brand colour for text, links and on/off states: Nadeshiko red, or a custom theme's accent. Errors and
        // destructive actions stay on `red`.
        brand: {
          DEFAULT: 'rgb(var(--c-brand) / <alpha-value>)',
          hover: 'rgb(var(--c-brand-hover) / <alpha-value>)',
          solid: 'rgb(var(--c-brand-solid) / <alpha-value>)',
        },
        hairline: 'var(--line)',
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
        },
        control: {
          DEFAULT: 'var(--control)',
          hover: 'var(--control-hover)',
        },
        header: {
          background: 'var(--header-background)',
        },
        footer: {
          background: 'var(--footer-background)',
        },
        button: {
          primary: {
            main: 'var(--button-color-primary)',
            hover: 'var(--button-color-hover-primary)',
          },
          accent: {
            main: 'var(--button-color-accent)',
            hover: 'var(--button-color-accent-hover)',
          },
        },
        input: {
          background: 'var(--input-background)',
          'focus-ring': 'var(--input-focus-ring)',
        },
        card: {
          background: 'var(--card-background)',
        },
        modal: {
          background: 'var(--modal-background)',
          input: 'var(--modal-input)',
          border: 'var(--modal-border)',
        },
        // Legacy class names still used in a few older templates.
        sgray: 'var(--control)',
        sgray2: 'var(--control-hover)',
        sgrayhover: 'var(--control-hover)',
        sred: 'var(--accent)',
      },
    },
  },
  plugins: [
    // The palette variables per theme. `system` follows the OS, which only CSS can read during SSR.
    plugin(({ addBase, addUtilities }) => {
      const light = { ...paletteVariables('light'), ...lightTokens };
      addBase({
        ':root': {
          ...paletteVariables('dark'),
          '--c-brand': 'var(--c-red-400)',
          '--c-brand-hover': 'var(--c-red-300)',
          '--c-brand-solid': 'var(--c-red-500)',
        },
        ':root[data-theme="light"]': light,
        '@media (prefers-color-scheme: light)': { ':root[data-theme="system"]': light },
        ...accentHeaderRules(':root[data-header="accent"]'),
      });
      // Utilities layer and `:where()` keep these at a utility's specificity, so `hover:` variants still win.
      addUtilities({
        ...lightFaintTextRules(':where(:root[data-theme="light"])'),
        ...lightBorderRules(':where(:root[data-theme="light"])'),
        '@media (prefers-color-scheme: light)': {
          ...lightFaintTextRules(':where(:root[data-theme="system"])'),
          ...lightBorderRules(':where(:root[data-theme="system"])'),
        },
      });
    }),
  ],
};
