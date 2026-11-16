import { describe, it, expect } from 'vitest';
import {
  PATREON_QUOTA_STALE_MS,
  patreonQuotaTier,
  resolveQuotaLimit,
  unmatchedPatreonTierIds,
} from '@app/models/quota';
import type { PatreonMembership } from '@app/models/quota';
import type { Tier } from '@app/models';

const tier = (monthlyQuotaLimit: number): Tier => ({ id: 'plus', monthlyQuotaLimit }) as Tier;

const account = (overrides: Partial<Parameters<typeof resolveQuotaLimit>[0]> = {}) => ({
  id: 328,
  tierId: 'plus' as string | null,
  quotaOverride: null as number | null,
  monthlyQuotaLimit: 5000,
  ...overrides,
});

describe('resolveQuotaLimit', () => {
  it('prefers an explicit override over everything', () => {
    expect(resolveQuotaLimit(account({ quotaOverride: 50_000, tier: tier(25_000) }))).toEqual({
      limit: 50_000,
      source: 'override',
      tierId: 'plus',
      tier: null,
    });
  });

  it('reads the tier when there is no override', () => {
    const plus = tier(25_000);
    expect(resolveQuotaLimit(account({ tier: plus }))).toEqual({
      limit: 25_000,
      source: 'tier',
      tierId: 'plus',
      tier: plus,
    });
  });

  // The migrated account stores an override of 0; preserve it rather than treating zero as unset.
  it('treats a zero override as a real limit, not as absent', () => {
    expect(resolveQuotaLimit(account({ quotaOverride: 0, tier: tier(25_000) })).limit).toBe(0);
  });

  /** A deleted tier must be quiet in the request path but loud in logs; use the account’s stored number rather than
   * fail or silently promote it. */
  it('falls back to the stored column when the tier row is gone', () => {
    expect(resolveQuotaLimit(account({ tier: null, monthlyQuotaLimit: 10_000 }))).toEqual({
      limit: 10_000,
      source: 'legacy_column',
      tierId: 'plus',
      tier: null,
    });
  });

  it('falls back for an account on no tier at all', () => {
    expect(resolveQuotaLimit(account({ tierId: null, tier: null, monthlyQuotaLimit: 7000 }))).toEqual({
      limit: 7000,
      source: 'legacy_column',
      tierId: null,
      tier: null,
    });
  });

  // Distinguish an unloaded relation from a missing row so logs identify the query bug versus the data bug.
  it('reports an unloaded relation as the stored column, not as a missing tier', () => {
    const resolved = resolveQuotaLimit(account({ monthlyQuotaLimit: 5000 }));
    expect(resolved).toEqual({ limit: 5000, source: 'legacy_column', tierId: 'plus', tier: null });
  });

  it('lands on the built-in default when even the column is unusable', () => {
    expect(resolveQuotaLimit(account({ tier: null, monthlyQuotaLimit: NaN })).source).toBe('default');
  });
});

/** The tier ladder as the 1790800000000 migration seeds it. */
const SEED = '22710324';
const FLOWER = '28118736';
const NADESHIKO = '30077695';
const ladder = {
  free: { id: 'free', displayName: 'Free', monthlyQuotaLimit: 5000, patreonTierId: null },
  plus: { id: 'plus', displayName: 'Seed', monthlyQuotaLimit: 15_000, patreonTierId: SEED },
  pro: { id: 'pro', displayName: 'Flower', monthlyQuotaLimit: 30_000, patreonTierId: FLOWER },
  max: { id: 'max', displayName: 'Nadeshiko', monthlyQuotaLimit: 60_000, patreonTierId: NADESHIKO },
} as unknown as Record<'free' | 'plus' | 'pro' | 'max', Tier>;
const tiers = Object.values(ladder);

const NOW = Date.parse('2026-11-16T12:00:00Z');
const patron = (entitledTierIds: string[], overrides: Partial<PatreonMembership> = {}): PatreonMembership => ({
  patronStatus: 'active_patron',
  entitledTierIds,
  membershipCheckedAt: new Date(NOW - 60_000),
  ...overrides,
});

/** Resolve a free account with the given membership, wired the way `resolveEffectiveQuota` wires it. */
const resolveFor = (
  membership: PatreonMembership | null,
  overrides: Partial<Parameters<typeof resolveQuotaLimit>[0]> = {},
) =>
  resolveQuotaLimit(
    account({ tierId: 'free', tier: ladder.free, patreonTier: patreonQuotaTier(tiers, membership, NOW), ...overrides }),
  );

describe('patreonQuotaTier', () => {
  it('earns nothing without a linked membership', () => {
    expect(patreonQuotaTier(tiers, null, NOW)).toBeNull();
    expect(resolveFor(null)).toMatchObject({ limit: 5000, source: 'tier', tier: ladder.free });
  });

  it.each([
    [SEED, 'plus', 15_000],
    [FLOWER, 'pro', 30_000],
    [NADESHIKO, 'max', 60_000],
  ] as const)('Patreon tier %s earns %s', (patreonTierId, id, limit) => {
    expect(patreonQuotaTier(tiers, patron([patreonTierId]), NOW)?.id).toBe(id);
    expect(resolveFor(patron([patreonTierId]))).toEqual({ limit, source: 'patreon', tierId: 'free', tier: ladder[id] });
  });

  it('takes the highest limit when the member is entitled to several tiers, in any order', () => {
    expect(patreonQuotaTier(tiers, patron([NADESHIKO, SEED]), NOW)?.id).toBe('max');
    expect(patreonQuotaTier(tiers, patron([SEED, FLOWER]), NOW)?.id).toBe('pro');
  });

  // No guessing from the amount: a tier we do not know about earns nothing, which the refresh then logs.
  it('earns nothing for an unknown tier id, or for no entitled tier at all', () => {
    expect(patreonQuotaTier(tiers, patron(['99999999']), NOW)).toBeNull();
    expect(patreonQuotaTier(tiers, patron([]), NOW)).toBeNull();
    expect(patreonQuotaTier(tiers, patron(['99999999', SEED]), NOW)?.id).toBe('plus');
    expect(unmatchedPatreonTierIds(tiers, ['99999999', SEED])).toEqual(['99999999']);
  });

  it('earns nothing once the membership has lapsed, whatever tiers were stored', () => {
    for (const patronStatus of ['former_patron', 'declined_patron', null]) {
      expect(patreonQuotaTier(tiers, patron([NADESHIKO], { patronStatus }), NOW)).toBeNull();
    }
    expect(resolveFor(patron([NADESHIKO], { patronStatus: 'former_patron' }))).toMatchObject({
      limit: 5000,
      source: 'tier',
    });
  });

  // A revoked grant makes every refresh fail, so the stored answer would otherwise count forever.
  it('stops counting a membership whose last successful check is too old', () => {
    const justInside = new Date(NOW - PATREON_QUOTA_STALE_MS);
    const justOutside = new Date(NOW - PATREON_QUOTA_STALE_MS - 1);
    expect(patreonQuotaTier(tiers, patron([FLOWER], { membershipCheckedAt: justInside }), NOW)?.id).toBe('pro');
    expect(patreonQuotaTier(tiers, patron([FLOWER], { membershipCheckedAt: justOutside }), NOW)).toBeNull();
    expect(resolveFor(patron([FLOWER], { membershipCheckedAt: justOutside }))).toMatchObject({
      limit: 5000,
      source: 'tier',
    });
  });

  it('never grants a tier that has no Patreon tier id', () => {
    const handMade = { id: 'partner', monthlyQuotaLimit: 1_000_000, patreonTierId: null } as unknown as Tier;
    expect(patreonQuotaTier([...tiers, handMade], patron([NADESHIKO]), NOW)?.id).toBe('max');
  });
});

describe('resolveQuotaLimit with a Patreon tier', () => {
  it('lets a manual override win over a Patreon tier', () => {
    expect(resolveFor(patron([NADESHIKO]), { quotaOverride: 8000 })).toEqual({
      limit: 8000,
      source: 'override',
      tierId: 'free',
      tier: null,
    });
  });

  it('keeps an assigned tier that is higher than the one Patreon earns', () => {
    expect(resolveFor(patron([SEED]), { tierId: 'max', tier: ladder.max })).toEqual({
      limit: 60_000,
      source: 'tier',
      tierId: 'max',
      tier: ladder.max,
    });
  });

  // Equal limits are explained by the assignment, which does not lapse.
  it('names the assigned tier, not Patreon, when the two are equal', () => {
    expect(resolveFor(patron([FLOWER]), { tierId: 'pro', tier: ladder.pro })).toMatchObject({ source: 'tier' });
  });

  it('uses the Patreon tier ahead of the fallbacks when the assigned tier is missing', () => {
    expect(resolveFor(patron([SEED]), { tierId: 'gone', tier: null, monthlyQuotaLimit: 5000 })).toMatchObject({
      limit: 15_000,
      source: 'patreon',
      tierId: 'gone',
    });
  });
});
