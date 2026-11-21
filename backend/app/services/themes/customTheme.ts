import { AccessDeniedError } from '@app/errors';
import { PATREON_QUOTA_STALE_MS, PatreonConnection } from '@app/models';
import { type User, type UserPreferences, UserRoleType } from '@app/models/User';

/**
 * Custom themes are a patron perk: any paid Patreon tier (`PatreonConnection.active`), or an admin, which is how a
 * theme is granted by hand.
 *
 * This reads the membership as stored and never calls Patreon, so a preferences read never waits on it. The daily
 * patreonMembershipRefreshWorker keeps the stored membership current, so a lapsed patron keeps the theme until its
 * next run (up to about a day). Like quota, a membership not checked within {@link PATREON_QUOTA_STALE_MS} stops
 * counting, so a revoked grant or stopped workers cannot leave the perk on forever.
 */
export async function canUseCustomTheme(user: Pick<User, 'id' | 'role'>): Promise<boolean> {
  if (user.role === UserRoleType.ADMIN) return true;
  const connection = await PatreonConnection.findOneBy({ userId: user.id });
  if (!connection?.active) return false;
  return Date.now() - connection.membershipCheckedAt.getTime() <= PATREON_QUOTA_STALE_MS;
}

/** Refuse a new custom theme from someone who may not have one. Clearing it (`null`) is always allowed. `allowed`
 * is a {@link canUseCustomTheme} answer the caller already has. */
export async function assertMayWriteCustomTheme(
  user: Pick<User, 'id' | 'role'>,
  body: UserPreferences,
  allowed?: boolean,
): Promise<void> {
  if (!body.customTheme) return;
  if (!(allowed ?? (await canUseCustomTheme(user)))) {
    throw new AccessDeniedError('Custom themes are for Nadeshiko patrons. Link an active Patreon membership first.');
  }
}

/**
 * The theme stays stored when a membership lapses, so it comes back on renewal, but it is left out of what the reader
 * gets until then, and the site falls back to its default theme. `allowed` is a {@link canUseCustomTheme} answer the
 * caller already has.
 */
export async function withUnlockedCustomTheme(
  user: Pick<User, 'id' | 'role'>,
  preferences: UserPreferences,
  allowed?: boolean,
): Promise<UserPreferences> {
  if (!preferences.customTheme || (allowed ?? (await canUseCustomTheme(user)))) return preferences;
  const { customTheme: _locked, ...rest } = preferences;
  return rest;
}
