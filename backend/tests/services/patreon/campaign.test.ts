import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache } from '@lib/cache';

const CONFIG = {
  PATREON_CREATOR_ACCESS_TOKEN: 'creator-token',
  PATREON_CAMPAIGN_ID: '10874870',
};
vi.mock('@config/config', () => ({ config: CONFIG }));

const warn = vi.hoisted(() => vi.fn());
vi.mock('@config/log', () => ({ logger: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const { PATREON_CAMPAIGN_CACHE, fetchCampaignMembers, isPatreonCreatorConfigured } = await import(
  '@app/services/patreon/campaign'
);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  CONFIG.PATREON_CREATOR_ACCESS_TOKEN = 'creator-token';
  CONFIG.PATREON_CAMPAIGN_ID = '10874870';
  Cache.invalidate(PATREON_CAMPAIGN_CACHE);
  warn.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Patreon campaign service', () => {
  it('reports unconfigured when token or campaign id is absent', async () => {
    CONFIG.PATREON_CREATOR_ACCESS_TOKEN = '';
    expect(isPatreonCreatorConfigured()).toBe(false);

    const snapshot = await fetchCampaignMembers();
    expect(snapshot).toEqual({
      status: 'unconfigured',
      errorMessage: null,
      fetchedAt: null,
      members: [],
    });
  });

  it('paginates members, normalizes iOS tier markup, sorts by status/amount, and caches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'm-former',
              type: 'member',
              attributes: {
                full_name: '  ',
                email: 'former@example.com',
                patron_status: 'former_patron',
                currently_entitled_amount_cents: 0,
                lifetime_support_cents: 2500,
                pledge_relationship_start: '2025-01-01T00:00:00Z',
              },
              relationships: { user: { data: { id: 'u-former', type: 'user' } } },
            },
            {
              id: 'm-ios',
              type: 'member',
              attributes: {
                full_name: 'Apple Patron',
                email: '  ios@example.com ',
                patron_status: 'active_patron',
                currently_entitled_amount_cents: 1430,
                campaign_lifetime_support_cents: 5000,
                pledge_relationship_start: '2026-02-01T00:00:00Z',
                last_charge_status: 'Paid',
                last_charge_date: '2026-11-01T00:00:00Z',
              },
              relationships: {
                user: { data: { id: 'u-ios', type: 'user' } },
                currently_entitled_tiers: { data: [{ id: 'tier-flower', type: 'tier' }] },
              },
            },
          ],
          included: [
            { id: 'tier-flower', type: 'tier', attributes: { title: 'Flower', amount_cents: 1000 } },
            { id: 'u-former', type: 'user', attributes: { full_name: 'Fallback User' } },
          ],
          links: { next: 'https://www.patreon.com/api/oauth2/v2/campaigns/10874870/members?page%5Bcursor%5D=p2' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'm-custom',
              type: 'member',
              attributes: {
                patron_status: 'active_patron',
                currently_entitled_amount_cents: 1500,
                campaign_lifetime_support_cents: 1500,
                pledge_relationship_start: '2026-03-01T00:00:00Z',
              },
            },
            {
              id: 'm-declined',
              type: 'member',
              attributes: {
                full_name: 'Declined',
                patron_status: 'declined_patron',
                currently_entitled_amount_cents: 500,
                campaign_lifetime_support_cents: 1000,
              },
            },
            {
              id: 'm-free',
              type: 'member',
              attributes: {
                full_name: 'Free Follower',
                patron_status: null,
                currently_entitled_amount_cents: 0,
              },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchCampaignMembers();
    expect(first.status).toBe('ok');
    expect(first.fetchedAt).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.members.map((m) => m.memberId)).toEqual(['m-custom', 'm-ios', 'm-declined', 'm-former', 'm-free']);

    // Custom active pledge keeps entitledAmountCents and falls back to em dash when no name exists.
    expect(first.members[0]).toMatchObject({
      fullName: '—',
      monthlyAmountCents: 1500,
      patreonUserId: null,
      patreonTierTitles: [],
    });
    // iOS patron normalizes monthlyAmountCents to tier USD price (1000) instead of 1430.
    expect(first.members[1]).toMatchObject({
      fullName: 'Apple Patron',
      email: 'ios@example.com',
      entitledAmountCents: 1430,
      monthlyAmountCents: 1000,
      patreonTierTitles: ['Flower'],
    });
    // Former patron falls back to included user's full_name and lifetime_support_cents.
    expect(first.members[3]).toMatchObject({
      fullName: 'Fallback User',
      monthlyAmountCents: 0,
      lifetimeSupportCents: 2500,
    });

    // Cached call does not re-fetch; force=true bypasses cache.
    const cached = await fetchCampaignMembers();
    expect(cached).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    const forced = await fetchCampaignMembers(true);
    expect(forced.members).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns unauthorized on 401/403, error on 5xx, and error on network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('denied', { status: 401 }))
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockRejectedValueOnce(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchCampaignMembers()).toMatchObject({
      status: 'unauthorized',
      members: [],
    });
    expect(await fetchCampaignMembers()).toMatchObject({
      status: 'error',
      errorMessage: 'Patreon API returned HTTP 503.',
      members: [],
    });
    expect(await fetchCampaignMembers()).toMatchObject({
      status: 'error',
      errorMessage: 'socket hang up',
      members: [],
    });
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
