/**
 * Browsers whose exact screen-and-window shape belongs to a known crawler, so analytics never starts
 * for them. The page still works for them; only PostHog stays off (like the `nb=1` email-scanner case).
 *
 * WHY. Since 2026-09-17 one distributed crawler has loaded sentence permalinks and searches about
 * 2,000 times a day: each load a new identity on a new residential-looking IP (about 45k IPs in 173
 * countries over three weeks), never a second visit, never a play, export, login or any interaction,
 * no day/night rhythm, enumerating search term × title × episode. It reported a 2560×1600 screen with
 * a 375×812 window -- a phone viewport inside desktop Chrome -- on every load. Over 2026-10-23 → 11-14
 * that shape was 263k of 938k PostHog events (28%): 99% of `locale_nudge_shown`, 79% of
 * `shared_link_viewed`, 55% of `$pageview`, 24% of `sentence_searched`. No real reader in that window
 * had it; 16 had the window size alone and 4 the screen size alone, which this match leaves alone.
 * Same behaviour as the permalink crawler documented in nadeshiko-infra's cloudflare-security.tf;
 * the shape is new. Plan and numbers: the operations docs, plans/posthog-event-budget.md.
 *
 * Exact matches only. A crawler that changes its shape is back in the numbers, and the daily
 * PostHog digest's event-budget line is what shows it.
 *
 * OFF FOR ONE WEEK FIRST. `utils/botSignals.ts` records sturdier browser signals for a week, which
 * needs the crawler's events still arriving. After that, turn this on, adding whichever signals
 * separated the crawler from readers with none caught.
 */
export const KNOWN_CRAWLER_FILTER_ACTIVE = false;

interface ShapeSource {
  screen: { width: number; height: number };
  innerWidth: number;
  innerHeight: number;
}

const CRAWLER_SHAPES = [{ screenWidth: 2560, screenHeight: 1600, innerWidth: 375, innerHeight: 812 }] as const;

export function isKnownCrawlerShape(source: ShapeSource | undefined = globalThis.window): boolean {
  if (!source?.screen) return false;
  return CRAWLER_SHAPES.some(
    (shape) =>
      source.screen.width === shape.screenWidth &&
      source.screen.height === shape.screenHeight &&
      source.innerWidth === shape.innerWidth &&
      source.innerHeight === shape.innerHeight,
  );
}
