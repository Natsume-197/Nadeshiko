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
  REQUEST_BOOST_WEIGHT,
  UserRoleType,
} from '@app/models';
import type { User } from '@app/models';
import { AccessDeniedError, DuplicateKeyError, InvalidRequestError, NotFoundError } from '@app/errors';
import {
  DAILY_REQUEST_LIMIT,
  OPEN_REQUEST_LIMIT,
  monthStart,
  openRequestCount,
  openRequestLimit,
  patronBenefits,
} from './allowance';
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
    score: request.score ?? request.voteCount + request.boostCount * REQUEST_BOOST_WEIGHT,
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

const INVALID_LINK_MESSAGE =
  'Use a link to AniList or MyAnimeList (anime), TMDB or MyDramaList (dramas), Audible or Amazon (audiobooks) or YouTube.';

/** What Nadeshiko already has of a requested title. `complete` only when the source gives a final episode count. */
export interface ExistingTitle {
  media: Media;
  episodes: number;
  totalEpisodes: number | null;
  complete: boolean;
}

interface ResolvedRequestLink {
  link: NonNullable<ReturnType<typeof parseRequestLink>>;
  metadata: Awaited<ReturnType<typeof lookupRequestMetadata>>;
  identity: { source: ExternalSourceType; id: string } | null;
  existing: ExistingTitle | null;
}

/** Parse a request link, read its metadata and find the published title it names, if any. */
async function resolveRequestLink(sourceUrl: string, hintTitle?: string): Promise<ResolvedRequestLink> {
  const link = parseRequestLink(sourceUrl);
  if (!link) throw new InvalidRequestError(INVALID_LINK_MESSAGE);

  const metadata = await lookupRequestMetadata(link, hintTitle);
  const resolvedId = link.externalId ?? metadata.externalId ?? null;
  // The identity a request is matched on: the same pair `MediaExternalId` stores for published media.
  const identity = resolvedId && link.externalSource ? { source: link.externalSource, id: resolvedId } : null;
  const external = identity
    ? await MediaExternalId.findOne({
        where: { source: identity.source, externalId: identity.id },
        relations: { media: true },
      })
    : null;

  return { link, metadata, identity, existing: external?.media ? existingTitle(external.media, metadata) : null };
}

/**
 * Complete only when the source says the entry finished airing and we hold at least its episode count, so an airing
 * show, a YouTube channel or an audiobook never reads as complete.
 */
export function existingTitle(
  media: Media,
  metadata: { totalEpisodes?: number | null; finished?: boolean },
): ExistingTitle {
  const totalEpisodes = metadata.totalEpisodes ?? null;
  const complete =
    media.category === CategoryType.ANIME &&
    metadata.finished === true &&
    totalEpisodes !== null &&
    media.episodeCount >= totalEpisodes;
  return { media, episodes: media.episodeCount, totalEpisodes, complete };
}

export interface RequestPreview {
  category: CategoryType;
  title: string | null;
  coverUrl: string | null;
  existing: {
    media: { id: string; slug: string; name: string };
    episodes: number;
    totalEpisodes: number | null;
    complete: boolean;
  } | null;
  /** The active request a new one would vote on instead. */
  activeRequestId: string | null;
}

/** What filing this link would do, so the form can say it before the reader sends it. */
export async function previewRequest(input: { sourceUrl: string; title?: string }): Promise<RequestPreview> {
  const { link, metadata, identity, existing } = await resolveRequestLink(input.sourceUrl, input.title);
  const active = identity
    ? await ContentRequest.findOne({
        where: { externalSource: identity.source, externalId: identity.id, status: In([...ACTIVE_REQUEST_STATUSES]) },
        select: { id: true, publicId: true },
      })
    : null;

  return {
    category: link.category,
    title: metadata.title ?? input.title?.trim() ?? null,
    coverUrl: metadata.coverUrl,
    existing: existing
      ? {
          media: {
            id: existing.media.publicId,
            slug: existing.media.slug,
            name: existing.media.nameEn || existing.media.nameRomaji,
          },
          episodes: existing.episodes,
          totalEpisodes: existing.totalEpisodes,
          complete: existing.complete,
        }
      : null,
    activeRequestId: active?.publicId ?? null,
  };
}

/**
 * File a request, or vote on the one already open for the same title. A request for a title that is already on
 * Nadeshiko becomes an UPDATE request for it (more episodes, a new season, new videos): it must say what is missing,
 * and a title we already hold in full cannot be requested.
 */
export async function createRequest(
  user: Pick<User, 'id' | 'role'>,
  input: CreateRequestInput,
): Promise<{ request: ContentRequest; outcome: CreateRequestOutcome }> {
  // The allowance depends only on the account, so read it while the external metadata loads.
  const [{ link, metadata, identity, existing }, benefits] = await Promise.all([
    resolveRequestLink(input.sourceUrl, input.title),
    patronBenefits(user),
  ]);
  const title = (metadata.title ?? input.title?.trim() ?? '').slice(0, 180);
  if (!title) throw new InvalidRequestError('We could not read a title from that link. Add one.');
  const note = input.note?.trim() ?? '';

  const openLimit = openRequestLimit(user, benefits.isPatron);

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

    // Checked after the vote path, so backing an open update request never needs a note.
    if (existing?.complete) {
      throw new InvalidRequestError(
        `${existing.media.nameEn || existing.media.nameRomaji} is already complete on Nadeshiko.`,
      );
    }
    if (existing && !note) {
      throw new InvalidRequestError('This title is already on Nadeshiko. Say what is missing.');
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
      kind: existing ? ContentRequestKind.UPDATE : ContentRequestKind.NEW,
      status: ContentRequestStatus.OPEN,
      title,
      note,
      sourceUrl: input.sourceUrl.trim(),
      externalSource: identity?.source ?? null,
      externalId: identity?.id ?? null,
      coverUrl: metadata.coverUrl,
      mediaId: existing?.media.id ?? null,
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
  if (request.status === ContentRequestStatus.IN_PROGRESS) {
    throw new InvalidRequestError('This request is already in progress.');
  }
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
  /** False moves the request quietly: no bell entry, no email. */
  notify?: boolean;
}

/**
 * Change a request; moving it to IN_PROGRESS or RELEASED tells everyone who voted for or boosted it, unless the admin
 * chose to move it quietly.
 */
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
  if (saved.status !== previous && patch.notify !== false) void notifyRequestSubscribers(saved, previous);
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
