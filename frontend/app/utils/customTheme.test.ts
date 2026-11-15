import { describe, expect, test } from 'vitest';
import {
  CUSTOM_THEME_PRESETS,
  contrastRatio,
  customThemeStyle,
  customThemeVariables,
  customThemeWarnings,
  decodeCustomTheme,
  encodeCustomTheme,
  isCustomTheme,
} from './customTheme';

describe('the cookie form', () => {
  test('round-trips a theme', () => {
    const theme = { base: 'light', accent: '#D6457A', background: '#fdf2f6' } as const;
    expect(encodeCustomTheme(theme)).toBe('light-d6457a-fdf2f6');
    expect(decodeCustomTheme('light-d6457a-fdf2f6')).toEqual({
      base: 'light',
      accent: '#d6457a',
      background: '#fdf2f6',
    });
  });

  test('refuses anything that is not exactly that shape', () => {
    for (const raw of [
      null,
      '',
      'dark',
      'pink-d6457a-fdf2f6',
      'dark-d6457a',
      'dark-zzzzzz-000000',
      'dark-d6457a-fdf2f6;x',
    ]) {
      expect(decodeCustomTheme(raw)).toBeNull();
    }
  });
});

describe('validation', () => {
  test('every preset is a valid theme', () => {
    for (const preset of Object.values(CUSTOM_THEME_PRESETS)) expect(isCustomTheme(preset)).toBe(true);
  });

  test('a colour must be a six-digit hex', () => {
    expect(isCustomTheme({ base: 'dark', accent: 'red', background: '#000000' })).toBe(false);
    expect(isCustomTheme({ base: 'grey', accent: '#ffffff', background: '#000000' })).toBe(false);
    expect(isCustomTheme(null)).toBe(false);
  });
});

describe('contrast', () => {
  test('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  test('no preset needs a warning', () => {
    for (const preset of Object.values(CUSTOM_THEME_PRESETS)) expect(customThemeWarnings(preset)).toEqual([]);
  });

  test('warns about light text on a light background and white on a pale accent', () => {
    expect(customThemeWarnings({ base: 'dark', accent: '#fff3a0', background: '#f0f0f0' })).toEqual(['text', 'accent']);
  });
});

describe('derived tokens', () => {
  test('keep the chosen colours and derive the rest from them', () => {
    const vars = customThemeVariables(CUSTOM_THEME_PRESETS.midnight);
    expect(vars['--background']).toBe('#10141f');
    expect(vars['--accent']).toBe('#6c8cff');
    expect(vars['--surface']).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--surface']).not.toBe(vars['--background']);
  });

  test('every custom theme paints its header in the accent', () => {
    expect(customThemeVariables(CUSTOM_THEME_PRESETS.midnight)['--header-background']).toBe('#6c8cff');
    expect(customThemeVariables(CUSTOM_THEME_PRESETS.indigo)['--header-background']).toBe('#2f5d8a');
  });

  test('a light base tints the grey surfaces with its background instead of plain white', () => {
    const vars = customThemeVariables(CUSTOM_THEME_PRESETS.sepia);
    expect(vars['--c-neutral-800']).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    expect(vars['--c-neutral-800']).not.toBe('255 255 255');
    expect(vars['--c-gray-800']).toBe(vars['--c-neutral-800']);
  });

  test('the inline style holds only hex values, so nothing from a cookie reaches the HTML unchecked', () => {
    const style = customThemeStyle(CUSTOM_THEME_PRESETS.sepia);
    expect(style).toMatch(/^(--[a-z0-9-]+: (#[0-9a-f]{6}|\d{1,3} \d{1,3} \d{1,3})(; )?)+$/);
  });
});
