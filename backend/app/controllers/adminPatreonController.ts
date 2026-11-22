import type {
  GetAdminPatreonOverview,
  RefreshAdminPatreonConnection,
  RefreshAllAdminPatreonConnections,
  UnlinkAdminPatreonConnection,
} from 'generated/routes/admin';
import type { t_AdminPatreonConnection } from 'generated/models';
import {
  PATREON_QUOTA_STALE_MS,
  PatreonConnection,
  Tier,
  User,
  patreonQuotaTier,
  resolveQuotaLimit,
  unmatchedPatreonTierIds,
} from '@app/models';
import { getPatreonConnection, isPatreonConfigured, unlinkPatreon } from '@app/services/patreon/connection';
import { refreshPatreonMemberships } from '@app/workers/patreonMembershipRefreshWorker';
import { ADMIN_OVERVIEW_CACHE } from '@app/controllers/adminDashboardController';
import { invalidateUserCache } from '@app/middleware/authCacheStore';
import { assertUser } from '@app/middleware/authentication';
import { NotFoundError, ValidationFailedError } from '@app/errors';
import { Cache } from '@lib/cache';
import { config } from '@config/config';
import { logger } from '@config/log';

function buildConnectionDTO(
  connection: PatreonConnection,
  user: User,
  tiers: Tier[],
  tierById: Map<string, Tier>,
  now: number,
): t_AdminPatreonConnection {
  const isStale = now - connection.membershipCheckedAt.getTime() > PATREON_QUOTA_STALE_MS;
  const earned = patreonQuotaTier(tiers, connection, now);
  const unmatchedTierIds =
    connection.patronStatus === 'active_patron' ? unmatchedPatreonTierIds(tiers, connection.entitledTierIds ?? []) : [];
  const isActive = connection.active && !isStale;
  const hasIssue = isStale || unmatchedTierIds.length > 0 || connection.patronStatus === 'declined_patron';

  const assignedTier = user.tierId ? (tierById.get(user.tierId) ?? null) : null;
  const resolved = resolveQuotaLimit({
    ...user,
    tier: assignedTier,
    patreonTier: earned,
  });

  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    patreonUserId: connection.patreonUserId,
    fullName: connection.fullName ?? null,
    patronStatus: connection.patronStatus ?? null,
    entitledAmountCents: connection.entitledAmountCents,
    entitledTierIds: connection.entitledTierIds ?? [],
    resolvedTierId: earned?.id ?? null,
    resolvedTierName: earned?.displayName ?? null,
    effectiveQuotaLimit: resolved.limit,
    quotaSource: resolved.source,
    unmatchedTierIds,
    isActive,
    isStale,
    hasIssue,
    membershipCheckedAt: connection.membershipCheckedAt.toISOString(),
    linkedAt: connection.createdAt.toISOString(),
  };
}

export const getAdminPatreonOverview: GetAdminPatreonOverview = async (_params, respond) => {
  const now = Date.now();
  const tiers = await Tier.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  const tierById = new Map(tiers.map((tier) => [tier.id, tier]));

  const connectionRows = await PatreonConnection.find({
    relations: { user: true },
    order: { membershipCheckedAt: 'DESC', id: 'DESC' },
  });

  const activeCountByTier = new Map<string, number>();
  const connections: t_AdminPatreonConnection[] = [];

  for (const row of connectionRows) {
    if (!row.user) continue;
    const dto = buildConnectionDTO(row, row.user, tiers, tierById, now);
    connections.push(dto);
    if (dto.resolvedTierId) {
      activeCountByTier.set(dto.resolvedTierId, (activeCountByTier.get(dto.resolvedTierId) ?? 0) + 1);
    }
  }

  const manualUsers = await User.createQueryBuilder('u')
    .where('u.is_active = true')
    .andWhere('(u.quota_override IS NOT NULL OR (u.tier_id IS NOT NULL AND u.tier_id != :free))', { free: 'free' })
    .orderBy('u.quota_override', 'DESC', 'NULLS LAST')
    .addOrderBy('u.username', 'ASC')
    .getMany();

  const manualGrants = manualUsers.map((user) => {
    const assignedTier = user.tierId ? (tierById.get(user.tierId) ?? null) : null;
    const resolved = resolveQuotaLimit({
      ...user,
      tier: assignedTier,
      patreonTier: null,
    });
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      tierId: user.tierId,
      tierName: assignedTier?.displayName ?? null,
      quotaOverride: user.quotaOverride,
      effectiveQuotaLimit: resolved.limit,
      quotaSource: resolved.source,
    };
  });

  return respond.with200().body({
    configured: isPatreonConfigured(),
    campaignId: config.PATREON_CAMPAIGN_ID || null,
    summary: {
      totalLinked: connections.length,
      active: connections.filter((c) => c.isActive).length,
      stale: connections.filter((c) => c.isStale).length,
      issues: connections.filter((c) => c.hasIssue).length,
    },
    tiers: tiers.map((tier) => ({
      id: tier.id,
      displayName: tier.displayName,
      patreonTierId: tier.patreonTierId,
      monthlyQuotaLimit: tier.monthlyQuotaLimit,
      monthlyRequestBoosts: tier.monthlyRequestBoosts,
      activePatronCount: activeCountByTier.get(tier.id) ?? 0,
    })),
    connections,
    manualGrants,
  });
};

export const refreshAdminPatreonConnection: RefreshAdminPatreonConnection = async ({ params }, respond, req) => {
  const actor = assertUser(req);
  if (!isPatreonConfigured()) {
    throw new ValidationFailedError({ connection: 'Patreon linking is not configured on this server.' });
  }

  const user = await User.findOne({ where: { id: params.userId } });
  if (!user) {
    throw new NotFoundError(`User with ID ${params.userId} not found`);
  }

  const refreshed = await getPatreonConnection(params.userId, true);
  if (!refreshed) {
    throw new NotFoundError(`User with ID ${params.userId} does not have a Patreon connection`);
  }

  invalidateUserCache(params.userId);
  Cache.invalidate(ADMIN_OVERVIEW_CACHE);

  const tiers = await Tier.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
  const dto = buildConnectionDTO(refreshed, user, tiers, tierById, Date.now());

  logger.info(
    {
      event: 'admin.patreon.refreshed',
      'actor.id': actor.id,
      'target.id': user.id,
      patronStatus: dto.patronStatus,
      resolvedTierId: dto.resolvedTierId,
    },
    'Admin refreshed Patreon membership',
  );

  return respond.with200().body(dto);
};

export const unlinkAdminPatreonConnection: UnlinkAdminPatreonConnection = async ({ params }, respond, req) => {
  const actor = assertUser(req);
  const removed = await unlinkPatreon(params.userId);
  if (!removed) {
    throw new NotFoundError(`User with ID ${params.userId} does not have a Patreon connection`);
  }

  invalidateUserCache(params.userId);
  Cache.invalidate(ADMIN_OVERVIEW_CACHE);

  logger.info(
    {
      event: 'admin.patreon.unlinked',
      'actor.id': actor.id,
      'target.id': params.userId,
    },
    'Admin unlinked Patreon connection',
  );

  return respond.with204().body();
};

export const refreshAllAdminPatreonConnections: RefreshAllAdminPatreonConnections = async (_params, respond, req) => {
  const actor = assertUser(req);
  if (!isPatreonConfigured()) {
    throw new ValidationFailedError({ connection: 'Patreon linking is not configured on this server.' });
  }

  const result = await refreshPatreonMemberships();
  Cache.invalidate(ADMIN_OVERVIEW_CACHE);

  logger.info(
    {
      event: 'admin.patreon.refreshed_all',
      'actor.id': actor.id,
      checked: result.checked,
      failed: result.failed,
    },
    'Admin triggered Patreon refresh for all connections',
  );

  return respond.with200().body(result);
};
