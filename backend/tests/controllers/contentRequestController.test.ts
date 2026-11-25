import type { Application, NextFunction, Request, Response } from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContentRequest,
  ContentRequestBoost,
  ContentRequestStatus,
  ContentRequestVote,
  MediaExternalId,
  ExternalSourceType,
  PatreonConnection,
  Tier,
  User,
} from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import * as emailQueueModule from '@app/workers/emailQueue';
import type { EmailJobData } from '@app/workers/emailQueue';
import { startRequestsForMedia } from '@app/services/requests/service';
import { buildApplication } from '@config/application';
import { AdminRoutes, RequestsRoutes } from '@config/routes';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { request } from '../helpers/http';
import { setupTestSuite } from '../helpers/setup';

setupTestSuite();

let app: Application;
let core: CoreFixtures;
let emails: { data: EmailJobData; key?: string }[];

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.SERVICE,
        permissions: Object.values(ApiPermission),
      },
    };
  }
  next();
}

/** Answer metadata lookups from a table instead of the network. */
function mockFetch(byHost: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = byHost[url.hostname];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  });
}

const ANILIST = {
  'graphql.anilist.co': {
    data: {
      Media: {
        title: { english: 'Frieren', romaji: 'Sousou no Frieren' },
        coverImage: {
          extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/x.jpg',
        },
        siteUrl: 'https://anilist.co/anime/154587',
      },
    },
  },
};

async function makeUser(name: string): Promise<User> {
  return User.create({
    username: name,
    email: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}@nadeshiko.test`,
    isVerified: true,
    isActive: true,
    preferences: {},
  }).save();
}

async function makePatron(user: User, patreonTierId: string): Promise<void> {
  await PatreonConnection.create({
    userId: user.id,
    patreonUserId: `p-${user.id}`,
    accessTokenCiphertext: 'x',
    refreshTokenCiphertext: 'x',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    patronStatus: 'active_patron',
    entitledAmountCents: 500,
    entitledTierIds: [patreonTierId],
    membershipCheckedAt: new Date(),
  }).save();
}

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', RequestsRoutes);
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(async () => {
  app.locals.testUser = core.users.regular;
  emails = [];
  vi.spyOn(emailQueueModule, 'sendEmailJob').mockImplementation(async (data, key) => {
    emails.push({ data, key });
    return 'job';
  });
  await ContentRequest.query('DELETE FROM "ContentRequest"');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('filing a request', () => {
  it('creates a request with metadata from the link and counts the requester as its first vote', async () => {
    mockFetch(ANILIST);
    const res = await request(app).post('/v1/requests').send({
      sourceUrl: 'https://anilist.co/anime/154587',
      note: 'Season 1 please',
    });

    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('created');
    expect(res.body.request).toMatchObject({
      category: 'ANIME',
      kind: 'NEW',
      status: 'OPEN',
      title: 'Frieren',
      note: 'Season 1 please',
      coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/x.jpg',
      voteCount: 1,
      boostCount: 0,
      score: 1,
    });
    expect(res.body.request).not.toHaveProperty('requester');
  });

  it('turns a second request for the same title into a vote', async () => {
    mockFetch(ANILIST);
    await request(app).post('/v1/requests').send({ sourceUrl: 'https://anilist.co/anime/154587' });

    app.locals.testUser = await makeUser('second');
    const res = await request(app).post('/v1/requests').send({ sourceUrl: 'https://anilist.co/anime/154587/Frieren' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('voted');
    expect(res.body.request.voteCount).toBe(2);
    expect(await ContentRequest.count()).toBe(1);

    const again = await request(app).post('/v1/requests').send({ sourceUrl: 'https://anilist.co/anime/154587' });
    expect(again.body.outcome).toBe('already_voted');
    expect(again.body.request.voteCount).toBe(2);
  });

  it('files a request for a title already on Nadeshiko as an UPDATE for it', async () => {
    mockFetch(ANILIST);
    const { media } = await loadFixtures(['singleMedia']);
    const published = Object.values(media)[0]!;
    await MediaExternalId.save({
      mediaId: published.id,
      source: ExternalSourceType.ANILIST,
      externalId: '154587',
    });

    const res = await request(app).post('/v1/requests').send({ sourceUrl: 'https://anilist.co/anime/154587' });
    expect(res.body.request).toMatchObject({
      kind: 'UPDATE',
      media: { id: published.publicId },
    });
  });

  it('moves open requests to in progress when ingest creates their media', async () => {
    mockFetch(ANILIST);
    const created = await request(app).post('/v1/requests').send({ sourceUrl: 'https://anilist.co/anime/154587' });
    const { media } = await loadFixtures(['singleMedia']);
    const published = Object.values(media)[0]!;
    await MediaExternalId.save({
      mediaId: published.id,
      source: ExternalSourceType.ANILIST,
      externalId: '154587',
    });

    expect(await startRequestsForMedia(published.id)).toBe(1);
    const started = await ContentRequest.findOneByOrFail({
      publicId: created.body.request.id,
    });
    expect(started).toMatchObject({
      status: 'IN_PROGRESS',
      mediaId: published.id,
    });
    await vi.waitFor(() => expect(emails).toHaveLength(1));
  });

  it('asks for a title when the link gives none', async () => {
    mockFetch({});
    const missing = await request(app).post('/v1/requests').send({ sourceUrl: 'https://www.themoviedb.org/tv/94796' });
    expect(missing.status).toBe(400);

    const typed = await request(app).post('/v1/requests').send({
      sourceUrl: 'https://www.themoviedb.org/tv/94796',
      title: 'Hanzawa Naoki',
    });
    expect(typed.status).toBe(201);
    expect(typed.body.request).toMatchObject({
      category: 'JDRAMA',
      title: 'Hanzawa Naoki',
      coverUrl: null,
    });
  });

  it('refuses links from sites requests do not accept', async () => {
    const res = await request(app).post('/v1/requests').send({ sourceUrl: 'https://kitsu.app/anime/21' });
    expect(res.status).toBe(400);
  });

  it('files a MyAnimeList link under its MAL id with metadata from AniList', async () => {
    mockFetch(ANILIST);
    const res = await request(app)
      .post('/v1/requests')
      .send({ sourceUrl: 'https://myanimelist.net/anime/52991/Frieren' });

    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('created');
    expect(res.body.request).toMatchObject({ category: 'ANIME', title: 'Frieren' });
    const stored = await ContentRequest.findOneByOrFail({ publicId: res.body.request.id });
    expect(stored).toMatchObject({ externalSource: 'MAL', externalId: '52991' });

    const again = await request(app).post('/v1/requests').send({ sourceUrl: 'https://myanimelist.net/anime/52991' });
    expect(again.body.outcome).toBe('already_voted');
  });

  it('flags a request whose title matches another open one', async () => {
    mockFetch({});
    const first = await request(app).post('/v1/requests').send({
      sourceUrl: 'https://mydramalist.com/1-first-love',
      title: 'First Love',
    });
    app.locals.testUser = await makeUser('lookalike');
    const second = await request(app).post('/v1/requests').send({
      sourceUrl: 'https://www.themoviedb.org/tv/1',
      title: 'first love',
    });
    expect(second.status).toBe(201);

    app.locals.testUser = core.users.kevin;
    const admin = await request(app).get('/v1/admin/requests?flagged=true');
    expect(admin.body.items).toHaveLength(1);
    expect(admin.body.items[0].possibleDuplicateOf).toMatchObject({
      id: first.body.request.id,
    });
  });

  it('caps open requests per account and filings per day', async () => {
    mockFetch({});
    const user = await makeUser('busy');
    app.locals.testUser = user;
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post('/v1/requests')
        .send({
          sourceUrl: `https://www.themoviedb.org/tv/${i}`,
          title: `Drama ${i}`,
        });
      expect(res.status).toBe(201);
    }
    const sixth = await request(app)
      .post('/v1/requests')
      .send({ sourceUrl: 'https://www.themoviedb.org/tv/6', title: 'Drama 6' });
    expect(sixth.status).toBe(403);
    expect(sixth.body.detail).toMatch(/a day/);

    // Older filings no longer count against the day; the open limit (10) still applies.
    await ContentRequest.query(`UPDATE "ContentRequest" SET "created_at" = now() - interval '2 days'`);
    for (let i = 6; i <= 10; i++) {
      await ContentRequest.query(`UPDATE "ContentRequest" SET "created_at" = now() - interval '2 days'`);
      await request(app)
        .post('/v1/requests')
        .send({
          sourceUrl: `https://www.themoviedb.org/tv/${i}`,
          title: `Drama ${i}`,
        });
    }
    await ContentRequest.query(`UPDATE "ContentRequest" SET "created_at" = now() - interval '2 days'`);
    const eleventh = await request(app).post('/v1/requests').send({
      sourceUrl: 'https://www.themoviedb.org/tv/11',
      title: 'Drama 11',
    });
    expect(eleventh.status).toBe(403);
    expect(eleventh.body.detail).toMatch(/10 open requests/);
  });
});

describe('voting and the public list', () => {
  it('votes, takes a vote back, and sorts the list by score', async () => {
    mockFetch({});
    const a = await request(app)
      .post('/v1/requests')
      .send({ sourceUrl: 'https://www.themoviedb.org/tv/1', title: 'A' });
    const b = await request(app)
      .post('/v1/requests')
      .send({ sourceUrl: 'https://www.themoviedb.org/tv/2', title: 'B' });

    app.locals.testUser = await makeUser('voter');
    const voted = await request(app).post(`/v1/requests/${b.body.request.id}/vote`);
    expect(voted.status).toBe(200);
    expect(voted.body.voteCount).toBe(2);

    app.locals.testUser = null;
    const list = await request(app).get('/v1/requests');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items.map((item: { title: string }) => item.title)).toEqual(['B', 'A']);

    const recent = await request(app).get('/v1/requests?sort=RECENT&category=JDRAMA&q=a');
    expect(recent.body.items.map((item: { title: string }) => item.title)).toEqual(['A']);

    // Moving a request to IN_PROGRESS separates it from Open (ACTIVE) into the IN_PROGRESS tab.
    app.locals.testUser = core.users.kevin;
    await request(app).patch(`/v1/admin/requests/${a.body.request.id}`).send({ status: 'IN_PROGRESS' });
    app.locals.testUser = null;
    const openOnly = await request(app).get('/v1/requests?status=ACTIVE');
    expect(openOnly.body.items.map((item: { title: string }) => item.title)).toEqual(['B']);
    const inProgressOnly = await request(app).get('/v1/requests?status=IN_PROGRESS');
    expect(inProgressOnly.body.items.map((item: { title: string }) => item.title)).toEqual(['A']);
    app.locals.testUser = core.users.kevin;
    await request(app).patch(`/v1/admin/requests/${a.body.request.id}`).send({ status: 'OPEN' });

    app.locals.testUser = await User.findOneByOrFail({ username: 'voter' });
    const unvoted = await request(app).delete(`/v1/requests/${b.body.request.id}/vote`);
    expect(unvoted.body.voteCount).toBe(1);
    expect(a.status).toBe(201);
  });

  it('reports what the signed-in reader voted for and their allowance', async () => {
    mockFetch({});
    const created = await request(app)
      .post('/v1/requests')
      .send({ sourceUrl: 'https://www.themoviedb.org/tv/1', title: 'A' });
    const me = await request(app).get('/v1/requests/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      isPatron: false,
      openCount: 1,
      openLimit: 10,
      boosts: { perMonth: 0, used: 0, remaining: 0 },
      votedIds: [created.body.request.id],
      boostedIds: [],
      ownIds: [created.body.request.id],
    });
  });

  it('lets the requester withdraw an open request only while nobody else voted', async () => {
    mockFetch({});
    const created = await request(app)
      .post('/v1/requests')
      .send({ sourceUrl: 'https://www.themoviedb.org/tv/1', title: 'A' });
    const id = created.body.request.id;

    const other = await makeUser('other');
    app.locals.testUser = other;
    expect((await request(app).delete(`/v1/requests/${id}`)).status).toBe(404);
    await request(app).post(`/v1/requests/${id}/vote`);

    app.locals.testUser = core.users.regular;
    expect((await request(app).delete(`/v1/requests/${id}`)).status).toBe(400);

    app.locals.testUser = other;
    await request(app).delete(`/v1/requests/${id}/vote`);
    app.locals.testUser = core.users.regular;
    expect((await request(app).delete(`/v1/requests/${id}`)).status).toBe(204);
    expect(await ContentRequest.count()).toBe(0);
  });
});

describe('boosts', () => {
  beforeEach(async () => {
    await Tier.upsert(
      {
        id: 'pro',
        displayName: 'Flower',
        monthlyQuotaLimit: 30000,
        patreonTierId: '28118736',
        monthlyRequestBoosts: 2,
      },
      ['id'],
    );
  });

  it('refuses readers without an active membership', async () => {
    mockFetch({});
    const created = await request(app)
      .post('/v1/requests')
      .send({ sourceUrl: 'https://www.themoviedb.org/tv/1', title: 'A' });
    const res = await request(app).post(`/v1/requests/${created.body.request.id}/boost`);
    expect(res.status).toBe(403);
  });

  it('spends the monthly allowance of the patron tier, once per request', async () => {
    mockFetch({});
    const patron = await makeUser('patron');
    await makePatron(patron, '28118736');
    app.locals.testUser = patron;

    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const res = await request(app)
        .post('/v1/requests')
        .send({
          sourceUrl: `https://www.themoviedb.org/tv/${i}`,
          title: `D${i}`,
        });
      ids.push(res.body.request.id);
    }

    const first = await request(app).post(`/v1/requests/${ids[0]}/boost`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ voteCount: 1, boostCount: 1, score: 6 });

    expect((await request(app).post(`/v1/requests/${ids[0]}/boost`)).status).toBe(409);
    expect((await request(app).post(`/v1/requests/${ids[1]}/boost`)).status).toBe(200);
    const third = await request(app).post(`/v1/requests/${ids[2]}/boost`);
    expect(third.status).toBe(403);
    expect(third.body.detail).toMatch(/this month/);

    const me = await request(app).get('/v1/requests/me');
    expect(me.body).toMatchObject({
      isPatron: true,
      openLimit: 30,
      boosts: { perMonth: 2, used: 2, remaining: 0 },
    });

    // Last month's boosts do not count against this month.
    await ContentRequestBoost.query(`UPDATE "ContentRequestBoost" SET "created_at" = now() - interval '40 days'`);
    expect((await request(app).post(`/v1/requests/${ids[2]}/boost`)).status).toBe(200);

    // Requests already in progress cannot receive new boosts.
    const inProgressId = (
      await request(app)
        .post('/v1/requests')
        .send({ sourceUrl: 'https://www.themoviedb.org/tv/50', title: 'Already Started' })
    ).body.request.id;
    app.locals.testUser = core.users.kevin;
    await request(app).patch(`/v1/admin/requests/${inProgressId}`).send({ status: 'IN_PROGRESS' });
    app.locals.testUser = patron;
    expect((await request(app).post(`/v1/requests/${inProgressId}/boost`)).status).toBe(400);
  });
});

describe('the admin side', () => {
  async function fileRequest(title: string, sourceUrl: string): Promise<string> {
    const res = await request(app).post('/v1/requests').send({ sourceUrl, title });
    return res.body.request.id;
  }

  it('needs a reason to decline, and shows it publicly', async () => {
    mockFetch({});
    const id = await fileRequest('A', 'https://www.themoviedb.org/tv/1');
    app.locals.testUser = core.users.kevin;

    expect((await request(app).patch(`/v1/admin/requests/${id}`).send({ status: 'DECLINED' })).status).toBe(400);
    const declined = await request(app).patch(`/v1/admin/requests/${id}`).send({
      status: 'DECLINED',
      declineReason: 'No Japanese subtitles exist.',
    });
    expect(declined.status).toBe(200);
    expect(declined.body.requester).toMatchObject({
      id: core.users.regular.id,
    });

    const list = await request(app).get('/v1/requests?status=DECLINED');
    expect(list.body.items[0]).toMatchObject({
      status: 'DECLINED',
      declineReason: 'No Japanese subtitles exist.',
    });
    expect(emails).toHaveLength(0);
  });

  it('emails voters when work starts and when the title is released, once per status', async () => {
    mockFetch({});
    const id = await fileRequest('A', 'https://www.themoviedb.org/tv/1');
    const optedOut = await makeUser('quiet');
    await User.update(optedOut.id, {
      preferences: { productEmails: { enabled: true, requests: false } },
    });
    app.locals.testUser = optedOut;
    await request(app).post(`/v1/requests/${id}/vote`);

    app.locals.testUser = core.users.kevin;
    await request(app).patch(`/v1/admin/requests/${id}`).send({ status: 'IN_PROGRESS' });
    await vi.waitFor(() => expect(emails).toHaveLength(1));
    expect(emails[0]!.data).toMatchObject({
      to: core.users.regular.email,
      kind: 'request-update',
    });
    expect(emails[0]!.data.subject).toMatch(/started/);
    expect(emails[0]!.key).toMatch(/-IN_PROGRESS-/);

    await request(app).patch(`/v1/admin/requests/${id}`).send({ status: 'RELEASED' });
    await vi.waitFor(() => expect(emails).toHaveLength(2));
    expect(emails[1]!.data.subject).toMatch(/is on Nadeshiko/);

    const released = await ContentRequest.findOneByOrFail({ publicId: id });
    expect(released.releasedAt).not.toBeNull();
  });

  it('merges a duplicate, moving its votes without counting anyone twice', async () => {
    mockFetch({});
    const keep = await fileRequest('Keep', 'https://www.themoviedb.org/tv/1');
    const both = await makeUser('both');
    app.locals.testUser = both;
    await request(app).post(`/v1/requests/${keep}/vote`);
    const dup = await fileRequest('Dup', 'https://mydramalist.com/2-dup');
    app.locals.testUser = await makeUser('only-dup');
    await request(app).post(`/v1/requests/${dup}/vote`);

    app.locals.testUser = core.users.kevin;
    const merged = await request(app).post(`/v1/admin/requests/${dup}/merge`).send({ intoId: keep });
    expect(merged.status).toBe(200);
    // regular + both on keep; both + only-dup on dup → regular, both, only-dup.
    expect(merged.body.voteCount).toBe(3);
    expect(await ContentRequestVote.countBy({ request: { publicId: dup } })).toBe(0);
    const declined = await ContentRequest.findOneByOrFail({ publicId: dup });
    expect(declined.status).toBe(ContentRequestStatus.DECLINED);
    expect(declined.declineReason).toMatch(/Merged into/);
  });
});

describe('listing my own and voted requests', () => {
  it('lists own requests across all statuses and voted or boosted requests separately', async () => {
    mockFetch({});
    const other = await makeUser('other');

    // Regular files two requests: one stays open, one is declined later.
    app.locals.testUser = core.users.regular;
    const ownOpen = (
      await request(app).post('/v1/requests').send({
        sourceUrl: 'https://www.themoviedb.org/tv/101',
        title: 'Own Open',
      })
    ).body.request.id;
    const ownDeclined = (
      await request(app).post('/v1/requests').send({
        sourceUrl: 'https://www.themoviedb.org/tv/102',
        title: 'Own Declined',
      })
    ).body.request.id;

    // Another user files two requests: regular votes on the first and ignores the second.
    app.locals.testUser = other;
    const otherVoted = (
      await request(app).post('/v1/requests').send({
        sourceUrl: 'https://www.themoviedb.org/tv/103',
        title: 'Other Voted',
      })
    ).body.request.id;
    await request(app).post('/v1/requests').send({
      sourceUrl: 'https://www.themoviedb.org/tv/104',
      title: 'Other Untouched',
    });

    app.locals.testUser = core.users.regular;
    await request(app).post(`/v1/requests/${otherVoted}/vote`);

    // Admin declines ownDeclined; it should still appear in regular's own requests.
    app.locals.testUser = core.users.kevin;
    await request(app)
      .patch(`/v1/admin/requests/${ownDeclined}`)
      .send({ status: 'DECLINED', declineReason: 'No subs' });

    app.locals.testUser = core.users.regular;
    const ownRes = await request(app).get('/v1/requests/mine?scope=OWN');
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.total).toBe(2);
    expect(ownRes.body.items.map((r: { id: string }) => r.id).sort()).toEqual([ownOpen, ownDeclined].sort());

    const votedRes = await request(app).get('/v1/requests/mine?scope=VOTED');
    expect(votedRes.status).toBe(200);
    expect(votedRes.body.total).toBe(3);
    expect(votedRes.body.items.map((r: { id: string }) => r.id).sort()).toEqual(
      [ownOpen, ownDeclined, otherVoted].sort(),
    );

    const meRes = await request(app).get('/v1/requests/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.ownCount).toBe(2);
    expect(meRes.body.votedCount).toBe(3);
  });
});
