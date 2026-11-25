import { LessThan } from 'typeorm';
import { EmailSend, type EmailSendStatus } from '@app/models';
import { logger } from '@config/log';
import type { EmailKind } from './metrics';
import { normalizeAddress } from './suppression';

/** Keep a year of sends: long enough to answer "did we ever write to this reader", short enough not to hoard
 * addresses. */
export const EMAIL_SEND_RETENTION_DAYS = 365;

/** SES events that decide a sent message's status, strongest first: a complaint outranks a bounce, a bounce outranks a
 * delivery. */
const VERDICT_EVENTS = `ARRAY['complaint', 'hard_bounce', 'soft_bounce', 'delivery']`;

/**
 * A send's status as the dashboard shows it, over `"EmailSend" s`. `failed` and `suppressed` never left, so they stand
 * as written; a message that left takes the strongest SES verdict on it.
 */
export const EMAIL_STATUS_SQL = `
  CASE
    WHEN s.status <> 'sent' THEN s.status
    ELSE COALESCE((
      SELECT CASE e.event WHEN 'complaint' THEN 'complained' WHEN 'delivery' THEN 'delivered' ELSE 'bounced' END
      FROM "EmailEvent" e
      WHERE e.email_reference = s.ses_message_id
        AND e.address = s.address
        AND e.event = ANY(${VERDICT_EVENTS})
      ORDER BY array_position(${VERDICT_EVENTS}, e.event::text)
      LIMIT 1
    ), 'sent')
  END`;

export interface SendCounts {
  sent: number;
  failed: number;
  /** Bounces and complaints. */
  bounced: number;
  suppressed: number;
}

/** Sends of the last 24 hours by outcome; the emails page and the dashboard badge read the same numbers. */
export async function countSendsLast24h(): Promise<SendCounts> {
  const [counts] = await EmailSend.query(
    `SELECT
       COUNT(*) FILTER (WHERE status NOT IN ('failed', 'suppressed'))::int AS sent,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status IN ('bounced', 'complained'))::int AS bounced,
       COUNT(*) FILTER (WHERE status = 'suppressed')::int AS suppressed
     FROM (SELECT ${EMAIL_STATUS_SQL} AS status FROM "EmailSend" s WHERE s.sent_at >= now() - interval '24 hours') recent`,
  );
  return counts ?? { sent: 0, failed: 0, bounced: 0, suppressed: 0 };
}

export interface SendLogEntry {
  address: string;
  userId?: number | null;
  kind: EmailKind;
  campaign?: string | null;
  subject: string;
  status: EmailSendStatus;
  error?: string | null;
  sesMessageId?: string | null;
}

/** Record one send attempt. Never throws: a log write must not fail a sign-in or retry a mail that already left. */
export async function recordSend(entry: SendLogEntry): Promise<void> {
  const address = normalizeAddress(entry.address);
  if (!address) return;

  try {
    await EmailSend.insert({
      sentAt: new Date(),
      address,
      userId: entry.userId ?? null,
      kind: entry.kind,
      campaign: entry.campaign ? entry.campaign.slice(0, 64) : null,
      subject: entry.subject,
      status: entry.status,
      error: entry.error ? entry.error.slice(0, 500) : null,
      sesMessageId: entry.sesMessageId ?? null,
      source: 'live',
    });
  } catch (error) {
    logger.error({ err: error, 'email.kind': entry.kind }, 'Could not record the email send');
  }
}

/** Delete sends older than the retention window. Run nightly by the retention worker. */
export async function pruneEmailSends(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EMAIL_SEND_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return (await EmailSend.delete({ sentAt: LessThan(cutoff) })).affected ?? 0;
}
