import { config } from '@config/config';
import { logger } from '@config/log';
import { getAniListMediaMetadata } from '@app/services/roadmap/anilist';
import type { ParsedRequestLink } from './links';

export interface RequestMetadata {
  title: string | null;
  coverUrl: string | null;
  /** Filled when the lookup finds the identity the link alone does not carry (a YouTube handle's channel id). */
  externalId?: string;
}

const TIMEOUT_MS = 4_000;
const EMPTY: RequestMetadata = { title: null, coverUrl: null };

/** Keep the strings we store to the column sizes and free of markup. */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

async function tmdb(mediaType: 'tv' | 'movie', id: string): Promise<RequestMetadata> {
  if (!config.TMDB_API_KEY) return EMPTY;
  const url = new URL(`https://api.themoviedb.org/3/${mediaType}/${id}`);
  url.searchParams.set('api_key', config.TMDB_API_KEY);
  url.searchParams.set('language', 'en-US');
  const body = (await fetchJson(url.toString())) as {
    name?: string;
    title?: string;
    original_name?: string;
    original_title?: string;
    poster_path?: string | null;
  } | null;
  if (!body) return EMPTY;
  const poster = typeof body.poster_path === 'string' ? `https://image.tmdb.org/t/p/w500${body.poster_path}` : null;
  return { title: clean(body.name ?? body.title ?? body.original_name ?? body.original_title, 180), coverUrl: poster };
}

async function audible(asin: string, host: string): Promise<RequestMetadata> {
  const url = new URL(`https://api.${host}/1.0/catalog/products/${asin}`);
  url.searchParams.set('response_groups', 'product_desc,media');
  url.searchParams.set('image_sizes', '500');
  const body = (await fetchJson(url.toString())) as {
    product?: { title?: string; product_images?: Record<string, string> };
  } | null;
  const product = body?.product;
  return { title: clean(product?.title, 180), coverUrl: httpsUrl(product?.product_images?.['500']) };
}

async function youtubeVideo(videoId: string): Promise<RequestMetadata> {
  const url = new URL('https://www.youtube.com/oembed');
  url.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
  url.searchParams.set('format', 'json');
  const body = (await fetchJson(url.toString())) as { title?: string; thumbnail_url?: string } | null;
  return { title: clean(body?.title, 180), coverUrl: httpsUrl(body?.thumbnail_url) };
}

/** A channel has no oEmbed; its page carries the canonical channel id and the Open Graph name and avatar. */
async function youtubeChannel(channelUrl: string): Promise<RequestMetadata> {
  const response = await fetch(channelUrl, {
    headers: { 'accept-language': 'en', 'user-agent': 'Mozilla/5.0 (compatible; Nadeshiko)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return EMPTY;
  const html = (await response.text()).slice(0, 2_000_000);
  const channelId = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1];
  const title = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const image = /<meta property="og:image" content="([^"]*)"/.exec(html)?.[1];
  return {
    title: title ? clean(decodeEntities(title), 180) : null,
    coverUrl: image ? httpsUrl(decodeEntities(image)) : null,
    ...(channelId ? { externalId: channelId } : {}),
  };
}

/**
 * Title, cover and, for a YouTube handle, the channel id behind a request link. Presentation data only: any failure
 * returns nulls and the request falls back to the title the reader typed.
 */
export async function lookupRequestMetadata(link: ParsedRequestLink): Promise<RequestMetadata> {
  try {
    switch (link.lookup.type) {
      case 'anilist': {
        const media = await getAniListMediaMetadata(`https://anilist.co/anime/${link.lookup.id}`);
        return media ? { title: clean(media.title, 180), coverUrl: media.coverUrl } : EMPTY;
      }
      case 'tmdb':
        return await tmdb(link.lookup.mediaType, link.lookup.id);
      case 'audible':
        return await audible(link.lookup.asin, link.lookup.host);
      case 'youtube-video':
        return await youtubeVideo(link.lookup.videoId);
      case 'youtube-channel':
        return await youtubeChannel(link.lookup.url);
      case 'none':
        return { title: link.lookup.fallbackTitle, coverUrl: null };
    }
  } catch (err) {
    logger.info({ err, lookup: link.lookup.type }, 'Content request metadata lookup failed');
    return EMPTY;
  }
}
