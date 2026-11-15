import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import {
  TTFB_STANDALONE_AFTER_MS,
  WEB_VITALS_SAMPLE_RATE,
  holdTtfb,
  isWebVitalsSampledLoad,
  resetWebVitalsBudget,
  shapeWebVitals,
} from './webVitalsBudget';

/** An autocaptured `$web_vitals` as posthog-js hands it to `before_send`. */
const autocaptured = (): CaptureResult =>
  ({ event: '$web_vitals', properties: { $web_vitals_LCP_value: 1500 } }) as unknown as CaptureResult;

const TTFB = { $web_vitals_TTFB_value: 812.4, page_path: '/search/[query]' };

beforeEach(() => {
  vi.useFakeTimers();
  resetWebVitalsBudget();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sampling', () => {
  test('keeps a quarter of page loads', () => {
    expect(WEB_VITALS_SAMPLE_RATE).toBe(0.25);
    expect(isWebVitalsSampledLoad(() => 0.24)).toBe(true);
    resetWebVitalsBudget();
    expect(isWebVitalsSampledLoad(() => 0.25)).toBe(false);
  });

  test('decides once per load, so a load keeps all its vitals together', () => {
    isWebVitalsSampledLoad(() => 0);
    expect(isWebVitalsSampledLoad(() => 0.99)).toBe(true);
  });

  test('drops every `$web_vitals` of an unsampled load', () => {
    isWebVitalsSampledLoad(() => 0.99);
    expect(shapeWebVitals(autocaptured())).toBeNull();
  });

  test('passes those of a sampled load untouched when no reading is held', () => {
    isWebVitalsSampledLoad(() => 0);
    expect(shapeWebVitals(autocaptured())?.properties).toEqual({ $web_vitals_LCP_value: 1500 });
  });
});

describe('the TTFB reading', () => {
  beforeEach(() => {
    isWebVitalsSampledLoad(() => 0);
  });

  test('rides the next autocaptured event instead of an event of its own', () => {
    const standalone = vi.fn();
    holdTtfb(TTFB, standalone);

    const event = shapeWebVitals(autocaptured());
    vi.advanceTimersByTime(TTFB_STANDALONE_AFTER_MS);

    expect(event?.properties).toEqual({ $web_vitals_LCP_value: 1500, ...TTFB });
    expect(standalone).not.toHaveBeenCalled();
  });

  test('rides only one event', () => {
    holdTtfb(TTFB, vi.fn());
    shapeWebVitals(autocaptured());

    expect(shapeWebVitals(autocaptured())?.properties).not.toHaveProperty('$web_vitals_TTFB_value');
  });

  test('is sent on its own when no autocaptured event comes in time, so it is never lost', () => {
    const standalone = vi.fn();
    holdTtfb(TTFB, standalone);

    vi.advanceTimersByTime(TTFB_STANDALONE_AFTER_MS);

    expect(standalone).toHaveBeenCalledWith(TTFB);
    // ...and is not stamped again on a later event.
    expect(shapeWebVitals(autocaptured())?.properties).not.toHaveProperty('$web_vitals_TTFB_value');
  });

  test('waits longer than posthog-js buffers its own vitals (5 s)', () => {
    expect(TTFB_STANDALONE_AFTER_MS).toBeGreaterThan(5000);
  });
});
