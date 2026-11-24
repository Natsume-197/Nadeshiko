import type { Application, NextFunction, Request, Response } from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notification, User, WordWatch, WordWatchStatus } from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import * as emailQueueModule from '@app/workers/emailQueue';
import type { EmailJobData } from '@app/workers/emailQueue';
import * as esSyncQueue from '@app/workers/esSyncQueue';
import { buildApplication } from '@config/application';
import { NotificationsRoutes } from '@config/routes';
import { setCountBatchPauseForTests } from '@app/services/wordWatches/counting';
import { runFirstAppearanceSweep, runNewSentencesSweep, weekCampaign } from '@app/services/wordWatches/sweep';
import { WORD_WATCH_LIMIT } from '@app/services/wordWatches/rules';
import { renderWordAlertList } from '@app/mailers/emailTemplates';
import { WordWatchMatchMode } from '@app/models';
import { wordSearchPath } from '@brigadasos/nadeshiko-shared/wordQuery';
import { isEsAvailable, seedSegmentsIntoEs } from '../helpers/esFixtures';
import { request } from '../helpers/http';
import { setupTestSuite } from '../helpers/setup';

setupTestSuite();

let app: Application;
let emails: { data: EmailJobData; key?: string }[];

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: { kind: ApiKeyKind.SERVICE, permissions: Object.values(ApiPermission) },
    };
  }
  next();
}

async function makeUser(name: string, preferences: User['preferences'] = {}): Promise<User> {
  return User.create({
    username: name,
    email: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}@nadeshiko.test`,
    isVerified: true,
    isActive: true,
    preferences,
  }).save();
}

const KATAKANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワ';

/** A katakana word nothing else in the shared test index contains: Elasticsearch is not rolled back between tests. */
function uniqueWord(): string {
  let word = 'ズ';
  for (let i = 0; i < 7; i++) word += KATAKANA[Math.floor(Math.random() * KATAKANA.length)];
  return word;
}

async function seedSentences(word: string, count: number, media: Record<string, unknown> = {}) {
  return seedSegmentsIntoEs(
    { nameEn: `Show for ${word}`, ...media },
    Array.from({ length: count }, (_, i) => ({ contentJa: `${word}が好きです${'。'.repeat(i + 1)}` })),
  );
}

beforeAll(async () => {
  if (!(await isEsAvailable())) throw new Error('Elasticsearch is required for the word alert suite');
  setCountBatchPauseForTests(0);
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', NotificationsRoutes);
    },
  });
});

beforeEach(() => {
  emails = [];
  vi.spyOn(esSyncQueue, 'sendEsSyncJob').mockResolvedValue(null);
  vi.spyOn(emailQueueModule, 'sendEmailJob').mockImplementation(async (data, key) => {
    emails.push({ data, key });
    return 'job';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setting word alerts', () => {
  it('creates a first-appearance alert on a word with no sentences, and finds it again', async () => {
    const user = await makeUser('watcher');
    app.locals.testUser = user;
    const word = uniqueWord();

    const res = await request(app)
      .post('/v1/word-watches')
      .send({ query: ` ${word} `, mode: 'FIRST' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      outcome: 'created',
      sentenceCount: 0,
      watch: { query: word, matchMode: 'WORD', mode: 'FIRST', status: 'ACTIVE', lastNotifiedAt: null },
    });

    const check = await request(app).get('/v1/word-watches/check').query({ query: word });
    expect(check.body.watch.id).toBe(res.body.watch.id);

    const list = await request(app).get('/v1/word-watches');
    expect(list.body).toMatchObject({ activeCount: 1, limit: WORD_WATCH_LIMIT.free });
  });

  it('refuses a first-appearance alert on a word that already has sentences', async () => {
    app.locals.testUser = await makeUser('early');
    const word = uniqueWord();
    await seedSentences(word, 1);

    const res = await request(app).post('/v1/word-watches').send({ query: word, mode: 'FIRST' });
    expect(res.status).toBe(400);

    const follow = await request(app).post('/v1/word-watches').send({ query: word, mode: 'NEW_SENTENCES' });
    expect(follow.status).toBe(201);
    expect(follow.body).toMatchObject({ sentenceCount: 1, commonWord: false });
  });

  it('takes only one Japanese word, and no "contains" digest', async () => {
    app.locals.testUser = await makeUser('picky');
    expect((await request(app).post('/v1/word-watches').send({ query: 'hello', mode: 'FIRST' })).status).toBe(400);
    expect((await request(app).post('/v1/word-watches').send({ query: '食べる 飲む', mode: 'FIRST' })).status).toBe(
      400,
    );
    const contains = await request(app)
      .post('/v1/word-watches')
      .send({ query: uniqueWord(), matchMode: 'CONTAINS', mode: 'NEW_SENTENCES' });
    expect(contains.status).toBe(400);
  });

  it('stops at the account limit, and a paused alert frees a slot', async () => {
    const user = await makeUser('collector');
    app.locals.testUser = user;
    for (let i = 0; i < WORD_WATCH_LIMIT.free; i++) {
      await WordWatch.create({ userId: user.id, query: `語${i}`, mode: 'FIRST' as never }).save();
    }

    const over = await request(app).post('/v1/word-watches').send({ query: uniqueWord(), mode: 'FIRST' });
    expect(over.status).toBe(403);

    const first = await WordWatch.findOneByOrFail({ userId: user.id, query: '語0' });
    const paused = await request(app).patch(`/v1/word-watches/${first.publicId}`).send({ paused: true });
    expect(paused.body.status).toBe('PAUSED');

    const fits = await request(app).post('/v1/word-watches').send({ query: uniqueWord(), mode: 'FIRST' });
    expect(fits.status).toBe(201);

    const resume = await request(app).patch(`/v1/word-watches/${first.publicId}`).send({ paused: false });
    expect(resume.status).toBe(403);

    expect((await request(app).delete(`/v1/word-watches/${first.publicId}`)).status).toBe(204);
    expect(await WordWatch.findOneBy({ id: first.id })).toBeNull();
  });

  it('does not let one reader touch another reader’s alert', async () => {
    const owner = await makeUser('owner');
    const watch = await WordWatch.create({ userId: owner.id, query: '憧憬', mode: 'FIRST' as never }).save();
    app.locals.testUser = await makeUser('stranger');
    expect((await request(app).delete(`/v1/word-watches/${watch.publicId}`)).status).toBe(404);
  });
});

describe('the first-appearance sweep', () => {
  it('tells the reader on the bell and by email, and closes the alert', async () => {
    const user = await makeUser('waiting');
    app.locals.testUser = user;
    const word = uniqueWord();
    await request(app).post('/v1/word-watches').send({ query: word, mode: 'FIRST' });

    await seedSentences(word, 2);
    const summary = await runFirstAppearanceSweep(new Date('2026-11-24T05:30:00Z'));
    expect(summary.notifiedAlerts).toBeGreaterThanOrEqual(1);

    const watch = await WordWatch.findOneByOrFail({ userId: user.id, query: word });
    expect(watch.status).toBe(WordWatchStatus.FULFILLED);
    expect(watch.lastCount).toBe(2);

    const mine = emails.filter((email) => email.data.to === user.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.data).toMatchObject({ kind: 'word-available', campaign: 'word-available-2026-11-24' });
    expect(mine[0]!.data.subject).toBe(`${word} is on Nadeshiko`);
    expect(mine[0]!.data.html).toContain(`Show for ${word}`);
    expect(mine[0]!.key).toBe(`word-available-2026-11-24-${user.id}`);

    expect((await request(app).get('/v1/notifications/unread-count')).body.count).toBe(1);
    const list = await request(app).get('/v1/notifications');
    expect(list.body.items[0]).toMatchObject({ kind: 'word-available', read: false });
    expect(list.body.items[0].payload.words[0]).toEqual({
      query: word,
      matchMode: 'WORD',
      sentences: 2,
      titles: [`Show for ${word}`],
    });

    const read = await request(app).post('/v1/notifications/read').send({});
    expect(read.body.unreadCount).toBe(0);

    // Closed alerts are not swept again.
    emails = [];
    await runFirstAppearanceSweep(new Date('2026-11-25T05:30:00Z'));
    expect(emails.filter((email) => email.data.to === user.email)).toHaveLength(0);
  });

  it('keeps waiting while the only sentences are in a title the reader hides', async () => {
    const word = uniqueWord();
    const { media } = await seedSentences(word, 1);
    const user = await makeUser('hider', { hiddenMedia: [{ mediaPublicId: media.publicId }] });
    app.locals.testUser = user;

    const res = await request(app).post('/v1/word-watches').send({ query: word, mode: 'FIRST' });
    expect(res.status).toBe(201);

    await runFirstAppearanceSweep();
    const watch = await WordWatch.findOneByOrFail({ userId: user.id, query: word });
    expect(watch.status).toBe(WordWatchStatus.ACTIVE);
    expect(await Notification.countBy({ userId: user.id })).toBe(0);
  });

  it('uses only the channels the reader keeps on', async () => {
    const word = uniqueWord();
    const bellOnly = await makeUser('bell-only', { productEmails: { enabled: true, words: false } });
    const mailOnly = await makeUser('mail-only', { siteNotifications: { words: false } });
    for (const user of [bellOnly, mailOnly]) {
      app.locals.testUser = user;
      await request(app).post('/v1/word-watches').send({ query: word, mode: 'FIRST' });
    }

    await seedSentences(word, 1);
    await runFirstAppearanceSweep();

    expect(await Notification.countBy({ userId: bellOnly.id })).toBe(1);
    expect(emails.some((email) => email.data.to === bellOnly.email)).toBe(false);
    expect(await Notification.countBy({ userId: mailOnly.id })).toBe(0);
    expect(emails.some((email) => email.data.to === mailOnly.email)).toBe(true);
  });
});

describe('the new-sentences digest', () => {
  it('waits for three new sentences, then sends one digest and moves the baseline', async () => {
    const word = uniqueWord();
    await seedSentences(word, 1);
    const user = await makeUser('follower');
    app.locals.testUser = user;
    await request(app).post('/v1/word-watches').send({ query: word, mode: 'NEW_SENTENCES' });

    await seedSentences(word, 2);
    await runNewSentencesSweep(new Date('2026-11-23T06:15:00Z'));
    expect(emails.filter((email) => email.data.to === user.email)).toHaveLength(0);
    // Below the threshold the baseline stays, so the two add up with what comes next.
    expect((await WordWatch.findOneByOrFail({ userId: user.id, query: word })).lastCount).toBe(1);

    await seedSentences(word, 1);
    await runNewSentencesSweep(new Date('2026-11-30T06:15:00Z'));
    const mine = emails.filter((email) => email.data.to === user.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.data).toMatchObject({ kind: 'word-digest', campaign: 'word-digest-2026-W49' });
    expect(mine[0]!.data.subject).toBe(`New sentences for ${word}`);
    expect(mine[0]!.data.html).toContain('3 new sentences');

    const watch = await WordWatch.findOneByOrFail({ userId: user.id, query: word });
    expect(watch).toMatchObject({ lastCount: 4, status: WordWatchStatus.ACTIVE });
    expect(watch.lastNotifiedAt).not.toBeNull();

    const bell = await Notification.findOneByOrFail({ userId: user.id, kind: 'word-digest' });
    expect((bell.payload.words as Array<{ newSentences: number }>)[0]?.newSentences).toBe(3);

    emails = [];
    await runNewSentencesSweep(new Date('2026-12-07T06:15:00Z'));
    expect(emails.filter((email) => email.data.to === user.email)).toHaveLength(0);
  });
});

describe('word alert helpers', () => {
  it('names the ISO week, across a year boundary too', () => {
    expect(weekCampaign(new Date('2026-11-23T06:00:00Z'))).toBe('word-digest-2026-W48');
    expect(weekCampaign(new Date('2027-01-01T06:00:00Z'))).toBe('word-digest-2026-W53');
  });

  it('links a contains alert to the contains search', () => {
    expect(wordSearchPath('糊', WordWatchMatchMode.CONTAINS)).toBe(
      `/search/${encodeURIComponent('糊')}?match=contains`,
    );
    expect(wordSearchPath('糊', WordWatchMatchMode.WORD)).toBe(`/search/${encodeURIComponent('糊')}`);
  });

  it('escapes every value it writes into the email markup', () => {
    const html = renderWordAlertList(
      [{ word: '<b>', path: '/search/x', titles: ['A & B'], examples: [{ text: '"<i>"', title: '<t>' }] }],
      'word-available-preview',
    );
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('A &amp; B');
  });
});
