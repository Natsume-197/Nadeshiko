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

const MAL_AUTHORIZE_URL = 'https://myanimelist.net/v1/oauth2/authorize';
const MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
const MAL_API_ORIGIN = 'https://api.myanimelist.net';
const MAL_TIMEOUT_MS = 12_000;
/** MAL's maximum page size for `animelist`. */
const MAL_PAGE_SIZE = 1000;
/** Guards against a paging loop; 20 pages is 20,000 entries, far beyond any real list. */
const MAL_MAX_PAGES = 20;

interface MalTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface MalUserResponse {
  id?: number;
  name?: string | null;
}

interface MalRawEntry {
  node?: {
    id?: number | null;
    title?: string | null;
  } | null;
  list_status?: {
    status?: string | null;
    num_episodes_watched?: number | null;
    is_rewatching?: boolean | null;
  } | null;
}

export interface MalAnimeListPage {
  data?: MalRawEntry[] | null;
  paging?: { next?: string | null } | null;
}

const MAL_STATUS_MAP: Record<string, WatchStatus> = {
  watching: WatchStatus.WATCHING,
  completed: WatchStatus.COMPLETED,
  on_hold: WatchStatus.PAUSED,
  dropped: WatchStatus.DROPPED,
  plan_to_watch: WatchStatus.PLANNING,
};

/** Normalize MAL `animelist` rows. MAL has no custom lists, and each anime appears once. */
export function normalizeMalAnimeList(rows: MalRawEntry[]): TrackerListEntry[] {
  const merged = new Map<string, TrackerListEntry>();

  for (const raw of rows) {
    const animeId = raw?.node?.id;
    if (typeof animeId !== 'number' || !Number.isInteger(animeId) || animeId <= 0) continue;

    const listStatus = raw.list_status;
    const mapped = listStatus?.status ? MAL_STATUS_MAP[listStatus.status] : undefined;
    if (!mapped) continue;
    // Rewatching means the reader already finished the anime once (MAL keeps it under watching or completed).
    const status = listStatus?.is_rewatching ? WatchStatus.COMPLETED : mapped;

    const watched = listStatus?.num_episodes_watched;
    const progress = typeof watched === 'number' && Number.isFinite(watched) && watched > 0 ? Math.floor(watched) : 0;
    const externalId = String(animeId);
    const title = raw.node?.title?.trim() || `MyAnimeList #${externalId}`;

    merged.set(externalId, {
      externalSource: TrackerProviderType.MAL,
      externalId,
      title: title.slice(0, 255),
      status,
      progress,
      customLists: [],
    });
  }

  return [...merged.values()];
}

function tokenRequestBody(grant: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams({ client_id: config.MAL_OAUTH_CLIENT_ID, ...grant });
  // MAL "web" apps have a client secret; "other" (public) apps rely on PKCE alone.
  if (config.MAL_OAUTH_CLIENT_SECRET) body.set('client_secret', config.MAL_OAUTH_CLIENT_SECRET);
  return body;
}

async function requestTokens(grant: Record<string, string>, failureMessage: string): Promise<TrackerTokens> {
  const response = await fetch(MAL_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: tokenRequestBody(grant).toString(),
    signal: AbortSignal.timeout(MAL_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new InvalidRequestError(failureMessage);
  }

  const payload = (await response.json()) as MalTokenResponse;
  if (!payload.access_token) {
    throw new InvalidRequestError(failureMessage);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresInSeconds: typeof payload.expires_in === 'number' ? payload.expires_in : null,
  };
}

/** Only follow paging links back to the MAL API, so the reader's token is never sent elsewhere. */
function nextPageUrl(next: string | null | undefined): string | null {
  if (!next) return null;
  try {
    const url = new URL(next);
    return url.origin === MAL_API_ORIGIN ? url.toString() : null;
  } catch {
    return null;
  }
}

export const malProvider: TrackerProvider = {
  id: TrackerProviderType.MAL,
  supportsCustomLists: false,
  usesPkce: true,

  isConfigured(): boolean {
    return Boolean(config.MAL_OAUTH_CLIENT_ID && config.MAL_OAUTH_REDIRECT_URI && config.TRACKER_CONNECTION_SECRET);
  },

  getAuthUrl(state: string, codeChallenge?: string): string {
    if (!codeChallenge) {
      throw new InvalidRequestError('MyAnimeList linking needs a PKCE code challenge.');
    }
    const url = new URL(MAL_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.MAL_OAUTH_CLIENT_ID,
      redirect_uri: config.MAL_OAUTH_REDIRECT_URI,
      state,
      code_challenge: codeChallenge,
      // MAL only supports the plain method.
      code_challenge_method: 'plain',
    }).toString();
    return url.toString();
  },

  async exchangeCode(code: string, codeVerifier?: string): Promise<TrackerTokens> {
    if (!codeVerifier) {
      throw new InvalidRequestError('This tracker link request is invalid or expired. Please start again.');
    }
    return requestTokens(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.MAL_OAUTH_REDIRECT_URI,
        code_verifier: codeVerifier,
      },
      'MyAnimeList could not complete the connection. Please try again.',
    );
  },

  async refreshTokens(refreshToken: string): Promise<TrackerTokens> {
    // MAL rotates refresh tokens: the caller must store the new one returned here.
    return requestTokens(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      'Your MyAnimeList authorization expired. Please reconnect MyAnimeList.',
    );
  },

  async fetchIdentity(accessToken: string): Promise<TrackerUserIdentity> {
    const response = await fetch(`${MAL_API_ORIGIN}/v2/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(MAL_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new InvalidRequestError('Could not read your MyAnimeList profile. Please reconnect.');
    }

    const payload = (await response.json()) as MalUserResponse;
    if (typeof payload.id !== 'number') {
      throw new InvalidRequestError('Could not read your MyAnimeList profile. Please reconnect.');
    }

    return {
      externalUserId: String(payload.id),
      externalUsername: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null,
    };
  },

  async fetchAnimeList(auth: TrackerAuthContext): Promise<TrackerListEntry[]> {
    const first = new URL(`${MAL_API_ORIGIN}/v2/users/@me/animelist`);
    first.search = new URLSearchParams({
      fields: 'list_status',
      limit: String(MAL_PAGE_SIZE),
      // Without nsfw=true MAL silently drops adult entries from the reader's own list.
      nsfw: 'true',
    }).toString();

    const rows: MalRawEntry[] = [];
    let url: string | null = first.toString();
    for (let page = 0; url && page < MAL_MAX_PAGES; page += 1) {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${auth.accessToken}`, accept: 'application/json' },
        signal: AbortSignal.timeout(MAL_TIMEOUT_MS),
      });

      if (response.status === 401) {
        throw new InvalidRequestError('Your MyAnimeList authorization expired. Please reconnect MyAnimeList.');
      }
      if (!response.ok) {
        throw new InvalidRequestError('Could not fetch your anime list from MyAnimeList. Please try again later.');
      }

      const payload = (await response.json()) as MalAnimeListPage;
      rows.push(...(payload.data ?? []));
      url = nextPageUrl(payload.paging?.next);
    }

    return normalizeMalAnimeList(rows);
  },

  externalUrl(externalId: string): string {
    return `https://myanimelist.net/anime/${externalId}`;
  },
};
