import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import nodemailer from 'nodemailer';
import { setupTestSuite } from '../../helpers/setup';
import { EmailSend } from '@app/models';
import { sendEmail, resetTransporterForTests } from '@app/mailers/email';
import { suppress } from '@app/services/email/suppression';
import { pruneEmailSends, recordSend } from '@app/services/email/sendLog';

setupTestSuite();

let sendMail: ReturnType<typeof vi.fn>;
let createTransport: MockInstance;

beforeEach(() => {
  resetTransporterForTests();
  sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });
  createTransport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
});

afterEach(() => {
  createTransport.mockRestore();
  resetTransporterForTests();
});

describe('the send log', () => {
  it('records a sent message with its kind, campaign, subject and reader', async () => {
    await sendEmail({
      to: 'Reader@Example.com',
      subject: 'We have added new titles',
      html: '<p>hi</p>',
      kind: 'dormant-30',
      campaign: 'dormant-30-2026-11',
      userId: 7,
    });

    const rows = await EmailSend.find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      address: 'reader@example.com',
      userId: 7,
      kind: 'dormant-30',
      campaign: 'dormant-30-2026-11',
      subject: 'We have added new titles',
      status: 'sent',
      source: 'live',
    });
  });

  it('never stores the body', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Link', html: '<p>token-123</p>', kind: 'magic-link' });

    const [row] = await EmailSend.find();
    expect(JSON.stringify(row)).not.toContain('token-123');
  });

  it('records a refused send to a suppressed address', async () => {
    await suppress({ address: 'gone@example.com', cause: 'hard_bounce' });

    await sendEmail({ to: 'gone@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' });

    const [row] = await EmailSend.find();
    expect(row).toMatchObject({ address: 'gone@example.com', status: 'suppressed' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('records a failed send with the error and still throws for the queue to retry', async () => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error('relay down'), { name: 'Throttling' }));

    await expect(sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' })).rejects.toThrow(
      'relay down',
    );

    const [row] = await EmailSend.find();
    expect(row).toMatchObject({ status: 'failed', error: 'Throttling: relay down' });
  });

  it('does not fail the send when the log write fails', async () => {
    const insert = vi.spyOn(EmailSend, 'insert').mockRejectedValueOnce(new Error('db down'));

    await expect(
      sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'magic-link' }),
    ).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalledTimes(1);

    insert.mockRestore();
  });

  it('prunes sends older than a year and keeps the rest', async () => {
    await recordSend({ address: 'old@example.com', kind: 'welcome', subject: 'Old', status: 'sent' });
    await recordSend({ address: 'new@example.com', kind: 'welcome', subject: 'New', status: 'sent' });
    await EmailSend.update({ address: 'old@example.com' }, { sentAt: new Date(Date.now() - 400 * 86_400_000) });

    expect(await pruneEmailSends()).toBe(1);
    expect((await EmailSend.find()).map((row) => row.address)).toEqual(['new@example.com']);
  });
});
