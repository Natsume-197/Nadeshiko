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

/** Each boost adds this many points to a request's score; mirrors the backend's `REQUEST_BOOST_WEIGHT`. */
export const REQUEST_BOOST_WEIGHT = 5;

/** Statuses a request is still being worked toward (the backend's `ACTIVE_REQUEST_STATUSES`). */
export const ACTIVE_REQUEST_STATUSES: readonly RequestStatus[] = ['OPEN', 'PLANNED', 'IN_PROGRESS'];

const shortDateFormats = new Map<string, { short: Intl.DateTimeFormat; full: Intl.DateTimeFormat }>();

/** A request date as "Nov 24", or "Nov 24, 2025" outside the current year (UTC); empty for an invalid date. */
export function formatRequestDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  let formats = shortDateFormats.get(locale);
  if (!formats) {
    formats = {
      short: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      full: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    };
    shortDateFormats.set(locale, formats);
  }
  return date.getUTCFullYear() === new Date().getUTCFullYear() ? formats.short.format(date) : formats.full.format(date);
}
