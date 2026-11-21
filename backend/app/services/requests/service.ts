import { In, MoreThan, MoreThanOrEqual, Not, type EntityManager } from 'typeorm';
import {
  ACTIVE_REQUEST_STATUSES,
  CategoryType,
  ContentRequest,
  ContentRequestBoost,
  ContentRequestKind,
  ContentRequestStatus,
  ContentRequestVote,
  ExternalSourceType,
  Media,
  MediaExternalId,
  UserRoleType,
} from '@app/models';
import type { User } from '@app/models';
import { AccessDeniedError, DuplicateKeyError, InvalidRequestError, NotFoundError } from '@app/errors';
import { logger } from '@config/log';
import { DAILY_REQUEST_LIMIT, OPEN_REQUEST_LIMIT, monthStart, openRequestCount, patronBenefits } from './allowance';
import { parseRequestLink } from './links';
import { lookupRequestMetadata } from './metadata';
import { notifyRequestSubscribers } from './notifications';

/** Advisory-lock namespace for per-account request writes (boost allowance, open limit). */
const LOCK_NAMESPACE = 49_001;

const isActive = (status: ContentRequestStatus) => ACTIVE_REQUEST_STATUSES.includes(status);

export interface ContentRequestJSON {
  id: string;
  category: CategoryType;
  kind: ContentRequestKind;
  status: ContentRequestStatus;
  title: string;
  note: string;
  sourceUrl: string;
  coverUrl: string | null;
  declineReason: string | null;
  voteCount: number;
  boostCount: number;
  score: number;
  media: { id: string; slug: string; name: string } | null;
  createdAt: string;
  releasedAt: string | null;
}

export interface AdminContentRequestJSON extends ContentRequestJSON {
  externalSource: ExternalSourceType | null;
  externalId: string | null;
  requester: { id: number; username: string } | null;
  possibleDuplicateOf: { id: string; title: string; status: ContentRequestStatus } | null;
}

export function toRequestJSON(request: ContentRequest): ContentRequestJSON {
  return {
    id: request.publicId,
    category: request.category,
    kind: request.kind,
    status: request.status,
    title: request.title,
    note: request.note,
    sourceUrl: request.sourceUrl,
    coverUrl: request.coverUrl,
    declineReason: request.status === ContentRequestStatus.DECLINED ? request.declineReason : null,
    voteCount: request.voteCount,
    boostCount: request.boostCount,
    score: request.score ?? request.voteCount + request.boostCount * 5,
    media: request.media
      ? { id: request.media.publicId, slug: request.media.slug, name: request.media.nameEn || request.media.nameRomaji }
      : null,
    createdAt: request.createdAt.toISOString(),
    releasedAt: request.releasedAt ? request.releasedAt.toISOString() : null,
  };
}

export function toAdminRequestJSON(request: ContentRequest): AdminContentRequestJSON {
  return {
    ...toRequestJSON(request),
    declineReason: request.declineReason,
    externalSource: request.externalSource,
    externalId: request.externalId,
    requester: request.requester ? { id: request.requester.id, username: request.requester.username } : null,
    possibleDuplicateOf: request.possibleDuplicateOf
      ? {
          id: request.possibleDuplicateOf.publicId,
          title: request.possibleDuplicateOf.title,
          status: request.possibleDuplicateOf.status,
        }
      : null,
  };
}

/** Reload with the relations the JSON shapes read. */
export async function loadRequest(
  where: { id: number } | { publicId: string },
  admin = false,
): Promise<ContentRequest> {
  const request = await ContentRequest.findOne({
    where,
    relations: admin ? { media: true, requester: true, possibleDuplicateOf: true } : { media: true },
  });
  if (!request) throw new NotFoundError('Request not found');
  return request;
}

async function lockAccount(manager: EntityManager, userId: number): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK_NAMESPACE, userId]);
}

/** Recount a request's votes and boosts from their tables; the counters on the row are only a sort key. */
async function recount(manager: EntityManager, requestId: number): Promise<void> {
  await manager.query(
    `UPDATE "ContentRequest" r
        SET "vote_count" = (SELECT count(*) FROM "ContentRequestVote" v WHERE v."request_id" = r."id"),
            "boost_count" = (SELECT count(*) FROM "ContentRequestBoost" b WHERE b."request_id" = r."id"),
            "updated_at" = now()
      WHERE r."id" = $1`,
    [requestId],
  );
}

async function addVote(manager: EntityManager, requestId: number, userId: number): Promise<boolean> {
  const inserted: unknown[] = await manager.query(
    `INSERT INTO "ContentRequestVote" ("request_id", "user_id") VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING "request_id"`,
    [requestId, userId],
  );
  if (inserted.length) await recount(manager, requestId);
  return inserted.length > 0;
}

export interface CreateRequestInput {
  sourceUrl: string;
  title?: string;
  note?: string;
}

export type CreateRequestOutcome = 'created' | 'voted' | 'already_voted';

/**
 * File a request, or vote on the one already open for the same title. A NEW request for a title that is already on
 * Nadeshiko becomes an UPDATE request for it (more episodes, a new season, new videos).
 */
export async function createRequest(
  user: Pick<User, 'id' | 'role'>,
  input: CreateRequestInput,
): Promise<{ request: ContentRequest; outcome: CreateRequestOutcome }> {
  const link = parseRequestLink(input.sourceUrl);
  if (!link) {
    throw new InvalidRequestError(
      'Use a link to AniList (anime), TMDB or MyDramaList (dramas), Audible or Amazon (audiobooks) or YouTube.',
    );
  }

  const metadata = await lookupRequestMetadata(link);
  const resolvedId = link.externalId ?? metadata.externalId ?? null;
  // The identity a request is matched on: the same pair `MediaExternalId` stores for published media.
  const identity = resolvedId && link.externalSource ? { source: link.externalSource, id: resolvedId } : null;
  const title = (metadata.title ?? input.title?.trim() ?? '').slice(0, 180);
  if (!title) throw new InvalidRequestError('We could not read a title from that link. Add one.');

  const existingMedia = identity
    ? await MediaExternalId.findOne({
        where: { source: identity.source, externalId: identity.id },
        relations: { media: true },
      })
    : null;

  const benefits = await patronBenefits(user);
  const openLimit =
    user.role === UserRoleType.ADMIN ? null : benefits.isPatron ? OPEN_REQUEST_LIMIT.patron : OPEN_REQUEST_LIMIT.free;

  const result = await ContentRequest.getRepository().manager.transaction(async (manager) => {
    await lockAccount(manager, user.id);

    if (identity) {
      const active = await manager.findOne(ContentRequest, {
        where: { externalSource: identity.source, externalId: identity.id, status: In([...ACTIVE_REQUEST_STATUSES]) },
      });
      if (active) {
        const voted = await addVote(manager, active.id, user.id);
        return { id: active.id, outcome: (voted ? 'voted' : 'already_voted') as CreateRequestOutcome };
      }
    }

    if (user.role !== UserRoleType.ADMIN) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const today = await manager.countBy(ContentRequest, { requesterUserId: user.id, createdAt: MoreThan(since) });
      if (today >= DAILY_REQUEST_LIMIT) {
        throw new AccessDeniedError(`You can file ${DAILY_REQUEST_LIMIT} requests a day. Try again tomorrow.`);
      }
    }
    if (openLimit !== null && (await openRequestCount(user.id)) >= openLimit) {
      throw new AccessDeniedError(
        benefits.isPatron
          ? `You have ${openLimit} open requests, the most you can have at once.`
          : `You have ${openLimit} open requests, the most you can have at once. Patrons can have ${OPEN_REQUEST_LIMIT.patron}.`,
      );
    }

    // Same title, different (or no) link: flag it for an admin instead of guessing.
    const lookalike = await manager
      .createQueryBuilder(ContentRequest, 'r')
      .where('lower(r.title) = lower(:title)', { title })
      .andWhere('r.status IN (:...statuses)', { statuses: ACTIVE_REQUEST_STATUSES })
      .andWhere('r.category = :category', { category: link.category })
      .orderBy('r.id', 'ASC')
      .getOne();

    const request = manager.create(ContentRequest, {
      category: link.category,
      kind: existingMedia ? ContentRequestKind.UPDATE : ContentRequestKind.NEW,
      status: ContentRequestStatus.OPEN,
      title,
      note: input.note?.trim() ?? '',
      sourceUrl: input.sourceUrl.trim(),
      externalSource: identity?.source ?? null,
      externalId: identity?.id ?? null,
      coverUrl: metadata.coverUrl,
      mediaId: existingMedia?.mediaId ?? null,
      possibleDuplicateOfId: lookalike?.id ?? null,
      requesterUserId: user.id,
    });
    await manager.save(request);
    await addVote(manager, request.id, user.id);
    return { id: request.id, outcome: 'created' as CreateRequestOutcome };
  });

  return { request: await loadRequest({ id: result.id }), outcome: result.outcome };
}

async function activeRequest(publicId: string): Promise<ContentRequest> {
  const request = await ContentRequest.findOneBy({ publicId });
  if (!request) throw new NotFoundError('Request not found');
  if (!isActive(request.status)) throw new InvalidRequestError('This request is closed.');
  return request;
}

export async function voteOnRequest(userId: number, publicId: string): Promise<ContentRequest> {
  const request = await activeRequest(publicId);
  await ContentRequest.getRepository().manager.transaction((manager) => addVote(manager, request.id, userId));
  return loadRequest({ id: request.id });
}

export async function removeVote(userId: number, publicId: string): Promise<ContentRequest> {
  const request = await activeRequest(publicId);
  await ContentRequest.getRepository().manager.transaction(async (manager) => {
    const result = await manager.delete(ContentRequestVote, { requestId: request.id, userId });
    if (result.affected) await recount(manager, request.id);
  });
  return loadRequest({ id: request.id });
}

/** Spend one of this month's boosts on a request: permanent, once per request. */
export async function boostRequest(user: Pick<User, 'id' | 'role'>, publicId: string): Promise<ContentRequest> {
  const request = await activeRequest(publicId);
  const { isPatron, boosts } = await patronBenefits(user);
  if (!isPatron) throw new AccessDeniedError('Boosts are for Nadeshiko patrons. Link an active Patreon membership.');

  await ContentRequest.getRepository().manager.transaction(async (manager) => {
    await lockAccount(manager, user.id);
    if (await manager.existsBy(ContentRequestBoost, { requestId: request.id, userId: user.id })) {
      throw new DuplicateKeyError('You have already boosted this request.');
    }
    const used = await manager.countBy(ContentRequestBoost, {
      userId: user.id,
      createdAt: MoreThanOrEqual(monthStart()),
    });
    if (used >= boosts) {
      throw new AccessDeniedError(
        boosts === 0 ? 'Your Patreon tier has no boosts.' : 'You have used all your boosts this month.',
      );
    }
    await manager.insert(ContentRequestBoost, { requestId: request.id, userId: user.id });
    await recount(manager, request.id);
  });
  return loadRequest({ id: request.id });
}

/** The requester may take back an open request nobody else has voted for or boosted. */
export async function withdrawRequest(userId: number, publicId: string): Promise<void> {
  const request = await ContentRequest.findOneBy({ publicId });
  if (!request || request.requesterUserId !== userId) throw new NotFoundError('Request not found');
  if (request.status !== ContentRequestStatus.OPEN) {
    throw new InvalidRequestError('Only open requests can be withdrawn.');
  }
  const others = await ContentRequestVote.countBy({ requestId: request.id, userId: Not(userId) });
  if (others > 0 || request.boostCount > 0) {
    throw new InvalidRequestError('Others have voted for this request, so it stays.');
  }
  await request.remove();
}

export interface AdminRequestPatch {
  status?: ContentRequestStatus;
  title?: string;
  note?: string;
  category?: CategoryType;
  kind?: ContentRequestKind;
  coverUrl?: string | null;
  declineReason?: string | null;
  mediaId?: string | null;
  dismissDuplicate?: boolean;
}

/** Change a request; moving it to IN_PROGRESS or RELEASED tells everyone who voted for or boosted it. */
export async function updateRequestAsAdmin(publicId: string, patch: AdminRequestPatch): Promise<ContentRequest> {
  const request = await ContentRequest.findOneBy({ publicId });
  if (!request) throw new NotFoundError('Request not found');
  const previous = request.status;

  if (patch.title !== undefined) request.title = patch.title.trim().slice(0, 180);
  if (patch.note !== undefined) request.note = patch.note;
  if (patch.category !== undefined) request.category = patch.category;
  if (patch.kind !== undefined) request.kind = patch.kind;
  if (patch.coverUrl !== undefined) request.coverUrl = patch.coverUrl;
  if (patch.declineReason !== undefined) request.declineReason = patch.declineReason?.trim() || null;
  if (patch.dismissDuplicate) request.possibleDuplicateOfId = null;
  if (patch.mediaId !== undefined) {
    if (patch.mediaId === null) request.mediaId = null;
    else {
      const media = await Media.findOneBy({ publicId: patch.mediaId });
      if (!media) throw new InvalidRequestError('No media has that id.');
      request.mediaId = media.id;
    }
  }
  if (patch.status !== undefined && patch.status !== previous) {
    if (patch.status === ContentRequestStatus.DECLINED && !request.declineReason) {
      throw new InvalidRequestError('Say why the request is declined: readers see the reason.');
    }
    request.status = patch.status;
    request.releasedAt = patch.status === ContentRequestStatus.RELEASED ? new Date() : null;
    if (
      patch.status === ContentRequestStatus.RELEASED &&
      !request.mediaId &&
      request.externalSource &&
      request.externalId
    ) {
      const match = await MediaExternalId.findOneBy({
        source: request.externalSource,
        externalId: request.externalId,
      });
      request.mediaId = match?.mediaId ?? null;
    }
  }

  try {
    await request.save();
  } catch (err) {
    // Reopening a request whose title already has another active request trips the identity index.
    if ((err as { code?: string }).code === '23505') {
      throw new DuplicateKeyError('Another active request already asks for this title. Merge them instead.');
    }
    throw err;
  }

  const saved = await loadRequest({ id: request.id }, true);
  if (saved.status !== previous) void notifyRequestSubscribers(saved, previous);
  return saved;
}

/**
 * Merge a duplicate into the request it duplicates: its voters and boosters move over (no one counts twice), and the
 * duplicate is declined with a pointer to the other.
 */
export async function mergeRequests(duplicatePublicId: string, intoPublicId: string): Promise<ContentRequest> {
  if (duplicatePublicId === intoPublicId) throw new InvalidRequestError('A request cannot be merged into itself.');
  const [duplicate, into] = await Promise.all([
    ContentRequest.findOneBy({ publicId: duplicatePublicId }),
    ContentRequest.findOneBy({ publicId: intoPublicId }),
  ]);
  if (!duplicate || !into) throw new NotFoundError('Request not found');
  if (!isActive(into.status)) throw new InvalidRequestError('Merge into a request that is still open.');

  await ContentRequest.getRepository().manager.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO "ContentRequestVote" ("request_id", "user_id", "created_at")
       SELECT $2, "user_id", "created_at" FROM "ContentRequestVote" WHERE "request_id" = $1
       ON CONFLICT DO NOTHING`,
      [duplicate.id, into.id],
    );
    await manager.query(
      `INSERT INTO "ContentRequestBoost" ("request_id", "user_id", "created_at")
       SELECT $2, "user_id", "created_at" FROM "ContentRequestBoost" WHERE "request_id" = $1
       ON CONFLICT DO NOTHING`,
      [duplicate.id, into.id],
    );
    await manager.delete(ContentRequestVote, { requestId: duplicate.id });
    await manager.delete(ContentRequestBoost, { requestId: duplicate.id });
    await manager.update(ContentRequest, duplicate.id, {
      status: ContentRequestStatus.DECLINED,
      declineReason: `Merged into “${into.title}”.`,
      possibleDuplicateOfId: into.id,
    });
    await recount(manager, duplicate.id);
    await recount(manager, into.id);
  });
  return loadRequest({ id: into.id }, true);
}

/**
 * Mark the open NEW requests a newly created media answers as in progress, matched by its external ids, and link them
 * to it. Ingest creates the media before uploading its sentences, so this is "work started", not "released": an admin
 * releases the request once production is checked. Failures are logged and never fail the ingest.
 */
export async function startRequestsForMedia(mediaId: number): Promise<number> {
  try {
    const ids = await MediaExternalId.findBy({ mediaId });
    if (!ids.length) return 0;
    const requests = await ContentRequest.find({
      where: ids.map((id) => ({
        externalSource: id.source,
        externalId: id.externalId,
        kind: ContentRequestKind.NEW,
        status: In([ContentRequestStatus.OPEN, ContentRequestStatus.PLANNED]),
      })),
    });
    for (const request of requests) {
      const previous = request.status;
      request.status = ContentRequestStatus.IN_PROGRESS;
      request.mediaId = mediaId;
      await request.save();
      void notifyRequestSubscribers(await loadRequest({ id: request.id }), previous);
    }
    return requests.length;
  } catch (err) {
    logger.error({ err, mediaId }, 'Could not start the content requests for a new media');
    return 0;
  }
}
