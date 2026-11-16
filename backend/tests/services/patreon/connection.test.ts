import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONFIG = {
  PATREON_OAUTH_CLIENT_ID: 'nadeshiko-test',
  PATREON_OAUTH_CLIENT_SECRET: 'client-secret',
  PATREON_OAUTH_REDIRECT_URI: 'https://nadeshiko.test/link/patreon/callback',
  PATREON_CAMPAIGN_ID: 'campaign-42',
  PATREON_CONNECTION_SECRET: 'test-secret-with-more-than-thirty-two-characters',
};
vi.mock('@config/config', () => ({ config: CONFIG }));

const rows: Record<string, unknown>[] = [];
const quotaTiers = vi.hoisted(() => [
  { id: 'plus', monthlyQuotaLimit: 15_000, patreonTierId: '22710324' },
  { id: 'pro', monthlyQuotaLimit: 30_000, patreonTierId: '28118736' },
]);
const warn = vi.hoisted(() => vi.fn());
vi.mock('@config/log', () => ({ logger: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('@app/models', async () => ({
  ...(await vi.importActual<typeof import('@app/models/quota')>('@app/models/quota')),
  Tier: { find: vi.fn(async () => quotaTiers) },
  PatreonConnection: {
    findOneBy: vi.fn(async () => null),
    create: vi.fn((attributes: Record<string, unknown>) => ({
      ...attributes,
      get active() {
        return this.patronStatus === 'active_patron' && Number(this.entitledAmountCents) > 0;
      },
      async save() {
        rows.push(this);
        return this;
      },
    })),
  },
}));

const { completePatreonLink, membershipFrom, startPatreonLink } = await import('@app/services/patreon/connection');

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  rows.length = 0;
  vi.restoreAllMocks();
  warn.mockReset();
});

/** One member to our campaign entitled to `tierIds`, next to a member of someone else's campaign. */
function identityWith(tierIds: string[], status = 'active_patron') {
  return {
    data: { id: 'patreon-user', type: 'user', attributes: { full_name: 'Mika' } },
    included: [
      {
        id: 'member-other',
        type: 'member',
        attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 9900 },
        relationships: {
          campaign: { data: { id: 'someone-else', type: 'campaign' } },
          currently_entitled_tiers: { data: [{ id: '30077695', type: 'tier' }] },
        },
      },
      {
        id: 'member-1',
        type: 'member',
        attributes: { patron_status: status, currently_entitled_amount_cents: 1000 },
        relationships: {
          campaign: { data: { id: 'campaign-42', type: 'campaign' } },
          currently_entitled_tiers: { data: tierIds.map((id) => ({ id, type: 'tier' })) },
        },
      },
      { id: '28118736', type: 'tier', attributes: { title: 'Flower' } },
      { id: 'campaign-42', type: 'campaign' },
    ],
  };
}

describe('membershipFrom', () => {
  it('reads the entitled tier ids of the membership to our campaign only', () => {
    expect(membershipFrom(identityWith(['28118736', '22710324']))).toEqual({
      memberId: 'member-1',
      campaignId: 'campaign-42',
      patronStatus: 'active_patron',
      entitledAmountCents: 1000,
      entitledTierIds: ['28118736', '22710324'],
    });
  });

  it('gives no tier ids when the relationship is missing, and nothing at all without our membership', () => {
    const response = identityWith([]);
    const ours = response.included[1] as { relationships: Record<string, unknown> };
    delete ours.relationships.currently_entitled_tiers;
    expect(membershipFrom(response).entitledTierIds).toEqual([]);

    response.included.splice(1, 1);
    expect(membershipFrom(response)).toMatchObject({ memberId: null, entitledTierIds: [] });
  });
});

describe('unmatched Patreon tiers', () => {
  function link(body: unknown) {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(response(body));
    return completePatreonLink(7, 'code', startPatreonLink(7).state);
  }

  it('warns with the user and the unknown ids when an active patron matches no quota tier', async () => {
    await link(identityWith(['99999999']));

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, unmatchedTierIds: ['99999999'] }),
      'Active Patreon membership matches no quota tier',
    );
  });

  it('stays quiet when a tier matches, or when the membership is not active', async () => {
    await link(identityWith(['28118736']));
    await link(identityWith(['99999999'], 'former_patron'));

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('Patreon OAuth linking', () => {
  it('requests only identity and membership access and carries sealed state', () => {
    const link = startPatreonLink(7);
    const url = new URL(link.authorizeUrl);

    expect(url.origin + url.pathname).toBe('https://www.patreon.com/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('identity identity.memberships');
    expect(url.searchParams.get('state')).toBe(link.state);
    expect(link.state).not.toContain('"userId":7');
  });

  it('marks only an active paid membership to the configured campaign as eligible', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(
        response({
          data: { id: 'patreon-user', type: 'user', attributes: { full_name: 'Mika' } },
          included: [
            {
              id: 'member-1',
              type: 'member',
              attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 500 },
              relationships: { campaign: { data: { id: 'campaign-42', type: 'campaign' } } },
            },
          ],
        }),
      );
    const state = startPatreonLink(7).state;
    const connection = await completePatreonLink(7, 'one-time-code', state);

    expect(connection.active).toBe(true);
    expect(connection).toMatchObject({
      patreonUserId: 'patreon-user',
      campaignId: 'campaign-42',
      memberId: 'member-1',
      patronStatus: 'active_patron',
      entitledAmountCents: 500,
    });
    const identityUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(identityUrl.searchParams.get('include')?.split(',')).toEqual(
      expect.arrayContaining(['memberships', 'memberships.campaign', 'memberships.currently_entitled_tiers']),
    );
    expect(String(connection.accessTokenCiphertext)).not.toContain('access');
    expect(String(connection.refreshTokenCiphertext)).not.toContain('refresh');
  });

  it('does not accept an active pledge to a different creator', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(
        response({
          data: { id: 'patreon-user', type: 'user', attributes: {} },
          included: [
            {
              id: 'member-other',
              type: 'member',
              attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 10000 },
              relationships: { campaign: { data: { id: 'someone-else', type: 'campaign' } } },
            },
          ],
        }),
      );

    const connection = await completePatreonLink(7, 'code', startPatreonLink(7).state);
    expect(connection.active).toBe(false);
    expect(connection.entitledAmountCents).toBe(0);
  });

  it('rejects a link that cannot be renewed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ access_token: 'access', expires_in: 3600 }));

    await expect(completePatreonLink(7, 'code', startPatreonLink(7).state)).rejects.toThrow(
      'did not provide a renewable connection',
    );
  });

  it('rejects state issued for another Nadeshiko account', async () => {
    await expect(completePatreonLink(8, 'code', startPatreonLink(7).state)).rejects.toThrow(
      'belongs to another account',
    );
  });
});
