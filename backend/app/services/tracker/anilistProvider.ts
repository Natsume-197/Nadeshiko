import { InvalidRequestError } from '@app/errors';
import { TrackerProviderType } from '@app/models/TrackerConnection';
import { WatchStatus } from '@app/models/UserMediaProgress';
import { config } from '@config/config';
import type {
  TrackerAuthContext,
  TrackerListEntry,
  TrackerProvider,
  TrackerTokens,
  TrackerUserIdentity,
} from './types';

const ANILIST_AUTHORIZE_URL = 'https://anilist.co/api/v2/oauth/authorize';
const ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';
const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const ANILIST_TIMEOUT_MS = 12_000;

interface AniListTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface AniListViewerResponse {
  data?: {
    Viewer?: {
      id?: number;
      name?: string | null;
    } | null;
  };
}

interface AniListRawEntry {
  status?: string | null;
  progress?: number | null;
  media?: {
    id?: number | null;
    title?: {
      english?: string | null;
      romaji?: string | null;
      native?: string | null;
    } | null;
  } | null;
}

interface AniListMediaListCollectionResponse {
  data?: {
    MediaListCollection?: {
      lists?: Array<{
        name?: string | null;
        isCustomList?: boolean | null;
        entries?: AniListRawEntry[] | null;
      }> | null;
    } | null;
  };
}

const ANILIST_STATUS_MAP: Record<string, WatchStatus> = {
  CURRENT: WatchStatus.WATCHING,
  // Rewatching means the reader has already finished the anime once; treating it as COMPLETED avoids hiding
  // episodes they have already seen.
  REPEATING: WatchStatus.COMPLETED,
  COMPLETED: WatchStatus.COMPLETED,
  PAUSED: WatchStatus.PAUSED,
  DROPPED: WatchStatus.DROPPED,
  PLANNING: WatchStatus.PLANNING,
};

/**
 * Normalize AniList's `MediaListCollection` into deduplicated entries. AniList repeats an anime once in its
 * standard status list and again inside every custom list it belongs to, so entries are merged by media id.
 */
export function normalizeAniListCollection(response: AniListMediaListCollectionResponse): TrackerListEntry[] {
  const lists = response.data?.MediaListCollection?.lists ?? [];
  const merged = new Map<string, { entry: TrackerListEntry; customLists: Set<string>; fromStandardList: boolean }>();

  for (const list of lists) {
    const isCustom = Boolean(list?.isCustomList);
    const listName = list?.name?.trim() || '';
    for (const raw of list?.entries ?? []) {
      const mediaId = raw?.media?.id;
      if (typeof mediaId !== 'number' || !Number.isInteger(mediaId) || mediaId <= 0) continue;

      const mappedStatus = raw.status ? ANILIST_STATUS_MAP[raw.status] : undefined;
      if (!mappedStatus) continue;

      const externalId = String(mediaId);
      const progress =
        typeof raw.progress === 'number' && Number.isFinite(raw.progress) && raw.progress > 0
          ? Math.floor(raw.progress)
          : 0;
      const title =
        raw.media?.title?.romaji?.trim() ||
        raw.media?.title?.english?.trim() ||
        raw.media?.title?.native?.trim() ||
        `AniList #${externalId}`;

      const existing = merged.get(externalId);
      if (!existing) {
        const customLists = new Set<string>();
        if (isCustom && listName) customLists.add(listName);
        merged.set(externalId, {
          entry: {
            externalSource: TrackerProviderType.ANILIST,
            externalId,
            title: title.slice(0, 255),
            status: mappedStatus,
            progress,
            customLists: [],
          },
          customLists,
          fromStandardList: !isCustom,
        });
        continue;
      }

      if (isCustom && listName) existing.customLists.add(listName);
      // Prefer the canonical status/progress from AniList's standard list over a custom list duplicate.
      if (!isCustom && !existing.fromStandardList) {
        existing.entry.status = mappedStatus;
        existing.entry.progress = progress;
        existing.fromStandardList = true;
      } else if (progress > existing.entry.progress) {
        existing.entry.progress = progress;
      }
    }
  }

  return Array.from(merged.values(), ({ entry, customLists }) => ({
    ...entry,
    customLists: [...customLists].sort((a, b) => a.localeCompare(b)),
  }));
}

export const anilistProvider: TrackerProvider = {
  id: TrackerProviderType.ANILIST,
  supportsCustomLists: true,

  isConfigured(): boolean {
    return Boolean(
      config.ANILIST_OAUTH_CLIENT_ID &&
        config.ANILIST_OAUTH_CLIENT_SECRET &&
        config.ANILIST_OAUTH_REDIRECT_URI &&
        config.TRACKER_CONNECTION_SECRET,
    );
  },

  getAuthUrl(state: string): string {
    const url = new URL(ANILIST_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: config.ANILIST_OAUTH_CLIENT_ID,
      redirect_uri: config.ANILIST_OAUTH_REDIRECT_URI,
      response_type: 'code',
      state,
    }).toString();
    return url.toString();
  },

  async exchangeCode(code: string): Promise<TrackerTokens> {
    const response = await fetch(ANILIST_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: config.ANILIST_OAUTH_CLIENT_ID,
        client_secret: config.ANILIST_OAUTH_CLIENT_SECRET,
        redirect_uri: config.ANILIST_OAUTH_REDIRECT_URI,
        code,
      }),
      signal: AbortSignal.timeout(ANILIST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new InvalidRequestError('AniList could not complete the connection. Please try again.');
    }

    const payload = (await response.json()) as AniListTokenResponse;
    if (!payload.access_token) {
      throw new InvalidRequestError('AniList did not return an access token. Please try again.');
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresInSeconds: typeof payload.expires_in === 'number' ? payload.expires_in : null,
    };
  },

  async fetchIdentity(accessToken: string): Promise<TrackerUserIdentity> {
    const response = await fetch(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ query: 'query { Viewer { id name } }' }),
      signal: AbortSignal.timeout(ANILIST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new InvalidRequestError('Could not read your AniList profile. Please reconnect.');
    }

    const payload = (await response.json()) as AniListViewerResponse;
    const viewer = payload.data?.Viewer;
    if (!viewer || typeof viewer.id !== 'number') {
      throw new InvalidRequestError('Could not read your AniList profile. Please reconnect.');
    }

    return {
      externalUserId: String(viewer.id),
      externalUsername: typeof viewer.name === 'string' && viewer.name.trim() ? viewer.name.trim() : null,
    };
  },

  async fetchAnimeList(auth: TrackerAuthContext): Promise<TrackerListEntry[]> {
    const userId = Number(auth.externalUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new InvalidRequestError('Invalid AniList user id on connection. Please reconnect.');
    }

    const response = await fetch(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        query: `query ($userId: Int!) {
          MediaListCollection(userId: $userId, type: ANIME) {
            lists {
              name
              isCustomList
              entries {
                status
                progress
                media {
                  id
                  title { romaji english native }
                }
              }
            }
          }
        }`,
        variables: { userId },
      }),
      signal: AbortSignal.timeout(ANILIST_TIMEOUT_MS),
    });

    if (response.status === 401) {
      throw new InvalidRequestError('Your AniList authorization expired. Please reconnect AniList.');
    }
    if (!response.ok) {
      throw new InvalidRequestError('Could not fetch your anime list from AniList. Please try again later.');
    }

    const payload = (await response.json()) as AniListMediaListCollectionResponse;
    return normalizeAniListCollection(payload);
  },

  externalUrl(externalId: string): string {
    return `https://anilist.co/anime/${externalId}`;
  },
};
