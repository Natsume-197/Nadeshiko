import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { ADMIN_OVERVIEW_CACHE } from '@app/controllers/adminDashboardController';
import { Cache } from '@lib/cache';
import {
  Announcement,
  CategoryType,
  ContentRating,
  ContentRequest,
  ContentRequestKind,
  ContentRequestStatus,
  EmailSuppression,
  Episode,
  Feedback,
  Media,
  PatreonConnection,
  Report,
  ReportReason,
  ReportSource,
  ReportStatus,
  ReportTargetType,
  Segment,
  SegmentStatus,
} from '@app/models';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';

setupTestSuite();

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

beforeEach(() => {
  app.locals.testUser = core.users.kevin;
  Cache.invalidate(ADMIN_OVERVIEW_CACHE);
});

describe('GET /v1/admin/overview', () => {
  it('returns live counts across moderation, community, feedback, users, catalogue, email, announcement and queues', async () => {
    const media = await Media.save(
      Media.create({
        publicId: 'ov-media-001',
        slug: 'overview-test-anime',
        nameJa: 'テストアニメ',
        nameRomaji: 'Tesuto Anime',
        nameEn: 'Test Anime',
        airingFormat: 'TV',
        airingStatus: 'FINISHED',
        genres: ['Drama'],
        startDate: '2025-01-01',
        seasonName: 'WINTER',
        seasonYear: 2025,
        category: CategoryType.ANIME,
        episodeCount: 12,
        segmentCount: 350,
        version: '1.0',
        storageBasePath: 'media/ov-media-001',
      }),
    );

    await Episode.save(
      Episode.create({
        mediaId: media.id,
        episodeNumber: 1,
        titleEn: 'Episode 1',
      }),
    );

    const segment = await Segment.save(
      Segment.create({
        publicId: 'ov-seg-00001',
        uuid: '00000000-0000-4000-8000-000000000001',
        mediaId: media.id,
        episode: 1,
        status: SegmentStatus.ACTIVE,
        position: 1,
        startTimeMs: 0,
        endTimeMs: 2000,
        contentJa: 'テストです',
        contentEn: 'It is a test',
        contentEs: 'Es una prueba',
        contentRating: ContentRating.SAFE,
        ratingAnalysis: { scores: { safe: 1 }, tags: {} },
        hashedId: 'ov-hash-00001',
        storageBasePath: 'media/ov-media-001',
      }),
    );

    await Report.save([
      Report.create({
        source: ReportSource.USER,
        targetType: ReportTargetType.SEGMENT,
        targetMediaId: media.id,
        targetSegmentId: segment.id,
        reason: ReportReason.WRONG_TRANSLATION,
        status: ReportStatus.OPEN,
        userId: core.users.regular.id,
      }),
      Report.create({
        source: ReportSource.USER,
        targetType: ReportTargetType.SEGMENT,
        targetMediaId: media.id,
        targetSegmentId: segment.id,
        reason: ReportReason.WRONG_TIMING,
        status: ReportStatus.PROCESSING,
        userId: core.users.regular.id,
      }),
      Report.create({
        source: ReportSource.USER,
        targetType: ReportTargetType.SEGMENT,
        targetMediaId: media.id,
        targetSegmentId: segment.id,
        reason: ReportReason.OTHER,
        status: ReportStatus.FIXED,
        userId: core.users.regular.id,
      }),
    ]);

    await ContentRequest.save([
      ContentRequest.create({
        category: CategoryType.ANIME,
        kind: ContentRequestKind.NEW,
        status: ContentRequestStatus.OPEN,
        title: 'Boosted Open Request',
        sourceUrl: 'https://anilist.co/anime/1',
        voteCount: 3,
        boostCount: 1,
        requesterUserId: core.users.regular.id,
      }),
      ContentRequest.create({
        category: CategoryType.JDRAMA,
        kind: ContentRequestKind.NEW,
        status: ContentRequestStatus.PLANNED,
        title: 'Planned Drama',
        sourceUrl: 'https://www.themoviedb.org/tv/1',
        voteCount: 2,
        boostCount: 0,
        requesterUserId: core.users.regular.id,
      }),
      ContentRequest.create({
        category: CategoryType.YOUTUBE,
        kind: ContentRequestKind.UPDATE,
        status: ContentRequestStatus.IN_PROGRESS,
        title: 'In Progress Channel',
        sourceUrl: 'https://www.youtube.com/@example',
        voteCount: 1,
        boostCount: 0,
        requesterUserId: core.users.regular.id,
      }),
      ContentRequest.create({
        category: CategoryType.ANIME,
        kind: ContentRequestKind.NEW,
        status: ContentRequestStatus.RELEASED,
        title: 'Released Show',
        sourceUrl: 'https://anilist.co/anime/2',
        voteCount: 5,
        boostCount: 1,
        requesterUserId: core.users.regular.id,
      }),
    ]);

    await Feedback.save([
      Feedback.create({ body: 'Unhandled note', handledAt: null }),
      Feedback.create({ body: 'Handled note', handledAt: new Date() }),
    ]);

    await PatreonConnection.save(
      PatreonConnection.create({
        userId: core.users.regular.id,
        patreonUserId: 'patreon-ov-1',
        accessTokenCiphertext: 'enc-a',
        refreshTokenCiphertext: 'enc-r',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        patronStatus: 'active_patron',
        entitledAmountCents: 500,
        entitledTierIds: ['tier-flower'],
        membershipCheckedAt: new Date(),
      }),
    );

    await EmailSuppression.save(
      EmailSuppression.create({
        address: 'bounced-overview@example.com',
        cause: 'hard_bounce',
        reason: 'mailbox unavailable',
        suppressedAt: new Date(),
      }),
    );

    await Announcement.save(
      Announcement.create({
        message: 'Maintenance tonight',
        type: 'MAINTENANCE',
        active: true,
      }),
    );

    const res = await request(app).get('/v1/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.reports).toEqual({ open: 1, processing: 1 });
    expect(res.body.requests).toEqual({ open: 1, planned: 1, inProgress: 1, boostedOpen: 1 });
    expect(res.body.feedback).toEqual({ unhandled: 1, total: 2 });
    expect(res.body.users.total).toBeGreaterThanOrEqual(5);
    expect(res.body.users.activePatrons).toBe(1);
    expect(res.body.catalogue).toEqual({ media: 1, episodes: 1, segments: 1 });
    expect(res.body.email).toEqual({ suppressed: 1 });
    expect(res.body.announcement).toEqual({ active: true });
    expect(typeof res.body.queues.queued).toBe('number');
    expect(typeof res.body.queues.active).toBe('number');
    expect(typeof res.body.queues.failed).toBe('number');
    expect(Number.isNaN(Date.parse(res.body.generatedAt))).toBe(false);
  });

  it('serves cached overview until cleared', async () => {
    const first = await request(app).get('/v1/admin/overview');
    expect(first.status).toBe(200);
    expect(first.body.feedback.unhandled).toBe(0);

    await Feedback.save(Feedback.create({ body: 'New after cache', handledAt: null }));

    const cached = await request(app).get('/v1/admin/overview');
    expect(cached.status).toBe(200);
    expect(cached.body.generatedAt).toBe(first.body.generatedAt);
    expect(cached.body.feedback.unhandled).toBe(0);

    Cache.invalidate(ADMIN_OVERVIEW_CACHE);
    const fresh = await request(app).get('/v1/admin/overview');
    expect(fresh.status).toBe(200);
    expect(fresh.body.feedback.unhandled).toBe(1);
  });
});
