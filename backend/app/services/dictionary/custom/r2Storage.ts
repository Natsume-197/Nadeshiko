import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

/** When each cached file's mtime was last refreshed; the LRU only needs it to the minute, not on every lookup. */
const lastTouched = new Map<string, number>();
const TOUCH_EVERY_MS = 60_000;

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
    prefix: stripSlashes(config.USER_DICT_R2_PREFIX),
  };
}

function stripSlashes(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, '');
}

/** `name` under `prefix`. The prefix is stripped again here because these key builders are exported and may be handed
 * a raw one (the tests do); `getR2StorageConfig` already strips it for every app caller. */
function prefixed(prefix: string, name: string): string {
  const cleanPrefix = stripSlashes(prefix);
  return cleanPrefix ? `${cleanPrefix}/${name}` : name;
}

export function r2ObjectKey(storageKey: string, prefix: string): string {
  return prefixed(prefix, `${storageKey}.sqlite`);
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

/** Object key for a direct `.zip` upload, kept apart from the indexed files under the same prefix. */
export function r2UploadKey(uploadId: string, prefix: string): string {
  return prefixed(prefix, `uploads/${uploadId}.zip`);
}

/** Pages one listing of the uploads prefix reads at most (1000 keys each), so a sweep stays bounded. */
const MAX_UPLOAD_LIST_PAGES = 10;

/**
 * Keys of direct-upload objects (`<prefix>/uploads/`) last written before `before`, at most `limit` of them. Empty
 * when R2 is not configured.
 */
export async function listStaleUploadObjects(before: Date, limit: number): Promise<string[]> {
  const r2 = getR2StorageConfig();
  if (!r2) return [];
  const keys: string[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_UPLOAD_LIST_PAGES; page += 1) {
    const listed = await r2Client(r2).send(
      new ListObjectsV2Command({
        Bucket: r2.bucket,
        Prefix: prefixed(r2.prefix, 'uploads/'),
        ContinuationToken: token,
      }),
    );
    for (const object of listed.Contents ?? []) {
      if (!object.Key || !object.LastModified || object.LastModified >= before) continue;
      keys.push(object.Key);
      if (keys.length >= limit) return keys;
    }
    if (!listed.IsTruncated || !listed.NextContinuationToken) break;
    token = listed.NextContinuationToken;
  }
  return keys;
}

/**
 * A presigned PUT for one direct upload (task 48, phase 2). It signs the content type and length, so R2 refuses a
 * body of any other size than the one reserved.
 */
export async function presignDictionaryUpload(
  objectKey: string,
  bytes: number,
  expiresInSeconds: number,
): Promise<string> {
  const r2 = getR2StorageConfig();
  if (!r2) throw new Error('R2 is not configured');
  return getSignedUrl(
    r2Client(r2),
    new PutObjectCommand({ Bucket: r2.bucket, Key: objectKey, ContentType: 'application/zip', ContentLength: bytes }),
    { expiresIn: expiresInSeconds, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

/** The size of an uploaded object, or null when it is not there. */
export async function r2ObjectSize(objectKey: string): Promise<number | null> {
  const r2 = getR2StorageConfig();
  if (!r2) return null;
  try {
    const head = await r2Client(r2).send(new HeadObjectCommand({ Bucket: r2.bucket, Key: objectKey }));
    return typeof head.ContentLength === 'number' ? head.ContentLength : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Downloads an uploaded object to `localPath`, hashing it on the way, and refuses one larger than `maxBytes` (the
 * object can be replaced between the size check and the download while the presigned URL is still valid).
 */
export async function downloadR2Object(
  objectKey: string,
  localPath: string,
  maxBytes: number,
): Promise<{ sha256: string; bytes: number }> {
  const r2 = getR2StorageConfig();
  if (!r2) throw new Error('R2 is not configured');
  const response = await r2Client(r2).send(new GetObjectCommand({ Bucket: r2.bucket, Key: objectKey }));
  if (!response.Body) throw new Error('Uploaded dictionary is empty');
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        done(new Error('Uploaded dictionary is larger than reserved'));
        return;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });
  await mkdir(dirname(localPath), { recursive: true });
  await pipeline(response.Body as Readable, meter, createWriteStream(localPath));
  return { sha256: hash.digest('hex'), bytes };
}

/** Deletes any object by key (a direct upload once read, or an abandoned one). A missing object counts as deleted. */
export async function deleteR2Object(objectKey: string, what = 'dictionary upload'): Promise<void> {
  const r2 = getR2StorageConfig();
  if (!r2) return;
  try {
    await r2Client(r2).send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: objectKey }));
  } catch (error) {
    if (isNotFound(error)) return;
    logger.warn({ err: error, key: objectKey }, `Failed to delete ${what} from R2`);
  }
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
  await deleteR2Object(r2ObjectKey(storageKey, r2.prefix), 'dictionary artifact');
}

/**
 * Checks whether an artifact exists either locally or in R2 (used for instant SHA-256 deduplication across deploys).
 * Only a 404 means missing; any other R2 failure throws, because a caller treats "missing" as licence to purge and
 * rebuild a shared artifact.
 */
export async function artifactExistsInStorage(storageKey: string): Promise<boolean> {
  const localPath = artifactSqlitePath(config.USER_DICTIONARIES_DIR, storageKey);
  if (existsSync(localPath)) return true;

  const r2 = getR2StorageConfig();
  if (!r2) return false;

  try {
    await r2Client(r2).send(new HeadObjectCommand({ Bucket: r2.bucket, Key: r2ObjectKey(storageKey, r2.prefix) }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Ensures `<storageKey>.sqlite` is present on local disk, downloading it atomically from R2 on a cache miss.
 * Returns the local file path, or `null` if the artifact cannot be found.
 */
export async function ensureArtifactCachedLocally(storageKey: string): Promise<string | null> {
  const localPath = artifactSqlitePath(config.USER_DICTIONARIES_DIR, storageKey);
  if (existsSync(localPath)) {
    // Touch mtime asynchronously so LRU pruning preserves frequently queried dictionaries, at most once a minute.
    const now = Date.now();
    if (now - (lastTouched.get(localPath) ?? 0) >= TOUCH_EVERY_MS) {
      lastTouched.set(localPath, now);
      const when = new Date(now);
      void utimes(localPath, when, when).catch(() => {});
    }
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

/** Leftovers older than this are abandoned: an upload's `.zip` whose import never ran, a half-built or half-downloaded
 * `.sqlite`. Longer than any import or download takes. */
export const STALE_TEMP_FILE_MS = 3 * 60 * 60 * 1000;

/**
 * Deletes abandoned temporary files from the dictionary directory, which lives on a volume and so keeps them across
 * deploys: uploaded `.zip` files in `tmp/`, and `.tmp-*` / `.dl-*` SQLite files an interrupted import or download left.
 * Returns how many were removed.
 */
export async function sweepStaleTempFiles(now = Date.now()): Promise<number> {
  const dir = config.USER_DICTIONARIES_DIR;
  const targets: string[] = [];
  const collect = async (folder: string, match: (name: string) => boolean) => {
    if (!existsSync(folder)) return;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isFile() && match(entry.name)) targets.push(join(folder, entry.name));
    }
  };
  await collect(join(dir, 'tmp'), (name) => name.endsWith('.zip'));
  await collect(dir, (name) => (name.startsWith('.tmp-') || name.startsWith('.dl-')) && name.endsWith('.sqlite'));

  let removed = 0;
  for (const path of targets) {
    try {
      const info = await stat(path);
      if (now - info.mtimeMs < STALE_TEMP_FILE_MS) continue;
      await unlink(path);
      removed += 1;
    } catch {
      // gone already, or in use by a container that just finished with it
    }
  }
  if (removed > 0) logger.info({ removed }, 'Removed abandoned custom dictionary temp files');
  return removed;
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
    lastTouched.delete(file.path);
    await unlink(file.path).catch(() => {});
    total -= file.size;
  }
}
