import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '@config/config';
import { logger } from '@config/log';
import { artifactSqlitePath, closeArtifactHandle } from './sqlitePool';

/**
 * Cloudflare R2 (through its S3 API) backing store plus a bounded local LRU disk cache for indexed user dictionary
 * SQLite files (task 48).
 *
 * - R2 is the durable source of truth in deployed environments (`<prefix>/<storageKey>.sqlite`).
 * - Local disk (`USER_DICTIONARIES_DIR`) is a bounded LRU cache, so warm lookups stay sub-millisecond and containers
 *   stay stateless across deploys and server rebuilds.
 * - In local development (`ENVIRONMENT === 'local'`) with R2 unset, files live directly in `USER_DICTIONARIES_DIR`.
 */

export interface R2StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

/** Deduplicates concurrent cache-miss downloads for the same artifact key. */
const inFlightDownloads = new Map<string, Promise<string | null>>();

export function getR2StorageConfig(): R2StorageConfig | null {
  const endpoint = config.USER_DICT_R2_ENDPOINT;
  const bucket = config.USER_DICT_R2_BUCKET;
  const accessKeyId = config.USER_DICT_R2_ACCESS_KEY_ID;
  const secretAccessKey = config.USER_DICT_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: config.USER_DICT_R2_PREFIX.replace(/^\/+|\/+$/g, ''),
  };
}

export function r2ObjectKey(storageKey: string, prefix: string): string {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  return cleanPrefix ? `${cleanPrefix}/${storageKey}.sqlite` : `${storageKey}.sqlite`;
}

let cachedClient: { endpoint: string; accessKeyId: string; client: S3Client } | null = null;

/**
 * One client per credentials. R2 takes region `auto` and path-style bucket URLs. Checksums only when an operation
 * requires one: by default the SDK streams uploads as `aws-chunked` with a trailing CRC, which Cloudflare advises
 * turning off for R2, and a store that keeps the chunk framing returns a file SQLite cannot open.
 */
export function r2Client(r2: R2StorageConfig): S3Client {
  if (cachedClient && cachedClient.endpoint === r2.endpoint && cachedClient.accessKeyId === r2.accessKeyId) {
    return cachedClient.client;
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: r2.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  cachedClient = { endpoint: r2.endpoint, accessKeyId: r2.accessKeyId, client };
  return client;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    error instanceof NotFound ||
    (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404
  );
}

/**
 * Uploads a freshly built `.sqlite` artifact to R2 when R2 is configured. No-op in local disk-only mode.
 */
export async function uploadArtifactToR2(storageKey: string, localFilePath: string): Promise<void> {
  const r2 = getR2StorageConfig();
  if (!r2) return;

  const { size } = await stat(localFilePath);
  await r2Client(r2).send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: r2ObjectKey(storageKey, r2.prefix),
      Body: createReadStream(localFilePath),
      ContentLength: size,
      ContentType: 'application/vnd.sqlite3',
    }),
  );
}

/**
 * Deletes an artifact from R2 when R2 is configured. A missing object counts as deleted; other failures are logged,
 * and the nightly orphan sweep cannot retry them (the row is gone), so they are warnings to act on.
 */
export async function deleteArtifactFromR2(storageKey: string): Promise<void> {
  const r2 = getR2StorageConfig();
  if (!r2) return;

  const key = r2ObjectKey(storageKey, r2.prefix);
  try {
    await r2Client(r2).send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
  } catch (error) {
    if (isNotFound(error)) return;
    logger.warn({ err: error, key }, 'Failed to delete dictionary artifact from R2');
  }
}

/**
 * Checks whether an artifact exists either locally or in R2 (used for instant SHA-256 deduplication across deploys).
 */
export async function artifactExistsInStorage(storageKey: string): Promise<boolean> {
  const localPath = artifactSqlitePath(config.USER_DICTIONARIES_DIR, storageKey);
  if (existsSync(localPath)) return true;

  const r2 = getR2StorageConfig();
  if (!r2) return false;

  try {
    await r2Client(r2).send(new HeadObjectCommand({ Bucket: r2.bucket, Key: r2ObjectKey(storageKey, r2.prefix) }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures `<storageKey>.sqlite` is present on local disk, downloading it atomically from R2 on a cache miss.
 * Returns the local file path, or `null` if the artifact cannot be found.
 */
export async function ensureArtifactCachedLocally(storageKey: string): Promise<string | null> {
  const localPath = artifactSqlitePath(config.USER_DICTIONARIES_DIR, storageKey);
  if (existsSync(localPath)) {
    // Touch mtime asynchronously so LRU pruning preserves frequently queried dictionaries.
    const now = new Date();
    void utimes(localPath, now, now).catch(() => {});
    return localPath;
  }

  const r2 = getR2StorageConfig();
  if (!r2) return null;

  const pending = inFlightDownloads.get(storageKey);
  if (pending) return pending;

  const downloadPromise = (async (): Promise<string | null> => {
    const key = r2ObjectKey(storageKey, r2.prefix);
    let body: Readable;
    try {
      const response = await r2Client(r2).send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
      if (!response.Body) return null;
      body = response.Body as Readable;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }

    await mkdir(dirname(localPath), { recursive: true });
    const tmpPath = join(dirname(localPath), `.dl-${storageKey.slice(0, 12)}-${process.pid}-${Date.now()}.sqlite`);
    try {
      await pipeline(body, createWriteStream(tmpPath));
      await rename(tmpPath, localPath);
      void pruneLocalDictionaryCache().catch(() => {});
      return localPath;
    } catch (error) {
      await unlink(tmpPath).catch(() => {});
      throw error;
    }
  })()
    .catch((error) => {
      logger.warn({ err: error, storageKey }, 'Failed to fetch custom dictionary artifact from R2');
      return null;
    })
    .finally(() => {
      inFlightDownloads.delete(storageKey);
    });

  inFlightDownloads.set(storageKey, downloadPromise);
  return downloadPromise;
}

/**
 * Local paths for the artifacts that are on disk, or arrive within `waitMs`. A cold artifact (first lookup after a
 * deploy) can be hundreds of MB; its download keeps going after the wait, so the next lookup finds it, while this one
 * answers without it rather than past the frontend's timeout. `missing` counts the artifacts left out.
 */
export async function resolveArtifactsWithin(
  storageKeys: string[],
  waitMs: number,
): Promise<{ paths: Map<string, string>; missing: number }> {
  const found = new Map<string, string>();
  const downloads = storageKeys.map((key) =>
    ensureArtifactCachedLocally(key).then((path) => {
      if (path) found.set(key, path);
    }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(downloads),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    }),
  ]);
  clearTimeout(timer);

  // A copy: downloads finishing later must not change the set the caller is answering from.
  const paths = new Map(found);
  return { paths, missing: storageKeys.filter((key) => !paths.has(key)).length };
}

/**
 * Keeps the local SQLite cache under `USER_DICTIONARIES_CACHE_MAX_BYTES` by evicting the least-recently-used `.sqlite`
 * files. Only runs when R2 is configured (in local disk-only mode, local files are the primary copy).
 */
export async function pruneLocalDictionaryCache(): Promise<void> {
  if (!getR2StorageConfig()) return;
  const maxBytes = config.USER_DICTIONARIES_CACHE_MAX_BYTES;
  const dir = config.USER_DICTIONARIES_DIR;
  if (!existsSync(dir)) return;

  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
  let total = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sqlite') || entry.name.startsWith('.')) continue;
    const fullPath = join(dir, entry.name);
    try {
      const info = await stat(fullPath);
      total += info.size;
      files.push({ path: fullPath, size: info.size, mtimeMs: info.mtimeMs });
    } catch {}
  }

  if (total <= maxBytes) return;

  // Evict oldest-used files until we are back under 85% of the cache cap.
  const target = Math.floor(maxBytes * 0.85);
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of files) {
    if (total <= target) break;
    closeArtifactHandle(file.path);
    await unlink(file.path).catch(() => {});
    total -= file.size;
  }
}
