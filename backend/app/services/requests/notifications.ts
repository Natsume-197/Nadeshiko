import { ContentRequestStatus, User } from '@app/models';
import type { ContentRequest } from '@app/models';
import { sendRequestUpdateEmail } from '@app/mailers/email';
import { acceptsProductEmails } from '@app/services/email/unsubscribe';
import { logger } from '@config/log';

/** The two moments a voter hears about. Planned, declined and reopened requests change quietly. */
const NOTIFIED_STATUSES = new Set([ContentRequestStatus.IN_PROGRESS, ContentRequestStatus.RELEASED]);

/** Everyone who voted for or boosted the request, minus banned accounts and anyone who opted out of request news. */
export async function requestSubscribers(requestId: number): Promise<Pick<User, 'id' | 'username' | 'email'>[]> {
  const users = await User.createQueryBuilder('u')
    .select(['u.id', 'u.username', 'u.email', 'u.preferences'])
    .where(
      `u.id IN (SELECT "user_id" FROM "ContentRequestVote" WHERE "request_id" = :requestId
                UNION SELECT "user_id" FROM "ContentRequestBoost" WHERE "request_id" = :requestId)`,
      { requestId },
    )
    .andWhere('u.banned = false')
    .getMany();
  return users.filter((user) => acceptsProductEmails(user.preferences, 'requests'));
}

/**
 * Queue one email per subscriber when a request moves to IN_PROGRESS or RELEASED. Runs after the status change is
 * saved and never throws: the change stands even if the mail queue is down.
 */
export async function notifyRequestSubscribers(
  request: ContentRequest,
  previous: ContentRequestStatus,
): Promise<number> {
  if (request.status === previous || !NOTIFIED_STATUSES.has(request.status)) return 0;
  try {
    const subscribers = await requestSubscribers(request.id);
    const status = request.status as 'IN_PROGRESS' | 'RELEASED';
    const path = status === 'RELEASED' && request.media ? `/media/${request.media.slug}` : '/requests';
    for (const user of subscribers) {
      await sendRequestUpdateEmail({
        userId: user.id,
        email: user.email,
        requestId: request.id,
        username: user.username,
        status,
        title: request.title,
        coverUrl: request.coverUrl,
        voteCount: request.voteCount,
        path,
      });
    }
    logger.info({ requestId: request.id, status, recipients: subscribers.length }, 'Content request update queued');
    return subscribers.length;
  } catch (err) {
    logger.error({ err, requestId: request.id }, 'Could not queue the content request update');
    return 0;
  }
}
