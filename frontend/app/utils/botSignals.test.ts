import { describe, test, expect, beforeEach } from 'vitest';
import { BOT_SIGNAL_EVENTS, collectBotSignals, primeBotSignals, resetBotSignals } from './botSignals';

/** A minimal window: only what the signals read. */
function fakeWindow(overrides: Record<string, unknown> = {}, navigatorOverrides: Record<string, unknown> = {}) {
  return {
    navigator: {
      webdriver: false,
      maxTouchPoints: 0,
      plugins: { length: 5 },
      languages: ['en-US', 'en'],
      hardwareConcurrency: 8,
      deviceMemory: 8,
      userAgentData: { brands: [{ brand: 'Google Chrome' }, { brand: 'Chromium' }] },
      ...navigatorOverrides,
    },
    matchMedia: (query: string) => ({ matches: query === '(hover: hover)' }),
    innerWidth: 1440,
    innerHeight: 900,
    outerWidth: 1440,
    outerHeight: 990,
    devicePixelRatio: 2,
    chrome: {},
    ...overrides,
  } as unknown as Window;
}

beforeEach(() => {
  resetBotSignals();
});

describe('a desktop reader', () => {
  test('reports ordinary values', () => {
    expect(collectBotSignals(fakeWindow())).toEqual({
      bot_signal_webdriver: false,
      bot_signal_touch_points: 0,
      bot_signal_pointer_coarse: false,
      bot_signal_hover: true,
      bot_signal_outer_smaller: false,
      bot_signal_outer_zero: false,
      bot_signal_plugins: 5,
      bot_signal_languages: 2,
      bot_signal_headless_brand: false,
      bot_signal_chrome_object: true,
      bot_signal_cpu: 8,
      bot_signal_memory: 8,
      bot_signal_dpr: 2,
      bot_signal_gpu: 'pending',
    });
  });
});

describe('the signals automation tends to leave', () => {
  test('a driven browser', () => {
    expect(collectBotSignals(fakeWindow({}, { webdriver: true })).bot_signal_webdriver).toBe(true);
  });

  test('a page wider than its window, or a window with no frame', () => {
    const signals = collectBotSignals(fakeWindow({ innerWidth: 375, innerHeight: 812, outerWidth: 0, outerHeight: 0 }));
    expect(signals.bot_signal_outer_smaller).toBe(true);
    expect(signals.bot_signal_outer_zero).toBe(true);
  });

  test('a headless brand', () => {
    const signals = collectBotSignals(fakeWindow({}, { userAgentData: { brands: [{ brand: 'HeadlessChrome' }] } }));
    expect(signals.bot_signal_headless_brand).toBe(true);
  });

  test('no plugins', () => {
    expect(collectBotSignals(fakeWindow({}, { plugins: { length: 0 } })).bot_signal_plugins).toBe(0);
  });
});

describe('robustness', () => {
  test('missing APIs read as null rather than throwing', () => {
    const signals = collectBotSignals(
      fakeWindow(
        { matchMedia: undefined, devicePixelRatio: undefined },
        { maxTouchPoints: undefined, plugins: undefined, languages: undefined, deviceMemory: undefined },
      ),
    );
    expect(signals.bot_signal_pointer_coarse).toBeNull();
    expect(signals.bot_signal_touch_points).toBeNull();
    expect(signals.bot_signal_plugins).toBeNull();
    expect(signals.bot_signal_memory).toBeNull();
  });

  test('no window (SSR) yields nothing', () => {
    expect(collectBotSignals(undefined)).toEqual({});
  });

  test('the GPU is read when idle, and as a class, never the renderer string', () => {
    const idle: { run?: () => void } = {};
    const gl = {
      RENDERER: 1,
      getExtension: (name: string) => (name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 2 } : null),
      getParameter: () => 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    };
    const scope = fakeWindow({
      requestIdleCallback: (fn: () => void) => {
        idle.run = fn;
      },
      document: { createElement: () => ({ getContext: () => gl }) },
    });

    primeBotSignals(scope);
    expect(collectBotSignals(scope).bot_signal_gpu).toBe('pending');
    idle.run?.();

    expect(collectBotSignals(scope).bot_signal_gpu).toBe('software');
    expect(JSON.stringify(collectBotSignals(scope))).not.toContain('SwiftShader');
  });
});

test('ride the page load and the dwell events, nothing else', () => {
  expect([...BOT_SIGNAL_EVENTS].sort()).toEqual(['$pageview', 'page_engaged', 'shared_link_read']);
});
