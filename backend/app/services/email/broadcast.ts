import { In } from 'typeorm';
import {
  EmailBroadcast,
  EmailSend,
  PatreonConnection,
  User,
  UserRoleType,
  type EmailBroadcastAudience,
  type EmailBroadcastAudienceParams,
} from '@app/models';
import { DuplicateKeyError, InvalidRequestError, NotFoundError } from '@app/errors';
import { sendAdminRawTestEmail, sendBroadcastEmail } from '@app/mailers/email';
import { buildBroadcastEmail } from '@app/mailers/emailTemplates';
import { acceptsProductEmails, unsubscribeUrls } from '@app/services/email/unsubscribe';
import { getNotificationParams, isChannelEnabled } from '@app/services/notifications/settings';
import { getOptionalPgBoss } from '@app/workers/pgBossClient';
import { EMAIL_BROADCAST_QUEUE } from '@app/workers/queueNames';
import { logger } from '@config/log';

const BATCH_SIZE = 50;
const CIRCUIT_BREAKER_MIN_SENDS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCampaignKey(raw: string): string {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!key) throw new InvalidRequestError('Campaign key is required.');
  return key;
}

function validateCtaUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  if (trimmed.startsWith('https://')) return trimmed;
  throw new InvalidRequestError('CTA URL must be a relative path (/...) or an https:// URL.');
}

async function queryEligibleUsers(
  audience: EmailBroadcastAudience,
  params: EmailBroadcastAudienceParams,
): Promise<Pick<User, 'id' | 'username' | 'email' | 'preferences'>[]> {
  const qb = User.createQueryBuilder('u')
    .select(['u.id', 'u.username', 'u.email', 'u.preferences'])
    .where('u.is_active = true')
    .andWhere('u.banned = false')
    .andWhere(`NOT EXISTS (SELECT 1 FROM "EmailSuppression" p WHERE p.address = LOWER(u.email))`);

  if (audience === 'SPECIFIC_USERS') {
    const ids = (params.userIds ?? []).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return [];
    qb.andWhere('u.id IN (:...ids)', { ids });
  } else if (audience === 'PATRONS') {
    const [connections, rolePatrons] = await Promise.all([
      PatreonConnection.createQueryBuilder('pc')
        .select('pc.userId', 'userId')
        .where(`pc.patron_status = 'active_patron'`)
        .getRawMany<{ userId: number }>(),
      User.find({ where: { role: UserRoleType.PATREON, isActive: true, banned: false }, select: { id: true } }),
    ]);
    const ids = [...new Set([...connections.map((c) => Number(c.userId)), ...rolePatrons.map((u) => u.id)])];
    if (ids.length === 0) return [];
    qb.andWhere('u.id IN (:...ids)', { ids });
  } else if (audience === 'ACTIVE_DAYS') {
    const days = Math.max(1, Math.min(365, Number(params.activeDays ?? 90)));
    qb.andWhere(`COALESCE(u.last_seen_at, u.created_at) >= now() - make_interval(days => :days)`, { days });
  }

  const rows = await qb.orderBy('u.id', 'ASC').getMany();
  return rows.filter((u) => acceptsProductEmails(u.preferences, 'updates'));
}

export async function estimateEmailBroadcastAudience(
  audience: EmailBroadcastAudience,
  params: EmailBroadcastAudienceParams = {},
): Promise<number> {
  const users = await queryEligibleUsers(audience, params);
  return users.length;
}

export interface EmailBroadcastInput {
  campaignKey: string;
  subject: string;
  previewText?: string | null;
  bodyMarkdown: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  audience: EmailBroadcastAudience;
  audienceParams?: EmailBroadcastAudienceParams;
}

export async function createEmailBroadcast(input: EmailBroadcastInput, adminUserId: number): Promise<EmailBroadcast> {
  const campaignKey = normalizeCampaignKey(input.campaignKey);
  const subject = input.subject.trim();
  const bodyMarkdown = input.bodyMarkdown.trim();
  if (!subject) throw new InvalidRequestError('Subject is required.');
  if (!bodyMarkdown) throw new InvalidRequestError('Body is required.');

  const ctaUrl = validateCtaUrl(input.ctaUrl);
  const ctaLabel = input.ctaLabel?.trim() || null;

  try {
    return await EmailBroadcast.create({
      campaignKey,
      subject: subject.slice(0, 200),
      previewText: input.previewText?.trim().slice(0, 240) || null,
      bodyMarkdown,
      ctaLabel: ctaLabel ? ctaLabel.slice(0, 80) : null,
      ctaUrl,
      audience: input.audience,
      audienceParams: input.audienceParams ?? {},
      status: 'DRAFT',
      createdBy: adminUserId,
    }).save();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new DuplicateKeyError(`A broadcast with campaign key "${campaignKey}" already exists.`);
    }
    throw err;
  }
}

export async function updateEmailBroadcast(
  publicId: string,
  patch: Partial<EmailBroadcastInput>,
): Promise<EmailBroadcast> {
  const row = await EmailBroadcast.findOneBy({ publicId });
  if (!row) throw new NotFoundError('Email broadcast not found.');
  if (row.status !== 'DRAFT') {
    throw new InvalidRequestError('Only draft broadcasts can be edited.');
  }

  if (patch.campaignKey !== undefined) row.campaignKey = normalizeCampaignKey(patch.campaignKey);
  if (patch.subject !== undefined) {
    const s = patch.subject.trim();
    if (!s) throw new InvalidRequestError('Subject is required.');
    row.subject = s.slice(0, 200);
  }
  if (patch.previewText !== undefined) row.previewText = patch.previewText?.trim().slice(0, 240) || null;
  if (patch.bodyMarkdown !== undefined) {
    const b = patch.bodyMarkdown.trim();
    if (!b) throw new InvalidRequestError('Body is required.');
    row.bodyMarkdown = b;
  }
  if (patch.ctaUrl !== undefined) row.ctaUrl = validateCtaUrl(patch.ctaUrl);
  if (patch.ctaLabel !== undefined) row.ctaLabel = patch.ctaLabel?.trim().slice(0, 80) || null;
  if (patch.audience !== undefined) row.audience = patch.audience;
  if (patch.audienceParams !== undefined) row.audienceParams = patch.audienceParams;
  row.updatedAt = new Date();

  try {
    return await row.save();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new DuplicateKeyError(`A broadcast with campaign key "${row.campaignKey}" already exists.`);
    }
    throw err;
  }
}

export async function deleteEmailBroadcast(publicId: string): Promise<void> {
  const row = await EmailBroadcast.findOneBy({ publicId });
  if (!row) throw new NotFoundError('Email broadcast not found.');
  if (row.status !== 'DRAFT') {
    throw new InvalidRequestError('Only draft broadcasts can be deleted.');
  }
  await row.remove();
}

export async function sendTestEmailBroadcast(publicId: string, toEmail: string): Promise<void> {
  const row = await EmailBroadcast.findOneBy({ publicId });
  if (!row) throw new NotFoundError('Email broadcast not found.');
  const { subject, html } = await buildBroadcastEmail({
    subject: row.subject,
    previewText: row.previewText,
    bodyMarkdown: row.bodyMarkdown,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    campaign: row.campaignKey,
    unsubscribeUrl: unsubscribeUrls(1, 'updates').page,
  });
  await sendAdminRawTestEmail(toEmail, subject, html, 'broadcast');
}

export async function launchEmailBroadcast(publicId: string): Promise<EmailBroadcast> {
  if (!(await isChannelEnabled('broadcast', 'email'))) {
    throw new InvalidRequestError('Broadcast emails are currently disabled in notification settings.');
  }
  const row = await EmailBroadcast.findOneBy({ publicId });
  if (!row) throw new NotFoundError('Email broadcast not found.');
  if (row.status !== 'DRAFT' && row.status !== 'FAILED') {
    throw new InvalidRequestError(`Cannot send a broadcast in "${row.status}" status.`);
  }

  const eligible = await queryEligibleUsers(row.audience, row.audienceParams);
  row.status = 'SENDING';
  row.recipientCount = eligible.length;
  row.error = null;
  row.updatedAt = new Date();
  await row.save();

  const boss = getOptionalPgBoss();
  if (!boss) {
    return dispatchEmailBroadcast(row.id);
  }
  await boss.send(EMAIL_BROADCAST_QUEUE, { broadcastId: row.id });
  return row;
}

export async function cancelEmailBroadcast(publicId: string): Promise<EmailBroadcast> {
  const row = await EmailBroadcast.findOneBy({ publicId });
  if (!row) throw new NotFoundError('Email broadcast not found.');
  if (row.status !== 'SENDING') {
    throw new InvalidRequestError('Only a sending broadcast can be cancelled.');
  }
  row.status = 'CANCELLED';
  row.updatedAt = new Date();
  return row.save();
}

export async function dispatchEmailBroadcast(broadcastId: number): Promise<EmailBroadcast> {
  const row = await EmailBroadcast.findOneBy({ id: broadcastId });
  if (!row) throw new NotFoundError('Email broadcast not found.');
  if (row.status === 'SENT' || row.status === 'CANCELLED') return row;

  const { emailsPerSec, errorCircuitBreakerPct } = await getNotificationParams<{
    emailsPerSec: number;
    errorCircuitBreakerPct: number;
  }>('broadcast');
  const delayMs = Math.max(0, Math.floor(1000 / Math.max(1, emailsPerSec ?? 5)));
  const breakerPct = errorCircuitBreakerPct ?? 5;

  const recipients = await queryEligibleUsers(row.audience, row.audienceParams);
  row.recipientCount = recipients.length;

  // Idempotent resume: skip anyone who already received this campaign.
  const alreadySent = await EmailSend.find({
    where: { kind: 'broadcast', campaign: row.campaignKey, status: In(['sent', 'suppressed']) },
    select: { userId: true },
  });
  const skipUserIds = new Set(alreadySent.map((s) => s.userId).filter((id): id is number => id !== null));

  let sent = row.sentCount;
  let failed = row.failedCount;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    // Check for mid-flight cancellation or global kill-switch between batches.
    const fresh = await EmailBroadcast.findOne({ where: { id: row.id }, select: { id: true, status: true } });
    if (fresh?.status === 'CANCELLED') {
      logger.info({ broadcastId: row.id, sent, failed }, 'Email broadcast cancelled mid-flight');
      return (await EmailBroadcast.findOneBy({ id: row.id })) ?? row;
    }
    if (!(await isChannelEnabled('broadcast', 'email'))) {
      row.status = 'FAILED';
      row.error = 'Paused: broadcast emails were disabled in notification settings.';
      row.sentCount = sent;
      row.failedCount = failed;
      row.updatedAt = new Date();
      return row.save();
    }

    const batch = recipients.slice(i, i + BATCH_SIZE);
    for (const user of batch) {
      if (skipUserIds.has(user.id)) continue;
      try {
        await sendBroadcastEmail({
          userId: user.id,
          email: user.email,
          username: user.username,
          subject: row.subject,
          previewText: row.previewText,
          bodyMarkdown: row.bodyMarkdown,
          ctaLabel: row.ctaLabel,
          ctaUrl: row.ctaUrl,
          campaign: row.campaignKey,
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        logger.error({ err, broadcastId: row.id, userId: user.id }, 'Broadcast email send failed');
      }

      const attempted = sent + failed;
      if (attempted >= CIRCUIT_BREAKER_MIN_SENDS && (failed / attempted) * 100 >= breakerPct) {
        row.status = 'FAILED';
        row.sentCount = sent;
        row.failedCount = failed;
        row.error = `Circuit breaker tripped: ${failed}/${attempted} sends failed (>= ${breakerPct}%).`;
        row.updatedAt = new Date();
        await row.save();
        logger.error({ broadcastId: row.id, sent, failed, breakerPct }, 'Email broadcast circuit breaker tripped');
        return row;
      }

      if (delayMs > 0) await sleep(delayMs);
    }

    row.sentCount = sent;
    row.failedCount = failed;
    row.updatedAt = new Date();
    await row.save();
  }

  row.status = 'SENT';
  row.sentCount = sent;
  row.failedCount = failed;
  row.sentAt = new Date();
  row.updatedAt = new Date();
  await row.save();
  logger.info({ broadcastId: row.id, campaign: row.campaignKey, sent, failed }, 'Email broadcast complete');
  return row;
}

export function toEmailBroadcastJSON(row: EmailBroadcast) {
  return {
    id: row.publicId,
    campaignKey: row.campaignKey,
    subject: row.subject,
    previewText: row.previewText,
    bodyMarkdown: row.bodyMarkdown,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    audience: row.audience,
    audienceParams: row.audienceParams,
    status: row.status,
    recipientCount: row.recipientCount,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    error: row.error,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
