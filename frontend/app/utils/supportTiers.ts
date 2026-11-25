import { PATREON_URL } from '#shared/utils/socialLinks';

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
  /** Matches the live Patreon tier ID (used for direct checkout links). */
  patreonTierId: string;
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

/**
 * What every paid tier adds on top of a free account, beyond the per-tier numbers above. Mirrors of backend limits:
 * custom dictionaries (`services/dictionary/custom/quotas.ts`) and open content requests
 * (`services/requests/allowance.ts`). Change them there and here together.
 */
export const PATRON_LIMITS = {
  customDictionaries: { free: 2, patron: 6 },
  openRequests: { free: 10, patron: 30 },
} as const;

/** The limit every account has without a membership; the backend `free` tier. */
export const FREE_MONTHLY_API_REQUESTS = 5000;

export const SUPPORT_TIERS: readonly SupportTier[] = [
  {
    quotaTierId: 'plus',
    patreonTierId: '22710324',
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
    patreonTierId: '28118736',
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
    patreonTierId: '30077695',
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

/** The campaign slug, taken from the public Patreon link so the two cannot drift. */
const PATREON_SLUG = new URL(PATREON_URL).pathname.replace(/^\/+|\/+$/g, '');

/** Official Patreon checkout URL for a specific tier (matches Patreon API v2 `tier.attributes.url`). */
export function tierCheckoutUrl(tier: SupportTier): string {
  return `https://www.patreon.com/checkout/${PATREON_SLUG}?rid=${tier.patreonTierId}`;
}

export const HIGHEST_MONTHLY_API_REQUESTS = Math.max(...SUPPORT_TIERS.map((tier) => tier.monthlyApiRequests));
