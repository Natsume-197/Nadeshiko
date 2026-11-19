import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictionaryCandidate } from '@app/services/dictionary/identify';
import { UserRoleType } from '@app/models/User';
import { closeAllArtifactHandles } from '@app/services/dictionary/custom/sqlitePool';
import { importYomitanZipToSqlite } from '@app/services/dictionary/custom/yomitanImport';

const {
  canUseCustomTheme,
  loadActiveUserDictionaryStack,
  resolveArtifactsWithin,
  assertCustomDictionariesEnabled,
  listUserDictionariesService,
  updateUserDictionaryStack,
  deleteUserDictionaryService,
  attachOrQueueUploadedDictionary,
  processArtifactImportJob,
  runUserDictionaryMaintenance,
  failInterruptedImports,
} = vi.hoisted(() => ({
  canUseCustomTheme: vi.fn(),
  loadActiveUserDictionaryStack: vi.fn(),
  resolveArtifactsWithin: vi.fn(),
  assertCustomDictionariesEnabled: vi.fn(),
  listUserDictionariesService: vi.fn(),
  updateUserDictionaryStack: vi.fn(),
  deleteUserDictionaryService: vi.fn(),
  attachOrQueueUploadedDictionary: vi.fn(),
  processArtifactImportJob: vi.fn(),
  runUserDictionaryMaintenance: vi.fn(),
  failInterruptedImports: vi.fn(),
}));

vi.mock('@app/middleware/authentication', () => ({
  assertUser: (req: { user?: unknown }) => req.user,
}));

vi.mock('@config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      USER_DICTIONARIES_DIR: join(tmpdir(), 'nadeshiko-controller-test-dicts'),
    },
  };
});

vi.mock('@app/services/themes/customTheme', () => ({
  canUseCustomTheme: (...args: unknown[]) => canUseCustomTheme(...args),
}));

vi.mock('@app/services/dictionary/custom/service', () => ({
  loadActiveUserDictionaryStack: (...args: unknown[]) => loadActiveUserDictionaryStack(...args),
  assertCustomDictionariesEnabled: (...args: unknown[]) => assertCustomDictionariesEnabled(...args),
  listUserDictionaries: (...args: unknown[]) => listUserDictionariesService(...args),
  updateUserDictionaryStack: (...args: unknown[]) => updateUserDictionaryStack(...args),
  deleteUserDictionary: (...args: unknown[]) => deleteUserDictionaryService(...args),
  attachOrQueueUploadedDictionary: (...args: unknown[]) => attachOrQueueUploadedDictionary(...args),
  processArtifactImportJob: (...args: unknown[]) => processArtifactImportJob(...args),
  runUserDictionaryMaintenance: (...args: unknown[]) => runUserDictionaryMaintenance(...args),
  failInterruptedImports: (...args: unknown[]) => failInterruptedImports(...args),
}));

vi.mock('@app/services/dictionary/custom/r2Storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@app/services/dictionary/custom/r2Storage')>();
  return {
    ...actual,
    resolveArtifactsWithin: (...args: unknown[]) => resolveArtifactsWithin(...args),
  };
});

import {
  FREE_MAX_DICTIONARIES,
  FREE_MAX_ZIP_BYTES,
  PATRON_MAX_DICTIONARIES,
  PATRON_MAX_ZIP_BYTES,
  resolveCustomDictionaryQuota,
} from '@app/services/dictionary/custom/quotas';
import { enrichCandidatesWithCustomDictionaries } from '@app/services/dictionary/custom/lookup';
import {
  deleteUserDictionary,
  listUserDictionaries,
  updateUserDictionaries,
  uploadUserDictionary,
} from '@app/controllers/userDictionaryController';
import { registerUserDictionaryImportWorker } from '@app/workers/userDictionaryImportWorker';
import { InvalidRequestError } from '@app/errors';

function buildZip(entries: Array<{ name: string; data: string }>): Buffer {
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

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nadeshiko-custom-lookup-'));
  tempDirs.push(dir);
  return dir;
}

const baseCandidate: DictionaryCandidate = {
  id: 'jmdict:1358280',
  headword: '食べる',
  reading: 'たべる',
  common: true,
  name: false,
  sourceId: '1358280',
  dictionary: 'jmdict',
  jlpt: 'N5',
  frequency: 195,
  pitch: [{ downstep: 2 }, { downstep: 0 }],
  forms: [{ text: '食べる', script: 'kanji', common: true }],
  entries: [
    {
      dictionary: 'jmdict',
      dictionaryName: 'JMdict',
      senses: [{ position: 0, definitions: [{ lang: 'en', text: 'to eat' }], tags: [] }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  closeAllArtifactHandles();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveCustomDictionaryQuota', () => {
  it('returns Free tier limits for non-patrons and Patron limits for patrons', async () => {
    canUseCustomTheme.mockResolvedValueOnce(false);
    expect(await resolveCustomDictionaryQuota({ id: 1, role: UserRoleType.USER })).toEqual({
      maxDictionaries: FREE_MAX_DICTIONARIES,
      maxZipBytes: FREE_MAX_ZIP_BYTES,
      isPatron: false,
    });

    canUseCustomTheme.mockResolvedValueOnce(true);
    expect(await resolveCustomDictionaryQuota({ id: 2, role: UserRoleType.ADMIN })).toEqual({
      maxDictionaries: PATRON_MAX_DICTIONARIES,
      maxZipBytes: PATRON_MAX_ZIP_BYTES,
      isPatron: true,
    });
  });
});

describe('enrichCandidatesWithCustomDictionaries', () => {
  it('returns base candidates untouched when the user has no custom stack', async () => {
    loadActiveUserDictionaryStack.mockResolvedValue({
      dictionaries: [],
      builtinEnabled: true,
      builtinPosition: 0,
      stackFingerprint: null,
      pendingCount: 0,
    });

    const out = await enrichCandidatesWithCustomDictionaries(1, { lemma: '食べる', locale: 'en' }, [baseCandidate]);
    expect(out).toEqual({ candidates: [baseCandidate], stackFingerprint: null, pending: false });
  });

  it('merges custom terms, frequencies, pitches, and tags in stack order and supports standalone fallback', async () => {
    const dir = makeTempDir();
    const zipPath = join(dir, 'combo.zip');
    const sqlitePath = join(dir, 'combo.sqlite');
    writeFileSync(
      zipPath,
      buildZip([
        { name: 'index.json', data: JSON.stringify({ title: 'MyDict', revision: '1', format: 3 }) },
        {
          name: 'tag_bank_1.json',
          data: JSON.stringify([
            ['v1', 'partOfSpeech', 0, 'Ichidan verb', 0],
            ['food', 'field', 0, 'Food term', 0],
            ['ksb', 'dialect', 0, 'Kansai-ben', 0],
            ['col', 'misc', 0, 'Colloquial', 0],
          ]),
        },
        {
          name: 'term_bank_1.json',
          data: JSON.stringify([
            [
              '食べる',
              'たべる',
              'v1 food',
              'v1',
              10,
              [{ type: 'structured-content', content: '固形の食物をかんで飲み込む。' }],
              1,
              'ksb col',
            ],
            ['〜ばかりか', 'ばかりか', '', '', 5, ['not only ... but also'], 2, ''],
          ]),
        },
        {
          name: 'term_meta_bank_1.json',
          data: JSON.stringify([
            ['食べる', 'freq', 172],
            [
              '食べる',
              'pitch',
              { reading: 'たべる', pitches: [{ position: 2, nasal: [1], devoice: [2], tags: ['名'] }] },
            ],
            ['〜ばかりか', 'freq', { value: 900, displayValue: '#900' }],
          ]),
        },
      ]),
    );
    await importYomitanZipToSqlite(zipPath, sqlitePath);

    loadActiveUserDictionaryStack.mockResolvedValue({
      dictionaries: [
        {
          userDictionaryId: 7,
          stackId: 'custom:7',
          sortOrder: 0,
          artifactId: 10,
          sha256: 'a'.repeat(64),
          storageKey: 'key-1',
          title: 'MyDict',
          frequencyMode: 'rank-based',
          hasTerms: true,
          hasFrequency: true,
          hasPitch: true,
        },
      ],
      builtinEnabled: true,
      builtinPosition: 1,
      stackFingerprint: 'fp-custom',
      pendingCount: 0,
    });
    resolveArtifactsWithin.mockResolvedValue({ paths: new Map([['key-1', sqlitePath]]), missing: 0 });

    const enriched = await enrichCandidatesWithCustomDictionaries(1, { lemma: '食べる', locale: 'en' }, [
      baseCandidate,
    ]);
    expect(enriched.stackFingerprint).toBe('fp-custom');
    expect(enriched.pending).toBe(false);
    expect(enriched.candidates[0]?.entries.map((e) => e.dictionary)).toEqual(['custom:7', 'jmdict']);
    expect(enriched.candidates[0]?.entries[0]?.senses[0]?.tags.map((t) => t.category)).toEqual([
      'partOfSpeech',
      'field',
      'dialect',
      'misc',
    ]);
    expect(enriched.candidates[0]?.customFrequencies).toEqual([
      { dictionary: 'custom:7', dictionaryName: 'MyDict', value: 172, displayValue: '172' },
    ]);
    // Custom downstep 2 comes first with source, built-in downstep 0 is preserved without duplicating 2.
    expect(enriched.candidates[0]?.pitch).toEqual([
      { downstep: 2, source: 'MyDict', nasal: [1], devoice: [2], tags: ['名'] },
      { downstep: 0 },
    ]);

    // Standalone custom-only fallback when JMdict returned no candidates.
    const grammarOnly = await enrichCandidatesWithCustomDictionaries(
      1,
      { lemma: '〜ばかりか', reading: 'ばかりか', locale: 'en' },
      [],
    );
    expect(grammarOnly.candidates).toHaveLength(1);
    expect(grammarOnly.candidates[0]?.headword).toBe('〜ばかりか');
    expect(grammarOnly.candidates[0]?.entries[0]?.dictionary).toBe('custom:7');
    expect(grammarOnly.candidates[0]?.customFrequencies?.[0]?.displayValue).toBe('#900');

    // Built-in JMdict disabled drops candidates that have no custom match.
    loadActiveUserDictionaryStack.mockResolvedValueOnce({
      dictionaries: [
        {
          userDictionaryId: 7,
          stackId: 'custom:7',
          sortOrder: 0,
          artifactId: 10,
          sha256: 'a'.repeat(64),
          storageKey: 'key-1',
          title: 'MyDict',
          frequencyMode: null,
          hasTerms: true,
          hasFrequency: false,
          hasPitch: false,
        },
      ],
      builtinEnabled: false,
      builtinPosition: 0,
      stackFingerprint: 'fp-no-jmdict',
      pendingCount: 1,
    });
    const noBuiltin = await enrichCandidatesWithCustomDictionaries(1, { lemma: '未知語', locale: 'en' }, [
      { ...baseCandidate, headword: '未知語', reading: 'みちご' },
    ]);
    expect(noBuiltin.candidates).toEqual([]);
    expect(noBuiltin.pending).toBe(true);
  });
});

describe('userDictionaryController', () => {
  function makeRes() {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  function makeStreamReq(headers: Record<string, string>, chunks: Buffer[]) {
    const stream = Readable.from(chunks) as Readable & {
      headers: Record<string, string>;
      user: { id: number; role: UserRoleType };
    };
    stream.headers = headers;
    stream.user = { id: 42, role: UserRoleType.USER };
    return stream as unknown as Request;
  }

  it('delegates list, update, and delete handlers to the dictionary service', async () => {
    const req = { user: { id: 42, role: UserRoleType.USER } } as unknown as Request;
    const respond = {
      with200: () => ({ body: (data: unknown) => ({ status: 200, data }) }),
    } as never;

    listUserDictionariesService.mockResolvedValue({ dictionaries: [] });
    await listUserDictionaries({} as never, respond, req, {} as never, vi.fn());
    expect(assertCustomDictionariesEnabled).toHaveBeenCalled();
    expect(listUserDictionariesService).toHaveBeenCalledWith(req.user);

    updateUserDictionaryStack.mockResolvedValue({ dictionaries: [] });
    await updateUserDictionaries(
      { body: { items: [{ id: 'jmdict', enabled: true }] } } as never,
      respond,
      req,
      {} as never,
      vi.fn(),
    );
    expect(updateUserDictionaryStack).toHaveBeenCalledWith(req.user, [{ id: 'jmdict', enabled: true }]);

    deleteUserDictionaryService.mockResolvedValue({ stackFingerprint: null });
    await deleteUserDictionary({ params: { id: 9 } } as never, respond, req, {} as never, vi.fn());
    expect(deleteUserDictionaryService).toHaveBeenCalledWith(req.user, 9);
  });

  it('rejects unsupported media types (415) and oversized uploads (413)', async () => {
    canUseCustomTheme.mockResolvedValue(false);

    const res415 = makeRes();
    const req415 = makeStreamReq({ 'content-type': 'text/plain' }, []);
    await uploadUserDictionary(req415, res415 as unknown as Response, vi.fn() as NextFunction);
    expect(res415.statusCode).toBe(415);

    const res413Header = makeRes();
    const req413Header = makeStreamReq(
      { 'content-type': 'application/zip', 'content-length': String(FREE_MAX_ZIP_BYTES + 10) },
      [],
    );
    await uploadUserDictionary(req413Header, res413Header as unknown as Response, vi.fn() as NextFunction);
    expect(res413Header.statusCode).toBe(413);
  });

  it('rejects empty/tiny bodies and returns 201 or 202 for valid uploads', async () => {
    canUseCustomTheme.mockResolvedValue(false);

    const nextTiny = vi.fn();
    const reqTiny = makeStreamReq({ 'content-type': 'application/zip' }, [Buffer.from('tiny')]);
    await uploadUserDictionary(reqTiny, makeRes() as unknown as Response, nextTiny as NextFunction);
    expect(nextTiny.mock.calls[0]?.[0]).toBeInstanceOf(InvalidRequestError);

    attachOrQueueUploadedDictionary.mockResolvedValueOnce({
      dictionary: { id: 1, status: 'ready' },
      deduplicated: true,
      stackFingerprint: 'fp1',
    });
    const res201 = makeRes();
    const req201 = makeStreamReq({ 'content-type': 'application/zip; charset=binary' }, [Buffer.alloc(64, 0x50)]);
    await uploadUserDictionary(req201, res201 as unknown as Response, vi.fn() as NextFunction);
    expect(res201.statusCode).toBe(201);

    attachOrQueueUploadedDictionary.mockResolvedValueOnce({
      dictionary: { id: 2, status: 'processing' },
      deduplicated: false,
      stackFingerprint: null,
    });
    const res202 = makeRes();
    const req202 = makeStreamReq({ 'content-type': 'application/octet-stream' }, [Buffer.alloc(64, 0x50)]);
    await uploadUserDictionary(req202, res202 as unknown as Response, vi.fn() as NextFunction);
    expect(res202.statusCode).toBe(202);
  });
});

describe('registerUserDictionaryImportWorker', () => {
  it('registers import and maintenance workers and invokes both handlers', async () => {
    const handlers = new Map<string, (jobs: unknown[]) => Promise<void>>();
    const boss = {
      work: vi.fn(async (queue: string, _opts: unknown, handler: (jobs: unknown[]) => Promise<void>) => {
        handlers.set(queue, handler);
      }),
    };

    failInterruptedImports.mockResolvedValue(0);
    await registerUserDictionaryImportWorker(boss as never);
    expect(boss.work).toHaveBeenCalledTimes(2);

    const importHandler = handlers.get('user-dictionary-import');
    expect(importHandler).toBeDefined();
    await importHandler?.([{ id: 'j1', data: { artifactId: 5, tmpZipPath: '/tmp/a.zip' } }]);
    expect(processArtifactImportJob).toHaveBeenCalledWith(5, '/tmp/a.zip');

    const maintHandler = handlers.get('user-dictionary-maintenance');
    expect(maintHandler).toBeDefined();
    await maintHandler?.([{ id: 'j2', data: {} }]);
    expect(runUserDictionaryMaintenance).toHaveBeenCalledTimes(1);
  });
});
