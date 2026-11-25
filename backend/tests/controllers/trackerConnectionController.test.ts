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
      TRACKER_CONNECTION_SECRET: 'tracker-test-secret-material-at-least-32-chars',
    },
  };
});

import {
  CategoryType,
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
      expect.objectContaining({ externalId: '999999', title: 'Unindexed Anime', status: WatchStatus.PLANNING }),
    ]);

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
});
