import { logger } from '@config/log';
import { AccountQuotaUsage } from './AccountQuotaUsage';
import type { PatreonConnection } from './PatreonConnection';
import type { Tier } from './Tier';
import type { User } from './User';

/** What decided the number, for the log line and the admin surface. */
export type QuotaSource = 'override' | 'tier' | 'patreon' | 'legacy_column' | 'default';

export interface ResolvedQuota {
  limit: number;
  source: QuotaSource;
  /** The tier the account is assigned, whatever decided the limit. */
  tierId: string | null;
  /** The tier that decided the limit: the assigned one for `tier`, the earned one for `patreon`, otherwise null. */
  tier: Tier | null;
}

/**
 * A membership whose last successful check is older than this does not count for quota. Refreshes stop succeeding
 * when a reader revokes the OAuth grant, and without a bound the last answer Patreon gave would stand forever. A week
 * leaves the daily refresh several failed runs of room before a paying patron loses anything to a Patreon outage.
 */
export const PATREON_QUOTA_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export type PatreonMembership = Pick<PatreonConnection, 'patronStatus' | 'entitledTierIds' | 'membershipCheckedAt'>;

/**
 * The tier a Patreon membership earns: of the quota tiers whose Patreon tier id the member is entitled to, the one
 * with the highest monthly limit, or null.
 *
 * By tier id only. The entitled amount is in the patron's own currency, so it cannot be compared with a US price; a
 * member whose tiers match no row earns nothing rather than a guess. Requires an active membership checked within the
 * staleness bound above, which custom themes and custom-dictionary limits share (`canUseCustomTheme`).
 */
export function patreonQuotaTier(
  tiers: Iterable<Tier>,
  membership: PatreonMembership | null | undefined,
  now: number = Date.now(),
): Tier | null {
  if (membership?.patronStatus !== 'active_patron') return null;
  if (now - membership.membershipCheckedAt.getTime() > PATREON_QUOTA_STALE_MS) return null;

  const entitled = new Set(membership.entitledTierIds ?? []);
  let earned: Tier | null = null;
  for (const tier of tiers) {
    if (tier.patreonTierId == null || !entitled.has(tier.patreonTierId)) continue;
    if (!earned || tier.monthlyQuotaLimit > earned.monthlyQuotaLimit) earned = tier;
  }
  return earned;
}

/** Entitled Patreon tier ids that no quota tier claims: how a tier renamed or re-created on Patreon gets noticed. */
export function unmatchedPatreonTierIds(tiers: Iterable<Tier>, entitledTierIds: readonly string[]): string[] {
  const known = new Set<string>();
  for (const tier of tiers) if (tier.patreonTierId != null) known.add(tier.patreonTierId);
  return entitledTierIds.filter((id) => !known.has(id));
}

function usableTier(tier: Tier | null | undefined): Tier | null {
  return tier && Number.isFinite(tier.monthlyQuotaLimit) ? tier : null;
}

/**
 * Resolve quota in order: override; then the higher of the assigned tier and the tier Patreon earns; then the legacy
 * column and the default. Pass both tiers explicitly so the hot caller can use its caches.
 */
export function resolveQuotaLimit(
  user: Pick<User, 'id' | 'quotaOverride' | 'monthlyQuotaLimit' | 'tierId'> & {
    tier?: Tier | null;
    patreonTier?: Tier | null;
  },
): ResolvedQuota {
  const tierId = user.tierId ?? null;

  if (user.quotaOverride != null && Number.isFinite(user.quotaOverride)) {
    return { limit: user.quotaOverride, source: 'override', tierId, tier: null };
  }

  const assigned = usableTier(user.tier);
  const earned = usableTier(user.patreonTier);

  // Patreon names the source only when it strictly beats the assignment, so an admin's tier stays the explanation
  // whenever it alone would have produced the same number.
  if (earned && (!assigned || earned.monthlyQuotaLimit > assigned.monthlyQuotaLimit)) {
    return { limit: earned.monthlyQuotaLimit, source: 'patreon', tierId, tier: earned };
  }
  if (assigned) {
    return { limit: assigned.monthlyQuotaLimit, source: 'tier', tierId, tier: assigned };
  }

  // A missing joined tier falls back and is logged: the account must keep working even when the row was deleted or the
  // caller omitted the relation.
  if (tierId !== null && user.tier === undefined) {
    logger.debug(
      { userId: user.id, tierId },
      'Quota resolved without a loaded tier; falling back to the stored column',
    );
  } else if (tierId !== null) {
    logger.warn({ userId: user.id, tierId }, 'Quota tier is missing from the Tier table; falling back');
  }

  if (Number.isFinite(user.monthlyQuotaLimit)) {
    return { limit: user.monthlyQuotaLimit, source: 'legacy_column', tierId, tier: null };
  }

  logger.warn({ userId: user.id, tierId }, 'Quota fell through to the built-in default');
  return { limit: AccountQuotaUsage.DEFAULT_QUOTA_LIMIT, source: 'default', tierId, tier: null };
}
