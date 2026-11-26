import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApplication } from '@config/application';
import { UserRoutes } from '@config/routes';
import { UserDictionaryUpload } from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { sweepExpiredUploads } from '@app/services/dictionary/custom/directUpload';
import { invalidateUserDictionaryStack } from '@app/services/dictionary/custom/service';
import { closeAllArtifactHandles } from '@app/services/dictionary/custom/sqlitePool';
import * as r2 from '@app/services/dictionary/custom/r2Storage';
import { request } from '../../helpers/http';
import { setupTestSuite, signInAs } from '../../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../../fixtures/core';
import { buildZip } from '../../fixtures/yomitanZip';

/**
 * Direct uploads of custom dictionaries (task 48) against the test database: reserve, the
 * browser's PUT (simulated: R2 is a map here), complete, and the sweep of expired reservations. Imports run for real.
 */

const dictDir = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nadeshiko-direct-upload-'));
});

vi.mock('@config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config')>();
  return {
    ...actual,
    config: { ...actual.config, USER_DICTIONARIES_ENABLED: true, USER_DICTIONARIES_DIR: dictDir },
  };
});

/** The bucket: object key → bytes. */
const bucket = vi.hoisted(() => new Map<string, Buffer>());

// Only what the direct-upload path calls is faked; the rest of r2Storage runs as in local mode (no R2).
vi.mock('@app/services/dictionary/custom/r2Storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@app/services/dictionary/custom/r2Storage')>();
  return {
    ...actual,
    getR2StorageConfig: vi.fn(() => ({
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'test-bucket',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      prefix: 'user-dicts/test',
    })),
    presignDictionaryUpload: vi.fn(
      async (key: string, bytes: number) => `https://account.r2.cloudflarestorage.com/test-bucket/${key}?size=${bytes}`,
    ),
    r2ObjectSize: vi.fn(async (key: string) => bucket.get(key)?.length ?? null),
    downloadR2Object: vi.fn(async (key: string, path: string, maxBytes: number) => {
      const data = bucket.get(key);
      if (!data) throw new Error('missing');
      if (data.length > maxBytes) throw new Error('Uploaded dictionary is larger than reserved');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
      return { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
    }),
    deleteR2Object: vi.fn(async (key: string) => {
      bucket.delete(key);
    }),
    // Every object counts as old here; the age cut-off is r2Storage's own (tested with it).
    listStaleUploadObjects: vi.fn(async () => [...bucket.keys()].filter((key) => key.includes('/uploads/'))),
  };
});

setupTestSuite();

let fixtures: CoreFixtures;
const app = buildApplication({
  rateLimit: false,
  beforeRoutes: [
    (req: Request, _res: Response, next: NextFunction) => {
      const user = req.app.locals.testUser;
      if (user) {
        req.user = user;
        req.auth = {
          type: AuthType.API_KEY,
          apiKey: { kind: ApiKeyKind.SERVICE, permissions: Object.values(ApiPermission) },
        };
      }
      next();
    },
  ],
  mountRoutes: (instance) => {
    instance.use('/', UserRoutes);
  },
});

function dictionaryZip(title = 'ダイレクト'): Buffer {
  return buildZip([
    { name: 'index.json', data: JSON.stringify({ title, revision: '1', format: 3 }), deflate: true },
    {
      name: 'term_bank_1.json',
      data: JSON.stringify([['猫', 'ねこ', '', '', 0, ['cat'], 1, '']]),
      deflate: true,
    },
  ]);
}

/** The browser's part: reserve, then PUT the bytes where the presigned URL points. */
async function reserveAndPut(zip: Buffer) {
  const reserved = await request(app).post('/v1/user/dictionaries/uploads').send({ sizeBytes: zip.length });
  expect(reserved.status).toBe(201);
  const key = new URL(reserved.body.url).pathname.replace('/test-bucket/', '');
  bucket.set(key, zip);
  return { uploadId: reserved.body.uploadId as string, key };
}

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(() => {
  invalidateUserDictionaryStack();
  bucket.clear();
  vi.clearAllMocks();
  signInAs(app, fixtures.users.regular);
});

afterEach(() => {
  closeAllArtifactHandles();
});

describe('direct uploads', () => {
  it('reserves, takes the file from storage, indexes it and deletes the uploaded object', async () => {
    const list = await request(app).get('/v1/user/dictionaries');
    expect(list.body.directUpload).toBe(true);

    const zip = dictionaryZip();
    const reserved = await request(app).post('/v1/user/dictionaries/uploads').send({ sizeBytes: zip.length });
    expect(reserved.status).toBe(201);
    expect(reserved.body).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/zip' } });
    expect(reserved.body.url).toContain(`/uploads/${reserved.body.uploadId}.zip`);
    expect(r2.presignDictionaryUpload).toHaveBeenCalledWith(expect.stringContaining('/uploads/'), zip.length, 900);

    const key = new URL(reserved.body.url).pathname.replace('/test-bucket/', '');
    bucket.set(key, zip);
    const done = await request(app).post(`/v1/user/dictionaries/uploads/${reserved.body.uploadId}/complete`).send();

    expect(done.status).toBe(201);
    expect(done.body.dictionary).toMatchObject({ title: 'ダイレクト', status: 'ready', termCount: 1 });
    expect(done.body).not.toHaveProperty('deduplicated');
    expect(bucket.has(key)).toBe(false);
    expect(await UserDictionaryUpload.count()).toBe(0);
    expect((await request(app).get('/v1/user/dictionaries')).body.dictionaries).toHaveLength(1);
  });

  it('refuses to reserve a file over the account limit, or past the dictionary count', async () => {
    const tooBig = await request(app)
      .post('/v1/user/dictionaries/uploads')
      .send({ sizeBytes: 61 * 1024 * 1024 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.detail).toContain('60 MB limit');

    for (const title of ['一つ目', '二つ目', '三つ目']) {
      const { uploadId } = await reserveAndPut(dictionaryZip(title));
      expect((await request(app).post(`/v1/user/dictionaries/uploads/${uploadId}/complete`).send()).status).toBe(201);
    }
    const fourth = await request(app).post('/v1/user/dictionaries/uploads').send({ sizeBytes: 1000 });
    expect(fourth.status).toBe(400);
    expect(fourth.body.detail).toContain('limit of 3');
  });

  it('keeps at most three uploads in progress per account', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post('/v1/user/dictionaries/uploads').send({ sizeBytes: 1000 })).status).toBe(201);
    }
    const fourth = await request(app).post('/v1/user/dictionaries/uploads').send({ sizeBytes: 1000 });
    expect(fourth.status).toBe(400);
    expect(fourth.body.detail).toContain('Too many uploads');
  });

  it('refuses a file of another size than reserved, and discards it', async () => {
    const zip = dictionaryZip();
    const reserved = await request(app)
      .post('/v1/user/dictionaries/uploads')
      .send({ sizeBytes: zip.length + 10 });
    const key = new URL(reserved.body.url).pathname.replace('/test-bucket/', '');
    bucket.set(key, zip);

    const done = await request(app).post(`/v1/user/dictionaries/uploads/${reserved.body.uploadId}/complete`).send();
    expect(done.status).toBe(400);
    expect(done.body.detail).toContain('reserved size');
    expect(bucket.has(key)).toBe(false);
    expect(await UserDictionaryUpload.count()).toBe(0);
  });

  it('refuses to complete an upload that never reached storage, someone else’s, or one completed already', async () => {
    const missing = await request(app).post('/v1/user/dictionaries/uploads').send({ sizeBytes: 1000 });
    const notThere = await request(app).post(`/v1/user/dictionaries/uploads/${missing.body.uploadId}/complete`).send();
    expect(notThere.status).toBe(400);
    expect(notThere.body.detail).toContain('did not reach storage');

    const { uploadId } = await reserveAndPut(dictionaryZip());
    signInAs(app, fixtures.users.kevin);
    expect((await request(app).post(`/v1/user/dictionaries/uploads/${uploadId}/complete`).send()).status).toBe(404);

    signInAs(app, fixtures.users.regular);
    expect((await request(app).post(`/v1/user/dictionaries/uploads/${uploadId}/complete`).send()).status).toBe(201);
    expect((await request(app).post(`/v1/user/dictionaries/uploads/${uploadId}/complete`).send()).status).toBe(404);
  });

  it('refuses an expired reservation, and the sweep removes expired ones with their objects', async () => {
    const late = await reserveAndPut(dictionaryZip('遅い'));
    const forgotten = await reserveAndPut(dictionaryZip('忘れた'));
    await UserDictionaryUpload.query(
      `UPDATE "UserDictionaryUpload" SET expires_at = now() - interval '10 minutes' WHERE id IN ($1, $2)`,
      [late.uploadId, forgotten.uploadId],
    );

    const done = await request(app).post(`/v1/user/dictionaries/uploads/${late.uploadId}/complete`).send();
    expect(done.status).toBe(400);
    expect(done.body.detail).toContain('took too long');
    expect(bucket.has(late.key)).toBe(false);

    expect(await sweepExpiredUploads()).toBe(1);
    expect(bucket.has(forgotten.key)).toBe(false);
    expect(await UserDictionaryUpload.count()).toBe(0);
  });

  it('sweeps uploaded objects whose reservation row is gone (account deleted), and keeps held ones', async () => {
    const held = await reserveAndPut(dictionaryZip('保持'));
    const orphaned = await reserveAndPut(dictionaryZip('孤児'));
    // What deleting the account does to its reservations: ON DELETE CASCADE, objects left behind.
    await UserDictionaryUpload.delete({ id: orphaned.uploadId });

    expect(await sweepExpiredUploads()).toBe(1);
    expect(bucket.has(orphaned.key)).toBe(false);
    expect(bucket.has(held.key)).toBe(true);
    expect(await UserDictionaryUpload.count()).toBe(1);
  });
});
