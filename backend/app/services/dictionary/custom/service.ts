import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { User, UserDictionary, UserDictionaryArtifact, type UserDictionaryArtifactStatus } from '@app/models';
import { config } from '@config/config';
import { logger } from '@config/log';
import { DuplicateKeyError, InvalidRequestError, NotFoundError } from '@app/errors';
import { getPgBoss } from '@app/workers/pgBossClient';
import { USER_DICTIONARY_IMPORT_QUEUE } from '@app/workers/queueNames';
import {
  assertDictionarySlot,
  assertIndexedSpace,
  assertZipSize,
  dictionaryLimitError,
  resolveCustomDictionaryQuota,
} from './quotas';
import {
  artifactExistsInStorage,
  deleteArtifactFromR2,
  getR2StorageConfig,
  pruneLocalDictionaryCache,
  sweepStaleTempFiles,
  uploadArtifactToR2,
} from './r2Storage';
import { runYomitanImportInThread } from './importRunner';
import { artifactSqlitePath, removeArtifactFile } from './sqlitePool';
import { IMPORTER_VERSION, inspectYomitanZip, type YomitanIndex, YomitanValidationError } from './yomitanImport';
import { ZipFormatError, ZipLimitError } from './zipReader';

export const BUILTIN_JMDICT_ID = 'jmdict';
export const CUSTOM_DICT_PREFIX = 'custom:';

export interface UserDictionaryDto {
  id: number;
  stackId: string;
  title: string;
  revision: string;
  author: string | null;
  description: string | null;
  url: string | null;
  frequencyMode: string | null;
  hasTerms: boolean;
  hasFrequency: boolean;
  hasPitch: boolean;
  termCount: number;
  frequencyCount: number;
  pitchCount: number;
  hasKanji: boolean;
  hasKanjiFrequency: boolean;
  hasKanjiTerms: boolean;
  kanjiCount: number;
  kanjiFrequencyCount: number;
  zipBytes: number;
  sqliteBytes: number;
  status: UserDictionaryArtifactStatus;
  errorMessage: string | null;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  /** Running import, 0–100; null when queued, ready or failed. */
  progress: number | null;
  /** Place in the import queue (1 = next) while waiting to start; null once it runs or is done. */
  queuePosition: number | null;
}

export interface UserDictionaryListResponse {
  dictionaries: UserDictionaryDto[];
  builtin: {
    id: string;
    enabled: boolean;
    position: number;
  };
  quota: {
    used: number;
    max: number;
    maxZipBytes: number;
    isPatron: boolean;
    indexedBytesUsed: number;
    maxIndexedBytes: number;
  };
  stackFingerprint: string | null;
  /** Uploads go straight to R2 (reserve, PUT, complete) rather than through the upload endpoint. */
  directUpload: boolean;
}

export interface SessionCustomDictionaries {
  count: number;
  stackFingerprint: string | null;
}

export interface ActiveUserDictionaryStack {
  dictionaries: Array<{
    userDictionaryId: number;
    stackId: string;
    sortOrder: number;
    artifactId: number;
    sha256: string;
    storageKey: string;
    title: string;
    frequencyMode: string | null;
    hasTerms: boolean;
    hasFrequency: boolean;
    hasPitch: boolean;
    hasKanji: boolean;
    hasKanjiFrequency: boolean;
    hasKanjiTerms: boolean;
  }>;
  builtinEnabled: boolean;
  builtinPosition: number;
  stackFingerprint: string | null;
  /** Enabled dictionaries still indexing: part of the fingerprint, not queried yet. */
  pendingCount: number;
}

function stackIdOf(userDictionaryId: number): string {
  return `${CUSTOM_DICT_PREFIX}${userDictionaryId}`;
}

/** A reader's dictionaries with their artifacts, in stack order. */
function userDictionaryRows(userId: number): Promise<UserDictionary[]> {
  return UserDictionary.find({
    where: { userId },
    relations: { artifact: true },
    order: { sortOrder: 'ASC', id: 'ASC' },
  });
}

/** The artifact columns a dictionary's `index.json` sets. */
function indexFields(
  index: Pick<YomitanIndex, 'title' | 'revision' | 'author' | 'description' | 'url' | 'format' | 'frequencyMode'>,
) {
  return {
    title: index.title,
    revision: index.revision,
    author: index.author,
    description: index.description,
    url: index.url,
    format: index.format,
    frequencyMode: index.frequencyMode,
  };
}

function toDto(
  row: UserDictionary,
  artifact: UserDictionaryArtifact,
  queuePositions: ReadonlyMap<number, number> = new Map(),
): UserDictionaryDto {
  const running = artifact.status === 'processing' && artifact.importStartedAt != null;
  return {
    id: row.id,
    stackId: stackIdOf(row.id),
    title: artifact.title,
    revision: artifact.revision,
    author: artifact.author ?? null,
    description: artifact.description ?? null,
    url: artifact.url ?? null,
    frequencyMode: artifact.frequencyMode ?? null,
    hasTerms: artifact.hasTerms,
    hasFrequency: artifact.hasFrequency,
    hasPitch: artifact.hasPitch,
    termCount: artifact.termCount,
    frequencyCount: artifact.frequencyCount,
    pitchCount: artifact.pitchCount,
    hasKanji: artifact.hasKanji,
    hasKanjiFrequency: artifact.hasKanjiFrequency,
    hasKanjiTerms: artifact.hasKanjiTerms,
    kanjiCount: artifact.kanjiCount,
    kanjiFrequencyCount: artifact.kanjiFrequencyCount,
    zipBytes: Number(artifact.zipBytes),
    sqliteBytes: Number(artifact.sqliteBytes),
    status: artifact.status,
    errorMessage: artifact.errorMessage ?? null,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    progress: running ? (artifact.importProgress ?? 0) : null,
    queuePosition: artifact.status === 'processing' && !running ? (queuePositions.get(artifact.id) ?? null) : null,
  };
}

/** Where each queued import (processing, not started) stands, 1 = next, in the order they were queued. */
async function importQueuePositions(): Promise<Map<number, number>> {
  const queued: Array<{ id: number }> = await UserDictionaryArtifact.createQueryBuilder('a')
    .select('a.id', 'id')
    .where("a.status = 'processing' AND a.import_started_at IS NULL")
    .orderBy('a.updated_at', 'ASC')
    .addOrderBy('a.id', 'ASC')
    .getRawMany();
  return new Map(queued.map((row, index) => [Number(row.id), index + 1]));
}

/**
 * The reader's stack as a cache key (browser URLs and the session carry it). It covers enabled dictionaries that are
 * ready or still indexing, so it changes when the reader uploads, reorders, toggles or deletes (all writes, which
 * renew the session) and not when an import finishes in the background (which renews nothing). While one is
 * indexing, lookups are answered `pending` and never cached, so the key staying put is safe. It uses the storage key
 * rather than the artifact id because a re-index (newer importer) moves the file to a new key.
 */
function buildStackFingerprint(
  rows: UserDictionary[],
  builtinEnabled: boolean,
  builtinPosition: number,
): string | null {
  const live = rows.filter(
    (row) => row.enabled && (row.artifact?.status === 'ready' || row.artifact?.status === 'processing'),
  );
  if (live.length === 0 && builtinEnabled) return null;
  const payload = JSON.stringify({
    b: builtinEnabled ? builtinPosition : -1,
    d: live.map((row) => [row.artifact?.storageKey.slice(0, 16), row.sortOrder]),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** Where JMdict sits in the reader's stack. One definition for lookups, the list and the session, because all three
 * feed the same fingerprint and must agree on it. */
function builtinPlacement(
  user: Pick<User, 'preferences'> | null,
  dictionaryCount: number,
): { builtinEnabled: boolean; builtinPosition: number } {
  const pref = user?.preferences?.dictionaryStack;
  const position = pref?.builtinPosition;
  return {
    builtinEnabled: pref?.builtinEnabled !== false,
    builtinPosition:
      typeof position === 'number' && Number.isInteger(position) && position >= 0
        ? Math.min(position, dictionaryCount)
        : dictionaryCount,
  };
}

/**
 * Each reader's stack, kept 30 s: the word card asks for it on every word, and it changes only when the reader
 * changes it (invalidated here) or an import ends (all dropped). Another container picks a change up within 30 s.
 */
const STACK_CACHE_MS = 30_000;
const STACK_CACHE_MAX_ENTRIES = 20_000;
const stackCache = new Map<number, { at: number; stack: Promise<ActiveUserDictionaryStack> }>();

/** Drops one reader's cached stack, or everyone's when no id is given (an import ended for a shared file). */
export function invalidateUserDictionaryStack(userId?: number): void {
  if (userId === undefined) stackCache.clear();
  else stackCache.delete(userId);
}

/**
 * Loads the user's active (enabled + ready) custom dictionaries and built-in JMdict settings.
 * Used on the lookup hot path and by session enrichment, through a short per-reader cache.
 */
export function loadActiveUserDictionaryStack(userId: number): Promise<ActiveUserDictionaryStack> {
  const now = Date.now();
  const cached = stackCache.get(userId);
  if (cached && now - cached.at < STACK_CACHE_MS) return cached.stack;

  if (stackCache.size >= STACK_CACHE_MAX_ENTRIES) stackCache.clear();
  const stack = readActiveUserDictionaryStack(userId);
  stackCache.set(userId, { at: now, stack });
  stack.catch(() => {
    if (stackCache.get(userId)?.stack === stack) stackCache.delete(userId);
  });
  return stack;
}

async function readActiveUserDictionaryStack(userId: number): Promise<ActiveUserDictionaryStack> {
  const [user, rows] = await Promise.all([
    User.findOne({ where: { id: userId }, select: { id: true, preferences: true } }),
    userDictionaryRows(userId),
  ]);

  const { builtinEnabled, builtinPosition } = builtinPlacement(user, rows.length);

  const readyEnabled = rows.flatMap((row) => {
    const a = row.artifact;
    if (!row.enabled || a?.status !== 'ready') return [];
    return [
      {
        userDictionaryId: row.id,
        stackId: stackIdOf(row.id),
        sortOrder: row.sortOrder,
        artifactId: a.id,
        sha256: a.sha256,
        storageKey: a.storageKey,
        title: a.title,
        frequencyMode: a.frequencyMode ?? null,
        hasTerms: a.hasTerms,
        hasFrequency: a.hasFrequency,
        hasPitch: a.hasPitch,
        hasKanji: a.hasKanji,
        hasKanjiFrequency: a.hasKanjiFrequency,
        hasKanjiTerms: a.hasKanjiTerms,
      },
    ];
  });

  return {
    dictionaries: readyEnabled,
    builtinEnabled,
    builtinPosition,
    stackFingerprint: buildStackFingerprint(rows, builtinEnabled, builtinPosition),
    pendingCount: rows.filter((row) => row.enabled && row.artifact?.status === 'processing').length,
  };
}

/** Throws a 404 while USER_DICTIONARIES_ENABLED is off, so the endpoints look absent rather than broken. */
export function assertCustomDictionariesEnabled(): void {
  if (!config.USER_DICTIONARIES_ENABLED) {
    throw new NotFoundError('Custom dictionaries are not available');
  }
}

/** `null` means the feature is off, and the frontend hides the settings tab on it. A read failure while it is on still
 * returns an object, with no stack, so a transient database error does not hide the tab. */
export async function getSessionCustomDictionaries(userId: number): Promise<SessionCustomDictionaries | null> {
  if (!config.USER_DICTIONARIES_ENABLED) return null;
  if (!Number.isInteger(userId) || userId <= 0) return null;
  try {
    const stack = await loadActiveUserDictionaryStack(userId);
    return {
      count: stack.dictionaries.length,
      stackFingerprint: stack.stackFingerprint,
    };
  } catch (error) {
    logger.warn({ err: error, userId }, 'Could not read user custom dictionaries for session; defaulting to none');
    return { count: 0, stackFingerprint: null };
  }
}

/** A running import heartbeats every few seconds; one silent this long died with its container or thread. */
export const STALLED_IMPORT_AFTER_MINUTES = 3;
/** A queued import that never started this long after it was queued lost its job. Generous: a queue of large
 * dictionaries on a small container can take this long to drain. */
export const INTERRUPTED_IMPORT_AFTER_MINUTES = 120;

export const INTERRUPTED_IMPORT_MESSAGE = 'Indexing was interrupted (the server restarted). Upload the file again.';

/** How often a running import's heartbeat is written to its row (the thread beats every second). */
const HEARTBEAT_WRITE_MS = 5000;

/**
 * Marks imports that can no longer finish as failed: running ones whose heartbeat stopped, and queued ones that never
 * started. Otherwise a restart mid-import leaves an artifact in `processing` forever; while it sits there, nobody can
 * upload that file again, because the upload attaches to the import still "running".
 */
export async function failInterruptedImports(): Promise<number> {
  const result = await UserDictionaryArtifact.createQueryBuilder()
    .update()
    .set({ status: 'failed', errorMessage: INTERRUPTED_IMPORT_MESSAGE, importProgress: null })
    .where('status = :status', { status: 'processing' })
    .andWhere(
      `((import_started_at IS NOT NULL
          AND coalesce(import_heartbeat_at, import_started_at) < now() - make_interval(mins => :stalled))
        OR (import_started_at IS NULL AND updated_at < now() - make_interval(mins => :queued)))`,
      { stalled: STALLED_IMPORT_AFTER_MINUTES, queued: INTERRUPTED_IMPORT_AFTER_MINUTES },
    )
    .execute();
  const count = result.affected ?? 0;
  if (count > 0) {
    invalidateUserDictionaryStack();
    logger.warn({ count }, 'Marked interrupted custom dictionary imports as failed');
  }
  return count;
}

export async function listUserDictionaries(user: Pick<User, 'id' | 'role'>): Promise<UserDictionaryListResponse> {
  // Cheap on a table this size, and it is what shows a reader that an import died instead of spinning forever.
  await failInterruptedImports().catch((error) =>
    logger.warn({ err: error }, 'Could not mark interrupted custom dictionary imports'),
  );
  const [quota, dbUser, rows] = await Promise.all([
    resolveCustomDictionaryQuota(user),
    User.findOne({ where: { id: user.id }, select: { id: true, preferences: true } }),
    userDictionaryRows(user.id),
  ]);

  const { builtinEnabled, builtinPosition } = builtinPlacement(dbUser, rows.length);
  const positions = rows.some((row) => row.artifact?.status === 'processing' && !row.artifact.importStartedAt)
    ? await importQueuePositions()
    : new Map<number, number>();
  const dictionaries = rows.flatMap((row) => (row.artifact ? [toDto(row, row.artifact, positions)] : []));
  const indexedBytesUsed = rows.reduce((sum, row) => sum + Number(row.artifact?.sqliteBytes ?? 0), 0);

  return {
    dictionaries,
    builtin: {
      id: BUILTIN_JMDICT_ID,
      enabled: builtinEnabled,
      position: builtinPosition,
    },
    quota: {
      used: dictionaries.length,
      max: quota.maxDictionaries,
      maxZipBytes: quota.maxZipBytes,
      isPatron: quota.isPatron,
      indexedBytesUsed,
      maxIndexedBytes: quota.maxIndexedBytes,
    },
    stackFingerprint: buildStackFingerprint(rows, builtinEnabled, builtinPosition),
    // Every deployed environment has R2; local development without it keeps the classic upload.
    directUpload: getR2StorageConfig() !== null,
  };
}

/**
 * Executes the SQLite import for one artifact and removes the temporary uploaded `.zip` afterwards.
 * Called by the pg-boss worker (or directly in tests / when pg-boss is not booted).
 */
export async function processArtifactImportJob(artifactId: number, tmpZipPath: string): Promise<void> {
  const artifact = await UserDictionaryArtifact.findOneBy({ id: artifactId });
  if (!artifact) {
    await unlink(tmpZipPath).catch(() => {});
    return;
  }

  // Every write below is conditional on the row still being this job's: the reader may delete the dictionary while it
  // indexes (the row is deleted), or a stalled import may be re-queued under a new storage key. A plain `save()` would
  // re-insert a deleted row or overwrite the newer key.
  const storageKey = artifact.storageKey;
  const ours = { id: artifact.id, storageKey, status: 'processing' as const };
  const targetPath = artifactSqlitePath(config.USER_DICTIONARIES_DIR, storageKey);
  try {
    // The `.zip` lives on the disk of the container that took the upload; a job picked up by another container (rolling
    // deploy) or after a restart finds nothing to import.
    if (!existsSync(tmpZipPath)) {
      throw new Error(INTERRUPTED_IMPORT_MESSAGE);
    }
    const startedAt = new Date();
    const started = await UserDictionaryArtifact.update(ours, {
      importStartedAt: startedAt,
      importHeartbeatAt: startedAt,
      importProgress: 0,
    });
    if (!started.affected) {
      logger.info({ artifactId: artifact.id }, 'Custom dictionary import is no longer wanted; skipped it');
      return;
    }
    // Its own thread and heap: see `importRunner.ts`. Its heartbeats reach the row every few seconds, so a reader sees
    // the progress and `failInterruptedImports` can tell a live import from a dead one.
    let lastWrite = 0;
    const result = await runYomitanImportInThread(tmpZipPath, targetPath, {
      onProgress: (fraction) => {
        const now = Date.now();
        if (now - lastWrite < HEARTBEAT_WRITE_MS) return;
        lastWrite = now;
        // A failed heartbeat write must never fail the import itself.
        void Promise.resolve()
          .then(() =>
            UserDictionaryArtifact.update(ours, {
              importHeartbeatAt: new Date(now),
              importProgress: Math.min(99, Math.floor(fraction * 100)),
            }),
          )
          .catch(() => {});
      },
    });

    // Deleted (or re-queued) while indexing: nothing will ever read this file, so do not upload it.
    if (!(await UserDictionaryArtifact.existsBy(ours))) {
      await discardImportOutput(artifact.id, storageKey);
      logger.info({ artifactId: artifact.id }, 'Custom dictionary was removed while indexing; discarded its file');
      return;
    }

    // A large upload can take minutes; keep heartbeating so `failInterruptedImports` does not take it for dead.
    const heartbeat = setInterval(() => {
      void UserDictionaryArtifact.update(ours, { importHeartbeatAt: new Date() }).catch(() => {});
    }, HEARTBEAT_WRITE_MS);
    try {
      await uploadArtifactToR2(storageKey, targetPath);
    } finally {
      clearInterval(heartbeat);
    }
    void pruneLocalDictionaryCache().catch(() => {});

    const fields = {
      ...indexFields(result.index),
      hasTerms: result.hasTerms,
      hasFrequency: result.hasFrequency,
      hasPitch: result.hasPitch,
      termCount: result.termCount,
      frequencyCount: result.frequencyCount,
      pitchCount: result.pitchCount,
      hasKanji: result.hasKanji,
      hasKanjiFrequency: result.hasKanjiFrequency,
      hasKanjiTerms: result.hasKanjiTerms,
      kanjiCount: result.kanjiCount,
      kanjiFrequencyCount: result.kanjiFrequencyCount,
      sqliteBytes: String(result.sqliteBytes),
      status: 'ready' as const,
      errorMessage: null,
      importerVersion: IMPORTER_VERSION,
      importProgress: null,
    };
    const finished = await UserDictionaryArtifact.update(ours, fields);
    if (!finished.affected) {
      // Removed or re-queued during the upload: what this job built and uploaded belongs to no row.
      await discardImportOutput(artifact.id, storageKey);
      logger.info({ artifactId: artifact.id }, 'Custom dictionary was removed while indexing; discarded its file');
      return;
    }
    Object.assign(artifact, fields);

    logger.info(
      {
        artifactId: artifact.id,
        title: artifact.title,
        terms: artifact.termCount,
        freq: artifact.frequencyCount,
        pitch: artifact.pitchCount,
        kanji: artifact.kanjiCount,
        kanjiFreq: artifact.kanjiFrequencyCount,
        kanjiTerms: artifact.hasKanjiTerms,
        sqliteBytes: result.sqliteBytes,
      },
      'Indexed custom Yomitan dictionary artifact',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dictionary indexing failed';
    const failed = { status: 'failed' as const, errorMessage: message.slice(0, 500), importProgress: null };
    const marked = await UserDictionaryArtifact.update(ours, failed).catch(() => null);
    if (marked?.affected) {
      Object.assign(artifact, failed);
    } else if (marked) {
      // No longer this job's row (removed or re-queued): drop whatever it built or uploaded.
      await discardImportOutput(artifact.id, storageKey).catch(() => {});
    }
    logger.warn({ err: error, artifactId: artifact.id }, 'Failed to index custom Yomitan dictionary');
  } finally {
    invalidateUserDictionaryStack();
    await unlink(tmpZipPath).catch(() => {});
  }
}

/**
 * Validates an uploaded `.zip` file on disk, checks per-account quota and duplicates, deduplicates against any
 * existing ready artifact with the same SHA-256, or queues background SQLite indexing.
 */
export async function attachOrQueueUploadedDictionary(
  user: Pick<User, 'id' | 'role'>,
  tmpZipPath: string,
  sha256: string,
  zipBytes: number,
): Promise<{ dictionary: UserDictionaryDto; deduplicated: boolean; stackFingerprint: string | null }> {
  let keepTempZip = false;
  try {
    // A dead import must read as `failed` before the checks below, or this upload of the same file is refused as a
    // duplicate / attached to an import that will never finish.
    await failInterruptedImports();
    const quota = await resolveCustomDictionaryQuota(user);
    assertZipSize(quota, zipBytes);

    let index: YomitanIndex;
    try {
      index = await inspectYomitanZip(tmpZipPath);
    } catch (error) {
      if (
        error instanceof YomitanValidationError ||
        error instanceof ZipFormatError ||
        error instanceof ZipLimitError
      ) {
        throw new InvalidRequestError(error.message);
      }
      throw error;
    }

    const existingRows = await userDictionaryRows(user.id);

    const alreadyLinked = existingRows.find((row) => row.artifact?.sha256 === sha256);
    if (alreadyLinked?.artifact) {
      // Allow re-uploading a previously failed dictionary so the user can recover without deleting first.
      if (alreadyLinked.artifact.status !== 'failed') {
        throw new DuplicateKeyError(`"${index.title}" is already in your dictionary list`);
      }
    } else {
      assertDictionarySlot(quota, existingRows.length);
    }

    // Space already indexed for this account (less the failed one being replaced); a new upload is refused once it is
    // used up.
    assertIndexedSpace(quota, existingRows, alreadyLinked);

    let artifact = await UserDictionaryArtifact.findOneBy({ sha256 });
    let deduplicated = false;
    let needsImport = false;

    if (
      artifact &&
      artifact.status === 'ready' &&
      artifact.importerVersion === IMPORTER_VERSION &&
      (await artifactExistsInStorage(artifact.storageKey))
    ) {
      deduplicated = true;
    } else if (artifact && artifact.status === 'processing') {
      // Another upload of the exact same zip is already indexing; attach to it.
      deduplicated = false;
    } else if (artifact) {
      // Failed, built by an older importer, or its SQLite object is gone: re-index from this upload. Under a new storage
      // key, because other containers may hold the old file in their local cache under the old one.
      await purgeArtifactStorage(artifact.storageKey);
      artifact.storageKey = randomBytes(32).toString('hex');
      Object.assign(artifact, indexFields(index));
      artifact.zipBytes = String(zipBytes);
      artifact.status = 'processing';
      artifact.errorMessage = null;
      // Queued again: no start, heartbeat or progress until the job picks it up.
      artifact.importStartedAt = null;
      artifact.importHeartbeatAt = null;
      artifact.importProgress = null;
      await artifact.save();
      // A shared file is being rebuilt: every reader who has it now waits for it, not just this one.
      invalidateUserDictionaryStack();
      needsImport = true;
    } else {
      artifact = UserDictionaryArtifact.create({
        sha256,
        storageKey: randomBytes(32).toString('hex'),
        ...indexFields(index),
        hasTerms: false,
        hasFrequency: false,
        hasPitch: false,
        termCount: 0,
        frequencyCount: 0,
        pitchCount: 0,
        hasKanji: false,
        hasKanjiFrequency: false,
        hasKanjiTerms: false,
        kanjiCount: 0,
        kanjiFrequencyCount: 0,
        zipBytes: String(zipBytes),
        sqliteBytes: '0',
        status: 'processing',
        errorMessage: null,
      });
      try {
        await artifact.save();
        needsImport = true;
      } catch (err: any) {
        // Concurrent upload race on unique sha256: reload the winning artifact.
        if (err?.code === '23505') {
          artifact = await UserDictionaryArtifact.findOneByOrFail({ sha256 });
          deduplicated = artifact.status === 'ready' && (await artifactExistsInStorage(artifact.storageKey));
        } else {
          throw err;
        }
      }
    }

    let userDict = alreadyLinked;
    if (!userDict) {
      const nextOrder = existingRows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
      userDict = UserDictionary.create({
        userId: user.id,
        artifactId: artifact.id,
        enabled: true,
        sortOrder: nextOrder,
      });
      try {
        await userDict.save();
      } catch (err: any) {
        // The same file uploaded twice at once by this account: the other request linked it first.
        if (err?.code === '23505') {
          await dropUnlinkedArtifact(needsImport ? artifact : null);
          throw new DuplicateKeyError(`"${index.title}" is already in your dictionary list`);
        }
        throw err;
      }

      // Two uploads at once can both pass the count above. Counting again after linking closes that: whichever
      // request finds the account over its limit takes its own dictionary back out.
      const linked = await UserDictionary.count({ where: { userId: user.id } });
      if (linked > quota.maxDictionaries) {
        await userDict.remove();
        await dropUnlinkedArtifact(needsImport ? artifact : null);
        throw dictionaryLimitError(quota);
      }
    }

    if (needsImport) {
      const boss = (() => {
        try {
          return getPgBoss();
        } catch {
          return null;
        }
      })();
      keepTempZip = true;
      if (boss) {
        await boss.send(USER_DICTIONARY_IMPORT_QUEUE, {
          artifactId: artifact.id,
          tmpZipPath,
        });
      } else {
        // When workers are not running (e.g. direct tests / single-process scripts), run inline before returning.
        await processArtifactImportJob(artifact.id, tmpZipPath);
        artifact = await UserDictionaryArtifact.findOneByOrFail({ id: artifact.id });
      }
    }

    invalidateUserDictionaryStack(user.id);
    const updated = await loadActiveUserDictionaryStack(user.id);
    return {
      dictionary: toDto(userDict, artifact),
      deduplicated,
      stackFingerprint: updated.stackFingerprint,
    };
  } finally {
    if (!keepTempZip) {
      await unlink(tmpZipPath).catch(() => {});
    }
  }
}

export interface StackOrderItemInput {
  id: string;
  enabled: boolean;
}

/**
 * Reorders and toggles the unified dictionary stack (`custom:<id>` + `jmdict`) atomically.
 */
export async function updateUserDictionaryStack(
  user: Pick<User, 'id' | 'role'>,
  items: StackOrderItemInput[],
): Promise<UserDictionaryListResponse> {
  const existing = await UserDictionary.find({ where: { userId: user.id } });
  const byId = new Map(existing.map((row) => [row.id, row]));

  let builtinEnabled: boolean | undefined;
  let builtinPosition: number | undefined;
  const seenCustom = new Set<number>();

  await UserDictionary.getRepository().manager.transaction(async (manager) => {
    let customIndex = 0;
    for (const item of items) {
      if (item.id === BUILTIN_JMDICT_ID) {
        builtinEnabled = item.enabled;
        builtinPosition = customIndex;
        continue;
      }
      if (!item.id.startsWith(CUSTOM_DICT_PREFIX)) continue;
      const numericId = Number(item.id.slice(CUSTOM_DICT_PREFIX.length));
      const row = byId.get(numericId);
      if (!row || seenCustom.has(numericId)) continue;
      seenCustom.add(numericId);
      row.enabled = item.enabled;
      row.sortOrder = customIndex;
      customIndex += 1;
    }

    // Keep any unmentioned dictionaries (e.g. concurrent upload in another tab) appended in their previous order.
    for (const row of existing) {
      if (seenCustom.has(row.id)) continue;
      row.sortOrder = customIndex;
      customIndex += 1;
    }
    // Every row was renumbered above, so one save writes them all.
    await manager.save(existing);

    if (builtinEnabled !== undefined || builtinPosition !== undefined) {
      const dbUser = await manager.findOne(User, { where: { id: user.id } });
      if (dbUser) {
        const current = dbUser.preferences?.dictionaryStack ?? {};
        dbUser.preferences = {
          ...(dbUser.preferences ?? {}),
          dictionaryStack: {
            builtinEnabled: builtinEnabled ?? current.builtinEnabled ?? true,
            builtinPosition: builtinPosition ?? current.builtinPosition ?? customIndex,
          },
        };
        await manager.save(dbUser);
      }
    }
  });

  invalidateUserDictionaryStack(user.id);
  return listUserDictionaries(user);
}

/**
 * Removes a custom dictionary from the user's account and immediately garbage-collects the underlying SQLite
 * artifact if no other account references it.
 */
export async function deleteUserDictionary(
  user: Pick<User, 'id' | 'role'>,
  userDictionaryId: number,
): Promise<{ stackFingerprint: string | null }> {
  const row = await UserDictionary.findOne({
    where: { id: userDictionaryId, userId: user.id },
    relations: { artifact: true },
  });
  if (!row) {
    throw new NotFoundError('Custom dictionary not found');
  }

  const artifactId = row.artifactId;
  const storageKey = row.artifact?.storageKey;
  await row.remove();

  // Delete unreferenced artifact from R2 and local cache immediately so storage is reclaimed right away.
  // Guarded like `gcOrphanArtifacts`: another account attaching the same file in the meantime keeps it.
  if ((await deleteArtifactIfUnlinked(artifactId)) && storageKey) {
    await purgeArtifactStorage(storageKey);
  }

  invalidateUserDictionaryStack(user.id);
  const updated = await loadActiveUserDictionaryStack(user.id);
  return { stackFingerprint: updated.stackFingerprint };
}

/** An upload saves its artifact a moment before the link that makes it someone's; younger artifacts are left alone so
 * a sweep cannot delete one in that gap. */
export const ORPHAN_MIN_AGE_MINUTES = 10;

/**
 * Deletes artifacts no account links to any more, from Postgres, the local cache and R2. Deleting an account removes
 * its `UserDictionary` rows by `ON DELETE CASCADE` but not the files, so this runs after an account is deleted and in
 * the nightly maintenance job (which also catches deletions this process never saw, such as an admin's).
 */
export async function gcOrphanArtifacts(): Promise<number> {
  const orphans: Array<{ id: number; storage_key: string }> = await UserDictionaryArtifact.query(
    `
    SELECT a.id, a.storage_key
    FROM "UserDictionaryArtifact" a
    WHERE NOT EXISTS (SELECT 1 FROM "UserDictionary" ud WHERE ud.artifact_id = a.id)
      AND a.created_at < now() - make_interval(mins => $1)
  `,
    [ORPHAN_MIN_AGE_MINUTES],
  );
  let deleted = 0;
  for (const orphan of orphans) {
    if (!(await deleteArtifactIfUnlinked(orphan.id))) continue;
    await purgeArtifactStorage(orphan.storage_key);
    deleted += 1;
  }
  if (deleted > 0) logger.info({ deleted }, 'Deleted orphaned custom dictionary artifacts');
  return deleted;
}

/** Deletes an artifact this upload created and then abandoned, unless another account has linked it since. Its file
 * was never built, so there is nothing to remove from disk or R2. */
async function dropUnlinkedArtifact(artifact: UserDictionaryArtifact | null): Promise<void> {
  if (artifact) await deleteArtifactIfUnlinked(artifact.id);
}

/** Deletes an artifact's row only while no account links it, so an upload that attached in the meantime keeps it.
 * True when the row was deleted. */
async function deleteArtifactIfUnlinked(artifactId: number): Promise<boolean> {
  const result: unknown = await UserDictionaryArtifact.query(
    `DELETE FROM "UserDictionaryArtifact" a
     WHERE a.id = $1 AND NOT EXISTS (SELECT 1 FROM "UserDictionary" ud WHERE ud.artifact_id = a.id)`,
    [artifactId],
  );
  return deletedRowCount(result) > 0;
}

/** Removes what an import job built under `storageKey` once it is no longer its row's: unless the row is ready under
 * that same key (a duplicate run of a job that already finished), nothing serves that file. */
async function discardImportOutput(artifactId: number, storageKey: string): Promise<void> {
  if (await UserDictionaryArtifact.existsBy({ id: artifactId, storageKey, status: 'ready' })) return;
  await purgeArtifactStorage(storageKey);
}

/** Removes an artifact's file from the local cache and from R2. Neither step throws (both log or ignore failures). */
async function purgeArtifactStorage(storageKey: string): Promise<void> {
  await Promise.all([removeArtifactFile(config.USER_DICTIONARIES_DIR, storageKey), deleteArtifactFromR2(storageKey)]);
}

/** TypeORM's Postgres driver answers a raw DELETE with `[rows, affectedCount]`. */
function deletedRowCount(result: unknown): number {
  return Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
}

/** Nightly upkeep while the feature is on: interrupted imports, orphaned artifacts, the local cache's size. */
export async function runUserDictionaryMaintenance(): Promise<void> {
  if (!config.USER_DICTIONARIES_ENABLED) return;
  await failInterruptedImports();
  await gcOrphanArtifacts();
  await pruneLocalDictionaryCache();
  await sweepStaleTempFiles();
}
