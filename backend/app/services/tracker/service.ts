import { randomBytes } from 'node:crypto';
import { In, IsNull } from 'typeorm';
import {
  AccessDeniedError,
  InvalidRequestError,
  NotFoundError,
  RateLimitExceededError,
  ValidationFailedError,
} from '@app/errors';
import {
  ExternalSourceType,
  MediaExternalId,
  TrackerConnection,
  TrackerProviderType,
  UserMediaProgress,
  WatchStatus,
} from '@app/models';
import type { User } from '@app/models/User';
import { canUseCustomTheme } from '@app/services/themes/customTheme';
import { config } from '@config/config';
import { logger } from '@config/log';
import { decryptSecret, encryptSecret } from '@lib/secretBox';
import { getTrackerProvider, listConfiguredTrackerProviders } from './registry';
import type { TrackerListEntry, TrackerProvider } from './types';

const FLOW_TTL_MS = 10 * 60_000;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
export const FREE_SYNC_COOLDOWN_MS = 6 * 60 * 60_000;
export const PATRON_SYNC_COOLDOWN_MS = 15 * 60_000;
const MAX_MISSING_ANIME = 50;

const STATE_CONTEXT = { purpose: 'tracker.oauth-state' } as const;
const tokenContext = (kind: 'access' | 'refresh', userId: number, provider: TrackerProviderType) => ({
  purpose: `tracker.${kind}-token`,
  aad: `${userId}:${provider}`,
});

interface PendingTrackerFlow {
  userId: number;
  provider: TrackerProviderType;
  nonce: string;
  expiresAt: number;
  codeVerifier?: string;
}

export interface TrackerSettingsDTO {
  autoSyncEnabled: boolean;
  spoilerGuardEnabled: boolean;
  hidePlanToWatch: boolean;
}

export interface TrackerConnectionDTO {
  provider: TrackerProviderType;
  externalUsername: string | null;
  supportsCustomLists: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  linkedAt: string;
  settings: TrackerSettingsDTO;
  effectiveSettings: TrackerSettingsDTO;
  nextManualSyncAt: string | null;
  manualCooldownSeconds: number;
}

export interface TrackerCoverageDTO {
  total: number;
  inCatalog: number;
  missing: number;
  byStatus: {
    WATCHING: number;
    COMPLETED: number;
    PAUSED: number;
    DROPPED: number;
    PLANNING: number;
  };
}

export interface TrackerProgressEntryDTO {
  mediaPublicId: string;
  title: string;
  status: WatchStatus;
  progress: number;
  customLists: string[];
}

export interface TrackerMissingAnimeDTO {
  externalSource: TrackerProviderType;
  externalId: string;
  title: string;
  status: WatchStatus;
  sourceUrl: string;
}

export interface TrackerStateDTO {
  configuredProviders: TrackerProviderType[];
  canUsePatronPerks: boolean;
  connection: TrackerConnectionDTO | null;
  coverage: TrackerCoverageDTO | null;
  customLists: string[];
  customListCount: number;
  entries: TrackerProgressEntryDTO[];
  missingAnime: TrackerMissingAnimeDTO[];
}

export interface TrackerSettingsPatch {
  autoSyncEnabled?: boolean;
  spoilerGuardEnabled?: boolean;
  hidePlanToWatch?: boolean;
}

const STATUS_PRIORITY: Record<WatchStatus, number> = {
  [WatchStatus.WATCHING]: 0,
  [WatchStatus.COMPLETED]: 1,
  [WatchStatus.PLANNING]: 2,
  [WatchStatus.PAUSED]: 3,
  [WatchStatus.DROPPED]: 4,
};

function connectionSecret(): string {
  if (!config.TRACKER_CONNECTION_SECRET) {
    throw new ValidationFailedError({ connection: 'Anime tracker linking is not configured on this server.' });
  }
  return config.TRACKER_CONNECTION_SECRET;
}

function assertProviderConfigured(provider: TrackerProvider): void {
  if (!provider.isConfigured()) {
    throw new ValidationFailedError({
      connection: `${provider.id} linking is not configured on this server.`,
    });
  }
}

export function startTrackerLink(userId: number, providerId: TrackerProviderType) {
  const provider = getTrackerProvider(providerId);
  assertProviderConfigured(provider);

  const state = encryptSecret(
    JSON.stringify({
      userId,
      provider: provider.id,
      nonce: randomBytes(24).toString('base64url'),
      expiresAt: Date.now() + FLOW_TTL_MS,
    } satisfies PendingTrackerFlow),
    connectionSecret(),
    STATE_CONTEXT,
  );

  return {
    authorizeUrl: provider.getAuthUrl(state),
    state,
  };
}

function openState(state: string): PendingTrackerFlow {
  try {
    const flow = JSON.parse(decryptSecret(state, connectionSecret(), STATE_CONTEXT)) as PendingTrackerFlow;
    if (!flow.userId || !flow.provider || !flow.nonce || flow.expiresAt < Date.now()) {
      throw new Error('expired');
    }
    return flow;
  } catch {
    throw new InvalidRequestError('This tracker link request is invalid or expired. Please start again.');
  }
}

async function resolveAccessToken(connection: TrackerConnection, provider: TrackerProvider): Promise<string> {
  const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? null;
  const needsRefresh = expiresAt !== null && expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS;

  if (!needsRefresh) {
    return decryptSecret(
      connection.accessTokenCiphertext,
      connectionSecret(),
      tokenContext('access', connection.userId, connection.provider),
    );
  }

  if (!provider.refreshTokens || !connection.refreshTokenCiphertext) {
    throw new InvalidRequestError(`Your ${provider.id} authorization expired. Please reconnect.`);
  }

  const refreshToken = decryptSecret(
    connection.refreshTokenCiphertext,
    connectionSecret(),
    tokenContext('refresh', connection.userId, connection.provider),
  );
  const tokens = await provider.refreshTokens(refreshToken);

  connection.accessTokenCiphertext = encryptSecret(
    tokens.accessToken,
    connectionSecret(),
    tokenContext('access', connection.userId, connection.provider),
  );
  if (tokens.refreshToken) {
    connection.refreshTokenCiphertext = encryptSecret(
      tokens.refreshToken,
      connectionSecret(),
      tokenContext('refresh', connection.userId, connection.provider),
    );
  }
  connection.accessTokenExpiresAt =
    typeof tokens.expiresInSeconds === 'number' && tokens.expiresInSeconds > 0
      ? new Date(Date.now() + tokens.expiresInSeconds * 1000)
      : null;
  await connection.save();
  return tokens.accessToken;
}

async function resolveExternalMediaMap(
  source: TrackerProviderType,
  externalIds: string[],
): Promise<Map<string, number>> {
  if (externalIds.length === 0) return new Map();

  // Only query sources present in MediaExternalId's enum (ANILIST in Phase 1; MAL joins in Phase 2).
  const enumValues = Object.values(ExternalSourceType) as string[];
  if (!enumValues.includes(source)) return new Map();

  const rows = await MediaExternalId.find({
    where: {
      source: source as unknown as ExternalSourceType,
      externalId: In(externalIds),
    },
    select: { mediaId: true, externalId: true },
  });

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.externalId, row.mediaId);
  }
  return map;
}

async function persistSyncedEntries(connection: TrackerConnection, entries: TrackerListEntry[]): Promise<void> {
  const externalIds = entries.map((entry) => entry.externalId);
  const mediaByExternalId = await resolveExternalMediaMap(connection.provider, externalIds);

  await TrackerConnection.getRepository().manager.transaction(async (manager) => {
    await manager.delete(UserMediaProgress, { userId: connection.userId });

    if (entries.length > 0) {
      const rows = entries.map((entry) =>
        manager.create(UserMediaProgress, {
          userId: connection.userId,
          provider: connection.provider,
          externalSource: entry.externalSource,
          externalId: entry.externalId,
          title: entry.title.slice(0, 255),
          mediaId: mediaByExternalId.get(entry.externalId) ?? null,
          status: entry.status,
          progress: entry.progress,
          customLists: entry.customLists,
        }),
      );
      // Batch inserts so a 1,000+ anime list stays well under Postgres parameter limits.
      await manager.save(UserMediaProgress, rows, { chunk: 250 });
    }

    connection.lastSyncedAt = new Date();
    connection.lastSyncError = null;
    await manager.save(TrackerConnection, connection);
  });
}

export async function syncTrackerConnection(
  connection: TrackerConnection,
  options: { enforceCooldown: boolean; canUsePatronPerks: boolean; now?: number },
): Promise<void> {
  const provider = getTrackerProvider(connection.provider);
  assertProviderConfigured(provider);

  const now = options.now ?? Date.now();
  const cooldownMs = options.canUsePatronPerks ? PATRON_SYNC_COOLDOWN_MS : FREE_SYNC_COOLDOWN_MS;
  if (options.enforceCooldown && connection.lastSyncedAt) {
    const elapsed = now - connection.lastSyncedAt.getTime();
    if (elapsed < cooldownMs) {
      const remainingMinutes = Math.max(1, Math.ceil((cooldownMs - elapsed) / 60_000));
      throw new RateLimitExceededError(
        `Your list was synced recently. Please wait ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'} before syncing again.`,
      );
    }
  }

  try {
    const accessToken = await resolveAccessToken(connection, provider);
    const entries = await provider.fetchAnimeList({
      accessToken,
      externalUserId: connection.externalUserId,
    });
    await persistSyncedEntries(connection, entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    connection.lastSyncError = message.slice(0, 500);
    await connection.save();
    throw error;
  }
}

export async function completeTrackerLink(
  user: Pick<User, 'id' | 'role'>,
  providerId: TrackerProviderType,
  code: string,
  state: string,
): Promise<TrackerStateDTO> {
  const provider = getTrackerProvider(providerId);
  assertProviderConfigured(provider);

  const flow = openState(state);
  if (flow.userId !== user.id || flow.provider !== provider.id) {
    throw new InvalidRequestError('This tracker link belongs to another account or provider.');
  }

  const tokens = await provider.exchangeCode(code, flow.codeVerifier);
  const identity = await provider.fetchIdentity(tokens.accessToken);

  const existing = await TrackerConnection.findOneBy({ userId: user.id });
  const connection = existing ?? TrackerConnection.create({ userId: user.id });

  // Switching providers replaces the previous connection and resets stale provider state.
  if (existing && existing.provider !== provider.id) {
    await UserMediaProgress.delete({ userId: user.id });
    connection.lastSyncedAt = null;
  }

  connection.provider = provider.id;
  connection.externalUserId = identity.externalUserId;
  connection.externalUsername = identity.externalUsername;
  connection.accessTokenCiphertext = encryptSecret(
    tokens.accessToken,
    connectionSecret(),
    tokenContext('access', user.id, provider.id),
  );
  connection.refreshTokenCiphertext = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken, connectionSecret(), tokenContext('refresh', user.id, provider.id))
    : null;
  connection.accessTokenExpiresAt =
    typeof tokens.expiresInSeconds === 'number' && tokens.expiresInSeconds > 0
      ? new Date(Date.now() + tokens.expiresInSeconds * 1000)
      : null;
  connection.lastSyncError = null;

  const canUsePatronPerks = await canUseCustomTheme(user);
  if (!existing) {
    // Only pre-enable patron perks when the reader already holds an active membership; free accounts start with
    // them off so the UI matches their actual state.
    connection.autoSyncEnabled = canUsePatronPerks;
    connection.spoilerGuardEnabled = canUsePatronPerks;
    connection.hidePlanToWatch = false;
  }

  await connection.save();

  // Run the initial sync immediately so the reader sees their catalog coverage right after connecting.
  try {
    await syncTrackerConnection(connection, { enforceCooldown: false, canUsePatronPerks });
  } catch (err) {
    // Keep the linked account even if the initial list fetch timed out; lastSyncError explains what happened and
    // the reader can hit Sync Now.
    logger.warn({ err, userId: user.id, provider: provider.id }, 'Initial tracker sync failed after OAuth link');
  }

  return getTrackerState(user);
}

export async function syncTrackerForUser(user: Pick<User, 'id' | 'role'>): Promise<TrackerStateDTO> {
  const connection = await TrackerConnection.findOneBy({ userId: user.id });
  if (!connection) {
    throw new NotFoundError('No anime tracker is linked');
  }
  const canUsePatronPerks = await canUseCustomTheme(user);
  await syncTrackerConnection(connection, { enforceCooldown: true, canUsePatronPerks });
  return getTrackerState(user);
}

export async function updateTrackerSettings(
  user: Pick<User, 'id' | 'role'>,
  patch: TrackerSettingsPatch,
): Promise<TrackerStateDTO> {
  const connection = await TrackerConnection.findOneBy({ userId: user.id });
  if (!connection) {
    throw new NotFoundError('No anime tracker is linked');
  }

  const canUsePatronPerks = await canUseCustomTheme(user);
  const enablingPatronFeature =
    patch.autoSyncEnabled === true || patch.spoilerGuardEnabled === true || patch.hidePlanToWatch === true;

  if (enablingPatronFeature && !canUsePatronPerks) {
    throw new AccessDeniedError(
      'Automatic sync, episode spoiler guard, and Plan to Watch hiding are patron perks. Link an active Patreon membership first.',
    );
  }

  if (patch.autoSyncEnabled !== undefined) connection.autoSyncEnabled = patch.autoSyncEnabled;
  if (patch.spoilerGuardEnabled !== undefined) connection.spoilerGuardEnabled = patch.spoilerGuardEnabled;
  if (patch.hidePlanToWatch !== undefined) connection.hidePlanToWatch = patch.hidePlanToWatch;

  await connection.save();
  return getTrackerState(user);
}

export async function unlinkTracker(userId: number): Promise<boolean> {
  const deleted = await TrackerConnection.getRepository().manager.transaction(async (manager) => {
    await manager.delete(UserMediaProgress, { userId });
    const result = await manager.delete(TrackerConnection, { userId });
    return Boolean(result.affected);
  });
  return deleted;
}

export async function getTrackerState(user: Pick<User, 'id' | 'role'>): Promise<TrackerStateDTO> {
  const [connection, canUsePatronPerks] = await Promise.all([
    TrackerConnection.findOneBy({ userId: user.id }),
    canUseCustomTheme(user),
  ]);

  const configuredProviders = listConfiguredTrackerProviders();

  if (!connection) {
    return {
      configuredProviders,
      canUsePatronPerks,
      connection: null,
      coverage: null,
      customLists: [],
      customListCount: 0,
      entries: [],
      missingAnime: [],
    };
  }

  const provider = getTrackerProvider(connection.provider);
  const rows = await UserMediaProgress.find({
    where: { userId: user.id, provider: connection.provider },
    relations: { media: true },
  });

  const byStatus: TrackerCoverageDTO['byStatus'] = {
    WATCHING: 0,
    COMPLETED: 0,
    PAUSED: 0,
    DROPPED: 0,
    PLANNING: 0,
  };

  const allCustomLists = new Set<string>();
  const matchedEntries: TrackerProgressEntryDTO[] = [];
  const unmatchedRows: UserMediaProgress[] = [];

  for (const row of rows) {
    byStatus[row.status] += 1;
    for (const listName of row.customLists ?? []) {
      if (listName) allCustomLists.add(listName);
    }

    if (row.media?.publicId) {
      matchedEntries.push({
        mediaPublicId: row.media.publicId,
        title: row.media.nameRomaji || row.media.nameEn || row.title,
        status: row.status,
        progress: row.progress,
        customLists: canUsePatronPerks ? (row.customLists ?? []) : [],
      });
    } else {
      unmatchedRows.push(row);
    }
  }

  matchedEntries.sort(
    (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || a.title.localeCompare(b.title),
  );

  unmatchedRows.sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || a.title.localeCompare(b.title));

  const missingAnime: TrackerMissingAnimeDTO[] = unmatchedRows
    .filter(
      (row) =>
        row.status === WatchStatus.WATCHING ||
        row.status === WatchStatus.COMPLETED ||
        row.status === WatchStatus.PLANNING,
    )
    .slice(0, MAX_MISSING_ANIME)
    .map((row) => ({
      externalSource: row.provider,
      externalId: row.externalId,
      title: row.title,
      status: row.status,
      sourceUrl: provider.externalUrl(row.externalId),
    }));

  const cooldownMs = canUsePatronPerks ? PATRON_SYNC_COOLDOWN_MS : FREE_SYNC_COOLDOWN_MS;
  const nextManualSyncMs = connection.lastSyncedAt ? connection.lastSyncedAt.getTime() + cooldownMs : null;
  const nextManualSyncAt =
    nextManualSyncMs && nextManualSyncMs > Date.now() ? new Date(nextManualSyncMs).toISOString() : null;

  const settings: TrackerSettingsDTO = {
    autoSyncEnabled: connection.autoSyncEnabled,
    spoilerGuardEnabled: connection.spoilerGuardEnabled,
    hidePlanToWatch: connection.hidePlanToWatch,
  };

  // Lapsed patrons keep their stored toggles intact so renewal restores them, but effective settings clamp off.
  const effectiveSettings: TrackerSettingsDTO = canUsePatronPerks
    ? settings
    : {
        autoSyncEnabled: false,
        spoilerGuardEnabled: false,
        hidePlanToWatch: false,
      };

  const sortedCustomLists = [...allCustomLists].sort((a, b) => a.localeCompare(b));

  return {
    configuredProviders,
    canUsePatronPerks,
    connection: {
      provider: connection.provider,
      externalUsername: connection.externalUsername ?? null,
      supportsCustomLists: provider.supportsCustomLists,
      lastSyncedAt: connection.lastSyncedAt ? connection.lastSyncedAt.toISOString() : null,
      lastSyncError: connection.lastSyncError ?? null,
      linkedAt: connection.createdAt.toISOString(),
      settings,
      effectiveSettings,
      nextManualSyncAt,
      manualCooldownSeconds: Math.round(cooldownMs / 1000),
    },
    coverage: {
      total: rows.length,
      inCatalog: matchedEntries.length,
      missing: unmatchedRows.length,
      byStatus,
    },
    customLists: canUsePatronPerks && provider.supportsCustomLists ? sortedCustomLists : [],
    customListCount: provider.supportsCustomLists ? sortedCustomLists.length : 0,
    entries: matchedEntries,
    missingAnime,
  };
}

/**
 * Link newly ingested media back to any reader's previously unmatched `UserMediaProgress` rows.
 * Never throws: ingest must succeed even if progress back-linking hits a transient DB issue.
 */
export async function linkProgressForMedia(mediaId: number): Promise<number> {
  try {
    const externalIds = await MediaExternalId.find({
      where: { mediaId },
      select: { source: true, externalId: true },
    });
    if (externalIds.length === 0) return 0;

    let updated = 0;
    for (const ext of externalIds) {
      if (ext.source !== ExternalSourceType.ANILIST) continue;
      const result = await UserMediaProgress.update(
        {
          externalSource: ext.source,
          externalId: ext.externalId,
          mediaId: IsNull(),
        },
        { mediaId },
      );
      updated += result.affected ?? 0;
    }
    return updated;
  } catch (err) {
    logger.warn({ err, mediaId }, 'Could not back-link tracker progress for newly created media');
    return 0;
  }
}
