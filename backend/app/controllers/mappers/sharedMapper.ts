import type { t_Media, t_MediaSummary, t_ExternalId } from 'generated/models';
import { ExternalSourceType, type Media } from '@app/models';
import type { MediaExternalId } from '@app/models/MediaExternalId';
import { getMediaCoverUrl, getMediaBannerUrl } from '@lib/utils/storage';

/** Every external id source, keyed as the API names it. Typed against `t_ExternalId`, so a source added to the
 * schema does not compile until it is mapped here, and no response can drop it. */
export const EXTERNAL_SOURCE_BY_KEY: Record<keyof t_ExternalId, ExternalSourceType> = {
  anilist: ExternalSourceType.ANILIST,
  mal: ExternalSourceType.MAL,
  imdb: ExternalSourceType.IMDB,
  tvdb: ExternalSourceType.TVDB,
  tmdb: ExternalSourceType.TMDB,
  youtube: ExternalSourceType.YOUTUBE,
  asin: ExternalSourceType.ASIN,
};

const EXTERNAL_ID_KEYS = Object.keys(EXTERNAL_SOURCE_BY_KEY) as (keyof t_ExternalId)[];

/** The API shape from ids keyed by lowercase source: every key present, null where the media has none. */
export const toExternalIds = (idsBySource: Readonly<Record<string, string | undefined>>): t_ExternalId => {
  const map = {} as t_ExternalId;
  for (const key of EXTERNAL_ID_KEYS) {
    map[key] = idsBySource[key] ?? null;
  }
  return map;
};

const toExternalIdsMap = (externalIds?: MediaExternalId[]): t_ExternalId =>
  toExternalIds(Object.fromEntries((externalIds ?? []).map((ext) => [ext.source.toLowerCase(), ext.externalId])));

export const toMediaSummaryDTO = (media: Media): t_MediaSummary => ({
  publicId: media.publicId,
  slug: media.slug,
  nameJa: media.nameJa,
  nameRomaji: media.nameRomaji,
  nameEn: media.nameEn,
  coverUrl: getMediaCoverUrl(media),
  category: media.category as t_MediaSummary['category'],
});

const toDateString = (date: Date | string): string => {
  if (typeof date === 'string') return date;
  return date.toISOString().slice(0, 10);
};

export const toMediaBaseDTO = (media: Media): t_Media => ({
  publicId: media.publicId,
  slug: media.slug,
  externalIds: toExternalIdsMap(media.externalIds),
  nameJa: media.nameJa,
  nameRomaji: media.nameRomaji,
  nameEn: media.nameEn,
  airingFormat: media.airingFormat as t_Media['airingFormat'],
  airingStatus: media.airingStatus as t_Media['airingStatus'],
  genres: media.genres,
  coverUrl: getMediaCoverUrl(media),
  bannerUrl: getMediaBannerUrl(media),
  startDate: toDateString(media.startDate),
  endDate: media.endDate ? toDateString(media.endDate) : null,
  category: media.category as t_Media['category'],
  segmentCount: media.segmentCount,
  // Read the denormalized episode count maintained by the trigger, not an unloaded relation length.
  episodeCount: media.episodeCount,
  studio: media.studio ?? null,
  seasonName: media.seasonName as t_Media['seasonName'],
  seasonYear: media.seasonYear,
  // Use the record’s modification time for sitemap `lastmod`, never airing dates or a build timestamp.
  updatedAt: media.updatedAt ? media.updatedAt.toISOString() : null,
});
