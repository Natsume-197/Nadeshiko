import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateKeyError, InvalidRequestError, NotFoundError } from '@app/errors';
import { UserRoleType } from '@app/models/User';
import { closeAllArtifactHandles } from '@app/services/dictionary/custom/sqlitePool';

const {
  mockConfig,
  mockS3Send,
  mockResolveQuota,
  mockRunImportInThread,
  mockGetPgBoss,
  mockUserFindOne,
  mockUdFind,
  mockUdFindOne,
  mockUdCount,
  mockUdCreate,
  mockUdGetRepository,
  mockArtifactFindOneBy,
  mockArtifactFindOneByOrFail,
  mockArtifactCreate,
  mockArtifactCreateQueryBuilder,
  mockArtifactQuery,
} = vi.hoisted(() => ({
  mockConfig: {
    USER_DICTIONARIES_ENABLED: true,
    USER_DICTIONARIES_DIR: '',
    USER_DICTIONARIES_CACHE_MAX_BYTES: 2 * 1024 * 1024 * 1024,
    USER_DICT_R2_ENDPOINT: undefined as string | undefined,
    USER_DICT_R2_BUCKET: undefined as string | undefined,
    USER_DICT_R2_ACCESS_KEY_ID: undefined as string | undefined,
    USER_DICT_R2_SECRET_ACCESS_KEY: undefined as string | undefined,
    USER_DICT_R2_PREFIX: 'user-dicts/test',
  },
  mockS3Send: vi.fn(),
  mockResolveQuota: vi.fn(),
  mockRunImportInThread: vi.fn(),
  mockGetPgBoss: vi.fn(),
  mockUserFindOne: vi.fn(),
  mockUdFind: vi.fn(),
  mockUdFindOne: vi.fn(),
  mockUdCount: vi.fn(),
  mockUdCreate: vi.fn(),
  mockUdGetRepository: vi.fn(),
  mockArtifactFindOneBy: vi.fn(),
  mockArtifactFindOneByOrFail: vi.fn(),
  mockArtifactCreate: vi.fn(),
  mockArtifactCreateQueryBuilder: vi.fn(),
  mockArtifactQuery: vi.fn(),
}));

vi.mock('@config/config', () => ({ config: mockConfig }));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  class FakeS3Client {
    send(...args: unknown[]) {
      return mockS3Send(...args);
    }
  }
  return {
    ...actual,
    S3Client: FakeS3Client,
  };
});

vi.mock('@app/services/dictionary/custom/quotas', () => ({
  resolveCustomDictionaryQuota: (...args: unknown[]) => mockResolveQuota(...args),
}));

vi.mock('@app/services/dictionary/custom/importRunner', () => ({
  runYomitanImportInThread: (...args: unknown[]) => mockRunImportInThread(...args),
}));

vi.mock('@app/workers/pgBossClient', () => ({
  getPgBoss: (...args: unknown[]) => mockGetPgBoss(...args),
}));

vi.mock('@app/models', () => ({
  User: { findOne: (...args: unknown[]) => mockUserFindOne(...args) },
  UserDictionary: {
    find: (...args: unknown[]) => mockUdFind(...args),
    findOne: (...args: unknown[]) => mockUdFindOne(...args),
    count: (...args: unknown[]) => mockUdCount(...args),
    create: (...args: unknown[]) => mockUdCreate(...args),
    getRepository: (...args: unknown[]) => mockUdGetRepository(...args),
  },
  UserDictionaryArtifact: {
    findOneBy: (...args: unknown[]) => mockArtifactFindOneBy(...args),
    findOneByOrFail: (...args: unknown[]) => mockArtifactFindOneByOrFail(...args),
    create: (...args: unknown[]) => mockArtifactCreate(...args),
    createQueryBuilder: (...args: unknown[]) => mockArtifactCreateQueryBuilder(...args),
    query: (...args: unknown[]) => mockArtifactQuery(...args),
  },
}));

import {
  artifactExistsInStorage,
  deleteArtifactFromR2,
  ensureArtifactCachedLocally,
  getR2StorageConfig,
  pruneLocalDictionaryCache,
  r2Client,
  resolveArtifactsWithin,
  uploadArtifactToR2,
} from '@app/services/dictionary/custom/r2Storage';
import {
  assertCustomDictionariesEnabled,
  attachOrQueueUploadedDictionary,
  deleteUserDictionary,
  failInterruptedImports,
  gcOrphanArtifacts,
  getSessionCustomDictionaries,
  invalidateUserDictionaryStack,
  listUserDictionaries,
  loadActiveUserDictionaryStack,
  processArtifactImportJob,
  runUserDictionaryMaintenance,
  updateUserDictionaryStack,
} from '@app/services/dictionary/custom/service';
import { IMPORTER_VERSION } from '@app/services/dictionary/custom/yomitanImport';

function buildMinimalZip(): Buffer {
  const entries = [
    { name: 'index.json', data: JSON.stringify({ title: 'TestDict', revision: '1.0', format: 3 }) },
    { name: 'term_bank_1.json', data: JSON.stringify([['猫', 'ねこ', '', '', 0, ['cat'], 1, '']]) },
  ];
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data, 'utf8');
    const compressed = deflateRawSync(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    localParts.push(local, compressed);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

let tempDir = '';

function enableR2() {
  mockConfig.USER_DICT_R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com/';
  mockConfig.USER_DICT_R2_BUCKET = 'nadeshiko-production';
  mockConfig.USER_DICT_R2_ACCESS_KEY_ID = 'key-id';
  mockConfig.USER_DICT_R2_SECRET_ACCESS_KEY = 'secret-key';
  mockConfig.USER_DICT_R2_PREFIX = '/user-dicts/test/';
}

function makeQueryBuilder(affected: number) {
  const qb = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ affected }),
  };
  return qb;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The per-reader stack cache would carry one test's mocked stack into the next.
  invalidateUserDictionaryStack();
  tempDir = mkdtempSync(join(tmpdir(), 'nadeshiko-svc-r2-'));
  mockConfig.USER_DICTIONARIES_ENABLED = true;
  mockConfig.USER_DICTIONARIES_DIR = tempDir;
  mockConfig.USER_DICTIONARIES_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
  mockConfig.USER_DICT_R2_ENDPOINT = undefined;
  mockConfig.USER_DICT_R2_BUCKET = undefined;
  mockConfig.USER_DICT_R2_ACCESS_KEY_ID = undefined;
  mockConfig.USER_DICT_R2_SECRET_ACCESS_KEY = undefined;
  mockConfig.USER_DICT_R2_PREFIX = 'user-dicts/test';

  mockArtifactCreateQueryBuilder.mockReturnValue(makeQueryBuilder(0));
  mockResolveQuota.mockResolvedValue({ maxDictionaries: 2, maxZipBytes: 60 * 1024 * 1024, isPatron: false });
});

afterEach(() => {
  closeAllArtifactHandles();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('r2Storage operations', () => {
  it('returns null config when unset and caches S3Client when configured', () => {
    expect(getR2StorageConfig()).toBeNull();
    enableR2();
    const cfg = getR2StorageConfig();
    expect(cfg).toEqual({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      bucket: 'nadeshiko-production',
      accessKeyId: 'key-id',
      secretAccessKey: 'secret-key',
      prefix: 'user-dicts/test',
    });
    const c1 = r2Client(cfg!);
    const c2 = r2Client(cfg!);
    expect(c1).toBe(c2);
  });

  it('uploads, checks existence, downloads to local cache, deletes, and prunes LRU cache', async () => {
    const localFile = join(tempDir, 'k-up.sqlite');
    writeFileSync(localFile, 'sqlite-bytes');

    // Local-only mode: upload/delete are no-ops, exists checks local disk.
    await uploadArtifactToR2('k-up', localFile);
    await deleteArtifactFromR2('k-up');
    expect(await artifactExistsInStorage('k-up')).toBe(true);
    expect(await artifactExistsInStorage('k-missing')).toBe(false);
    expect(await ensureArtifactCachedLocally('k-missing')).toBeNull();
    expect(mockS3Send).not.toHaveBeenCalled();

    // Enable R2.
    enableR2();
    mockS3Send.mockResolvedValue({});
    await uploadArtifactToR2('k-up', localFile);
    expect(mockS3Send).toHaveBeenCalledTimes(1);

    // Exists via HEAD in R2.
    expect(await artifactExistsInStorage('k-remote')).toBe(true);
    mockS3Send.mockRejectedValueOnce(new Error('not found'));
    expect(await artifactExistsInStorage('k-remote-miss')).toBe(false);

    // Download via GET from R2 into local cache.
    mockS3Send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('downloaded-sqlite')]) });
    const cached = await ensureArtifactCachedLocally('k-dl');
    expect(cached).toBe(join(tempDir, 'k-dl.sqlite'));
    expect(existsSync(cached!)).toBe(true);

    // 404 and unexpected errors return null gracefully.
    mockS3Send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await ensureArtifactCachedLocally('k-404')).toBeNull();
    mockS3Send.mockRejectedValueOnce(new Error('r2 down'));
    expect(await ensureArtifactCachedLocally('k-err')).toBeNull();

    // resolveArtifactsWithin reports local hits + missing.
    mockS3Send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    const resolved = await resolveArtifactsWithin(['k-dl', 'k-nope'], 500);
    expect(resolved.paths.get('k-dl')).toBe(join(tempDir, 'k-dl.sqlite'));
    expect(resolved.missing).toBe(1);

    // Delete handles 404 and unexpected failures cleanly.
    mockS3Send.mockResolvedValueOnce({});
    await deleteArtifactFromR2('k-dl');
    mockS3Send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await deleteArtifactFromR2('k-404');
    mockS3Send.mockRejectedValueOnce(new Error('boom'));
    await deleteArtifactFromR2('k-err');

    // Prune evicts oldest files when over cap.
    const oldFile = join(tempDir, 'old.sqlite');
    const newFile = join(tempDir, 'new.sqlite');
    writeFileSync(oldFile, Buffer.alloc(100, 1));
    writeFileSync(newFile, Buffer.alloc(100, 2));
    utimesSync(oldFile, new Date(1000), new Date(1000));
    utimesSync(newFile, new Date(Date.now()), new Date(Date.now()));
    mockConfig.USER_DICTIONARIES_CACHE_MAX_BYTES = 150;
    await pruneLocalDictionaryCache();
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
  });
});

describe('custom dictionary service', () => {
  const user = { id: 10, role: UserRoleType.USER };
  const sampleArtifact = (overrides: Record<string, unknown> = {}) => ({
    id: 100,
    sha256: 'a'.repeat(64),
    storageKey: 'b'.repeat(64),
    title: 'TestDict',
    revision: '1.0',
    author: null,
    description: null,
    url: null,
    format: 3,
    frequencyMode: null,
    hasTerms: true,
    hasFrequency: false,
    hasPitch: false,
    termCount: 1,
    frequencyCount: 0,
    pitchCount: 0,
    zipBytes: '1234',
    sqliteBytes: '4096',
    status: 'ready',
    errorMessage: null,
    importerVersion: IMPORTER_VERSION,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const sampleRow = (overrides: Record<string, unknown> = {}) => ({
    id: 5,
    userId: 10,
    artifactId: 100,
    enabled: true,
    sortOrder: 0,
    createdAt: new Date('2026-11-19T00:00:00.000Z'),
    artifact: sampleArtifact(),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  it('guards feature flag and computes session state safely', async () => {
    mockConfig.USER_DICTIONARIES_ENABLED = false;
    expect(() => assertCustomDictionariesEnabled()).toThrow(NotFoundError);
    expect(await getSessionCustomDictionaries(10)).toBeNull();

    mockConfig.USER_DICTIONARIES_ENABLED = true;
    expect(() => assertCustomDictionariesEnabled()).not.toThrow();
    expect(await getSessionCustomDictionaries(0)).toBeNull();

    mockUserFindOne.mockResolvedValue({
      id: 10,
      preferences: { dictionaryStack: { builtinEnabled: true, builtinPosition: 1 } },
    });
    mockUdFind.mockResolvedValue([
      sampleRow(),
      sampleRow({
        id: 6,
        sortOrder: 1,
        artifact: sampleArtifact({ id: 101, status: 'processing', storageKey: 'c'.repeat(64) }),
      }),
    ]);
    const session = await getSessionCustomDictionaries(10);
    expect(session?.count).toBe(1);
    expect(session?.stackFingerprint).toMatch(/^[0-9a-f]{16}$/);

    invalidateUserDictionaryStack(10);
    mockUserFindOne.mockRejectedValueOnce(new Error('db down'));
    expect(await getSessionCustomDictionaries(10)).toEqual({ count: 0, stackFingerprint: null });
  });

  it('lists dictionaries, marks interrupted imports, and loads active stack', async () => {
    mockArtifactCreateQueryBuilder.mockReturnValue(makeQueryBuilder(2));
    expect(await failInterruptedImports()).toBe(2);

    mockUserFindOne.mockResolvedValue({ id: 10, preferences: {} });
    mockUdFind.mockResolvedValue([sampleRow()]);

    const listed = await listUserDictionaries(user);
    expect(listed.dictionaries).toHaveLength(1);
    expect(listed.builtin).toEqual({ id: 'jmdict', enabled: true, position: 1 });
    expect(listed.quota.used).toBe(1);

    const active = await loadActiveUserDictionaryStack(10);
    expect(active.dictionaries).toHaveLength(1);
    expect(active.pendingCount).toBe(0);
  });

  it('processes artifact import jobs (success, missing artifact, missing zip, error)', async () => {
    const tmpZip = join(tempDir, 'upload.zip');
    writeFileSync(tmpZip, buildMinimalZip());

    // Missing artifact
    mockArtifactFindOneBy.mockResolvedValueOnce(null);
    await processArtifactImportJob(999, tmpZip);
    expect(existsSync(tmpZip)).toBe(false);

    // Missing zip on disk -> marks failed
    const artMissing = sampleArtifact({ status: 'processing' });
    mockArtifactFindOneBy.mockResolvedValueOnce(artMissing);
    await processArtifactImportJob(100, join(tempDir, 'gone.zip'));
    expect(artMissing.status).toBe('failed');
    expect(artMissing.save).toHaveBeenCalled();

    // Success path
    const tmpZip2 = join(tempDir, 'upload2.zip');
    writeFileSync(tmpZip2, buildMinimalZip());
    const artOk = sampleArtifact({ status: 'processing', storageKey: 'okkey' });
    mockArtifactFindOneBy.mockResolvedValueOnce(artOk);
    mockRunImportInThread.mockResolvedValueOnce({
      index: {
        title: 'TestDict',
        revision: '2.0',
        format: 3,
        author: 'A',
        description: 'D',
        url: null,
        frequencyMode: null,
      },
      hasTerms: true,
      hasFrequency: false,
      hasPitch: false,
      termCount: 10,
      frequencyCount: 0,
      pitchCount: 0,
      sqliteBytes: 2048,
    });
    await processArtifactImportJob(100, tmpZip2);
    expect(artOk.status).toBe('ready');
    expect(artOk.termCount).toBe(10);
    expect(existsSync(tmpZip2)).toBe(false);
  });

  it('handles upload validation, quota, dedup, and queueing cleanly', async () => {
    const zipPath = join(tempDir, 'dict.zip');
    writeFileSync(zipPath, buildMinimalZip());

    // Exceeds zip size
    await expect(attachOrQueueUploadedDictionary(user, zipPath, '1'.repeat(64), 90 * 1024 * 1024)).rejects.toThrow(
      InvalidRequestError,
    );

    // Invalid zip
    const badPath = join(tempDir, 'bad.zip');
    writeFileSync(badPath, 'not a zip file at all 1234567890');
    await expect(attachOrQueueUploadedDictionary(user, badPath, '2'.repeat(64), 100)).rejects.toThrow(
      InvalidRequestError,
    );

    // Duplicate already linked
    const zipDup = join(tempDir, 'dup.zip');
    writeFileSync(zipDup, buildMinimalZip());
    mockUdFind.mockResolvedValueOnce([
      sampleRow({ artifact: sampleArtifact({ sha256: '3'.repeat(64), status: 'ready' }) }),
    ]);
    await expect(attachOrQueueUploadedDictionary(user, zipDup, '3'.repeat(64), 200)).rejects.toThrow(DuplicateKeyError);

    // Quota reached
    const zipQuota = join(tempDir, 'quota.zip');
    writeFileSync(zipQuota, buildMinimalZip());
    mockUdFind.mockResolvedValueOnce([sampleRow({ id: 1 }), sampleRow({ id: 2 })]);
    await expect(attachOrQueueUploadedDictionary(user, zipQuota, '4'.repeat(64), 200)).rejects.toThrow(
      InvalidRequestError,
    );

    // Deduplicated instant attach against existing ready artifact on disk
    const zipDedup = join(tempDir, 'dedup.zip');
    writeFileSync(zipDedup, buildMinimalZip());
    const readyStorageKey = 'readykey';
    writeFileSync(join(tempDir, `${readyStorageKey}.sqlite`), 'cached');
    const existingArt = sampleArtifact({ sha256: '5'.repeat(64), storageKey: readyStorageKey, status: 'ready' });
    mockUdFind.mockResolvedValueOnce([]);
    mockArtifactFindOneBy.mockResolvedValueOnce(existingArt);
    const createdLink = sampleRow({ id: 12, artifactId: existingArt.id, artifact: existingArt });
    mockUdCreate.mockReturnValueOnce(createdLink);
    mockUdCount.mockResolvedValueOnce(1);
    mockUserFindOne.mockResolvedValue({ id: 10, preferences: {} });
    mockUdFind.mockResolvedValueOnce([createdLink]);

    const dedupRes = await attachOrQueueUploadedDictionary(user, zipDedup, '5'.repeat(64), 200);
    expect(dedupRes.deduplicated).toBe(true);
    expect(dedupRes.dictionary.status).toBe('ready');

    // New artifact queued to pg-boss
    const zipNew = join(tempDir, 'new.zip');
    writeFileSync(zipNew, buildMinimalZip());
    const newArt = sampleArtifact({ id: 200, sha256: '6'.repeat(64), status: 'processing' });
    const newLink = sampleRow({ id: 13, artifactId: 200, artifact: newArt });
    const mockBossSend = vi.fn().mockResolvedValue('job-1');
    mockUdFind.mockResolvedValueOnce([]);
    mockArtifactFindOneBy.mockResolvedValueOnce(null);
    mockArtifactCreate.mockReturnValueOnce(newArt);
    mockUdCreate.mockReturnValueOnce(newLink);
    mockUdCount.mockResolvedValueOnce(1);
    mockGetPgBoss.mockReturnValueOnce({ send: mockBossSend });
    mockUdFind.mockResolvedValueOnce([newLink]);

    const queuedRes = await attachOrQueueUploadedDictionary(user, zipNew, '6'.repeat(64), 200);
    expect(queuedRes.deduplicated).toBe(false);
    expect(mockBossSend).toHaveBeenCalledWith('user-dictionary-import', {
      artifactId: 200,
      tmpZipPath: zipNew,
    });
  });

  it('reorders stack, deletes unreferenced artifacts, and runs orphan GC maintenance', async () => {
    const r1 = sampleRow({ id: 1, sortOrder: 0 });
    const r2 = sampleRow({ id: 2, sortOrder: 1 });
    const dbUser = { id: 10, preferences: {} as Record<string, unknown> };
    const manager = {
      save: vi.fn().mockResolvedValue(undefined),
      findOne: vi.fn().mockResolvedValue(dbUser),
    };
    mockUdFind.mockResolvedValueOnce([r1, r2]);
    mockUdGetRepository.mockReturnValue({
      manager: { transaction: async (fn: (m: typeof manager) => Promise<void>) => fn(manager) },
    });
    mockUserFindOne.mockResolvedValue(dbUser);
    mockUdFind.mockResolvedValueOnce([r2, r1]);

    await updateUserDictionaryStack(user, [
      { id: 'custom:2', enabled: false },
      { id: 'jmdict', enabled: true },
    ]);
    expect(r2.sortOrder).toBe(0);
    expect(r2.enabled).toBe(false);
    expect(r1.sortOrder).toBe(1);
    expect(dbUser.preferences.dictionaryStack).toEqual({ builtinEnabled: true, builtinPosition: 1 });

    // Delete: 404 when missing
    mockUdFindOne.mockResolvedValueOnce(null);
    await expect(deleteUserDictionary(user, 999)).rejects.toThrow(NotFoundError);

    // Delete: removes link + deletes unreferenced artifact file
    const delKey = 'delkey';
    writeFileSync(join(tempDir, `${delKey}.sqlite`), 'data');
    const delRow = sampleRow({ id: 5, artifactId: 50, artifact: sampleArtifact({ id: 50, storageKey: delKey }) });
    mockUdFindOne.mockResolvedValueOnce(delRow);
    mockArtifactQuery.mockResolvedValueOnce([[], 1]);
    mockUdFind.mockResolvedValueOnce([]);
    const delRes = await deleteUserDictionary(user, 5);
    expect(delRow.remove).toHaveBeenCalled();
    expect(existsSync(join(tempDir, `${delKey}.sqlite`))).toBe(false);
    expect(delRes.stackFingerprint).toBeNull();

    // Orphan GC + nightly maintenance
    const orphanKey = 'orphankey';
    writeFileSync(join(tempDir, `${orphanKey}.sqlite`), 'orphan');
    mockArtifactQuery.mockResolvedValueOnce([{ id: 77, storage_key: orphanKey }]).mockResolvedValueOnce([[], 1]);
    expect(await gcOrphanArtifacts()).toBe(1);
    expect(existsSync(join(tempDir, `${orphanKey}.sqlite`))).toBe(false);

    mockArtifactQuery.mockResolvedValueOnce([]);
    await runUserDictionaryMaintenance();
    mockConfig.USER_DICTIONARIES_ENABLED = false;
    await runUserDictionaryMaintenance();
  });
});
