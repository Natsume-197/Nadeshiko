import type {
  GetAdminEmail,
  LiftAdminEmailSuppression,
  ListAdminEmailSuppressions,
  ListAdminEmails,
  ResendAdminEmail,
} from 'generated/routes/admin';
import type { t_AdminEmailEvent, t_AdminEmailSend, t_AdminEmailSuppression } from 'generated/models';
import { EmailEvent, EmailSend, EmailSuppression, isPermanentCause } from '@app/models';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import { ADMIN_OVERVIEW_CACHE } from '@app/controllers/adminDashboardController';
import { escapeLikePattern } from '@app/controllers/mediaController';
import { normalizeAddress, removeSuppression } from '@app/services/email/suppression';
import { countSendsLast24h, EMAIL_STATUS_SQL } from '@app/services/email/sendLog';
import { canResend, resendEmail } from '@app/services/email/resend';
import { deleteSesSuppression, usesSes } from '@app/mailers/sesSend';
import { logger } from '@config/log';
import { Cache } from '@lib/cache';

/** One send with its account and derived status; callers add `WHERE`, order and paging. */
const SELECT_SENDS = `
  SELECT
    s.id,
    s.sent_at AS "sentAt",
    s.address,
    s.user_id AS "userId",
    u.username,
    s.kind,
    s.campaign,
    s.subject,
    ${EMAIL_STATUS_SQL} AS status,
    s.error,
    s.ses_message_id AS "sesMessageId",
    s.source
  FROM "EmailSend" s
  LEFT JOIN "User" u ON u.id = s.user_id`;

type SendRow = Omit<t_AdminEmailSend, 'sentAt' | 'resendable'> & { sentAt: Date };

function toSendDTO({ sentAt, total: _total, ...fields }: SendRow & { total?: number }): t_AdminEmailSend {
  return { ...fields, sentAt: new Date(sentAt).toISOString(), resendable: canResend(fields) };
}

const likePattern = (search: string) => `%${escapeLikePattern(search)}%`;

export const listAdminEmails: ListAdminEmails = async ({ query }, respond) => {
  const filters: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const search = query.search?.trim();
  if (search) {
    const p = add(likePattern(search));
    filters.push(`(s.address ILIKE ${p} OR u.username ILIKE ${p})`);
  }
  if (query.kind) filters.push(`s.kind = ${add(query.kind)}`);
  if (query.campaign) filters.push(`s.campaign = ${add(query.campaign)}`);
  if (query.days) filters.push(`s.sent_at >= now() - make_interval(days => ${add(query.days)})`);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  // Status is derived, so it filters the outer query.
  const statusFilter = query.status ? `WHERE status = ${add(query.status)}` : '';

  const [rows, last24h] = await Promise.all([
    EmailSend.query(
      `SELECT *, COUNT(*) OVER ()::int AS total
       FROM (${SELECT_SENDS} ${where}) sends ${statusFilter}
       ORDER BY "sentAt" DESC, id DESC
       LIMIT ${add(query.limit)} OFFSET ${add(query.offset)}`,
      params,
    ) as Promise<(SendRow & { total: number })[]>,
    countSendsLast24h(),
  ]);

  return respond.with200().body({ emails: rows.map(toSendDTO), total: rows[0]?.total ?? 0, last24h });
};

export const getAdminEmail: GetAdminEmail = async ({ params }, respond) => {
  const [row]: SendRow[] = await EmailSend.query(`${SELECT_SENDS} WHERE s.id = $1`, [params.emailId]);
  if (!row) throw new NotFoundError('Email not found.');

  const events = row.sesMessageId
    ? await EmailEvent.find({
        where: { emailReference: row.sesMessageId, address: row.address },
        order: { occurredAt: 'ASC', id: 'ASC' },
      })
    : [];

  return respond.with200().body({
    email: toSendDTO(row),
    events: events.map(
      (event): t_AdminEmailEvent => ({
        id: event.id,
        event: event.event,
        occurredAt: event.occurredAt.toISOString(),
        reason: event.reason ?? null,
        diagnosticMessage: event.diagnosticMessage ?? null,
      }),
    ),
  });
};

export const listAdminEmailSuppressions: ListAdminEmailSuppressions = async ({ query }, respond) => {
  const search = query.search?.trim();
  const builder = EmailSuppression.createQueryBuilder('x');
  if (search) builder.where('x.address ILIKE :pattern', { pattern: likePattern(search) });

  const [rows, total] = await builder
    .orderBy('x.suppressedAt', 'DESC')
    .addOrderBy('x.id', 'DESC')
    .take(query.limit)
    .skip(query.offset)
    .getManyAndCount();

  return respond.with200().body({
    suppressions: rows.map(
      (row): t_AdminEmailSuppression => ({
        address: row.address,
        cause: row.cause,
        reason: row.reason ?? null,
        suppressedAt: row.suppressedAt.toISOString(),
        permanent: isPermanentCause(row.cause),
      }),
    ),
    total,
  });
};

/** Lift SES's account-level list before our row: if SES refuses, our row stays and the dashboard still tells the
 * truth. Local development has no SES list to lift. */
export const liftAdminEmailSuppression: LiftAdminEmailSuppression = async ({ body }, respond) => {
  const address = normalizeAddress(body.address);
  if (!address) throw new InvalidRequestError('Address is required.');

  const row = await EmailSuppression.findOneBy({ address });
  if (!row) throw new NotFoundError('That address is not suppressed.');
  if (isPermanentCause(row.cause)) {
    throw new InvalidRequestError('Complaints are not lifted.');
  }

  if (usesSes()) {
    await deleteSesSuppression(address);
  }
  await removeSuppression(address);
  Cache.invalidate(ADMIN_OVERVIEW_CACHE);
  logger.info({ 'email.cause': row.cause }, 'Lifted an email suppression from the admin dashboard');

  return respond.with204().body();
};

export const resendAdminEmail: ResendAdminEmail = async ({ params }, respond) => {
  const send = await EmailSend.findOneBy({ id: params.emailId });
  if (!send) throw new NotFoundError('Email not found.');

  await resendEmail(send);
  logger.info({ 'email.kind': send.kind }, 'Resent an email from the admin dashboard');

  return respond.with204().body();
};
