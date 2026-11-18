import { request } from '../helpers/http';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp, setupTestSuite, type TestServer } from '../helpers/setup';

/** Whether the request looks like it came through our own frontend proxy. */
let fromInternalProxy = false;
vi.mock('@lib/internalProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/internalProxy')>()),
  isInternalProxyRequest: () => fromInternalProxy,
}));

const { kanjiCard, kanjiIndex } = vi.hoisted(() => ({ kanjiCard: vi.fn(), kanjiIndex: vi.fn() }));
vi.mock('@app/services/dictionary/kanji', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/services/dictionary/kanji')>()),
  kanjiCard,
  kanjiIndex,
}));

setupTestSuite();

const CARD = {
  character: '本',
  strokeCount: 5,
  grade: 1,
  frequency: 10,
  corpusRank: 11,
  jlpt: 5,
  kanken: '10級',
  radical: { glyph: '⽊', number: 75, reading: 'き', meaning: 'tree, wood', character: '木' },
  readings: [
    {
      kind: 'on',
      reading: 'ホン',
      examples: [{ id: 'jmdict:1522150', headword: '本', reading: 'ほん', furigana: [{ text: '本', ruby: 'ほん' }] }],
    },
  ],
  meanings: ['book'],
  meaningsLanguage: 'en',
  components: [{ character: '木', hasCard: true, meaning: 'tree' }],
  strokes: ['M1,1'],
  strokeNumbers: [[1, 2]],
  words: [{ id: 'jmdict:1583070', headword: '日本', reading: 'にほん', frequency: 40, gloss: 'Japan' }],
  sameRadical: [{ character: '木', reading: 'ボク', meaning: 'tree', grade: 1 }],
  sameRadicalCount: 1,
  containedIn: [],
  containedInCount: 0,
};

let app: TestServer;

beforeEach(() => {
  fromInternalProxy = false;
  kanjiCard.mockReset();
  kanjiCard.mockResolvedValue(CARD);
  app ??= createTestApp();
});

const path = (character: string) => `/v1/dictionary/kanji/${encodeURIComponent(character)}`;

describe('GET /v1/dictionary/kanji/{character}', () => {
  it('refuses anything but our own frontend server', async () => {
    const res = await request(app).get(path('本'));

    expect(res.status).toBe(403);
    expect(kanjiCard).not.toHaveBeenCalled();
  });

  it('answers our frontend server with the card, in the asked language', async () => {
    fromInternalProxy = true;

    const res = await request(app).get(path('本')).query({ locale: 'es' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(CARD);
    expect(kanjiCard).toHaveBeenCalledWith(expect.anything(), '本', 'es', { related: 'short' });
  });

  it('defaults to English', async () => {
    fromInternalProxy = true;

    await request(app).get(path('本'));

    expect(kanjiCard).toHaveBeenCalledWith(expect.anything(), '本', 'en', { related: 'short' });
  });

  it('lists every related kanji for the kanji page', async () => {
    fromInternalProxy = true;

    await request(app).get(path('本')).query({ related: 'all' });

    expect(kanjiCard).toHaveBeenCalledWith(expect.anything(), '本', 'en', { related: 'all' });
  });

  it('takes one character only', async () => {
    fromInternalProxy = true;

    const res = await request(app).get(path('本当'));

    expect(res.status).toBe(400);
    expect(kanjiCard).not.toHaveBeenCalled();
  });

  it('answers 404 for a kanji with no card', async () => {
    fromInternalProxy = true;
    kanjiCard.mockResolvedValue(null);

    const res = await request(app).get(path('鬱'));

    expect(res.status).toBe(404);
  });
});

describe('GET /v1/dictionary/kanji', () => {
  const ENTRY = { character: '日', grade: 1, jlpt: 5, frequency: 1, reading: 'ニチ', meaning: 'day' };

  beforeEach(() => {
    kanjiIndex.mockReset();
    kanjiIndex.mockResolvedValue([ENTRY]);
  });

  it('refuses anything but our own frontend server', async () => {
    const res = await request(app).get('/v1/dictionary/kanji');

    expect(res.status).toBe(403);
    expect(kanjiIndex).not.toHaveBeenCalled();
  });

  it('answers the index in the asked language', async () => {
    fromInternalProxy = true;

    const res = await request(app).get('/v1/dictionary/kanji').query({ locale: 'es' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kanji: [ENTRY] });
    expect(kanjiIndex).toHaveBeenCalledWith(expect.anything(), 'es');
  });
});
