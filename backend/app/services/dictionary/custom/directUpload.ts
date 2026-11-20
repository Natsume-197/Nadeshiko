import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@config/config';
import { logger } from '@config/log';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import { type User, UserDictionary, UserDictionaryUpload } from '@app/models';
import { resolveCustomDictionaryQuota } from './quotas';
import {
  deleteR2Object,
  downloadR2Object,
  getR2StorageConfig,
  presignDictionaryUpload,
  r2ObjectSize,
  r2UploadKey,
} from './r2Storage';
import { attachOrQueueUploadedDictionary } from './service';

/**
 * Direct uploads of custom dictionaries to R2 (task 48, Shirabe lessons phase 2).
 *
 * The browser reserves an upload (`reserveDictionaryUpload`), PUTs the `.zip` straight to R2 with the presigned URL it
 * gets back, and completes it (`completeDictionaryUpload`). The archive never crosses the web app on the way in, so a
 * large upload cannot tie it up, and Cloudflare's request body limit no longer applies to it. Completing reads the
 * object once (hashing it), deletes it, and hands the file to the same path a classic upload takes.
 */

/** How long a reservation and its presigned URL last: enough for 95 MB on a slow connection. */
export const UPLOAD_RESERVATION_SECONDS = 15 * 60;
/** Reservations one account may hold open at once. */
const MAX_OPEN_RESERVATIONS = 3;
/** Smallest possible zip (an empty central directory). */
const MIN_ZIP_BYTES = 22;

export interface DictionaryUploadReservation {
  uploadId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

/** Whether this environment takes direct uploads: only with R2, which every deployed environment has. */
export function directUploadsAvailable(): boolean {
  return getR2StorageConfig() !== null;
}

export async function reserveDictionaryUpload(
  user: Pick<User, 'id' | 'role'>,
  sizeBytes: number,
): Promise<DictionaryUploadReservation> {
  const r2 = getR2StorageConfig();
  if (!r2) throw new InvalidRequestError('Direct uploads are not available here; send the file to the upload endpoint');
  if (!Number.isInteger(sizeBytes) || sizeBytes < MIN_ZIP_BYTES) {
    throw new InvalidRequestError('Uploaded file is empty or not a valid ZIP archive');
  }

  const quota = await resolveCustomDictionaryQuota(user);
  if (sizeBytes > quota.maxZipBytes) {
    throw new InvalidRequestError(
      `Dictionary exceeds the ${Math.round(quota.maxZipBytes / (1024 * 1024))} MB limit for your account`,
    );
  }

  const rows = await UserDictionary.find({ where: { userId: user.id }, relations: { artifact: true } });
  // A failed dictionary can be uploaded again without deleting it first, so an account at its limit with one may
  // still reserve; completing checks the limit again once the file is known.
  const hasFailed = rows.some((row) => row.artifact?.status === 'failed');
  if (rows.length >= quota.maxDictionaries && !hasFailed) {
    throw new InvalidRequestError(
      `You have reached the limit of ${quota.maxDictionaries} custom dictionaries for your account`,
    );
  }
  const indexedBytes = rows.reduce((sum, row) => sum + Number(row.artifact?.sqliteBytes ?? 0), 0);
  if (indexedBytes >= quota.maxIndexedBytes) {
    const gb = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(1);
    throw new InvalidRequestError(
      `Your dictionaries already use ${gb(indexedBytes)} GB of the ${gb(quota.maxIndexedBytes)} GB indexed space for your account`,
    );
  }

  const open = await UserDictionaryUpload.createQueryBuilder('u')
    .where('u.user_id = :userId', { userId: user.id })
    .andWhere("u.status = 'reserved' AND u.expires_at > now()")
    .getCount();
  if (open >= MAX_OPEN_RESERVATIONS) {
    throw new InvalidRequestError('Too many uploads in progress; finish or wait for one before starting another');
  }

  const uploadId = randomUUID();
  const objectKey = r2UploadKey(uploadId, r2.prefix);
  const expiresAt = new Date(Date.now() + UPLOAD_RESERVATION_SECONDS * 1000);
  await UserDictionaryUpload.insert({
    id: uploadId,
    userId: user.id,
    objectKey,
    declaredBytes: String(sizeBytes),
    status: 'reserved',
    expiresAt,
  });
  const url = await presignDictionaryUpload(objectKey, sizeBytes, UPLOAD_RESERVATION_SECONDS);
  return {
    uploadId,
    url,
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    expiresAt: expiresAt.toISOString(),
  };
}

export async function completeDictionaryUpload(user: Pick<User, 'id' | 'role'>, uploadId: string) {
  // Claimed in one statement, so two completions of the same upload cannot both import it.
  const claimed: Array<{ object_key: string; declared_bytes: string }> = await UserDictionaryUpload.query(
    `UPDATE "UserDictionaryUpload" SET status = 'completed', updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'reserved' AND expires_at > now()
      RETURNING object_key, declared_bytes`,
    [uploadId, user.id],
  ).then((result: unknown) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as never);
  const row = claimed[0];
  if (!row) {
    const existing = await UserDictionaryUpload.findOneBy({ id: uploadId, userId: user.id });
    if (!existing) throw new NotFoundError('Upload not found');
    if (existing.status === 'completed') throw new InvalidRequestError('This upload was already completed');
    await discardUpload(existing.id, existing.objectKey);
    throw new InvalidRequestError('The upload took too long; upload the file again');
  }

  const declared = Number(row.declared_bytes);
  const size = await r2ObjectSize(row.object_key);
  if (size === null) {
    await discardUpload(uploadId, row.object_key);
    throw new InvalidRequestError('The file did not reach storage; upload it again');
  }
  if (size !== declared) {
    await discardUpload(uploadId, row.object_key);
    throw new InvalidRequestError('The uploaded file does not match the reserved size; upload it again');
  }

  const tmpPath = join(config.USER_DICTIONARIES_DIR, 'tmp', `${uploadId}.zip`);
  let download: { sha256: string; bytes: number };
  try {
    download = await downloadR2Object(row.object_key, tmpPath, declared);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    await discardUpload(uploadId, row.object_key);
    throw error;
  }
  await discardUpload(uploadId, row.object_key);

  // Ownership of `tmpPath` passes to the classic path, which unlinks it on error or after the import.
  return attachOrQueueUploadedDictionary(user, tmpPath, download.sha256, download.bytes);
}

async function discardUpload(uploadId: string, objectKey: string): Promise<void> {
  await deleteR2Object(objectKey);
  await UserDictionaryUpload.delete({ id: uploadId }).catch(() => {});
}

/** Deletes reservations that expired without being completed, with their objects. Returns how many. */
export async function sweepExpiredUploads(): Promise<number> {
  const expired = await UserDictionaryUpload.createQueryBuilder('u')
    .where("u.expires_at < now() - interval '5 minutes'")
    .getMany();
  for (const upload of expired) await discardUpload(upload.id, upload.objectKey);
  if (expired.length > 0)
    logger.info({ count: expired.length }, 'Removed expired custom dictionary upload reservations');
  return expired.length;
}
