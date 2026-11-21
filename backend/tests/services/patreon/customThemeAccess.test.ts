import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRoleType } from '@app/models/User';

const findOneBy = vi.hoisted(() => vi.fn());
vi.mock('@app/models', () => ({ PatreonConnection: { findOneBy }, PATREON_QUOTA_STALE_MS: 7 * 86_400_000 }));

const { assertMayWriteCustomTheme, canUseCustomTheme, withUnlockedCustomTheme } = await import(
  '@app/services/themes/customTheme'
);

const THEME = { preset: 'sepia', base: 'light', accent: '#e05a8a', background: '#fff5f8' } as const;
const reader = { id: 7, role: UserRoleType.USER };
const DAY_AGO = new Date(Date.now() - 86_400_000);

/** A stored link whose membership was last checked a day ago, long past the 15-minute refresh window. */
function staleConnection(active: boolean, membershipCheckedAt = DAY_AGO) {
  return { userId: reader.id, active, membershipCheckedAt, accessTokenCiphertext: 'x' };
}

beforeEach(() => {
  vi.restoreAllMocks();
  findOneBy.mockReset();
});

describe('canUseCustomTheme', () => {
  it('answers from the stored membership without calling Patreon', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    findOneBy.mockResolvedValue(staleConnection(true));

    await expect(canUseCustomTheme(reader)).resolves.toBe(true);

    expect(findOneBy).toHaveBeenCalledWith({ userId: reader.id });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a stored membership that is not active, and a reader with no link', async () => {
    findOneBy.mockResolvedValueOnce(staleConnection(false)).mockResolvedValueOnce(null);

    await expect(canUseCustomTheme(reader)).resolves.toBe(false);
    await expect(canUseCustomTheme(reader)).resolves.toBe(false);
  });

  it('stops counting a membership not checked for over a week, as quota does', async () => {
    findOneBy.mockResolvedValue(staleConnection(true, new Date(Date.now() - 8 * 86_400_000)));

    await expect(canUseCustomTheme(reader)).resolves.toBe(false);
  });

  it('lets an admin through without looking the link up', async () => {
    await expect(canUseCustomTheme({ id: 1, role: UserRoleType.ADMIN })).resolves.toBe(true);
    expect(findOneBy).not.toHaveBeenCalled();
  });
});

describe('a precomputed answer', () => {
  it('is used instead of a lookup by both the write check and the read filter', async () => {
    await expect(assertMayWriteCustomTheme(reader, { customTheme: THEME }, true)).resolves.toBeUndefined();
    await expect(assertMayWriteCustomTheme(reader, { customTheme: THEME }, false)).rejects.toThrow(/patrons/);
    await expect(withUnlockedCustomTheme(reader, { customTheme: THEME }, true)).resolves.toEqual({
      customTheme: THEME,
    });
    await expect(withUnlockedCustomTheme(reader, { customTheme: THEME }, false)).resolves.toEqual({});

    expect(findOneBy).not.toHaveBeenCalled();
  });

  it('falls back to a lookup when none is given', async () => {
    findOneBy.mockResolvedValue(staleConnection(false));

    await expect(withUnlockedCustomTheme(reader, { customTheme: THEME })).resolves.toEqual({});
    expect(findOneBy).toHaveBeenCalledTimes(1);
  });
});
