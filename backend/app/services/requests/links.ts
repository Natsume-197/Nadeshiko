import { CategoryType, ExternalSourceType } from '@app/models';

/**
 * What a request link names. The category follows from the site the link is on, so a request cannot be filed under the
 * wrong kind of content, and the identity is the one `MediaExternalId` stores for published media, so a request can be
 * matched to what is already on Nadeshiko and to other requests for the same title.
 */
export interface ParsedRequestLink {
  category: CategoryType;
  externalSource: ExternalSourceType | null;
  externalId: string | null;
  /** How the metadata is looked up. */
  lookup:
    | { type: 'anilist'; id: string }
    | { type: 'tmdb'; mediaType: 'tv' | 'movie'; id: string }
    | { type: 'audible'; asin: string; host: string }
    | { type: 'youtube-video'; videoId: string }
    | { type: 'youtube-channel'; url: string }
    | { type: 'none'; fallbackTitle: string | null };
}

const ASIN = /(?:^|[/=])(B0[0-9A-Z]{8}|\d{9}[\dX])(?=$|[/?&#])/;
const YOUTUBE_VIDEO_ID = /^[\w-]{11}$/;
const YOUTUBE_CHANNEL_ID = /^UC[\w-]{22}$/;

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www|m)\./, '');
}

function slugTitle(segment: string | undefined): string | null {
  if (!segment) return null;
  const words = decodeURIComponent(segment).replace(/^\d+-/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** Parse a request link, or null when it is not on a site requests accept. */
export function parseRequestLink(raw: string): ParsedRequestLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = hostOf(url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'anilist.co') {
    const id = parts[0] === 'anime' && parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null;
    if (!id) return null;
    return {
      category: CategoryType.ANIME,
      externalSource: ExternalSourceType.ANILIST,
      externalId: id,
      lookup: { type: 'anilist', id },
    };
  }

  if (host === 'themoviedb.org') {
    const mediaType = parts[0] === 'tv' || parts[0] === 'movie' ? parts[0] : null;
    const id = /^(\d+)/.exec(parts[1] ?? '')?.[1];
    if (!mediaType || !id) return null;
    return {
      category: CategoryType.JDRAMA,
      externalSource: ExternalSourceType.TMDB,
      // Ingest stores a drama's TMDB TV id as is; a movie id gets a prefix so the two id spaces cannot collide.
      externalId: mediaType === 'tv' ? id : `movie:${id}`,
      lookup: { type: 'tmdb', mediaType, id },
    };
  }

  if (host === 'mydramalist.com') {
    if (!/^\d+-/.test(parts[0] ?? '')) return null;
    // MyDramaList has no public API and ingest does not store its ids: the link is kept, the identity is not.
    return {
      category: CategoryType.JDRAMA,
      externalSource: null,
      externalId: null,
      lookup: { type: 'none', fallbackTitle: slugTitle(parts[0]) },
    };
  }

  if (/^audible\.[a-z.]+$/.test(host) || /^amazon\.[a-z.]+$/.test(host)) {
    const asin = ASIN.exec(url.pathname)?.[1] ?? url.searchParams.get('asin')?.toUpperCase() ?? null;
    if (!asin || !/^(B0[0-9A-Z]{8}|\d{9}[\dX])$/.test(asin)) return null;
    return {
      category: CategoryType.AUDIOBOOK,
      externalSource: ExternalSourceType.ASIN,
      externalId: asin,
      // Japanese audiobooks live on the Japanese store; other Audible stores answer for their own catalogue.
      lookup: { type: 'audible', asin, host: host.startsWith('audible.') ? host : 'audible.co.jp' },
    };
  }

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    const videoId =
      host === 'youtu.be'
        ? parts[0]
        : parts[0] === 'watch'
          ? url.searchParams.get('v')
          : parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed'
            ? parts[1]
            : null;
    if (videoId && YOUTUBE_VIDEO_ID.test(videoId)) {
      return {
        category: CategoryType.YOUTUBE,
        externalSource: ExternalSourceType.YOUTUBE,
        // One video is not a channel, so it gets an id no published channel carries.
        externalId: `video:${videoId}`,
        lookup: { type: 'youtube-video', videoId },
      };
    }
    const channelId = parts[0] === 'channel' ? parts[1] : undefined;
    if (channelId && YOUTUBE_CHANNEL_ID.test(channelId)) {
      return {
        category: CategoryType.YOUTUBE,
        externalSource: ExternalSourceType.YOUTUBE,
        externalId: channelId,
        lookup: { type: 'youtube-channel', url: `https://www.youtube.com/channel/${channelId}` },
      };
    }
    const handle = parts[0]?.startsWith('@') ? parts[0] : null;
    const legacy = (parts[0] === 'c' || parts[0] === 'user') && parts[1] ? `${parts[0]}/${parts[1]}` : null;
    if (handle || legacy) {
      // The channel id behind a handle is only known after fetching the channel page.
      return {
        category: CategoryType.YOUTUBE,
        externalSource: ExternalSourceType.YOUTUBE,
        externalId: null,
        lookup: { type: 'youtube-channel', url: `https://www.youtube.com/${handle ?? legacy}` },
      };
    }
    return null;
  }

  return null;
}
