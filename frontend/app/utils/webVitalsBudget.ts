import type { CaptureResult } from 'posthog-js';

/**
 * Keep PostHog's `$web_vitals` within the event budget (docs: plans/posthog-event-budget.md).
 *
 * Two changes, both invisible to the Performance dashboard's p75 series:
 *
 * - SAMPLING. Only `WEB_VITALS_SAMPLE_RATE` of page loads send any `$web_vitals`. The decision is
 *   made once per document, so a sampled load keeps all its vitals together. Percentiles are
 *   unchanged in expectation; event and person counts are a quarter of what they would be.
 * - ONE EVENT, NOT TWO. Our TTFB reading (`plugins/rum.client.ts`) used to be its own
 *   `$web_vitals` event. It is now held here and stamped onto the next `$web_vitals` PostHog
 *   autocaptures on the same load. If none comes within `TTFB_STANDALONE_AFTER_MS`, it is sent on
 *   its own as before, so no reading is lost.
 *
 * Bots are left in PostHog's own vitals exactly as before: the dashboard's LCP/FCP/INP series
 * were always read over that population, and changing it here would move them.
 */

/** Share of page loads that report web vitals. */
export const WEB_VITALS_SAMPLE_RATE = 0.25;

/**
 * Longer than posthog-js waits before flushing its buffered vitals (5 s), so the autocaptured
 * event normally arrives first and carries the TTFB reading.
 */
export const TTFB_STANDALONE_AFTER_MS = 8000;

let sampledLoad: boolean | null = null;
let heldTtfb: Record<string, unknown> | null = null;
let standaloneTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether this page load reports web vitals. Decided once per document. */
export function isWebVitalsSampledLoad(random: () => number = Math.random): boolean {
  sampledLoad ??= random() < WEB_VITALS_SAMPLE_RATE;
  return sampledLoad;
}

/**
 * Hold a TTFB reading until PostHog's next `$web_vitals` on this load. If none comes in time,
 * `sendStandalone` sends it as its own event, which is what every reading used to be.
 */
export function holdTtfb(
  properties: Record<string, unknown>,
  sendStandalone: (p: Record<string, unknown>) => void,
): void {
  heldTtfb = properties;
  if (standaloneTimer !== null) clearTimeout(standaloneTimer);
  standaloneTimer = setTimeout(() => {
    standaloneTimer = null;
    const held = heldTtfb;
    if (!held) return;
    heldTtfb = null;
    sendStandalone(held);
  }, TTFB_STANDALONE_AFTER_MS);
}

/**
 * `before_send` step for `$web_vitals`: drop unsampled loads, stamp a held TTFB reading onto the
 * event otherwise.
 */
export function shapeWebVitals(event: CaptureResult): CaptureResult | null {
  if (!isWebVitalsSampledLoad()) return null;
  if (heldTtfb) {
    event.properties = { ...event.properties, ...heldTtfb };
    heldTtfb = null;
    if (standaloneTimer !== null) {
      clearTimeout(standaloneTimer);
      standaloneTimer = null;
    }
  }
  return event;
}

/** Test seam: forget this document's sampling decision and any held reading. */
export function resetWebVitalsBudget(): void {
  sampledLoad = null;
  heldTtfb = null;
  if (standaloneTimer !== null) clearTimeout(standaloneTimer);
  standaloneTimer = null;
}
