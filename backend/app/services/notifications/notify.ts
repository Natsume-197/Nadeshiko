import { IsNull } from 'typeorm';
import { Notification } from '@app/models';
import type { NotificationKind, User } from '@app/models';
import { acceptsProductEmails } from '@app/services/email/unsubscribe';
import { logger } from '@config/log';
import { NOTIFICATION_REGISTRY, isOfficialNotificationKind, type SiteNotificationCategory } from './registry';
import { isChannelEnabled } from './settings';

/** The categories a reader switches notices on and off by, per channel. */
export type NotificationCategory = SiteNotificationCategory;

export const NOTIFICATION_CATEGORY: Partial<Record<NotificationKind, NotificationCategory>> = {
  'word-available': 'words',
  'word-digest': 'words',
  'request-update': 'requests',
  'report-resolved': 'reports',
};

/** Read entries are kept this long, then the nightly sweep deletes them. */
const READ_NOTIFICATION_RETENTION_DAYS = 90;

/** Unread entries are kept longer, but not forever: a reader who never comes back does not need a year of bells. */
const UNREAD_NOTIFICATION_RETENTION_DAYS = 365;

/** Absent means on: the bell is part of the site, not mail the reader signed up for. */
export function acceptsSiteNotifications(
  preferences: User['preferences'] | null | undefined,
  category: NotificationCategory | null,
): boolean {
  if (category === null) return true; // Official notices cannot be muted
  return preferences?.siteNotifications?.[category] !== false;
}

export interface NotifyOptions {
  /**
   * When provided, folds into the reader's latest unread notification with the same `groupKey` (incrementing
   * `groupCount`, replacing `payload`, and bumping `createdAt` to now). Pass `buildPayload` to compute the folded
   * payload from the new count.
   */
  groupKey?: string;
  buildPayload?: (groupCount: number, existingPayload: Record<string, unknown> | null) => Record<string, unknown>;
}

async function writeSiteNotification(
  userId: number,
  kind: NotificationKind,
  payload: Record<string, unknown>,
  options?: NotifyOptions,
): Promise<void> {
  if (options?.groupKey) {
    const existing = await Notification.findOne({
      where: { userId, groupKey: options.groupKey, readAt: IsNull() },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    if (existing) {
      const nextCount = (existing.groupCount ?? 1) + 1;
      existing.groupCount = nextCount;
      existing.payload = options.buildPayload ? options.buildPayload(nextCount, existing.payload) : payload;
      existing.createdAt = new Date();
      await existing.save();
      return;
    }
    const initialPayload = options.buildPayload ? options.buildPayload(1, null) : payload;
    await Notification.create({
      userId,
      kind,
      payload: initialPayload,
      groupKey: options.groupKey,
      groupCount: 1,
    }).save();
    return;
  }

  await Notification.create({ userId, kind, payload, groupKey: null, groupCount: 1 }).save();
}

/**
 * The one place a notice to a reader goes out (task 52). Checks the central registry's runtime switches, writes the
 * bell entry if site is enabled for the kind and reader, and calls `sendEmail` if email is enabled for the kind and
 * reader. Never throws: a notice is a side effect of work that already happened. Answers whether the email was queued.
 */
export async function notify(
  user: Pick<User, 'id' | 'preferences'>,
  kind: NotificationKind,
  payload: Record<string, unknown>,
  sendEmail?: () => Promise<void>,
  options?: NotifyOptions,
): Promise<boolean> {
  const entry = NOTIFICATION_REGISTRY[kind];
  const siteCategory = entry.siteCategory;
  const emailCategory = entry.emailCategory;

  const [siteGloballyOn, emailGloballyOn] = await Promise.all([
    entry.channels.site ? isChannelEnabled(kind, 'site') : Promise.resolve(false),
    sendEmail && entry.channels.email ? isChannelEnabled(kind, 'email') : Promise.resolve(false),
  ]);

  const site =
    siteGloballyOn && acceptsSiteNotifications(user.preferences, siteCategory)
      ? writeSiteNotification(user.id, kind, payload, options).catch((err) =>
          logger.error({ err, userId: user.id, kind }, 'Could not write the notification'),
        )
      : null;

  let emailed = false;
  if (
    sendEmail &&
    emailGloballyOn &&
    (emailCategory === null || acceptsProductEmails(user.preferences, emailCategory))
  ) {
    try {
      await sendEmail();
      emailed = true;
    } catch (err) {
      logger.error({ err, userId: user.id, kind }, 'Could not queue the notification email');
    }
  }

  await site;
  return emailed;
}

export async function unreadNotificationCount(userId: number): Promise<number> {
  return Notification.countBy({ userId, readAt: IsNull() });
}

/** Deletes read entries past their retention and unread ones past theirs, in one pass. Returns how many went. */
export async function pruneNotifications(now: Date = new Date()): Promise<number> {
  const day = 24 * 60 * 60 * 1000;
  const result = await Notification.createQueryBuilder()
    .delete()
    .where('(read_at IS NOT NULL AND created_at < :readCutoff) OR created_at < :unreadCutoff', {
      readCutoff: new Date(now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * day),
      unreadCutoff: new Date(now.getTime() - UNREAD_NOTIFICATION_RETENTION_DAYS * day),
    })
    .execute();
  return result.affected ?? 0;
}

export function toNotificationJSON(notification: Notification) {
  return {
    id: notification.publicId,
    kind: notification.kind,
    payload: notification.payload,
    read: notification.readAt !== null,
    pinned: isOfficialNotificationKind(notification.kind) && notification.readAt === null,
    groupCount: notification.groupCount ?? 1,
    createdAt: notification.createdAt.toISOString(),
  };
}
