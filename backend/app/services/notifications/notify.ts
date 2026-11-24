import { IsNull } from 'typeorm';
import { Notification } from '@app/models';
import type { NotificationKind, User } from '@app/models';
import { acceptsProductEmails } from '@app/services/email/unsubscribe';
import { logger } from '@config/log';

/** The categories a reader switches notices on and off by, per channel. They match the email categories of the same
 * name, so Settings shows one row per category with a site switch and an email switch. */
export type NotificationCategory = 'words' | 'requests';

export const NOTIFICATION_CATEGORY: Record<NotificationKind, NotificationCategory> = {
  'word-available': 'words',
  'word-digest': 'words',
  'request-update': 'requests',
};

/** Read entries are kept this long, then the nightly sweep deletes them. */
const READ_NOTIFICATION_RETENTION_DAYS = 90;

/** Unread entries are kept longer, but not forever: a reader who never comes back does not need a year of bells. */
const UNREAD_NOTIFICATION_RETENTION_DAYS = 365;

/** Absent means on: the bell is part of the site, not mail the reader signed up for. */
export function acceptsSiteNotifications(
  preferences: User['preferences'] | null | undefined,
  category: NotificationCategory,
): boolean {
  return preferences?.siteNotifications?.[category] !== false;
}

/**
 * The one place a notice to a reader goes out (task 52). Writes the bell entry if the reader keeps the site channel on
 * for the kind's category, and calls `sendEmail` if they keep email on for it; the two run side by side. Never throws:
 * a notice is a side effect of work that already happened (a sweep, a status change), and that work stands if a
 * channel is down. Answers whether the email was queued.
 */
export async function notify(
  user: Pick<User, 'id' | 'preferences'>,
  kind: NotificationKind,
  payload: Record<string, unknown>,
  sendEmail?: () => Promise<void>,
): Promise<boolean> {
  const category = NOTIFICATION_CATEGORY[kind];

  const site = acceptsSiteNotifications(user.preferences, category)
    ? Notification.create({ userId: user.id, kind, payload })
        .save()
        .catch((err) => logger.error({ err, userId: user.id, kind }, 'Could not write the notification'))
    : null;

  let emailed = false;
  if (sendEmail && acceptsProductEmails(user.preferences, category)) {
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
    createdAt: notification.createdAt.toISOString(),
  };
}
