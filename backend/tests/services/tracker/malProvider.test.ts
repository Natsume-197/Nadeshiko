import { afterEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  MAL_OAUTH_CLIENT_ID: '',
  MAL_OAUTH_CLIENT_SECRET: '',
  MAL_OAUTH_REDIRECT_URI: '',
  TRACKER_CONNECTION_SECRET: 'tracker-test-secret-material-at-least-32-chars',
}));
vi.mock('@config/config', () => ({ config }));

import { TrackerProviderType } from '@app/models/TrackerConnection';
import { WatchStatus } from '@app/models/UserMediaProgress';
import { malProvider, normalizeMalAnimeList } from '@app/services/tracker/malProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('normalizeMalAnimeList', () => {
  it('maps MAL statuses, treats rewatching as completed and clamps progress', () => {
    const entries = normalizeMalAnimeList([
      { node: { id: 52991, title: 'Sousou no Frieren' }, list_status: { status: 'watching', num_episodes_watched: 6 } },
      {
        node: { id: 9253, title: 'Steins;Gate' },
        list_status: { status: 'watching', num_episodes_watched: 3, is_rewatching: true },
      },
      { node: { id: 1, title: 'Cowboy Bebop' }, list_status: { status: 'on_hold', num_episodes_watched: 4 } },
      { node: { id: 2, title: 'Dropped' }, list_status: { status: 'dropped', num_episodes_watched: 1 } },
      { node: { id: 3, title: '  ' }, list_status: { status: 'plan_to_watch', num_episodes_watched: -2 } },
      { node: { id: 4, title: 'Done' }, list_status: { status: 'completed', num_episodes_watched: 12 } },
    ]);

    expect(entries.map((entry) => [entry.externalId, entry.status, entry.progress])).toEqual([
      ['52991', WatchStatus.WATCHING, 6],
      ['9253', WatchStatus.COMPLETED, 3],
      ['1', WatchStatus.PAUSED, 4],
      ['2', WatchStatus.DROPPED, 1],
      ['3', WatchStatus.PLANNING, 0],
      ['4', WatchStatus.COMPLETED, 12],
    ]);
    expect(entries[4]).toEqual({
      externalSource: TrackerProviderType.MAL,
      externalId: '3',
      title: 'MyAnimeList #3',
      status: WatchStatus.PLANNING,
      progress: 0,
      customLists: [],
    });
  });

  it('skips rows without a valid anime id or a known status', () => {
    expect(
      normalizeMalAnimeList([
        { node: { id: null, title: 'Missing' }, list_status: { status: 'completed' } },
        { node: { id: 5, title: 'Unknown' }, list_status: { status: 'rewatching' } },
        { node: { id: 6, title: 'No status' }, list_status: null },
      ]),
    ).toEqual([]);
  });
});

describe('malProvider', () => {
  afterEach(() => {
    config.MAL_OAUTH_CLIENT_ID = '';
    config.MAL_OAUTH_CLIENT_SECRET = '';
    config.MAL_OAUTH_REDIRECT_URI = '';
    vi.unstubAllGlobals();
  });

  function configure(secret = 'mal-secret') {
    config.MAL_OAUTH_CLIENT_ID = 'mal-client';
    config.MAL_OAUTH_CLIENT_SECRET = secret;
    config.MAL_OAUTH_REDIRECT_URI = 'http://localhost:3000/link/mal/callback';
  }

  it('declares PKCE and no custom lists, and is configured without a client secret', () => {
    expect(malProvider.isConfigured()).toBe(false);
    configure('');
    expect(malProvider.isConfigured()).toBe(true);
    expect(malProvider.id).toBe(TrackerProviderType.MAL);
    expect(malProvider.usesPkce).toBe(true);
    expect(malProvider.supportsCustomLists).toBe(false);
    expect(malProvider.externalUrl('52991')).toBe('https://myanimelist.net/anime/52991');
  });

  it('builds a plain PKCE authorize URL', () => {
    configure();
    const url = new URL(malProvider.getAuthUrl('state-123', 'verifier-abc'));
    expect(url.origin + url.pathname).toBe('https://myanimelist.net/v1/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'mal-client',
      redirect_uri: 'http://localhost:3000/link/mal/callback',
      state: 'state-123',
      code_challenge: 'verifier-abc',
      code_challenge_method: 'plain',
    });
    expect(() => malProvider.getAuthUrl('state-123')).toThrow();
  });

  it('exchanges the code with the verifier and sends the secret only when set', async () => {
    configure();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 2_678_400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(malProvider.exchangeCode('code-1', 'verifier-abc')).resolves.toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresInSeconds: 2_678_400,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://myanimelist.net/v1/oauth2/token');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: 'mal-client',
      client_secret: 'mal-secret',
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'http://localhost:3000/link/mal/callback',
      code_verifier: 'verifier-abc',
    });

    configure('');
    await malProvider.refreshTokens?.('old-refresh');
    const [, refreshInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(Object.fromEntries(new URLSearchParams(String(refreshInit.body)))).toEqual({
      client_id: 'mal-client',
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
    });
  });

  it('rejects a code exchange without a verifier and a failed refresh', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400)),
    );
    await expect(malProvider.exchangeCode('code-1')).rejects.toThrow();
    await expect(malProvider.refreshTokens?.('dead')).rejects.toThrow(/reconnect MyAnimeList/);
  });

  it('reads the MAL identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: 1234, name: ' reader ' })),
    );
    await expect(malProvider.fetchIdentity('at')).resolves.toEqual({
      externalUserId: '1234',
      externalUsername: 'reader',
    });
  });

  it('follows MAL paging and never sends the token to another origin', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ node: { id: 1, title: 'One' }, list_status: { status: 'completed', num_episodes_watched: 26 } }],
          paging: { next: 'https://api.myanimelist.net/v2/users/@me/animelist?offset=1000&limit=1000' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ node: { id: 2, title: 'Two' }, list_status: { status: 'watching', num_episodes_watched: 2 } }],
          paging: { next: 'https://evil.example/steal' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const entries = await malProvider.fetchAnimeList({ accessToken: 'at', externalUserId: '1234' });

    expect(entries.map((entry) => entry.externalId)).toEqual(['1', '2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(firstUrl.pathname).toBe('/v2/users/@me/animelist');
    expect(firstUrl.searchParams.get('nsfw')).toBe('true');
    expect(firstUrl.searchParams.get('fields')).toBe('list_status');
  });

  it('asks for a reconnect when MAL rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'invalid_token' }, 401)),
    );
    await expect(malProvider.fetchAnimeList({ accessToken: 'at', externalUserId: '1' })).rejects.toThrow(
      /reconnect MyAnimeList/,
    );
  });
});
