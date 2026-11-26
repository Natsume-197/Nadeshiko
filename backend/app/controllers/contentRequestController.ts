import { In } from 'typeorm';
import type {
  BoostContentRequest,
  CreateContentRequest,
  GetContentRequestAllowance,
  ListContentRequests,
  ListMyContentRequests,
  PreviewContentRequest,
  UnvoteContentRequest,
  VoteContentRequest,
  WithdrawContentRequest,
} from 'generated/routes/requests';
import type {
  ListAdminContentRequests,
  MergeAdminContentRequest,
  UpdateAdminContentRequest,
} from 'generated/routes/admin';
import {
  ACTIVE_REQUEST_STATUSES,
  CategoryType,
  ContentRequest,
  ContentRequestBoost,
  ContentRequestKind,
  ContentRequestStatus,
  ContentRequestVote,
} from '@app/models';
import { assertUser } from '@app/middleware/authentication';
import { escapeLikePattern } from '@app/controllers/mediaController';
import { requestAllowance } from '@app/services/requests/allowance';
import {
  boostRequest,
  createRequest,
  mergeRequests,
  previewRequest,
  removeVote,
  toAdminRequestJSON,
  toRequestJSON,
  updateRequestAsAdmin,
  voteOnRequest,
  withdrawRequest,
} from '@app/services/requests/service';

/** Statuses shown in the Open tab (every active request not yet actively in progress). */
const OPEN_TAB_STATUSES: readonly ContentRequestStatus[] = [ContentRequestStatus.OPEN, ContentRequestStatus.PLANNED];

/** `%` and `_` typed by a reader are text, not wildcards. */
function titleLike(q: string): string {
  return `%${escapeLikePattern(q.trim())}%`;
}

function applyRequestFilters(
  qb: ReturnType<typeof ContentRequest.createQueryBuilder>,
  filters: { status?: string; category?: string; q?: string },
): void {
  if (filters.status === 'ACTIVE') qb.andWhere('r.status IN (:...statuses)', { statuses: OPEN_TAB_STATUSES });
  else if (filters.status && filters.status !== 'ALL') qb.andWhere('r.status = :status', { status: filters.status });
  if (filters.category) qb.andWhere('r.category = :category', { category: filters.category });
  if (filters.q?.trim()) qb.andWhere('r.title ILIKE :q', { q: titleLike(filters.q) });
}

export const listContentRequests: ListContentRequests = async ({ query }, respond) => {
  const take = query.take ?? 24;
  const page = query.page ?? 1;
  const status = query.status ?? 'ACTIVE';

  const qb = ContentRequest.createQueryBuilder('r').leftJoinAndSelect('r.media', 'media').where('1 = 1');
  applyRequestFilters(qb, { status, category: query.category, q: query.q });

  if (status === 'RELEASED') qb.orderBy('r.releasedAt', 'DESC', 'NULLS LAST');
  else if ((query.sort ?? 'TOP') === 'TOP') qb.orderBy('r.score', 'DESC').addOrderBy('r.createdAt', 'ASC');
  else qb.orderBy('r.createdAt', 'DESC');
  qb.addOrderBy('r.id', 'DESC');

  const [items, total] = await qb
    .skip((page - 1) * take)
    .take(take)
    .getManyAndCount();
  return respond.with200().body({ items: items.map(toRequestJSON), total });
};

/** Filter a `ContentRequest` query (`r`) to requests the user voted for or boosted. */
function applyVotedOrBoostedFilter(
  qb: ReturnType<typeof ContentRequest.createQueryBuilder>,
  userId: number,
): ReturnType<typeof ContentRequest.createQueryBuilder> {
  const hasVote = qb
    .subQuery()
    .select('1')
    .from(ContentRequestVote, 'v')
    .where('v.requestId = r.id AND v.userId = :userId')
    .getQuery();
  const hasBoost = qb
    .subQuery()
    .select('1')
    .from(ContentRequestBoost, 'b')
    .where('b.requestId = r.id AND b.userId = :userId')
    .getQuery();
  return qb.where(`(EXISTS (${hasVote}) OR EXISTS (${hasBoost}))`, { userId });
}

export const listMyContentRequests: ListMyContentRequests = async ({ query }, respond, req) => {
  const user = assertUser(req);
  const take = query.take ?? 24;
  const page = query.page ?? 1;
  const scope = query.scope ?? 'OWN';

  const qb = ContentRequest.createQueryBuilder('r').leftJoinAndSelect('r.media', 'media');
  if (scope === 'OWN') qb.where('r.requesterUserId = :userId', { userId: user.id });
  else applyVotedOrBoostedFilter(qb, user.id);

  applyRequestFilters(qb, { status: query.status ?? 'ALL', category: query.category, q: query.q });

  if ((query.sort ?? 'RECENT') === 'TOP') qb.orderBy('r.score', 'DESC').addOrderBy('r.createdAt', 'DESC');
  else qb.orderBy('r.createdAt', 'DESC');
  qb.addOrderBy('r.id', 'DESC');

  const [items, total] = await qb
    .skip((page - 1) * take)
    .take(take)
    .getManyAndCount();
  return respond.with200().body({ items: items.map(toRequestJSON), total });
};

export const createContentRequest: CreateContentRequest = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const { request, outcome } = await createRequest(user, body);
  if (outcome === 'created') return respond.with201().body({ request: toRequestJSON(request), outcome });
  return respond.with200().body({ request: toRequestJSON(request), outcome });
};

export const previewContentRequest: PreviewContentRequest = async ({ body }, respond, req) => {
  assertUser(req);
  return respond.with200().body(await previewRequest(body));
};

export const getContentRequestAllowance: GetContentRequestAllowance = async (_params, respond, req) => {
  const user = assertUser(req);
  const active = In([...ACTIVE_REQUEST_STATUSES]);
  const [allowance, votes, boosts, own, ownCount, votedCount] = await Promise.all([
    requestAllowance(user),
    ContentRequestVote.find({
      where: { userId: user.id, request: { status: active } },
      relations: { request: true },
      select: { requestId: true, request: { id: true, publicId: true } },
    }),
    ContentRequestBoost.find({
      where: { userId: user.id, request: { status: active } },
      relations: { request: true },
      select: { requestId: true, request: { id: true, publicId: true } },
    }),
    ContentRequest.find({ where: { requesterUserId: user.id, status: active }, select: { id: true, publicId: true } }),
    ContentRequest.countBy({ requesterUserId: user.id }),
    applyVotedOrBoostedFilter(ContentRequest.createQueryBuilder('r'), user.id).getCount(),
  ]);
  return respond.with200().body({
    ...allowance,
    ownCount,
    votedCount,
    votedIds: votes.flatMap((vote) => (vote.request ? [vote.request.publicId] : [])),
    boostedIds: boosts.flatMap((boost) => (boost.request ? [boost.request.publicId] : [])),
    ownIds: own.map((request) => request.publicId),
  });
};

export const voteContentRequest: VoteContentRequest = async ({ params }, respond, req) => {
  const user = assertUser(req);
  return respond.with200().body(toRequestJSON(await voteOnRequest(user.id, params.requestId)));
};

export const unvoteContentRequest: UnvoteContentRequest = async ({ params }, respond, req) => {
  const user = assertUser(req);
  return respond.with200().body(toRequestJSON(await removeVote(user.id, params.requestId)));
};

export const boostContentRequest: BoostContentRequest = async ({ params }, respond, req) => {
  const user = assertUser(req);
  return respond.with200().body(toRequestJSON(await boostRequest(user, params.requestId)));
};

export const withdrawContentRequest: WithdrawContentRequest = async ({ params }, respond, req) => {
  const user = assertUser(req);
  await withdrawRequest(user.id, params.requestId);
  return respond.with204();
};

export const listAdminContentRequests: ListAdminContentRequests = async ({ query }, respond) => {
  const take = query.take ?? 50;
  const page = query.page ?? 1;
  const qb = ContentRequest.createQueryBuilder('r')
    .leftJoinAndSelect('r.media', 'media')
    .leftJoinAndSelect('r.requester', 'requester')
    .leftJoinAndSelect('r.possibleDuplicateOf', 'duplicateOf')
    .where('1 = 1');
  applyRequestFilters(qb, { status: query.status, category: query.category, q: query.q });
  if (query.flagged) qb.andWhere('r.possibleDuplicateOfId IS NOT NULL');
  const [items, total] = await qb
    .orderBy('r.score', 'DESC')
    .addOrderBy('r.createdAt', 'ASC')
    .skip((page - 1) * take)
    .take(take)
    .getManyAndCount();
  return respond.with200().body({ items: items.map(toAdminRequestJSON), total });
};

export const updateAdminContentRequest: UpdateAdminContentRequest = async ({ params, body }, respond) => {
  const request = await updateRequestAsAdmin(params.requestId, {
    ...body,
    status: body.status as ContentRequestStatus | undefined,
    category: body.category as CategoryType | undefined,
    kind: body.kind as ContentRequestKind | undefined,
  });
  return respond.with200().body(toAdminRequestJSON(request));
};

export const mergeAdminContentRequest: MergeAdminContentRequest = async ({ params, body }, respond) => {
  return respond.with200().body(toAdminRequestJSON(await mergeRequests(params.requestId, body.intoId)));
};
