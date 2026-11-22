import { mdiBookOpenVariant, mdiFilmstrip, mdiTelevisionClassic, mdiYoutube } from '@mdi/js';

export type RequestCategory = 'ANIME' | 'JDRAMA' | 'YOUTUBE' | 'AUDIOBOOK';
export type RequestStatus = 'OPEN' | 'PLANNED' | 'IN_PROGRESS' | 'RELEASED' | 'DECLINED';

export const REQUEST_CATEGORIES: readonly RequestCategory[] = ['ANIME', 'JDRAMA', 'AUDIOBOOK', 'YOUTUBE'];

export const REQUEST_CATEGORY_ICONS: Record<RequestCategory, string> = {
  ANIME: mdiFilmstrip,
  JDRAMA: mdiTelevisionClassic,
  AUDIOBOOK: mdiBookOpenVariant,
  YOUTUBE: mdiYoutube,
};

/** Square and 16:9 covers (YouTube and audiobooks) sit on a blurred copy so portrait frames do not slice them. */
export function usesAmbientCover(category: RequestCategory): boolean {
  return category === 'YOUTUBE' || category === 'AUDIOBOOK';
}

export function categoryPlaceholderTone(category: RequestCategory): string {
  if (category === 'ANIME') return 'from-rose-500/15 to-rose-500/[0.03] text-rose-300/60';
  if (category === 'JDRAMA') return 'from-amber-500/15 to-amber-500/[0.03] text-amber-300/60';
  if (category === 'AUDIOBOOK') return 'from-sky-500/15 to-sky-500/[0.03] text-sky-300/60';
  return 'from-red-500/15 to-red-500/[0.03] text-red-300/60';
}
