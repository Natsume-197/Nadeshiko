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
  highestEntitledTier,
  patreonQuotaTier,
  resolveQuotaLimit,
  unmatchedPatreonTierIds,
} from '@app/models';
import {
  assertConfigured,
  getPatreonConnection,
  isPatreonConfigured,
  unlinkPatreon,
} from '@app/services/patreon/connection';
import { fetchCampaignMembers } from '@app/services/patreon/campaign';
import { refreshPatreonMemberships } from '@app/workers/patreonMembershipRefreshWorker';
import { ADMIN_OVERVIEW_CACHE } from '@app/controllers/adminDashboardController';
import { invalidateUserCache } from '@app/middleware/authCacheStore';
import { assertUser } from '@app/middleware/authentication';
import { NotFoundError } from '@app/errors';
import { Cache } from '@lib/cache';
import { config } from '@config/config';
import { logger } from '@config/log';

function buildConnectionDTO(
  connection: PatreonConnection,
  user: User,
  tiers: Tier[],
  tierById: Map<string, Tier>,
  now: number,
  normalizedMonthlyCents?: number,
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
    monthlyAmountCents: normalizedMonthlyCents ?? connection.entitledAmountCents,
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

export const getAdminPatreonOverview: GetAdminPatreonOverview = async ({ query }, respond) => {
  const now = Date.now();
  const [tiers, connectionRows, campaignSnapshot, manualUsers] = await Promise.all([
    Tier.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
    PatreonConnection.find({
      relations: { user: true },
      order: { membershipCheckedAt: 'DESC', id: 'DESC' },
    }),
    fetchCampaignMembers(query.refreshCampaign === true),
    User.createQueryBuilder('u')
      .where('u.is_active = true')
      .andWhere('(u.quota_override IS NOT NULL OR (u.tier_id IS NOT NULL AND u.tier_id != :free))', { free: 'free' })
      .orderBy('u.quota_override', 'DESC', 'NULLS LAST')
      .addOrderBy('u.username', 'ASC')
      .getMany(),
  ]);
  const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
  const campaignMonthlyByPatreonUserId = new Map(
    campaignSnapshot.members
      .filter((member) => member.patreonUserId)
      .map((member) => [member.patreonUserId as string, member.monthlyAmountCents]),
  );
  const earnedTierByUserId = new Map<number, Tier | null>();

  const activeCountByTier = new Map<string, number>();
  const connectionByPatreonUserId = new Map<string, t_AdminPatreonConnection>();
  const connections: t_AdminPatreonConnection[] = [];

  for (const row of connectionRows) {
    if (!row.user) continue;
    const dto = buildConnectionDTO(
      row,
      row.user,
      tiers,
      tierById,
      now,
      campaignMonthlyByPatreonUserId.get(row.patreonUserId),
    );
    earnedTierByUserId.set(row.user.id, patreonQuotaTier(tiers, row, now));
    connections.push(dto);
    connectionByPatreonUserId.set(dto.patreonUserId, dto);
    if (dto.resolvedTierId) {
      activeCountByTier.set(dto.resolvedTierId, (activeCountByTier.get(dto.resolvedTierId) ?? 0) + 1);
    }
  }

  const unlinkedCampaignEmails = [
    ...new Set(
      campaignSnapshot.members
        .filter((member) => !(member.patreonUserId && connectionByPatreonUserId.has(member.patreonUserId)))
        .map((member) => member.email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const matchedUsers =
    unlinkedCampaignEmails.length > 0
      ? await User.createQueryBuilder('u')
          .select(['u.id', 'u.username', 'u.email'])
          .where('LOWER(u.email) IN (:...emails)', { emails: unlinkedCampaignEmails })
          .getMany()
      : [];
  const matchedUserByEmail = new Map(matchedUsers.map((u) => [u.email.toLowerCase(), u]));

  const campaignCountByTier = new Map<string, number>();
  const campaignMonthlyByTier = new Map<string, number>();

  const campaignMembers = campaignSnapshot.members.map((member) => {
    const linked = member.patreonUserId ? (connectionByPatreonUserId.get(member.patreonUserId) ?? null) : null;
    const matched =
      !linked && member.email ? (matchedUserByEmail.get(member.email.trim().toLowerCase()) ?? null) : null;
    // The campaign list is live from Patreon, so only the active status applies: there is no staleness to check.
    const isActivePatron = member.patronStatus === 'active_patron';
    const earned = isActivePatron ? highestEntitledTier(tiers, member.entitledTierIds) : null;
    const unmatchedTierIds = isActivePatron ? unmatchedPatreonTierIds(tiers, member.entitledTierIds) : [];

    if (earned) {
      campaignCountByTier.set(earned.id, (campaignCountByTier.get(earned.id) ?? 0) + 1);
      campaignMonthlyByTier.set(earned.id, (campaignMonthlyByTier.get(earned.id) ?? 0) + member.monthlyAmountCents);
    }

    return {
      ...member,
      resolvedTierName: earned?.displayName ?? null,
      unmatchedTierIds,
      linkedUserId: linked?.userId ?? null,
      linkedUsername: linked?.username ?? null,
      matchedUserId: matched?.id ?? null,
      matchedUsername: matched?.username ?? null,
    };
  });

  const campaignActiveMembers = campaignMembers.filter((m) => m.patronStatus === 'active_patron');
  const campaignUnlinkedActive = campaignActiveMembers.filter((m) => m.linkedUserId === null).length;
  const campaignMonthlyCents = campaignActiveMembers.reduce((sum, m) => sum + m.monthlyAmountCents, 0);
  const campaignLifetimeCents = campaignMembers.reduce((sum, m) => sum + m.lifetimeSupportCents, 0);
  const campaignPayingEver = campaignMembers.filter(
    (m) => m.lifetimeSupportCents > 0 || m.monthlyAmountCents > 0,
  ).length;

  const manualGrants = manualUsers.map((user) => {
    const assignedTier = user.tierId ? (tierById.get(user.tierId) ?? null) : null;
    const resolved = resolveQuotaLimit({
      ...user,
      tier: assignedTier,
      // Same inputs as enforcement (resolveEffectiveQuota): a linked Patreon tier can outrank the manual one.
      patreonTier: earnedTierByUserId.get(user.id) ?? null,
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
      issues: connections.filter((c) => c.hasIssue).length,
      campaignActive: campaignActiveMembers.length,
      campaignUnlinkedActive,
      campaignMonthlyCents,
      campaignLifetimeCents,
      campaignPayingEver,
    },
    campaign: {
      status: campaignSnapshot.status,
      errorMessage: campaignSnapshot.errorMessage,
      fetchedAt: campaignSnapshot.fetchedAt,
      members: campaignMembers,
    },
    tiers: tiers.map((tier) => ({
      id: tier.id,
      displayName: tier.displayName,
      patreonTierId: tier.patreonTierId,
      monthlyQuotaLimit: tier.monthlyQuotaLimit,
      monthlyRequestBoosts: tier.monthlyRequestBoosts,
      activePatronCount: activeCountByTier.get(tier.id) ?? 0,
      campaignPatronCount: campaignCountByTier.get(tier.id) ?? 0,
      campaignMonthlyCents: campaignMonthlyByTier.get(tier.id) ?? 0,
    })),
    connections,
    manualGrants,
  });
};

export const refreshAdminPatreonConnection: RefreshAdminPatreonConnection = async ({ params }, respond, req) => {
  const actor = assertUser(req);
  assertConfigured();

  const [user, tiers] = await Promise.all([
    User.findOne({ where: { id: params.userId } }),
    Tier.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
  ]);
  if (!user) {
    throw new NotFoundError(`User with ID ${params.userId} not found`);
  }

  const refreshed = await getPatreonConnection(params.userId, true);
  if (!refreshed) {
    throw new NotFoundError(`User with ID ${params.userId} does not have a Patreon connection`);
  }

  invalidateUserCache(params.userId);
  Cache.invalidate(ADMIN_OVERVIEW_CACHE);

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
  assertConfigured();

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
