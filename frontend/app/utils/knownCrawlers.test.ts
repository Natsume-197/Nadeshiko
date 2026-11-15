import { describe, test, expect } from 'vitest';
import { isKnownCrawlerShape } from './knownCrawlers';

const shape = (screenWidth: number, screenHeight: number, innerWidth: number, innerHeight: number) => ({
  screen: { width: screenWidth, height: screenHeight },
  innerWidth,
  innerHeight,
});

describe('the permalink crawler (2560×1600 screen, 375×812 window)', () => {
  test('is recognised', () => {
    expect(isKnownCrawlerShape(shape(2560, 1600, 375, 812))).toBe(true);
  });

  test.each([
    ['a reader with a 2560×1600 screen and a normal window', shape(2560, 1600, 1440, 900)],
    ['a phone with a 375×812 viewport', shape(375, 812, 375, 812)],
    ['devtools phone emulation on another screen', shape(1920, 1080, 375, 812)],
    ['a window one pixel off', shape(2560, 1600, 375, 811)],
  ])('but %s is not', (_name, source) => {
    expect(isKnownCrawlerShape(source)).toBe(false);
  });

  test('and nothing is suppressed where there is no window (SSR, tests)', () => {
    expect(isKnownCrawlerShape(undefined)).toBe(false);
  });
});
