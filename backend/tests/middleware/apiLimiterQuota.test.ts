import { describe, it, expect, beforeAll, vi } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import { invalidatePatreonQuotaCache, invalidateTierCache } from '@app/services/quota/effectiveQuota';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { QuotaExceededError } from '@app/errors';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { PatreonConnection, PATREON_QUOTA_STALE_MS, Tier } from '@app/models';

setupTestSuite();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

function buildReq(overrides: Record<string, unknown> = {}) {
  return {
    user: fixtures.users.kevin,
    auth: {
      type: AuthType.API_KEY,
      apiKey: { kind: ApiKeyKind.USER, permissions: [ApiPermission.READ_MEDIA] },
    },
    ...overrides,
  } as any;
}

function buildRes() {
  const listeners: Record<string, (...args: never) => unknown> = {};
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    on: vi.fn((event: string, cb: (...args: never) => unknown) => {
      listeners[event] = cb;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    _listeners: listeners,
    _headers: headers,
  } as any;
}

describe('rateLimitApiQuota', () => {
  it('skips quota check for session auth', async () => {
    const req = buildReq({ auth: { type: AuthType.SESSION } });
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.accountQuota).toBeUndefined();
  });

  it('skips quota check for service API keys', async () => {
    const req = buildReq({
      auth: {
        type: AuthType.API_KEY,
        apiKey: { kind: ApiKeyKind.SERVICE, permissions: [ApiPermission.READ_MEDIA] },
      },
    });
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.accountQuota).toBeUndefined();
  });

  it('passes and attaches quota snapshot when under limit', async () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(typeof req.accountQuota.quotaLimit).toBe('number');
    expect(typeof req.accountQuota.quotaUsed).toBe('number');
    expect(req.accountQuota.quotaUsed).toBeLessThan(req.accountQuota.quotaLimit);
  });

  it('throws QuotaExceededError when quota is exhausted', async () => {
    // Set an override of 0 so any usage exceeds it; `monthlyQuotaLimit` is only the fallback when no tier applies.
    fixtures.users.kevin.quotaOverride = 0;

    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await expect(rateLimitApiQuota(req, res, next)).rejects.toThrow(QuotaExceededError);
    expect(next).not.toHaveBeenCalled();

    fixtures.users.kevin.quotaOverride = null;
  });

  it('names the monthly quota as the reason on the error it throws', async () => {
    // Carry the reason on the error: both the request and API-key paths can produce 429s, but only the error handler
    // can consistently set `X-RateLimit-Reason`.
    fixtures.users.kevin.quotaOverride = 0;

    const req = buildReq();
    const res = buildRes();

    await expect(rateLimitApiQuota(req, res, vi.fn())).rejects.toMatchObject({ reason: 'monthly_quota' });

    fixtures.users.kevin.quotaOverride = null;
  });

  it('announces the month on every authenticated response, not only the rejection', async () => {
    // Return quota headers so the account page can render its bar without a second request.
    const req = buildReq();
    const res = buildRes();

    await rateLimitApiQuota(req, res, vi.fn());

    expect(res._headers['X-Monthly-Quota-Limit']).toBe(String(req.accountQuota.quotaLimit));
    expect(res._headers['X-Monthly-Quota-Used']).toBe(String(req.accountQuota.quotaUsed));
    // An ISO instant, so a client can render "resets on ..." in its own locale
    // rather than parsing a period integer it has no calendar for.
    expect(res._headers['X-Monthly-Quota-Reset']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('bills against the tier when the account has no override', async () => {
    // The point of the whole change: the limit comes from a row the account
    // points at, not from a number typed onto the account.
    const user = fixtures.users.kevin;
    const previous = { tierId: user.tierId, override: user.quotaOverride, column: user.monthlyQuotaLimit };

    await Tier.upsert({ id: 'test-plus', displayName: 'Test Plus', monthlyQuotaLimit: 31_337, sortOrder: 99 }, ['id']);
    invalidateTierCache();
    user.tierId = 'test-plus';
    user.quotaOverride = null;
    user.monthlyQuotaLimit = 5000;

    const req = buildReq();
    await rateLimitApiQuota(req, buildRes(), vi.fn());
    expect(req.accountQuota.quotaLimit).toBe(31_337);

    // An override is the escape hatch, and it wins.
    user.quotaOverride = 42;
    const overridden = buildReq();
    await rateLimitApiQuota(overridden, buildRes(), vi.fn());
    expect(overridden.accountQuota.quotaLimit).toBe(42);

    user.tierId = previous.tierId;
    user.quotaOverride = previous.override;
    user.monthlyQuotaLimit = previous.column;
    invalidateTierCache();
  });

  describe('with a linked Patreon membership', () => {
    /** Kevin on `free`, with the migration's tier ladder in place and both caches cleared. */
    async function patronKevin(membership: Partial<PatreonConnection> | null) {
      const user = fixtures.users.kevin;
      const previous = { tierId: user.tierId, override: user.quotaOverride };
      await Tier.upsert(
        [
          { id: 'free', displayName: 'Free', monthlyQuotaLimit: 5000, patreonTierId: null, sortOrder: 0 },
          { id: 'plus', displayName: 'Seed', monthlyQuotaLimit: 15_000, patreonTierId: '22710324', sortOrder: 10 },
          { id: 'pro', displayName: 'Flower', monthlyQuotaLimit: 30_000, patreonTierId: '28118736', sortOrder: 20 },
          {
            id: 'max',
            displayName: 'Nadeshiko',
            monthlyQuotaLimit: 60_000,
            patreonTierId: '30077695',
            sortOrder: 30,
          },
        ],
        ['id'],
      );
      await PatreonConnection.delete({ userId: user.id });
      if (membership) {
        await PatreonConnection.save(
          PatreonConnection.create({
            userId: user.id,
            patreonUserId: `patreon-${user.id}`,
            accessTokenCiphertext: 'sealed',
            refreshTokenCiphertext: 'sealed',
            accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
            patronStatus: 'active_patron',
            entitledAmountCents: 0,
            entitledTierIds: [],
            membershipCheckedAt: new Date(),
            ...membership,
          }),
        );
      }
      user.tierId = 'free';
      user.quotaOverride = null;
      invalidateTierCache();
      invalidatePatreonQuotaCache(user.id);
      return () => {
        user.tierId = previous.tierId;
        user.quotaOverride = previous.override;
        invalidateTierCache();
        invalidatePatreonQuotaCache(user.id);
      };
    }

    async function limitFor() {
      const req = buildReq();
      await rateLimitApiQuota(req, buildRes(), vi.fn());
      return req.accountQuota.quotaLimit;
    }

    it.each([
      ['no link', null, 5000],
      ['Seed', ['22710324'], 15_000],
      ['Flower', ['28118736'], 30_000],
      ['Nadeshiko', ['30077695'], 60_000],
      ['Seed and Nadeshiko', ['22710324', '30077695'], 60_000],
      ['an unknown tier', ['99999999'], 5000],
    ] as const)('bills %s against the tier it earns (%i)', async (_label, tierIds, expected) => {
      const restore = await patronKevin(tierIds === null ? null : { entitledTierIds: [...tierIds] });
      try {
        expect(await limitFor()).toBe(expected);
      } finally {
        restore();
      }
    });

    it('drops a lapsed patron back to their own tier', async () => {
      const restore = await patronKevin({ patronStatus: 'former_patron', entitledTierIds: ['30077695'] });
      try {
        expect(await limitFor()).toBe(5000);
      } finally {
        restore();
      }
    });

    it('does not count a membership whose last check is stale', async () => {
      const restore = await patronKevin({
        entitledTierIds: ['30077695'],
        membershipCheckedAt: new Date(Date.now() - PATREON_QUOTA_STALE_MS - 60_000),
      });
      try {
        expect(await limitFor()).toBe(5000);
      } finally {
        restore();
      }
    });

    it('lets a manual override win over the Patreon tier', async () => {
      const restore = await patronKevin({ entitledTierIds: ['30077695'] });
      fixtures.users.kevin.quotaOverride = 7777;
      try {
        expect(await limitFor()).toBe(7777);
      } finally {
        restore();
      }
    });

    it('keeps an assigned tier that is higher than the Patreon one', async () => {
      const restore = await patronKevin({ entitledTierIds: ['22710324'] });
      fixtures.users.kevin.tierId = 'max';
      try {
        expect(await limitFor()).toBe(60_000);
      } finally {
        restore();
      }
    });

    // The cache keeps this off the database on every request; a lapse must still reach it once invalidated.
    it('serves the membership from cache until it is invalidated', async () => {
      const restore = await patronKevin({ entitledTierIds: ['30077695'] });
      try {
        expect(await limitFor()).toBe(60_000);

        await PatreonConnection.update({ userId: fixtures.users.kevin.id }, { patronStatus: 'former_patron' });
        expect(await limitFor()).toBe(60_000);

        invalidatePatreonQuotaCache(fixtures.users.kevin.id);
        expect(await limitFor()).toBe(5000);
      } finally {
        restore();
      }
    });
  });

  it('throws when req.user is missing', async () => {
    const req = buildReq({ user: undefined });
    const res = buildRes();
    const next = vi.fn();

    await expect(rateLimitApiQuota(req, res, next)).rejects.toThrow('Invalid API key owner');
  });

  it('registers a finish listener to increment quota on success', async () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('increments quota on successful 2xx response', async () => {
    const spy = vi.spyOn(AccountQuotaUsage, 'incrementForUser').mockResolvedValue(undefined as any);

    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    res.statusCode = 200;
    res._listeners['finish']();

    expect(spy).toHaveBeenCalledWith(fixtures.users.kevin.id);

    spy.mockRestore();
  });

  it('does not increment quota on non-2xx response', async () => {
    const spy = vi.spyOn(AccountQuotaUsage, 'incrementForUser').mockResolvedValue(undefined as any);

    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    res.statusCode = 404;
    res._listeners['finish']();

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
