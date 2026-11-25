import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      ANILIST_OAUTH_CLIENT_ID: 'anilist-client-id',
      ANILIST_OAUTH_CLIENT_SECRET: 'anilist-client-secret',
      ANILIST_OAUTH_REDIRECT_URI: 'http://localhost:3000/link/anilist/callback',
      MAL_OAUTH_CLIENT_ID: 'mal-client-id',
      MAL_OAUTH_CLIENT_SECRET: '',
      MAL_OAUTH_REDIRECT_URI: 'http://localhost:3000/link/mal/callback',
      TRACKER_CONNECTION_SECRET: 'tracker-test-secret-material-at-least-32-chars',
    },
  };
});

import {
  CategoryType,
  ContentRequest,
  ContentRequestStatus,
  ContentRequestVote,
  ExternalSourceType,
  Media,
  MediaExternalId,
  PatreonConnection,
  TrackerConnection,
  TrackerProviderType,
  UserMediaProgress,
  WatchStatus,
} from '@app/models';
import { linkProgressForMedia } from '@app/services/tracker/service';
import { decryptSecret } from '@lib/secretBox';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { request } from '../helpers/http';
import { createTestApp, setupTestSuite, signInAs } from '../helpers/setup';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;
let matchedMedia: Media;

async function linkPatreon(userId: number, active: boolean) {
  await PatreonConnection.delete({ userId });
  await PatreonConnection.create({
    userId,
    patreonUserId: `patreon-tracker-${userId}`,
    accessTokenCiphertext: 'x',
    refreshTokenCiphertext: 'x',
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
    patronStatus: active ? 'active_patron' : 'former_patron',
    entitledAmountCents: active ? 500 : 0,
    membershipCheckedAt: new Date(),
  }).save();
}

function mockAniListFetchWithInit(lists: unknown[]) {
  const realFetch = globalThis.fetch.bind(globalThis);
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('anilist.co/api/v2/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'anilist-access-token', expires_in: 31_536_000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('graphql.anilist.co')) {
      const rawBody = typeof init?.body === 'string' ? init.body : '';
      if (rawBody.includes('Viewer')) {
        return new Response(JSON.stringify({ data: { Viewer: { id: 4242, name: 'NatsumeReader' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: { MediaListCollection: { lists } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return realFetch(input, init);
  });
}

interface MalMockOptions {
  entries: unknown[];
  /** Token responses in order: the code exchange first, then each refresh. */
  tokens?: Array<{ access_token: string; refresh_token: string; expires_in: number }>;
}

function mockMalFetch({ entries, tokens = [] }: MalMockOptions) {
  const realFetch = globalThis.fetch.bind(globalThis);
  const tokenBodies: Array<Record<string, string>> = [];
  const listAuthHeaders: string[] = [];
  const queue = [...tokens];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

    if (url === 'https://myanimelist.net/v1/oauth2/token') {
      tokenBodies.push(Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))));
      const next = queue.shift() ?? { access_token: 'mal-access', refresh_token: 'mal-refresh', expires_in: 2_678_400 };
      return json({ token_type: 'Bearer', ...next });
    }
    if (url === 'https://api.myanimelist.net/v2/users/@me') {
      return json({ id: 777, name: 'MalReader' });
    }
    if (url.startsWith('https://api.myanimelist.net/v2/users/@me/animelist')) {
      listAuthHeaders.push(String(new Headers(init?.headers).get('authorization')));
      return json({ data: entries, paging: {} });
    }
    return realFetch(input, init);
  });
  return { spy, tokenBodies, listAuthHeaders };
}

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(async () => {
  matchedMedia = (await Media.create({
    publicId: 'trckrTest001',
    slug: 'tracker-test-bakemonogatari',
    nameEn: 'Bakemonogatari',
    nameJa: '化物語',
    nameRomaji: 'Bakemonogatari',
    category: CategoryType.ANIME,
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    episodeCount: 15,
    startDate: '2009-07-03',
    endDate: '2010-06-25',
    seasonName: 'SUMMER',
    seasonYear: 2009,
    genres: ['Mystery'],
    studio: 'SHAFT',
    version: '1',
    storage: 'R2',
    storageBasePath: 'media/5081',
  } as Partial<Media>).save()) as Media;
  await MediaExternalId.create({
    mediaId: matchedMedia.id,
    source: ExternalSourceType.ANILIST,
    externalId: '5081',
  }).save();

  const { regular } = fixtures.users;
  await UserMediaProgress.delete({ userId: regular.id });
  await TrackerConnection.delete({ userId: regular.id });
  await PatreonConnection.delete({ userId: regular.id });
  signInAs(app, regular);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('anime tracker connection endpoints', () => {
  it('links AniList via OAuth, syncs catalog coverage, and separates free vs patron perks', async () => {
    const anilistExt = await MediaExternalId.findOneByOrFail({
      mediaId: matchedMedia.id,
      source: ExternalSourceType.ANILIST,
    });

    mockAniListFetchWithInit([
      {
        name: 'Watching',
        isCustomList: false,
        entries: [
          {
            status: 'CURRENT',
            progress: 5,
            media: { id: Number(anilistExt.externalId), title: { romaji: 'Bakemonogatari' } },
          },
        ],
      },
      {
        name: 'Planning',
        isCustomList: false,
        entries: [
          {
            status: 'PLANNING',
            progress: 0,
            media: { id: 999999, title: { romaji: 'Unindexed Anime' } },
          },
        ],
      },
      {
        name: 'Mining Queue',
        isCustomList: true,
        entries: [
          {
            status: 'CURRENT',
            progress: 5,
            media: { id: Number(anilistExt.externalId), title: { romaji: 'Bakemonogatari' } },
          },
        ],
      },
    ]);

    const startRes = await request(app).post('/v1/user/connections/tracker').send({ provider: 'ANILIST' });
    expect(startRes.status).toBe(201);
    expect(startRes.body.authorizeUrl).toContain('anilist.co/api/v2/oauth/authorize');

    const callbackRes = await request(app).post('/v1/user/connections/tracker/callback').send({
      provider: 'ANILIST',
      code: 'oauth-code-123',
      state: startRes.body.state,
    });
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body.canUsePatronPerks).toBe(false);
    expect(callbackRes.body.connection.externalUsername).toBe('NatsumeReader');
    expect(callbackRes.body.coverage).toMatchObject({ total: 2, inCatalog: 1, missing: 1 });
    // Free users see custom list count (for upsell) but customLists array stays locked.
    expect(callbackRes.body.customLists).toEqual([]);
    expect(callbackRes.body.customListCount).toBe(1);
    expect(callbackRes.body.entries).toEqual([
      {
        mediaPublicId: matchedMedia.publicId,
        title: expect.any(String),
        status: WatchStatus.WATCHING,
        progress: 5,
        customLists: [],
      },
    ]);
    expect(callbackRes.body.missingAnime).toEqual([
      expect.objectContaining({
        externalId: '999999',
        title: 'Unindexed Anime',
        status: WatchStatus.PLANNING,
        request: null,
      }),
    ]);

    // Someone else already asked for the missing title: the card offers a vote, not a second request.
    const existingRequest = await ContentRequest.create({
      category: CategoryType.ANIME,
      status: ContentRequestStatus.OPEN,
      title: 'Unindexed Anime',
      sourceUrl: 'https://anilist.co/anime/999999',
      externalSource: ExternalSourceType.ANILIST,
      externalId: '999999',
      requesterUserId: fixtures.users.kevin.id,
      voteCount: 1,
    }).save();
    await ContentRequestVote.create({ requestId: existingRequest.id, userId: fixtures.users.kevin.id }).save();

    const othersRes = await request(app).get('/v1/user/connections/tracker');
    expect(othersRes.status).toBe(200);
    expect(othersRes.body.missingAnime[0].request).toEqual({
      publicId: existingRequest.publicId,
      status: ContentRequestStatus.OPEN,
      voteCount: 1,
      voted: false,
    });

    // Once the reader votes (or files it), it reads as requested.
    await ContentRequestVote.create({ requestId: existingRequest.id, userId: fixtures.users.regular.id }).save();
    const votedRes = await request(app).get('/v1/user/connections/tracker');
    expect(votedRes.body.missingAnime[0].request).toMatchObject({ voted: true });

    // Free account cannot enable patron toggles.
    const forbiddenRes = await request(app)
      .patch('/v1/user/connections/tracker/settings')
      .send({ spoilerGuardEnabled: true });
    expect(forbiddenRes.status).toBe(403);

    // Immediate manual sync hits the 6h free cooldown.
    const cooldownRes = await request(app).post('/v1/user/connections/tracker/sync');
    expect(cooldownRes.status).toBe(429);

    // Activate Patreon: toggles unlock and custom lists appear.
    await linkPatreon(fixtures.users.regular.id, true);
    const patronSettingsRes = await request(app)
      .patch('/v1/user/connections/tracker/settings')
      .send({ autoSyncEnabled: true, spoilerGuardEnabled: true, hidePlanToWatch: true });
    expect(patronSettingsRes.status).toBe(200);
    expect(patronSettingsRes.body.canUsePatronPerks).toBe(true);
    expect(patronSettingsRes.body.connection.effectiveSettings).toEqual({
      autoSyncEnabled: true,
      spoilerGuardEnabled: true,
      hidePlanToWatch: true,
    });
    expect(patronSettingsRes.body.customLists).toEqual(['Mining Queue']);

    // Lapsed Patreon: stored settings stay intact, effective settings clamp to false.
    await linkPatreon(fixtures.users.regular.id, false);
    const lapsedRes = await request(app).get('/v1/user/connections/tracker');
    expect(lapsedRes.status).toBe(200);
    expect(lapsedRes.body.canUsePatronPerks).toBe(false);
    expect(lapsedRes.body.connection.settings.spoilerGuardEnabled).toBe(true);
    expect(lapsedRes.body.connection.effectiveSettings).toEqual({
      autoSyncEnabled: false,
      spoilerGuardEnabled: false,
      hidePlanToWatch: false,
    });

    // Disconnect deletes both connection and synced rows.
    const unlinkRes = await request(app).delete('/v1/user/connections/tracker');
    expect(unlinkRes.status).toBe(204);
    expect(await UserMediaProgress.countBy({ userId: fixtures.users.regular.id })).toBe(0);
  });

  it('back-links previously unmatched tracker progress rows when new media is ingested', async () => {
    const anilistExt = await MediaExternalId.findOneByOrFail({
      mediaId: matchedMedia.id,
      source: ExternalSourceType.ANILIST,
    });

    await UserMediaProgress.create({
      userId: fixtures.users.regular.id,
      provider: TrackerProviderType.ANILIST,
      externalSource: ExternalSourceType.ANILIST,
      externalId: anilistExt.externalId,
      title: 'Bakemonogatari',
      mediaId: null,
      status: WatchStatus.COMPLETED,
      progress: 15,
      customLists: [],
    }).save();

    const linked = await linkProgressForMedia(matchedMedia.id);
    expect(linked).toBeGreaterThanOrEqual(1);

    const row = await UserMediaProgress.findOneByOrFail({
      userId: fixtures.users.regular.id,
      externalSource: ExternalSourceType.ANILIST,
      externalId: anilistExt.externalId,
    });
    expect(row.mediaId).toBe(matchedMedia.id);
  });

  it('links MyAnimeList with PKCE, replaces AniList, refreshes rotating tokens and disconnects', async () => {
    const userId = fixtures.users.regular.id;
    await MediaExternalId.create({
      mediaId: matchedMedia.id,
      source: ExternalSourceType.MAL,
      externalId: '5081',
    }).save();

    // An AniList connection is replaced by the MAL link, along with its synced rows.
    mockAniListFetchWithInit([
      {
        name: 'Completed',
        isCustomList: false,
        entries: [{ status: 'COMPLETED', progress: 15, media: { id: 5081, title: { romaji: 'Bakemonogatari' } } }],
      },
    ]);
    const anilistStart = await request(app).post('/v1/user/connections/tracker').send({ provider: 'ANILIST' });
    await request(app)
      .post('/v1/user/connections/tracker/callback')
      .send({ provider: 'ANILIST', code: 'anilist-code', state: anilistStart.body.state });
    expect(await UserMediaProgress.countBy({ userId, provider: TrackerProviderType.ANILIST })).toBe(1);
    vi.restoreAllMocks();

    const mal = mockMalFetch({
      entries: [
        { node: { id: 5081, title: 'Bakemonogatari' }, list_status: { status: 'watching', num_episodes_watched: 7 } },
        { node: { id: 424242, title: 'Not On Nadeshiko' }, list_status: { status: 'plan_to_watch' } },
      ],
      tokens: [{ access_token: 'mal-access-1', refresh_token: 'mal-refresh-1', expires_in: 2_678_400 }],
    });

    const startRes = await request(app).post('/v1/user/connections/tracker').send({ provider: 'MAL' });
    expect(startRes.status).toBe(201);
    const authorizeUrl = new URL(startRes.body.authorizeUrl);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://myanimelist.net/v1/oauth2/authorize');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('plain');
    const challenge = authorizeUrl.searchParams.get('code_challenge') ?? '';
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    // The verifier travels encrypted inside the state, never in clear.
    expect(startRes.body.state).not.toContain(challenge);

    const callbackRes = await request(app)
      .post('/v1/user/connections/tracker/callback')
      .send({ provider: 'MAL', code: 'mal-code', state: startRes.body.state });
    expect(callbackRes.status).toBe(200);
    expect(mal.tokenBodies[0]).toMatchObject({
      grant_type: 'authorization_code',
      code: 'mal-code',
      code_verifier: challenge,
      client_id: 'mal-client-id',
      redirect_uri: 'http://localhost:3000/link/mal/callback',
    });
    expect(mal.tokenBodies[0]).not.toHaveProperty('client_secret');
    expect(callbackRes.body.connection).toMatchObject({
      provider: 'MAL',
      externalUsername: 'MalReader',
      supportsCustomLists: false,
    });
    expect(callbackRes.body.coverage).toMatchObject({ total: 2, inCatalog: 1, missing: 1 });
    expect(callbackRes.body.entries).toEqual([
      expect.objectContaining({ mediaPublicId: matchedMedia.publicId, status: WatchStatus.WATCHING, progress: 7 }),
    ]);
    expect(callbackRes.body.missingAnime).toEqual([
      expect.objectContaining({
        externalSource: 'MAL',
        externalId: '424242',
        sourceUrl: 'https://myanimelist.net/anime/424242',
      }),
    ]);
    expect(await UserMediaProgress.countBy({ userId, provider: TrackerProviderType.ANILIST })).toBe(0);
    expect(await TrackerConnection.countBy({ userId })).toBe(1);

    // A token close to expiry is refreshed before the next sync, and the rotated refresh token is stored.
    const connection = await TrackerConnection.findOneByOrFail({ userId });
    connection.accessTokenExpiresAt = new Date(Date.now() + 60 * 60_000);
    connection.lastSyncedAt = new Date(Date.now() - 7 * 60 * 60_000);
    await connection.save();
    vi.restoreAllMocks();
    const refreshMock = mockMalFetch({
      entries: [
        { node: { id: 5081, title: 'Bakemonogatari' }, list_status: { status: 'completed', num_episodes_watched: 15 } },
      ],
      tokens: [{ access_token: 'mal-access-2', refresh_token: 'mal-refresh-2', expires_in: 2_678_400 }],
    });

    const syncRes = await request(app).post('/v1/user/connections/tracker/sync');
    expect(syncRes.status).toBe(200);
    expect(refreshMock.tokenBodies).toEqual([
      { client_id: 'mal-client-id', grant_type: 'refresh_token', refresh_token: 'mal-refresh-1' },
    ]);
    expect(refreshMock.listAuthHeaders).toEqual(['Bearer mal-access-2']);
    expect(syncRes.body.entries).toEqual([
      expect.objectContaining({ mediaPublicId: matchedMedia.publicId, status: WatchStatus.COMPLETED, progress: 15 }),
    ]);
    const refreshed = await TrackerConnection.findOneByOrFail({ userId });
    expect(
      decryptSecret(refreshed.refreshTokenCiphertext ?? '', 'tracker-test-secret-material-at-least-32-chars', {
        purpose: 'tracker.refresh-token',
        aad: `${userId}:MAL`,
      }),
    ).toBe('mal-refresh-2');
    expect(refreshed.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 30 * 24 * 60 * 60_000);

    const unlinkRes = await request(app).delete('/v1/user/connections/tracker');
    expect(unlinkRes.status).toBe(204);
    expect(await TrackerConnection.countBy({ userId })).toBe(0);
    expect(await UserMediaProgress.countBy({ userId })).toBe(0);
  });

  it('back-links unmatched MyAnimeList rows when new media gets a MAL id', async () => {
    await MediaExternalId.create({
      mediaId: matchedMedia.id,
      source: ExternalSourceType.MAL,
      externalId: '5081',
    }).save();
    await UserMediaProgress.create({
      userId: fixtures.users.regular.id,
      provider: TrackerProviderType.MAL,
      externalSource: ExternalSourceType.MAL,
      externalId: '5081',
      title: 'Bakemonogatari',
      mediaId: null,
      status: WatchStatus.WATCHING,
      progress: 3,
      customLists: [],
    }).save();

    await linkProgressForMedia(matchedMedia.id);

    const row = await UserMediaProgress.findOneByOrFail({
      userId: fixtures.users.regular.id,
      externalSource: ExternalSourceType.MAL,
      externalId: '5081',
    });
    expect(row.mediaId).toBe(matchedMedia.id);
  });
});
