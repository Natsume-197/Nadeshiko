import type { TrackerProviderType } from '@app/models/TrackerConnection';
import type { WatchStatus } from '@app/models/UserMediaProgress';

export interface TrackerListEntry {
  externalSource: TrackerProviderType;
  externalId: string;
  title: string;
  status: WatchStatus;
  progress: number;
  customLists: string[];
}

export interface TrackerTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresInSeconds?: number | null;
}

export interface TrackerUserIdentity {
  externalUserId: string;
  externalUsername: string | null;
}

export interface TrackerAuthContext {
  accessToken: string;
  externalUserId: string;
}

/**
 * Provider-agnostic adapter interface for anime list trackers (AniList in Phase 1, MyAnimeList in Phase 2).
 *
 * Sync, storage, search filtering, spoiler protection, and UI operate exclusively on this contract so adding a
 * second tracker only requires implementing and registering one adapter.
 */
export interface TrackerProvider {
  readonly id: TrackerProviderType;
  readonly supportsCustomLists: boolean;
  /** OAuth2 PKCE: the service sends a code challenge with the authorize URL and the verifier with the code. */
  readonly usesPkce: boolean;
  isConfigured(): boolean;
  getAuthUrl(state: string, codeChallenge?: string): string;
  exchangeCode(code: string, codeVerifier?: string): Promise<TrackerTokens>;
  refreshTokens?(refreshToken: string): Promise<TrackerTokens>;
  fetchIdentity(accessToken: string): Promise<TrackerUserIdentity>;
  fetchAnimeList(auth: TrackerAuthContext): Promise<TrackerListEntry[]>;
  externalUrl(externalId: string): string;
}
