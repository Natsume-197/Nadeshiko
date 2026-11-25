import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { ADMIN_OVERVIEW_CACHE } from '@app/controllers/adminDashboardController';
import { Cache } from '@lib/cache';
import { EmailEvent, EmailSend, EmailSuppression } from '@app/models';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';
import nodemailer from 'nodemailer';
import { resetTransporterForTests } from '@app/mailers/email';

const ses = vi.hoisted(() => ({ deleteSesSuppression: vi.fn(), usesSes: vi.fn(() => true) }));

const mail = vi.hoisted(() => ({ sendWelcomeEmail: vi.fn() }));

vi.mock('@app/mailers/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/mailers/email')>()),
  sendWelcomeEmail: mail.sendWelcomeEmail,
}));

vi.mock('@app/mailers/sesSend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/mailers/sesSend')>()),
  deleteSesSuppression: ses.deleteSesSuppression,
  usesSes: ses.usesSes,
}));

setupTestSuite();

let app: Application;
let core: CoreFixtures;

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

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(() => {
  app.locals.testUser = core.users.kevin;
  Cache.invalidate(ADMIN_OVERVIEW_CACHE);
});

afterEach(() => {
  mail.sendWelcomeEmail.mockReset();
  ses.deleteSesSuppression.mockReset();
  ses.usesSes.mockReset().mockReturnValue(true);
});

async function send(fields: Partial<EmailSend> & { address: string }): Promise<EmailSend> {
  return EmailSend.save(
    EmailSend.create({
      sentAt: new Date(),
      kind: 'magic-link',
      subject: 'Nadeshiko: Your sign-in link',
      status: 'sent',
      source: 'live',
      ...fields,
    }),
  );
}

async function event(address: string, messageId: string, name: string, diagnosticMessage: string | null = null) {
  await EmailEvent.insert({
    address,
    event: name,
    emailReference: messageId,
    diagnosticMessage,
    occurredAt: new Date(),
    payload: {},
  });
}

describe('GET /v1/admin/emails', () => {
  it('lists sends newest first with the status SES reported', async () => {
    await send({ address: 'a@example.com', sesMessageId: 'm-a', sentAt: new Date(Date.now() - 3000) });
    await send({ address: 'b@example.com', sesMessageId: 'm-b', sentAt: new Date(Date.now() - 2000) });
    await send({ address: 'c@example.com', sesMessageId: 'm-c', sentAt: new Date(Date.now() - 1000) });
    await send({ address: 'd@example.com', status: 'failed', error: 'Throttling: slow down' });
    await event('b@example.com', 'm-b', 'delivery');
    await event('c@example.com', 'm-c', 'delivery');
    await event('c@example.com', 'm-c', 'complaint');

    const res = await request(app).get('/v1/admin/emails').expect(200);

    expect(res.body.emails.map((row: { address: string; status: string }) => [row.address, row.status])).toEqual([
      ['d@example.com', 'failed'],
      ['c@example.com', 'complained'],
      ['b@example.com', 'delivered'],
      ['a@example.com', 'sent'],
    ]);
    expect(res.body.total).toBe(4);
    expect(res.body.last24h).toEqual({ sent: 3, failed: 1, bounced: 1, suppressed: 0 });
  });

  it('filters by search, kind, status and days, and paginates', async () => {
    await send({ address: 'reader@example.com', kind: 'welcome' });
    await send({ address: 'reader@example.com', kind: 'magic-link', status: 'suppressed' });
    await send({ address: 'other@example.com', kind: 'welcome' });
    await send({ address: 'reader@example.com', kind: 'welcome', sentAt: new Date(Date.now() - 40 * 86_400_000) });

    const bySearch = await request(app).get('/v1/admin/emails?search=READER&days=30').expect(200);
    expect(bySearch.body.total).toBe(2);

    const byKind = await request(app).get('/v1/admin/emails?kind=welcome&status=sent').expect(200);
    expect(byKind.body.total).toBe(3);

    const page = await request(app).get('/v1/admin/emails?kind=welcome&limit=1&offset=1').expect(200);
    expect(page.body.emails).toHaveLength(1);
    expect(page.body.total).toBe(3);
  });

  it('matches a username through the linked account', async () => {
    await send({ address: 'x@example.com', userId: core.users.regular.id });

    const res = await request(app).get(`/v1/admin/emails?search=${core.users.regular.username}`).expect(200);
    expect(res.body.emails[0]).toMatchObject({ address: 'x@example.com', username: core.users.regular.username });
  });
});

describe('GET /v1/admin/emails/:emailId', () => {
  it('says which sends the view may offer to resend', async () => {
    await send({ address: 'a@example.com', kind: 'magic-link' });
    await send({ address: 'b@example.com', kind: 'welcome', userId: core.users.regular.id });
    await send({ address: 'c@example.com', kind: 'welcome', userId: null });
    await send({ address: 'd@example.com', kind: 'word-digest' });

    const res = await request(app).get('/v1/admin/emails').expect(200);
    const byAddress = Object.fromEntries(
      res.body.emails.map((row: { address: string; resendable: boolean }) => [row.address, row.resendable]),
    );
    expect(byAddress).toEqual({
      'a@example.com': true,
      'b@example.com': true,
      'c@example.com': false,
      'd@example.com': false,
    });
  });

  it('returns the send with its SES events in order', async () => {
    const row = await send({ address: 'b@example.com', sesMessageId: 'm-1' });
    await event('b@example.com', 'm-1', 'hard_bounce', '550 5.1.1 User unknown');
    await event('other@example.com', 'm-1', 'delivery');

    const res = await request(app).get(`/v1/admin/emails/${row.id}`).expect(200);

    expect(res.body.email).toMatchObject({ id: row.id, status: 'bounced' });
    expect(res.body.events).toEqual([
      expect.objectContaining({ event: 'hard_bounce', diagnosticMessage: '550 5.1.1 User unknown' }),
    ]);
  });

  it('returns 404 for an unknown id', async () => {
    await request(app).get('/v1/admin/emails/999999').expect(404);
  });
});

describe('email suppressions', () => {
  beforeEach(async () => {
    await EmailSuppression.insert([
      { address: 'bounced@example.com', cause: 'hard_bounce', suppressedAt: new Date(Date.now() - 1000) },
      { address: 'angry@example.com', cause: 'complaint', suppressedAt: new Date() },
    ]);
  });

  it('lists suppressions newest first and marks complaints permanent', async () => {
    const res = await request(app).get('/v1/admin/email-suppressions').expect(200);

    expect(res.body.total).toBe(2);
    expect(
      res.body.suppressions.map((row: { address: string; permanent: boolean }) => [row.address, row.permanent]),
    ).toEqual([
      ['angry@example.com', true],
      ['bounced@example.com', false],
    ]);
  });

  it('lifts a bounce at SES and here', async () => {
    ses.deleteSesSuppression.mockResolvedValue(true);

    await request(app).post('/v1/admin/email-suppressions/lift').send({ address: 'Bounced@Example.com' }).expect(204);

    expect(await EmailSuppression.existsBy({ address: 'bounced@example.com' })).toBe(false);
    expect(ses.deleteSesSuppression).toHaveBeenCalledWith('bounced@example.com');
  });

  it('keeps our row when SES refuses the lift', async () => {
    ses.deleteSesSuppression.mockRejectedValue(new Error('AccessDenied'));

    await request(app).post('/v1/admin/email-suppressions/lift').send({ address: 'bounced@example.com' }).expect(500);

    expect(await EmailSuppression.existsBy({ address: 'bounced@example.com' })).toBe(true);
  });

  it('lifts only our row when there is no SES to ask', async () => {
    ses.usesSes.mockReturnValue(false);

    await request(app).post('/v1/admin/email-suppressions/lift').send({ address: 'bounced@example.com' }).expect(204);

    expect(ses.deleteSesSuppression).not.toHaveBeenCalled();
    expect(await EmailSuppression.existsBy({ address: 'bounced@example.com' })).toBe(false);
  });

  it('refuses to lift a complaint', async () => {
    await request(app).post('/v1/admin/email-suppressions/lift').send({ address: 'angry@example.com' }).expect(400);
    expect(await EmailSuppression.existsBy({ address: 'angry@example.com' })).toBe(true);
  });

  it('returns 404 for an address that is not suppressed', async () => {
    await request(app).post('/v1/admin/email-suppressions/lift').send({ address: 'fine@example.com' }).expect(404);
  });
});

describe('GET /v1/admin/overview emails', () => {
  it('counts the same failed and bounced sends of the last 24 hours as the emails page', async () => {
    await send({ address: 'f@example.com', status: 'failed' });
    await send({ address: 'f@example.com', status: 'failed', sentAt: new Date(Date.now() - 3 * 86_400_000) });
    await send({ address: 'b@example.com', sesMessageId: 'm-x' });
    await send({ address: 'd@example.com', sesMessageId: 'm-y' });
    await event('b@example.com', 'm-x', 'hard_bounce');
    await event('b@example.com', 'm-x', 'soft_bounce');
    await event('d@example.com', 'm-y', 'delivery');

    const res = await request(app).get('/v1/admin/overview').expect(200);
    expect(res.body.emails).toEqual({ failed: 1, bounced: 1 });
  });
});

describe('POST /v1/admin/emails/:emailId/resend', () => {
  it('mints a new sign-in link for the same address, which lands in the log', async () => {
    // Deliver through the local transport so the send is observable without SES.
    ses.usesSes.mockReturnValue(false);
    resetTransporterForTests();
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'local' });
    const transport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const original = await send({ address: 'reader@example.com', sentAt: new Date(Date.now() - 60_000) });

    await request(app).post(`/v1/admin/emails/${original.id}/resend`).expect(204);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const rows = await EmailSend.find({ where: { address: 'reader@example.com' }, order: { sentAt: 'ASC' } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: 'magic-link', status: 'sent', source: 'live' });

    transport.mockRestore();
    resetTransporterForTests();
  });

  it("queues a new welcome for the send's account", async () => {
    const original = await send({ address: core.users.regular.email, kind: 'welcome', userId: core.users.regular.id });

    await request(app).post(`/v1/admin/emails/${original.id}/resend`).expect(204);

    expect(mail.sendWelcomeEmail).toHaveBeenCalledWith(
      core.users.regular.id,
      core.users.regular.username,
      core.users.regular.email,
    );
  });

  it('refuses kinds that are not resendable, welcomes without an account and suppressed addresses', async () => {
    const digest = await send({ address: 'a@example.com', kind: 'word-digest' });
    const orphan = await send({ address: 'b@example.com', kind: 'welcome', userId: null });
    const blocked = await send({ address: 'gone@example.com' });
    await EmailSuppression.insert({ address: 'gone@example.com', cause: 'hard_bounce', suppressedAt: new Date() });

    for (const row of [digest, orphan, blocked]) {
      await request(app).post(`/v1/admin/emails/${row.id}/resend`).expect(400);
    }
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown id', async () => {
    await request(app).post('/v1/admin/emails/999999/resend').expect(404);
  });
});
