import type { User } from '@app/models/User';
import { canUseCustomTheme } from '@app/services/themes/customTheme';

/**
 * Per-account custom dictionary quotas (task 48).
 *
 * Free accounts get enough room to try a monolingual + grammar/frequency pair (2 dicts, 60 MB each); active patrons
 * (any paid Patreon tier) and admins get 6 dictionaries up to 95 MB each (safely under Cloudflare Free's 100 MB HTTP
 * request body cap).
 */

export const FREE_MAX_DICTIONARIES = 2;
export const FREE_MAX_ZIP_BYTES = 60 * 1024 * 1024;

export const PATRON_MAX_DICTIONARIES = 6;
export const PATRON_MAX_ZIP_BYTES = 95 * 1024 * 1024;

/** What an account's dictionaries may take once indexed. The zip says little: 52 MB of PixivLight index to 376 MB.
 * This is what fills the local cache, so it is what protects the disk. */
export const FREE_MAX_INDEXED_BYTES = 512 * 1024 * 1024;
export const PATRON_MAX_INDEXED_BYTES = 2 * 1024 * 1024 * 1024;

export interface CustomDictionaryQuota {
  maxDictionaries: number;
  maxZipBytes: number;
  maxIndexedBytes: number;
  isPatron: boolean;
}

export async function resolveCustomDictionaryQuota(user: Pick<User, 'id' | 'role'>): Promise<CustomDictionaryQuota> {
  const isPatron = await canUseCustomTheme(user);
  return isPatron
    ? {
        maxDictionaries: PATRON_MAX_DICTIONARIES,
        maxZipBytes: PATRON_MAX_ZIP_BYTES,
        maxIndexedBytes: PATRON_MAX_INDEXED_BYTES,
        isPatron: true,
      }
    : {
        maxDictionaries: FREE_MAX_DICTIONARIES,
        maxZipBytes: FREE_MAX_ZIP_BYTES,
        maxIndexedBytes: FREE_MAX_INDEXED_BYTES,
        isPatron: false,
      };
}
