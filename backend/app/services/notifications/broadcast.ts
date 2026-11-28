import { In, type QueryDeepPartialEntity } from 'typeorm';
import {
  Notification,
  NotificationBroadcast,
  PatreonConnection,
  User,
  UserRoleType,
  type NotificationBroadcastAudience,
  type NotificationBroadcastKind,
} from '@app/models';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import { getOptionalPgBoss } from '@app/workers/pgBossClient';
import { NOTIFICATION_BROADCAST_QUEUE } from '@app/workers/queueNames';
import { isChannelEnabled } from './settings';
import { logger } from '@config/log';

const BATCH_SIZE = 500;

export function validateRelativeLink(url: string | null | undefined): string | null {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return null;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    throw new InvalidRequestError('Link URL must be a relative path starting with /.');
  }
  return trimmed;
}

export interface SendNotificationBroadcastInput {
  kind: NotificationBroadcastKind;
  audience: NotificationBroadcastAudience;
  targetUserId?: number | null;
  title: string;
  message: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
}

async function resolveRecipientIds(
  audience: NotificationBroadcastAudience,
  targetUserId: number | null,
): Promise<number[]> {
  if (audience === 'USER') {
    if (!targetUserId) throw new InvalidRequestError('A target user is required.');
    const user = await User.findOne({ where: { id: targetUserId }, select: { id: true } });
    if (!user) throw new NotFoundError('Target user not found.');
    return [user.id];
  }

  if (audience === 'PATRONS') {
    const [connections, rolePatrons] = await Promise.all([
      PatreonConnection.createQueryBuilder('pc')
        .select('pc.userId', 'userId')
        .where(`pc.patron_status = 'active_patron'`)
        .getRawMany<{ userId: number }>(),
      User.find({ where: { role: UserRoleType.PATREON, isActive: true, banned: false }, select: { id: true } }),
    ]);
    const ids = new Set<number>([...connections.map((c) => Number(c.userId)), ...rolePatrons.map((u) => u.id)]);
    if (ids.size === 0) return [];
    const active = await User.find({
      where: { id: In([...ids]), isActive: true, banned: false },
      select: { id: true },
    });
    return active.map((u) => u.id);
  }

  const users = await User.find({ where: { isActive: true, banned: false }, select: { id: true } });
  return users.map((u) => u.id);
}

export async function dispatchNotificationBroadcast(broadcastId: number): Promise<NotificationBroadcast> {
  const broadcast = await NotificationBroadcast.findOneBy({ id: broadcastId });
  if (!broadcast) throw new NotFoundError('Notification broadcast not found.');
  if (broadcast.status === 'SENT') return broadcast;

  broadcast.status = 'SENDING';
  broadcast.error = null;
  await broadcast.save();

  try {
    const recipientIds = await resolveRecipientIds(broadcast.audience, broadcast.targetUserId);
    broadcast.recipientCount = recipientIds.length;
    await broadcast.save();

    const payload: Record<string, unknown> = {
      title: broadcast.title,
      message: broadcast.message,
      ...(broadcast.linkUrl ? { linkUrl: broadcast.linkUrl } : {}),
      ...(broadcast.linkLabel ? { linkLabel: broadcast.linkLabel } : {}),
      broadcastId: broadcast.publicId,
    };

    let sent = 0;
    for (let i = 0; i < recipientIds.length; i += BATCH_SIZE) {
      const chunk = recipientIds.slice(i, i + BATCH_SIZE);
      await Notification.createQueryBuilder()
        .insert()
        .into(Notification)
        .values(
          chunk.map(
            (userId): QueryDeepPartialEntity<Notification> => ({
              userId,
              kind: broadcast.kind,
              payload: payload as QueryDeepPartialEntity<Record<string, unknown>>,
              groupKey: null,
              groupCount: 1,
            }),
          ),
        )
        .execute();
      sent += chunk.length;
      broadcast.sentCount = sent;
      await broadcast.save();
    }

    broadcast.status = 'SENT';
    broadcast.sentAt = new Date();
    await broadcast.save();
    logger.info(
      { broadcastId: broadcast.id, kind: broadcast.kind, audience: broadcast.audience, sent },
      'Notification broadcast dispatched',
    );
    return broadcast;
  } catch (err) {
    broadcast.status = 'FAILED';
    broadcast.error = err instanceof Error ? err.message : String(err);
    await broadcast.save();
    logger.error({ err, broadcastId: broadcast.id }, 'Notification broadcast failed');
    throw err;
  }
}

export async function createNotificationBroadcast(
  input: SendNotificationBroadcastInput,
  adminUserId: number,
): Promise<NotificationBroadcast> {
  if (!(await isChannelEnabled(input.kind, 'site'))) {
    throw new InvalidRequestError(`"${input.kind}" is currently disabled in notification settings.`);
  }

  const title = input.title.trim();
  const message = input.message.trim();
  if (!title) throw new InvalidRequestError('Title is required.');
  if (!message) throw new InvalidRequestError('Message is required.');

  const linkUrl = validateRelativeLink(input.linkUrl);
  const linkLabel = input.linkLabel?.trim() || null;

  if (input.audience === 'USER') {
    if (!input.targetUserId) throw new InvalidRequestError('Select a user when audience is USER.');
    const exists = await User.existsBy({ id: input.targetUserId });
    if (!exists) throw new NotFoundError('Target user not found.');
  }

  const broadcast = await NotificationBroadcast.create({
    kind: input.kind,
    audience: input.audience,
    targetUserId: input.audience === 'USER' ? (input.targetUserId ?? null) : null,
    title: title.slice(0, 160),
    message,
    linkUrl,
    linkLabel: linkLabel ? linkLabel.slice(0, 80) : null,
    status: 'QUEUED',
    createdBy: adminUserId,
  }).save();

  // Single-user direct notices run immediately; bulk broadcasts fan out via pg-boss when running.
  const boss = getOptionalPgBoss();
  if (input.audience === 'USER' || !boss) {
    return dispatchNotificationBroadcast(broadcast.id);
  }

  await boss.send(NOTIFICATION_BROADCAST_QUEUE, { broadcastId: broadcast.id });
  return broadcast;
}

export function toNotificationBroadcastJSON(row: NotificationBroadcast) {
  return {
    id: row.publicId,
    kind: row.kind,
    audience: row.audience,
    targetUserId: row.targetUserId,
    targetUsername: row.targetUser?.username ?? null,
    title: row.title,
    message: row.message,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    status: row.status,
    recipientCount: row.recipientCount,
    sentCount: row.sentCount,
    error: row.error,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
