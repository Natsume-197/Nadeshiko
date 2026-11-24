import { MoreThanOrEqual, In } from 'typeorm';
import {
  ACTIVE_REQUEST_STATUSES,
  ContentRequest,
  ContentRequestBoost,
  PatreonConnection,
  Tier,
  UserRoleType,
  patreonQuotaTier,
} from '@app/models';
import type { User } from '@app/models';
import { isCurrentPatron } from '@app/services/themes/customTheme';

/** Open requests one account may have waiting at once (decided 2026-11-21). */
export const OPEN_REQUEST_LIMIT = { free: 10, patron: 30 } as const;

/** Requests one account may file in a rolling day, whatever its open count: a brake on pasting a list in one go. */
export const DAILY_REQUEST_LIMIT = 5;

export interface RequestAllowance {
  isPatron: boolean;
  openCount: number;
  openLimit: number | null;
  boosts: { perMonth: number; used: number; remaining: number; resetsAt: string };
}

/** The first instant of the next calendar month, UTC: when the boost allowance refills. */
export function nextMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * What the Patreon membership earns here. A patron is anyone custom themes call one (`canUseCustomTheme`, via `isCurrentPatron`: an active,
 * recently checked membership, or an admin). Boosts come from the Patreon tier they are entitled to, by tier id
 * (`Tier.monthlyRequestBoosts`); a patron whose tier matches no row is still a patron but earns no boosts until the
 * tier is mapped. Admins get the highest allowance so they can try the flow.
 */
export async function patronBenefits(user: Pick<User, 'id' | 'role'>): Promise<{ isPatron: boolean; boosts: number }> {
  if (user.role === UserRoleType.ADMIN) {
    const tiers = await Tier.find();
    return { isPatron: true, boosts: Math.max(0, ...tiers.map((tier) => tier.monthlyRequestBoosts)) };
  }
  const [connection, tiers] = await Promise.all([PatreonConnection.findOneBy({ userId: user.id }), Tier.find()]);
  if (!isCurrentPatron(connection)) return { isPatron: false, boosts: 0 };
  return { isPatron: true, boosts: patreonQuotaTier(tiers, connection)?.monthlyRequestBoosts ?? 0 };
}

/** Open requests the account may have waiting at once; null means no limit (admins). */
export function openRequestLimit(user: Pick<User, 'role'>, isPatron: boolean): number | null {
  if (user.role === UserRoleType.ADMIN) return null;
  return isPatron ? OPEN_REQUEST_LIMIT.patron : OPEN_REQUEST_LIMIT.free;
}

export async function openRequestCount(userId: number): Promise<number> {
  return ContentRequest.countBy({ requesterUserId: userId, status: In([...ACTIVE_REQUEST_STATUSES]) });
}

export async function boostsUsedThisMonth(userId: number, now: Date = new Date()): Promise<number> {
  return ContentRequestBoost.countBy({ userId, createdAt: MoreThanOrEqual(monthStart(now)) });
}

export async function requestAllowance(
  user: Pick<User, 'id' | 'role'>,
  now: Date = new Date(),
): Promise<RequestAllowance> {
  const [benefits, openCount, used] = await Promise.all([
    patronBenefits(user),
    openRequestCount(user.id),
    boostsUsedThisMonth(user.id, now),
  ]);
  const openLimit = openRequestLimit(user, benefits.isPatron);
  return {
    isPatron: benefits.isPatron,
    openCount,
    openLimit,
    boosts: {
      perMonth: benefits.boosts,
      used,
      remaining: Math.max(0, benefits.boosts - used),
      resetsAt: nextMonthStart(now).toISOString(),
    },
  };
}
