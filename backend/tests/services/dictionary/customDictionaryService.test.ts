import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApplication } from '@config/application';
import { UserRoutes } from '@config/routes';
import { User, UserDictionary, UserDictionaryArtifact } from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { requireSessionAuth } from '@app/middleware/authentication';
import { uploadUserDictionary, USER_DICTIONARY_UPLOAD_PATH } from '@app/controllers/userDictionaryController';
import { enrichCandidatesWithCustomDictionaries } from '@app/services/dictionary/custom/lookup';
import {
  failInterruptedImports,
  gcOrphanArtifacts,
  INTERRUPTED_IMPORT_MESSAGE,
  invalidateUserDictionaryStack,
  loadActiveUserDictionaryStack,
} from '@app/services/dictionary/custom/service';
import { artifactSqlitePath, closeAllArtifactHandles } from '@app/services/dictionary/custom/sqlitePool';
import { IMPORTER_VERSION } from '@app/services/dictionary/custom/yomitanImport';
import type { DictionaryCandidate } from '@app/services/dictionary/identify';
import { config } from '@config/config';
import { request } from '../../helpers/http';
import { setupTestSuite, signInAs } from '../../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../../fixtures/core';
import { buildZip } from '../../fixtures/yomitanZip';

/**
 * Custom Yomitan dictionaries (task 48) against the test database: the upload endpoint, quotas, duplicates and
 * sharing between accounts, deletion, re-indexing, the interrupted-import and orphan sweeps, and the merge into word
 * cards. Imports run for real (in their worker thread); R2 is unset, so files stay in a temporary directory.
 */

const dictDir = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nadeshiko-user-dicts-'));
});

// The feature is off by default; these tests need it on, with files in a temporary directory. A mutable copy, so one
// test can switch it off again.
vi.mock('@config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config')>();
  return {
    ...actual,
    config: { ...actual.config, USER_DICTIONARIES_ENABLED: true, USER_DICTIONARIES_DIR: dictDir },
  };
});

setupTestSuite();

/** The mocked config is a plain object; its type is still the frozen one. */
function setEnabled(on: boolean) {
  (config as { USER_DICTIONARIES_ENABLED: boolean }).USER_DICTIONARIES_ENABLED = on;
}

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
    // As in `config/routes.ts`.
    instance.post(USER_DICTIONARY_UPLOAD_PATH, requireSessionAuth, uploadUserDictionary);
    instance.use('/', UserRoutes);
  },
});

/** A monolingual dictionary with a homograph (生: なま and せい) and a cross-reference. */
function monolingualZip(title = 'テスト国語', revision = '1'): Buffer {
  return buildZip([
    { name: 'index.json', data: JSON.stringify({ title, revision, format: 3 }), deflate: true },
    {
      name: 'term_bank_1.json',
      data: JSON.stringify([
        ['生', 'なま', 'n', '', 10, ['火を通していないこと。'], 1, ''],
        ['生', 'せい', 'n', '', 9, ['生きていること。'], 2, ''],
        ['食べる', 'たべる', 'v1', 'v1', 10, ['口に入れてかみ、飲み込む。'], 3, ''],
        ['〜ばかり', '', 'exp', '', 1, ['程度を表す。'], 4, ''],
      ]),
      deflate: true,
    },
  ]);
}

function pitchZip(): Buffer {
  return buildZip([
    {
      name: 'index.json',
      data: JSON.stringify({ title: 'テストアクセント', revision: '1', format: 3 }),
      deflate: true,
    },
    {
      name: 'term_meta_bank_1.json',
      data: JSON.stringify([
        ['生', 'pitch', { reading: 'なま', pitches: [{ position: 1 }] }],
        ['生', 'pitch', { reading: 'せい', pitches: [{ position: 1 }] }],
        ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 2 }] }],
        ['食べる', 'freq', { reading: 'たべる', frequency: 120 }],
      ]),
      deflate: true,
    },
  ]);
}

function upload(zip: Buffer, contentType = 'application/zip') {
  return request(app).post(USER_DICTIONARY_UPLOAD_PATH).set('Content-Type', contentType).send(zip);
}

function candidate(headword: string, reading: string, extra: Partial<DictionaryCandidate> = {}): DictionaryCandidate {
  return {
    id: `jmdict:${headword}:${reading}`,
    headword,
    reading,
    common: true,
    name: false,
    sourceId: '1',
    dictionary: 'jmdict',
    jlpt: null,
    frequency: null,
    forms: [],
    entries: [
      {
        dictionary: 'jmdict',
        dictionaryName: 'JMdict',
        senses: [{ position: 0, definitions: [{ lang: 'en', text: `${headword} (${reading})` }], tags: [] }],
      },
    ],
    ...extra,
  };
}

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(() => {
  // The database is reset between tests and ids come back; a cached stack from the last test must not answer.
  invalidateUserDictionaryStack();
  setEnabled(true);
  signInAs(app, fixtures.users.regular);
});

afterEach(() => {
  closeAllArtifactHandles();
});

describe('the upload endpoint', () => {
  it('indexes a dictionary and lists it for its owner only', async () => {
    const res = await upload(monolingualZip());

    expect(res.status).toBe(201);
    expect(res.body.dictionary).toMatchObject({ title: 'テスト国語', status: 'ready', termCount: 4, enabled: true });
    expect(res.body).not.toHaveProperty('deduplicated');
    expect(res.body.stackFingerprint).toMatch(/^[0-9a-f]{16}$/);

    const artifact = await UserDictionaryArtifact.findOneByOrFail({ title: 'テスト国語' });
    expect(artifact.importerVersion).toBe(IMPORTER_VERSION);
    expect(existsSync(artifactSqlitePath(dictDir, artifact.storageKey))).toBe(true);

    const list = await request(app).get('/v1/user/dictionaries');
    expect(list.status).toBe(200);
    expect(list.body.dictionaries).toHaveLength(1);
    expect(list.body.quota).toMatchObject({ used: 1, max: 2, isPatron: false });

    signInAs(app, fixtures.users.kevin);
    const other = await request(app).get('/v1/user/dictionaries');
    expect(other.body.dictionaries).toHaveLength(0);
  });

  it('answers 404 everywhere while the feature is off', async () => {
    setEnabled(false);

    expect((await upload(monolingualZip())).status).toBe(404);
    expect((await request(app).get('/v1/user/dictionaries')).status).toBe(404);
  });

  it('refuses anything but a raw zip body', async () => {
    const res = await upload(monolingualZip(), 'text/plain');
    expect(res.status).toBe(415);
    expect(await UserDictionary.countBy({ userId: fixtures.users.regular.id })).toBe(0);
  });

  it('refuses an unsigned-in upload', async () => {
    signInAs(app, null);
    expect((await upload(monolingualZip())).status).toBe(401);
  });

  it('refuses a file that is not a Yomitan dictionary, and keeps nothing', async () => {
    const res = await upload(buildZip([{ name: 'readme.txt', data: 'hello' }]));
    expect(res.status).toBe(400);
    expect(await UserDictionaryArtifact.count()).toBe(0);
    // The uploaded zip is gone too.
    expect(existsSync(join(dictDir, 'tmp')) ? readdirSync(join(dictDir, 'tmp')) : []).toEqual([]);
  });

  it('refuses the same file twice for one account', async () => {
    expect((await upload(monolingualZip())).status).toBe(201);
    const again = await upload(monolingualZip());
    expect(again.status).toBe(409);
  });

  it("enforces a free account's limit of two", async () => {
    expect((await upload(monolingualZip('一'))).status).toBe(201);
    expect((await upload(monolingualZip('二'))).status).toBe(201);
    const third = await upload(monolingualZip('三'));
    expect(third.status).toBe(400);
    expect(third.body.detail).toContain('limit of 2');
  });

  it('enforces the limit when two uploads race past the first check', async () => {
    expect((await upload(monolingualZip('一'))).status).toBe(201);
    const [a, b] = await Promise.all([upload(monolingualZip('二')), upload(monolingualZip('三'))]);
    expect([a.status, b.status].filter((status) => status === 201).length).toBeLessThanOrEqual(1);
    expect(await UserDictionary.countBy({ userId: fixtures.users.regular.id })).toBeLessThanOrEqual(2);
  });

  it('shares one indexed file between accounts that upload the same zip', async () => {
    await upload(monolingualZip());
    signInAs(app, fixtures.users.kevin);
    const res = await upload(monolingualZip());

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('deduplicated');
    expect(await UserDictionaryArtifact.count()).toBe(1);
    expect(await UserDictionary.count()).toBe(2);
  });
});

describe('removing, re-indexing and sweeping', () => {
  it('keeps a shared file until its last account removes it', async () => {
    const first = await upload(monolingualZip());
    signInAs(app, fixtures.users.kevin);
    const second = await upload(monolingualZip());
    const artifact = await UserDictionaryArtifact.findOneByOrFail({ title: 'テスト国語' });
    const file = artifactSqlitePath(dictDir, artifact.storageKey);

    expect((await request(app).delete(`/v1/user/dictionaries/${second.body.dictionary.id}`)).status).toBe(200);
    expect(existsSync(file)).toBe(true);

    signInAs(app, fixtures.users.regular);
    // Another account's dictionary id is not found for this one.
    expect((await request(app).delete(`/v1/user/dictionaries/${second.body.dictionary.id}`)).status).toBe(404);
    expect((await request(app).delete(`/v1/user/dictionaries/${first.body.dictionary.id}`)).status).toBe(200);
    expect(existsSync(file)).toBe(false);
    expect(await UserDictionaryArtifact.count()).toBe(0);
  });

  it('re-indexes, under a new storage key, a file that failed or that an older importer built', async () => {
    await upload(monolingualZip());
    const artifact = await UserDictionaryArtifact.findOneByOrFail({ title: 'テスト国語' });
    const oldKey = artifact.storageKey;

    // An older importer's file, reached from another account (the owner's own re-upload is a duplicate).
    await UserDictionaryArtifact.update({ id: artifact.id }, { importerVersion: IMPORTER_VERSION - 1 });
    signInAs(app, fixtures.users.kevin);
    const res = await upload(monolingualZip());

    expect(res.status).toBe(201);
    const rebuilt = await UserDictionaryArtifact.findOneByOrFail({ id: artifact.id });
    expect(rebuilt.storageKey).not.toBe(oldKey);
    expect(rebuilt.importerVersion).toBe(IMPORTER_VERSION);
    expect(existsSync(artifactSqlitePath(dictDir, oldKey))).toBe(false);
    expect(existsSync(artifactSqlitePath(dictDir, rebuilt.storageKey))).toBe(true);

    // Its owner may upload a failed one again without deleting it first.
    signInAs(app, fixtures.users.regular);
    await UserDictionaryArtifact.update({ id: artifact.id }, { status: 'failed', errorMessage: 'boom' });
    const retry = await upload(monolingualZip());
    expect(retry.status).toBe(201);
    expect(retry.body.dictionary.status).toBe('ready');
  });

  it('fails a running import whose heartbeat stopped and a queued one that never started, and nothing else', async () => {
    // An admin, for room for four.
    signInAs(app, fixtures.users.kevin);
    for (const title of ['止まった', '動いてる', '古い待ち', '新しい待ち']) await upload(monolingualZip(title));
    await UserDictionaryArtifact.query(`
      UPDATE "UserDictionaryArtifact" SET status = 'processing', import_progress = 40,
        import_started_at = CASE WHEN title IN ('止まった', '動いてる') THEN now() - interval '20 minutes' END,
        import_heartbeat_at = CASE
          WHEN title = '止まった' THEN now() - interval '10 minutes'
          WHEN title = '動いてる' THEN now() - interval '10 seconds' END,
        updated_at = CASE WHEN title = '古い待ち' THEN now() - interval '3 hours' ELSE now() - interval '10 minutes' END`);

    expect(await failInterruptedImports()).toBe(2);
    const status = async (title: string) => UserDictionaryArtifact.findOneByOrFail({ title });
    expect(await status('止まった')).toMatchObject({
      status: 'failed',
      errorMessage: INTERRUPTED_IMPORT_MESSAGE,
      importProgress: null,
    });
    expect((await status('古い待ち')).status).toBe('failed');
    expect((await status('動いてる')).status).toBe('processing');
    expect((await status('新しい待ち')).status).toBe('processing');
  });

  it('lists progress for a running import, queue places for waiting ones, and the indexed space', async () => {
    signInAs(app, fixtures.users.kevin);
    for (const title of ['一番', '二番', '三番']) await upload(monolingualZip(title));
    const used = (await UserDictionaryArtifact.find()).reduce((sum, a) => sum + Number(a.sqliteBytes), 0);
    await UserDictionaryArtifact.query(`
      UPDATE "UserDictionaryArtifact" SET status = 'processing',
        import_started_at = CASE WHEN title = '一番' THEN now() END,
        import_heartbeat_at = CASE WHEN title = '一番' THEN now() END,
        import_progress = CASE WHEN title = '一番' THEN 37 END,
        updated_at = CASE WHEN title = '二番' THEN now() - interval '2 minutes' ELSE now() - interval '1 minute' END`);
    invalidateUserDictionaryStack();

    const list = await request(app).get('/v1/user/dictionaries');
    const byTitle = Object.fromEntries(
      (list.body.dictionaries as Array<{ title: string; progress: number | null; queuePosition: number | null }>).map(
        (d) => [d.title, d],
      ),
    );
    expect(byTitle['一番']).toMatchObject({ progress: 37, queuePosition: null });
    expect(byTitle['二番']).toMatchObject({ progress: null, queuePosition: 1 });
    expect(byTitle['三番']).toMatchObject({ progress: null, queuePosition: 2 });
    expect(list.body.quota.indexedBytesUsed).toBe(used);
    expect(list.body.quota.maxIndexedBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  it('deletes files nobody links to any more, except very new ones', async () => {
    // An admin, for room for three.
    signInAs(app, fixtures.users.kevin);
    await upload(monolingualZip('残る'));
    const orphanOld = await upload(monolingualZip('孤児'));
    const orphanNew = await upload(monolingualZip('新入り'));
    const oldArtifact = await UserDictionaryArtifact.findOneByOrFail({ title: '孤児' });
    // The cascade of an account deletion, simulated.
    await UserDictionary.delete({ id: orphanOld.body.dictionary.id });
    await UserDictionary.delete({ id: orphanNew.body.dictionary.id });
    await UserDictionaryArtifact.query(
      `UPDATE "UserDictionaryArtifact" SET created_at = now() - interval '1 hour' WHERE title IN ('孤児', '残る')`,
    );

    expect(await gcOrphanArtifacts()).toBe(1);
    expect(await UserDictionaryArtifact.findOneBy({ title: '孤児' })).toBeNull();
    expect(existsSync(artifactSqlitePath(dictDir, oldArtifact.storageKey))).toBe(false);
    expect(await UserDictionaryArtifact.findOneBy({ title: '残る' })).not.toBeNull();
    expect(await UserDictionaryArtifact.findOneBy({ title: '新入り' })).not.toBeNull();
  });
});

describe('word cards', () => {
  async function stackFor(user: User) {
    return loadActiveUserDictionaryStack(user.id);
  }

  it("shows only the reading's own entry for a homograph", async () => {
    await upload(monolingualZip());
    const { candidates, pending } = await enrichCandidatesWithCustomDictionaries(
      fixtures.users.regular.id,
      { lemma: '生', reading: 'ナマ', locale: 'en' },
      [candidate('生', 'なま')],
    );

    expect(pending).toBe(false);
    const custom = candidates[0]!.entries.find((entry) => entry.dictionaryName === 'テスト国語');
    expect(custom?.senses.map((sense) => sense.definitions[0]!.text)).toEqual(['火を通していないこと。']);
  });

  it('orders entries by the reader’s stack and drops JMdict when it is switched off', async () => {
    const res = await upload(monolingualZip());
    // Custom dictionary first, JMdict after it.
    await request(app)
      .patch('/v1/user/dictionaries')
      .send({
        items: [
          { id: res.body.dictionary.stackId, enabled: true },
          { id: 'jmdict', enabled: true },
        ],
      });

    let { candidates } = await enrichCandidatesWithCustomDictionaries(
      fixtures.users.regular.id,
      { lemma: '食べる', reading: 'タベル', locale: 'en' },
      [candidate('食べる', 'たべる')],
    );
    expect(candidates[0]!.entries.map((entry) => entry.dictionaryName)).toEqual(['テスト国語', 'JMdict']);

    await request(app)
      .patch('/v1/user/dictionaries')
      .send({
        items: [
          { id: 'jmdict', enabled: false },
          { id: res.body.dictionary.stackId, enabled: true },
        ],
      });
    ({ candidates } = await enrichCandidatesWithCustomDictionaries(
      fixtures.users.regular.id,
      { lemma: '食べる', reading: 'タベル', locale: 'en' },
      [candidate('食べる', 'たべる'), candidate('喰べる', 'たべる')],
    ));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.entries.map((entry) => entry.dictionaryName)).toEqual(['テスト国語']);
  });

  it('builds a card from the reader’s dictionaries alone when JMdict has no such word', async () => {
    await upload(monolingualZip());
    const { candidates } = await enrichCandidatesWithCustomDictionaries(
      fixtures.users.regular.id,
      { lemma: '〜ばかり', locale: 'en' },
      [],
    );
    expect(candidates[0]).toMatchObject({ headword: '〜ばかり', dictionary: expect.stringMatching(/^custom:/) });
  });

  it('puts uploaded pitch first and keeps our own patterns it does not give', async () => {
    await upload(pitchZip());
    const { candidates } = await enrichCandidatesWithCustomDictionaries(
      fixtures.users.regular.id,
      { lemma: '食べる', reading: 'タベル', locale: 'en' },
      [candidate('食べる', 'たべる', { pitch: [{ downstep: 2 }, { downstep: 0 }] })],
    );

    expect(candidates[0]!.pitch).toEqual([{ downstep: 2, source: 'テストアクセント' }, { downstep: 0 }]);
    expect(candidates[0]!.customFrequencies?.[0]).toMatchObject({ dictionaryName: 'テストアクセント', value: 120 });
  });

  it('answers pending, with an unchanged fingerprint, while a dictionary is indexing', async () => {
    await upload(monolingualZip());
    const ready = await stackFor(fixtures.users.regular);
    await UserDictionaryArtifact.update({ title: 'テスト国語' }, { status: 'processing' });
    // Written behind the service's back; the service's own status changes invalidate the cache themselves.
    invalidateUserDictionaryStack();
    const indexing = await stackFor(fixtures.users.regular);

    expect(indexing.stackFingerprint).toBe(ready.stackFingerprint);
    const { pending, candidates } = await enrichCandidatesWithCustomDictionaries(
      fixtures.users.regular.id,
      { lemma: '食べる', reading: 'タベル', locale: 'en' },
      [candidate('食べる', 'たべる')],
    );
    expect(pending).toBe(true);
    expect(candidates[0]!.entries.map((entry) => entry.dictionaryName)).toEqual(['JMdict']);
  });

  it('leaves a reader without uploads exactly as JMdict answered', async () => {
    const base = [candidate('食べる', 'たべる')];
    const result = await enrichCandidatesWithCustomDictionaries(
      fixtures.users.kevin.id,
      { lemma: '食べる', locale: 'en' },
      base,
    );
    expect(result).toEqual({ candidates: base, stackFingerprint: null, pending: false });
  });
});
