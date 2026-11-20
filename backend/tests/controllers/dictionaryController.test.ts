import { request } from '../helpers/http';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp, setupTestSuite, TestDataSource, type TestServer } from '../helpers/setup';
import { useRawQueriesAgainstTestDb } from '../helpers/rawQuery';

/** Whether the request looks like it came through our own frontend proxy. */
let fromInternalProxy = false;
vi.mock('@lib/internalProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/internalProxy')>()),
  isInternalProxyRequest: () => fromInternalProxy,
}));

const { identifyWord } = vi.hoisted(() => ({ identifyWord: vi.fn() }));
vi.mock('@app/services/dictionary/identify', () => ({ identifyWord }));

setupTestSuite();
useRawQueriesAgainstTestDb();

const CANDIDATE = {
  id: 'jmdict:1358280',
  headword: '食べる',
  reading: 'たべる',
  common: true,
  name: false,
  sourceId: '1358280',
  dictionary: 'jmdict',
  jlpt: 'N5',
  frequency: null,
  forms: [{ text: '食べる', script: 'kanji', common: true }],
  entries: [
    {
      dictionary: 'jmdict',
      dictionaryName: 'JMdict',
      senses: [{ position: 0, definitions: [{ lang: 'en', text: 'to eat' }], tags: [] }],
    },
  ],
};

let app: TestServer;

beforeEach(() => {
  fromInternalProxy = false;
  identifyWord.mockReset();
  identifyWord.mockResolvedValue([CANDIDATE]);
  app ??= createTestApp();
});

describe('GET /v1/dictionary/identify', () => {
  it('refuses anything but our own frontend server', async () => {
    const res = await request(app).get('/v1/dictionary/identify').query({ lemma: '食べる' });

    expect(res.status).toBe(403);
    expect(identifyWord).not.toHaveBeenCalled();
  });

  it('answers our frontend server with the ranked candidates', async () => {
    fromInternalProxy = true;

    const res = await request(app)
      .get('/v1/dictionary/identify')
      .query({ lemma: '開く', surface: '開いた', reading: 'ヒライタ', pos: 'verb', locale: 'es' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ candidates: [CANDIDATE] });
    expect(identifyWord).toHaveBeenCalledWith(expect.anything(), {
      lemma: '開く',
      surface: '開いた',
      reading: 'ヒライタ',
      pos: 'verb',
      locale: 'es',
    });
  });

  it('defaults the label language to English', async () => {
    fromInternalProxy = true;

    await request(app).get('/v1/dictionary/identify').query({ lemma: '食べる' });

    expect(identifyWord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locale: 'en' }));
  });

  it('adds the pitch clip where one is uploaded', async () => {
    fromInternalProxy = true;
    identifyWord.mockResolvedValue([{ ...CANDIDATE, pitch: [{ downstep: 2 }, { downstep: 0 }] }]);
    await TestDataSource.query(
      `INSERT INTO dict.pitch_audio (reading, downstep, voice) VALUES ('たべる', 2, 'metan-v1')`,
    );

    const res = await request(app).get('/v1/dictionary/identify').query({ lemma: '食べる' });

    expect(res.status).toBe(200);
    expect(res.body.candidates[0].pitch).toEqual([
      { downstep: 2, audioUrl: expect.stringMatching(/\/pitch-audio\/metan-v1\/%E3%81%9F%E3%81%B9%E3%82%8B_2\.opus$/) },
      { downstep: 0 },
    ]);
  });

  it('needs a lemma', async () => {
    fromInternalProxy = true;

    expect((await request(app).get('/v1/dictionary/identify')).status).toBe(400);
  });
});
