import { In } from 'typeorm';
import type {
  BoostContentRequest,
  CreateContentRequest,
  GetContentRequestAllowance,
  ListContentRequests,
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
import { requestAllowance } from '@app/services/requests/allowance';
import {
  boostRequest,
  createRequest,
  mergeRequests,
  removeVote,
  toAdminRequestJSON,
  toRequestJSON,
  updateRequestAsAdmin,
  voteOnRequest,
  withdrawRequest,
} from '@app/services/requests/service';

/** `%` and `_` typed by a reader are text, not wildcards. */
function titleLike(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const listContentRequests: ListContentRequests = async ({ query }, respond) => {
  const take = query.take ?? 24;
  const page = query.page ?? 1;
  const status = query.status ?? 'ACTIVE';

  const qb = ContentRequest.createQueryBuilder('r').leftJoinAndSelect('r.media', 'media');
  if (status === 'ACTIVE') qb.where('r.status IN (:...statuses)', { statuses: ACTIVE_REQUEST_STATUSES });
  else qb.where('r.status = :status', { status });
  if (query.category) qb.andWhere('r.category = :category', { category: query.category });
  if (query.q?.trim()) qb.andWhere('r.title ILIKE :q', { q: titleLike(query.q) });

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

export const createContentRequest: CreateContentRequest = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const { request, outcome } = await createRequest(user, body);
  if (outcome === 'created') return respond.with201().body({ request: toRequestJSON(request), outcome });
  return respond.with200().body({ request: toRequestJSON(request), outcome });
};

export const getContentRequestAllowance: GetContentRequestAllowance = async (_params, respond, req) => {
  const user = assertUser(req);
  const allowance = await requestAllowance(user);
  const active = In([...ACTIVE_REQUEST_STATUSES]);
  const [votes, boosts, own] = await Promise.all([
    ContentRequestVote.find({ where: { userId: user.id, request: { status: active } }, relations: { request: true } }),
    ContentRequestBoost.find({ where: { userId: user.id, request: { status: active } }, relations: { request: true } }),
    ContentRequest.find({ where: { requesterUserId: user.id, status: active }, select: { id: true, publicId: true } }),
  ]);
  return respond.with200().body({
    ...allowance,
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
  if (query.status) qb.andWhere('r.status = :status', { status: query.status });
  if (query.category) qb.andWhere('r.category = :category', { category: query.category });
  if (query.flagged) qb.andWhere('r.possibleDuplicateOfId IS NOT NULL');
  if (query.q?.trim()) qb.andWhere('r.title ILIKE :q', { q: titleLike(query.q) });
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
