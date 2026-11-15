import { AccessDeniedError } from '@app/errors';
import { PatreonConnection } from '@app/models';
import { type User, type UserPreferences, UserRoleType } from '@app/models/User';
import { getPatreonConnection } from '@app/services/patreon/connection';

/**
 * Custom themes are a patron perk: any paid Patreon tier (`PatreonConnection.active`), or an admin, which is how a
 * theme is granted by hand.
 *
 * A Patreon outage must not take a patron's theme away, so when the membership cannot be refreshed the last stored
 * answer stands.
 */
export async function canUseCustomTheme(user: Pick<User, 'id' | 'role'>): Promise<boolean> {
  if (user.role === UserRoleType.ADMIN) return true;
  try {
    return Boolean((await getPatreonConnection(user.id))?.active);
  } catch {
    return Boolean((await PatreonConnection.findOneBy({ userId: user.id }))?.active);
  }
}

/** Refuse a new custom theme from someone who may not have one. Clearing it (`null`) is always allowed. */
export async function assertMayWriteCustomTheme(user: Pick<User, 'id' | 'role'>, body: UserPreferences): Promise<void> {
  if (!body.customTheme) return;
  if (!(await canUseCustomTheme(user))) {
    throw new AccessDeniedError('Custom themes are for Nadeshiko patrons. Link an active Patreon membership first.');
  }
}

/**
 * The theme stays stored when a membership lapses, so it comes back on renewal, but it is left out of what the reader
 * gets until then, and the site falls back to its default theme.
 */
export async function withUnlockedCustomTheme(
  user: Pick<User, 'id' | 'role'>,
  preferences: UserPreferences,
): Promise<UserPreferences> {
  if (!preferences.customTheme || (await canUseCustomTheme(user))) return preferences;
  const { customTheme: _locked, ...rest } = preferences;
  return rest;
}
