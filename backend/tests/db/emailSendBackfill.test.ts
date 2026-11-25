import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestSuite, TestDataSource } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { EmailEvent, EmailLifecycleSend, EmailSend, EmailSuppression } from '@app/models';
import { EmailSendLog1792200000000 } from '../../db/migrations/1792200000000-email-send-log';

setupTestSuite();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

const backfill = () => new EmailSendLog1792200000000().backfill(TestDataSource.createQueryRunner());

function sesEvent(messageId: string, subject: string, timestamp: string) {
  return {
    eventType: 'Delivery',
    mail: { messageId, timestamp, commonHeaders: { subject } },
  };
}

/** This SQL runs once in production, on the release deploy, so it is tested against the shapes the old tables hold. */
describe('EmailSendLog backfill', () => {
  it('rebuilds one send per SES message from its events, with subject, kind, campaign and send time', async () => {
    const address = fixtures.users.regular.email.toLowerCase();
    for (const event of ['delivery', 'complaint']) {
      await EmailEvent.insert({
        address,
        event,
        emailReference: 'ses-abc',
        clientReference: 'dormant-30:dormant-30-2026-11',
        occurredAt: new Date('2026-11-10T05:01:00Z'),
        payload: sesEvent('ses-abc', 'We have added new titles', '2026-11-10T05:00:00Z'),
      });
    }

    await backfill();

    const rows = await EmailSend.find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      address,
      userId: fixtures.users.regular.id,
      kind: 'dormant-30',
      campaign: 'dormant-30-2026-11',
      subject: 'We have added new titles',
      status: 'sent',
      sesMessageId: 'ses-abc',
      source: 'backfill',
    });
    expect(rows[0].sentAt.toISOString()).toBe('2026-11-10T05:00:00.000Z');
  });

  it('falls back to the event time and a null campaign for a ZeptoMail-era event', async () => {
    await EmailEvent.insert({
      address: 'old@example.com',
      event: 'hard_bounce',
      emailReference: 'zepto-1',
      clientReference: 'magic-link',
      occurredAt: new Date('2026-08-01T10:00:00Z'),
      payload: { data: 'zepto shape' },
    });

    await backfill();

    const [row] = await EmailSend.find();
    expect(row).toMatchObject({ kind: 'magic-link', campaign: null, subject: null, userId: null });
    expect(row.sentAt.toISOString()).toBe('2026-08-01T10:00:00.000Z');
  });

  it('adds lifecycle claims an event did not already cover', async () => {
    const user = fixtures.users.regular;
    await EmailEvent.insert({
      address: user.email.toLowerCase(),
      event: 'delivery',
      emailReference: 'ses-1',
      clientReference: 'feedback-ask:feedback-ask-started',
      occurredAt: new Date('2026-10-01T05:00:00Z'),
      payload: sesEvent('ses-1', 'How is Nadeshiko working out?', '2026-10-01T05:00:00Z'),
    });
    await EmailLifecycleSend.insert({
      userId: user.id,
      kind: 'feedback-ask',
      campaign: 'feedback-ask-started',
      sentAt: new Date('2026-10-01T04:59:00Z'),
    });
    await EmailLifecycleSend.insert({
      userId: user.id,
      kind: 'dormant-30',
      campaign: 'dormant-30-2026-10',
      sentAt: new Date('2026-10-20T05:00:00Z'),
    });

    await backfill();

    const rows = await EmailSend.find({ order: { sentAt: 'ASC' } });
    expect(rows.map((row) => [row.kind, row.campaign, row.sesMessageId])).toEqual([
      ['feedback-ask', 'feedback-ask-started', 'ses-1'],
      ['dormant-30', 'dormant-30-2026-10', null],
    ]);
  });

  it('adds finished send jobs pg-boss still holds, marking failures and suppressed addresses', async () => {
    const runner = TestDataSource.createQueryRunner();
    await runner.query(`SELECT pgboss.create_queue('email-send', '{"policy": "standard"}'::jsonb)`);
    const job = (to: string, state: string, output: object | null = null) =>
      runner.query(
        `INSERT INTO pgboss.job (name, data, state, created_on, completed_on, output)
         VALUES ('email-send', $1::jsonb, $2::pgboss.job_state, now() - interval '2 days', now() - interval '2 days', $3::jsonb)`,
        [JSON.stringify({ to, subject: 'Welcome to Nadeshiko!', html: '<p>x</p>', kind: 'welcome' }), state, output],
      );
    await EmailSuppression.insert({
      address: 'gone@example.com',
      cause: 'hard_bounce',
      suppressedAt: new Date(Date.now() - 10 * 86_400_000),
    });
    await job('New@Example.com', 'completed');
    await job('broken@example.com', 'failed', { message: 'Throttling: rate exceeded' });
    await job('gone@example.com', 'completed');

    await backfill();

    const rows = await EmailSend.find({ order: { address: 'ASC' } });
    expect(rows.map((row) => [row.address, row.status, row.error, row.subject])).toEqual([
      ['broken@example.com', 'failed', 'Throttling: rate exceeded', 'Welcome to Nadeshiko!'],
      ['gone@example.com', 'suppressed', null, 'Welcome to Nadeshiko!'],
      ['new@example.com', 'sent', null, 'Welcome to Nadeshiko!'],
    ]);
  });
});
