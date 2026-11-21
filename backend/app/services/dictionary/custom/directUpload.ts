import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { In } from 'typeorm';
import { config } from '@config/config';
import { logger } from '@config/log';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import { type User, UserDictionary, UserDictionaryUpload } from '@app/models';
import { assertDictionarySlot, assertIndexedSpace, assertZipSize, resolveCustomDictionaryQuota } from './quotas';
import {
  deleteR2Object,
  downloadR2Object,
  getR2StorageConfig,
  listStaleUploadObjects,
  presignDictionaryUpload,
  r2ObjectSize,
  r2UploadKey,
} from './r2Storage';
import { attachOrQueueUploadedDictionary } from './service';

/**
 * Direct uploads of custom dictionaries to R2 (task 48).
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
  assertZipSize(quota, sizeBytes);

  const rows = await UserDictionary.find({ where: { userId: user.id }, relations: { artifact: true } });
  // A failed dictionary can be uploaded again without deleting it first, so an account at its limit with one may
  // still reserve; completing checks the limit again once the file is known.
  if (!rows.some((row) => row.artifact?.status === 'failed')) assertDictionarySlot(quota, rows.length);
  assertIndexedSpace(quota, rows);

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

/** An uploaded object with no reservation row this long after it was written is abandoned for certain: past any
 * reservation's lifetime, with an hour to spare for a completion still reading it. */
const ORPHAN_UPLOAD_AFTER_MS = UPLOAD_RESERVATION_SECONDS * 1000 + 60 * 60 * 1000;
/** Orphaned upload objects one sweep deletes at most; the next run takes the rest. */
const MAX_ORPHAN_UPLOADS_PER_SWEEP = 500;

/**
 * Deletes reservations that expired without being completed, with their objects, then uploaded objects no reservation
 * row points to any more (deleting an account cascades its rows away, leaving their objects behind). Returns how many
 * reservations and objects it removed.
 */
export async function sweepExpiredUploads(): Promise<number> {
  const expired = await UserDictionaryUpload.createQueryBuilder('u')
    .where("u.expires_at < now() - interval '5 minutes'")
    .getMany();
  for (const upload of expired) await discardUpload(upload.id, upload.objectKey);
  if (expired.length > 0)
    logger.info({ count: expired.length }, 'Removed expired custom dictionary upload reservations');
  const orphans = await sweepOrphanedUploadObjects().catch((error) => {
    logger.warn({ err: error }, 'Could not sweep orphaned custom dictionary uploads');
    return 0;
  });
  return expired.length + orphans;
}

async function sweepOrphanedUploadObjects(): Promise<number> {
  const stale = await listStaleUploadObjects(
    new Date(Date.now() - ORPHAN_UPLOAD_AFTER_MS),
    MAX_ORPHAN_UPLOADS_PER_SWEEP,
  );
  if (stale.length === 0) return 0;
  const held = await UserDictionaryUpload.find({ where: { objectKey: In(stale) }, select: { objectKey: true } });
  const heldKeys = new Set(held.map((row) => row.objectKey));
  const orphans = stale.filter((key) => !heldKeys.has(key));
  for (const key of orphans) await deleteR2Object(key);
  if (orphans.length > 0) logger.info({ count: orphans.length }, 'Removed orphaned custom dictionary uploads');
  return orphans.length;
}
