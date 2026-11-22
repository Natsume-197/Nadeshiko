import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { PATREON_QUOTA_STALE_MS, PatreonConnection, Tier, User } from '@app/models';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';

setupTestSuite();

const mockIsPatreonConfigured = vi.fn(() => true);
const mockGetPatreonConnection = vi.fn();
const mockRefreshPatreonMemberships = vi.fn();
const mockFetchCampaignMembers = vi.fn();

vi.mock('@app/services/patreon/connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@app/services/patreon/connection')>();
  return {
    ...actual,
    isPatreonConfigured: () => mockIsPatreonConfigured(),
    getPatreonConnection: (...args: unknown[]) => mockGetPatreonConnection(...args),
  };
});

vi.mock('@app/services/patreon/campaign', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@app/services/patreon/campaign')>();
  return {
    ...actual,
    fetchCampaignMembers: (...args: unknown[]) => mockFetchCampaignMembers(...args),
  };
});

vi.mock('@app/workers/patreonMembershipRefreshWorker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@app/workers/patreonMembershipRefreshWorker')>();
  return {
    ...actual,
    refreshPatreonMemberships: () => mockRefreshPatreonMemberships(),
  };
});

let app: Application;
let core: CoreFixtures;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: { kind: ApiKeyKind.SERVICE, permissions: Object.values(ApiPermission) },
    };
  }
  next();
}

async function seedTier(id: string, overrides: Partial<Tier> = {}) {
  return Tier.save(
    Tier.create({
      id,
      displayName: id,
      monthlyQuotaLimit: 5000,
      rateLimitMax: null,
      rateLimitWindowMs: null,
      patreonTierId: null,
      monthlyRequestBoosts: 0,
      sortOrder: 1,
      ...overrides,
    }),
  );
}

async function seedConnection(userId: number, overrides: Partial<PatreonConnection> = {}) {
  return PatreonConnection.save(
    PatreonConnection.create({
      userId,
      patreonUserId: `patreon-${userId}`,
      accessTokenCiphertext: 'enc-a',
      refreshTokenCiphertext: 'enc-r',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      fullName: `Patron ${userId}`,
      patronStatus: 'active_patron',
      entitledAmountCents: 1000,
      entitledTierIds: ['tier-flower'],
      membershipCheckedAt: new Date(),
      ...overrides,
    }),
  );
}

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(async () => {
  app.locals.testUser = core.users.kevin;
  mockIsPatreonConfigured.mockReset().mockReturnValue(true);
  mockGetPatreonConnection.mockReset();
  mockRefreshPatreonMemberships.mockReset();
  mockFetchCampaignMembers.mockReset().mockResolvedValue({
    configured: true,
    status: 'ok',
    errorMessage: null,
    fetchedAt: '2026-11-22T12:00:00.000Z',
    members: [],
  });
  await PatreonConnection.query('DELETE FROM "PatreonConnection"');
  await Tier.query('DELETE FROM "Tier"');
});

describe('GET /v1/admin/patreon', () => {
  it('diagnoses active, stale, unmatched-tier connections and lists tiers and manual grants', async () => {
    await seedTier('free', { displayName: 'Free', monthlyQuotaLimit: 5000, sortOrder: 1 });
    await seedTier('pro', {
      displayName: 'Flower',
      monthlyQuotaLimit: 30000,
      patreonTierId: 'tier-flower',
      monthlyRequestBoosts: 5,
      sortOrder: 20,
    });

    // Active fresh Flower patron
    await seedConnection(core.users.regular.id, {
      patreonUserId: 'p-active',
      fullName: 'Active Patron',
      entitledTierIds: ['tier-flower'],
      membershipCheckedAt: new Date(),
    });

    // Stale patron (>7 days old) -> loses earned tier and flagged stale + issue
    await seedConnection(core.users.david.id, {
      patreonUserId: 'p-stale',
      fullName: 'Stale Patron',
      entitledTierIds: ['tier-flower'],
      membershipCheckedAt: new Date(Date.now() - PATREON_QUOTA_STALE_MS - 60_000),
    });

    // Active patron with an unknown Patreon tier ID -> flagged unmatched + issue
    const unknownTierUser = await User.save(
      User.create({
        username: 'unmatched-patron',
        email: 'unmatched-patron@example.com',
        isActive: true,
        isVerified: true,
      }),
    );
    await seedConnection(unknownTierUser.id, {
      patreonUserId: 'p-unmatched',
      fullName: 'Unknown Tier Patron',
      entitledTierIds: ['tier-mystery-999'],
      membershipCheckedAt: new Date(),
    });

    // Manual quota override (like Kobo)
    const overrideUser = await User.save(
      User.create({
        username: 'kobo-manual',
        email: 'kobo-manual@example.com',
        isActive: true,
        isVerified: true,
        quotaOverride: 20000,
      }),
    );

    mockFetchCampaignMembers.mockResolvedValue({
      configured: true,
      status: 'ok',
      errorMessage: null,
      fetchedAt: '2026-11-22T12:00:00.000Z',
      members: [
        {
          memberId: 'mem-1',
          patreonUserId: 'p-active',
          fullName: 'Active Patron',
          email: 'active@patreon.test',
          patronStatus: 'active_patron',
          entitledAmountCents: 1467,
          monthlyAmountCents: 1000,
          lifetimeSupportCents: 3000,
          pledgeStart: '2026-08-01T00:00:00.000Z',
          lastChargeStatus: 'Paid',
          lastChargeDate: '2026-11-01T00:00:00.000Z',
          entitledTierIds: ['tier-flower'],
          patreonTierTitles: ['Flower'],
        },
        {
          memberId: 'mem-2',
          patreonUserId: 'p-unlinked-99',
          fullName: 'Unlinked Patron',
          email: 'unlinked@patreon.test',
          patronStatus: 'active_patron',
          entitledAmountCents: 1000,
          monthlyAmountCents: 1000,
          lifetimeSupportCents: 1000,
          pledgeStart: '2026-11-01T00:00:00.000Z',
          lastChargeStatus: 'Paid',
          lastChargeDate: '2026-11-01T00:00:00.000Z',
          entitledTierIds: ['tier-flower'],
          patreonTierTitles: ['Flower'],
        },
        {
          memberId: 'mem-3',
          patreonUserId: 'p-former-50',
          fullName: 'Former Patron',
          email: 'former@patreon.test',
          patronStatus: 'former_patron',
          entitledAmountCents: 0,
          monthlyAmountCents: 0,
          lifetimeSupportCents: 4500,
          pledgeStart: '2026-01-01T00:00:00.000Z',
          lastChargeStatus: 'Paid',
          lastChargeDate: '2026-05-01T00:00:00.000Z',
          entitledTierIds: [],
          patreonTierTitles: [],
        },
        {
          memberId: 'mem-4',
          patreonUserId: 'p-free-1',
          fullName: 'Free Follower',
          email: 'free@patreon.test',
          patronStatus: null,
          entitledAmountCents: 0,
          monthlyAmountCents: 0,
          lifetimeSupportCents: 0,
          pledgeStart: null,
          lastChargeStatus: null,
          lastChargeDate: null,
          entitledTierIds: [],
          patreonTierTitles: [],
        },
      ],
    });

    const res = await request(app).get('/v1/admin/patreon');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.summary).toEqual({
      totalLinked: 3,
      active: 2,
      stale: 1,
      issues: 2,
      campaignActive: 2,
      campaignUnlinkedActive: 1,
      campaignMonthlyCents: 2000,
      campaignLifetimeCents: 8500,
      campaignPayingEver: 3,
    });
    expect(res.body.campaign.status).toBe('ok');
    expect(res.body.campaign.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 'mem-1',
          linkedUserId: core.users.regular.id,
          resolvedTierName: 'Flower',
        }),
        expect.objectContaining({
          memberId: 'mem-2',
          linkedUserId: null,
          resolvedTierName: 'Flower',
        }),
      ]),
    );

    const flowerTier = res.body.tiers.find((t: { id: string }) => t.id === 'pro');
    expect(flowerTier).toMatchObject({
      displayName: 'Flower',
      patreonTierId: 'tier-flower',
      monthlyQuotaLimit: 30000,
      monthlyRequestBoosts: 5,
      activePatronCount: 1,
    });

    const activeRow = res.body.connections.find((c: { userId: number }) => c.userId === core.users.regular.id);
    expect(activeRow).toMatchObject({
      resolvedTierId: 'pro',
      resolvedTierName: 'Flower',
      effectiveQuotaLimit: 30000,
      quotaSource: 'patreon',
      isActive: true,
      isStale: false,
      hasIssue: false,
      unmatchedTierIds: [],
    });

    const staleRow = res.body.connections.find((c: { userId: number }) => c.userId === core.users.david.id);
    expect(staleRow).toMatchObject({
      resolvedTierId: null,
      isActive: false,
      isStale: true,
      hasIssue: true,
    });

    const unmatchedRow = res.body.connections.find((c: { userId: number }) => c.userId === unknownTierUser.id);
    expect(unmatchedRow).toMatchObject({
      resolvedTierId: null,
      unmatchedTierIds: ['tier-mystery-999'],
      hasIssue: true,
    });

    expect(res.body.manualGrants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: overrideUser.id,
          quotaOverride: 20000,
          effectiveQuotaLimit: 20000,
          quotaSource: 'override',
        }),
      ]),
    );
  });
});

describe('POST /v1/admin/patreon/connections/:userId/refresh', () => {
  it('forces a live refresh for one connection and returns the updated DTO', async () => {
    await seedTier('pro', {
      displayName: 'Flower',
      monthlyQuotaLimit: 30000,
      patreonTierId: 'tier-flower',
      sortOrder: 20,
    });
    const conn = await seedConnection(core.users.regular.id);
    mockGetPatreonConnection.mockResolvedValue(conn);

    const res = await request(app).post(`/v1/admin/patreon/connections/${core.users.regular.id}/refresh`);
    expect(res.status).toBe(200);
    expect(mockGetPatreonConnection).toHaveBeenCalledWith(core.users.regular.id, true);
    expect(res.body.resolvedTierId).toBe('pro');
  });

  it('returns 404 when the user has no Patreon connection', async () => {
    mockGetPatreonConnection.mockResolvedValue(null);

    const res = await request(app).post(`/v1/admin/patreon/connections/${core.users.regular.id}/refresh`);
    expect(res.status).toBe(404);
  });

  it('returns 400 when Patreon OAuth is not configured', async () => {
    mockIsPatreonConfigured.mockReturnValue(false);

    const res = await request(app).post(`/v1/admin/patreon/connections/${core.users.regular.id}/refresh`);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/admin/patreon/connections/:userId', () => {
  it('unlinks an existing Patreon connection and returns 404 if repeated', async () => {
    await seedConnection(core.users.regular.id);

    const first = await request(app).delete(`/v1/admin/patreon/connections/${core.users.regular.id}`);
    expect(first.status).toBe(204);
    expect(await PatreonConnection.findOneBy({ userId: core.users.regular.id })).toBeNull();

    const second = await request(app).delete(`/v1/admin/patreon/connections/${core.users.regular.id}`);
    expect(second.status).toBe(404);
  });
});

describe('POST /v1/admin/patreon/refresh-all', () => {
  it('runs the global refresh pass and returns checked/failed counts', async () => {
    mockRefreshPatreonMemberships.mockResolvedValue({ checked: 4, failed: 1 });

    const res = await request(app).post('/v1/admin/patreon/refresh-all');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 4, failed: 1 });
  });

  it('returns 400 when Patreon is not configured', async () => {
    mockIsPatreonConfigured.mockReturnValue(false);

    const res = await request(app).post('/v1/admin/patreon/refresh-all');
    expect(res.status).toBe(400);
  });
});
