/**
 * The Patreon tiers as the site describes them: the Support page, and the hint on Developer settings.
 *
 * The one place the frontend keeps these numbers. The API limits are enforced from the backend `Tier` table (seeded
 * by the 1790800000000 migration, which matches each one to its Patreon tier id), and no public endpoint returns that
 * table, so a change to a tier's limit is made there and here together. The price is shown only; nothing matches on it.
 */
export interface SupportTier {
  /** Matches the backend `Tier.id` the Patreon tier earns. */
  quotaTierId: 'plus' | 'pro' | 'max';
  /** Translation key under `support.tiers`. */
  key: 'seed' | 'flower' | 'nadeshiko';
  /** Shown untranslated next to the name, as on the Patreon page. */
  kanji: string;
  priceUsd: number;
  monthlyApiRequests: number;
  /** Content-request boosts a month; the backend `Tier.monthlyRequestBoosts` (task 49 migration) holds the same. */
  requestBoostsPerMonth: number;
  talkToDevs: boolean;
  priorityRequests: boolean;
  customThemes: boolean;
}

/** The limit every account has without a membership; the backend `free` tier. */
export const FREE_MONTHLY_API_REQUESTS = 5000;

export const SUPPORT_TIERS: readonly SupportTier[] = [
  {
    quotaTierId: 'plus',
    key: 'seed',
    kanji: '種',
    priceUsd: 5,
    monthlyApiRequests: 15_000,
    requestBoostsPerMonth: 3,
    talkToDevs: false,
    priorityRequests: false,
    customThemes: true,
  },
  {
    quotaTierId: 'pro',
    key: 'flower',
    kanji: '花',
    priceUsd: 10,
    monthlyApiRequests: 30_000,
    requestBoostsPerMonth: 5,
    talkToDevs: true,
    priorityRequests: false,
    customThemes: true,
  },
  {
    quotaTierId: 'max',
    key: 'nadeshiko',
    kanji: '撫子',
    priceUsd: 20,
    monthlyApiRequests: 60_000,
    requestBoostsPerMonth: 10,
    talkToDevs: true,
    priorityRequests: true,
    customThemes: true,
  },
];

export const HIGHEST_MONTHLY_API_REQUESTS = Math.max(...SUPPORT_TIERS.map((tier) => tier.monthlyApiRequests));
