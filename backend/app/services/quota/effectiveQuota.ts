import { PatreonConnection, Tier, patreonQuotaTier, resolveQuotaLimit } from '@app/models';
import type { PatreonMembership, ResolvedQuota, User } from '@app/models';
import { Cache, createCacheNamespace } from '@lib/cache';

/**
 * The one place an account's quota is worked out, so the API-key middleware, the account page and the admin surface
 * cannot disagree about the limit or the tier that explains it.
 *
 * The middleware runs on every API request and reads through per-process caches; the account and admin pages read
 * the database directly, since a person looking at the number expects the current one.
 */

/** Cache tiers per process with a TTL: invalidation reaches one worker, so expiry is the cross-worker freshness
 * bound. */
const TIER_CACHE_TTL_MS = 5 * 60 * 1000;

let tierCache: Map<string, Tier> | null = null;
let tierCacheExpiresAt = 0;

export function invalidateTierCache(): void {
  tierCache = null;
}

async function fetchTiers(): Promise<Map<string, Tier>> {
  return new Map((await Tier.find()).map((row) => [row.id, row]));
}

async function loadTiers(cached: boolean): Promise<Map<string, Tier>> {
  if (!cached) return fetchTiers();
  if (!tierCache || Date.now() >= tierCacheExpiresAt) {
    tierCache = await fetchTiers();
    tierCacheExpiresAt = Date.now() + TIER_CACHE_TTL_MS;
  }
  return tierCache;
}

/**
 * The membership is cached on the same terms as the tiers. Most accounts have no link, so "no link" is cached too
 * (wrapped, because the cache answers null on a miss); otherwise every request from them would query for a row that
 * is not there. Linking, unlinking and every refresh invalidate the entry in the process that did them; the TTL
 * bounds the rest, which is minutes against a membership that changes monthly.
 */
const MEMBERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;
const MEMBERSHIP_CACHE = createCacheNamespace('quotaPatreonMembership', 10_000);

interface MembershipEntry {
  membership: PatreonMembership | null;
}

export function invalidatePatreonQuotaCache(userId: number): void {
  Cache.delete(MEMBERSHIP_CACHE, String(userId));
}

async function readMembership(userId: number): Promise<PatreonMembership | null> {
  const row = await PatreonConnection.findOne({
    where: { userId },
    select: { id: true, patronStatus: true, entitledTierIds: true, membershipCheckedAt: true },
  });
  return row
    ? {
        patronStatus: row.patronStatus ?? null,
        entitledTierIds: row.entitledTierIds ?? [],
        membershipCheckedAt: row.membershipCheckedAt,
      }
    : null;
}

async function loadMembership(userId: number, cached: boolean): Promise<PatreonMembership | null> {
  if (!cached) return readMembership(userId);
  const hit = Cache.get<MembershipEntry>(MEMBERSHIP_CACHE, String(userId));
  if (hit) return hit.membership;
  const membership = await readMembership(userId);
  Cache.set<MembershipEntry>(MEMBERSHIP_CACHE, String(userId), { membership }, MEMBERSHIP_CACHE_TTL_MS);
  return membership;
}

export interface EffectiveQuota extends ResolvedQuota {
  /** The assigned tier's row, which still decides the burst stamped onto new keys. */
  assignedTier: Tier | null;
}

export async function resolveEffectiveQuota(
  user: Pick<User, 'id' | 'quotaOverride' | 'monthlyQuotaLimit' | 'tierId'>,
  { cached = false }: { cached?: boolean } = {},
): Promise<EffectiveQuota> {
  const [tiers, membership] = await Promise.all([loadTiers(cached), loadMembership(user.id, cached)]);
  // `null` (loaded, no row) rather than `undefined` for a dangling tier id, so the resolver warns about it.
  const assignedTier = user.tierId ? (tiers.get(user.tierId) ?? null) : null;
  const resolved = resolveQuotaLimit({
    ...user,
    tier: assignedTier,
    patreonTier: patreonQuotaTier(tiers.values(), membership),
  });
  return { ...resolved, assignedTier };
}
