import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { DeleteUserDictionary, ListUserDictionaries, UpdateUserDictionaries } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { InvalidRequestError } from '@app/errors';
import { config } from '@config/config';
import { resolveCustomDictionaryQuota } from '@app/services/dictionary/custom/quotas';
import {
  assertCustomDictionariesEnabled,
  attachOrQueueUploadedDictionary,
  deleteUserDictionary as deleteUserDictionaryService,
  listUserDictionaries as listUserDictionariesService,
  updateUserDictionaryStack,
} from '@app/services/dictionary/custom/service';

export const USER_DICTIONARY_UPLOAD_PATH = '/v1/user/dictionaries';

export const listUserDictionaries: ListUserDictionaries = async (_params, respond, req) => {
  assertCustomDictionariesEnabled();
  const user = assertUser(req);
  const data = await listUserDictionariesService(user);
  return respond.with200().body(data);
};

export const updateUserDictionaries: UpdateUserDictionaries = async ({ body }, respond, req) => {
  assertCustomDictionariesEnabled();
  const user = assertUser(req);
  const data = await updateUserDictionaryStack(user, body.items);
  return respond.with200().body(data);
};

export const deleteUserDictionary: DeleteUserDictionary = async ({ params }, respond, req) => {
  assertCustomDictionariesEnabled();
  const user = assertUser(req);
  const data = await deleteUserDictionaryService(user, params.id);
  return respond.with200().body(data);
};

const UPLOAD_CONTENT_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']);

/**
 * Streams a raw Yomitan `.zip` upload directly to disk while computing its SHA-256 hash and enforcing the account's
 * tier byte limit (60 MB Free / 95 MB Patron & Admin). Mounted outside `express.json()` so 95 MB uploads never buffer
 * in V8 heap memory.
 */
export const uploadUserDictionary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let tmpPath: string | null = null;
  try {
    assertCustomDictionariesEnabled();
    const user = assertUser(req);

    // A raw `.zip` body only. Also keeps an HTML form on another site (which can only send form or text bodies) from
    // posting here even if a browser ever sent the session cookie along.
    const contentType = (String(req.headers['content-type'] ?? '').split(';')[0] ?? '').trim().toLowerCase();
    if (!UPLOAD_CONTENT_TYPES.has(contentType)) {
      req.resume();
      res.status(415).json({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        title: 'Unsupported media type',
        detail: 'Send the dictionary as a raw .zip body (Content-Type: application/zip).',
        status: 415,
      });
      return;
    }

    const quota = await resolveCustomDictionaryQuota(user);

    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader) {
      const declared = Number(contentLengthHeader);
      if (Number.isFinite(declared) && declared > quota.maxZipBytes) {
        const limitMb = Math.round(quota.maxZipBytes / (1024 * 1024));
        res.status(413).json({
          code: 'PAYLOAD_TOO_LARGE',
          title: 'File too large',
          detail: `Dictionary exceeds the ${limitMb} MB limit for your account.`,
          status: 413,
        });
        req.resume();
        return;
      }
    }

    const tmpDir = join(config.USER_DICTIONARIES_DIR, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    tmpPath = join(tmpDir, `${randomUUID()}.zip`);

    const { sha256, bytes, tooLarge } = await streamRequestToFile(req, tmpPath, quota.maxZipBytes);

    if (tooLarge) {
      await unlink(tmpPath).catch(() => {});
      tmpPath = null;
      const limitMb = Math.round(quota.maxZipBytes / (1024 * 1024));
      res.status(413).json({
        code: 'PAYLOAD_TOO_LARGE',
        title: 'File too large',
        detail: `Dictionary exceeds the ${limitMb} MB limit for your account.`,
        status: 413,
      });
      return;
    }

    if (bytes < 22) {
      await unlink(tmpPath).catch(() => {});
      tmpPath = null;
      throw new InvalidRequestError('Uploaded file is empty or not a valid ZIP archive');
    }

    // Ownership of `tmpPath` transfers to `attachOrQueueUploadedDictionary` (which unlinks on error or after import).
    const filePath = tmpPath;
    tmpPath = null;
    const result = await attachOrQueueUploadedDictionary(user, filePath, sha256, bytes);
    const statusCode = result.dictionary.status === 'ready' ? 201 : 202;
    // `deduplicated` stays server-side: it would tell the uploader that another account already has this exact file.
    res.status(statusCode).json({ dictionary: result.dictionary, stackFingerprint: result.stackFingerprint });
  } catch (error) {
    if (tmpPath) {
      await unlink(tmpPath).catch(() => {});
    }
    next(error);
  }
};

function streamRequestToFile(
  req: Request,
  destPath: string,
  maxBytes: number,
): Promise<{ sha256: string; bytes: number; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const out = createWriteStream(destPath);
    let bytes = 0;
    let tooLarge = false;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on('data', (chunk: Buffer) => {
      if (tooLarge || settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        tooLarge = true;
        out.destroy();
        req.resume();
        finish(() => resolve({ sha256: '', bytes, tooLarge: true }));
        return;
      }
      hash.update(chunk);
      if (!out.write(chunk)) {
        req.pause();
        out.once('drain', () => {
          if (!tooLarge && !settled) req.resume();
        });
      }
    });

    req.on('end', () => {
      if (tooLarge || settled) return;
      out.end();
    });

    req.on('aborted', () => {
      out.destroy();
      finish(() => reject(new InvalidRequestError('Upload was aborted before completion')));
    });

    req.on('error', (err) => {
      out.destroy();
      finish(() => reject(err));
    });

    out.on('error', (err) => {
      if (tooLarge) return;
      finish(() => reject(err));
    });

    out.on('finish', () => {
      finish(() => resolve({ sha256: hash.digest('hex'), bytes, tooLarge: false }));
    });
  });
}
