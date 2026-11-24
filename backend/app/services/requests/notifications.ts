import { ContentRequestStatus, User } from '@app/models';
import type { ContentRequest } from '@app/models';
import { sendRequestUpdateEmail } from '@app/mailers/email';
import { notify } from '@app/services/notifications/notify';
import { logger } from '@config/log';

/** The two moments a voter hears about. Planned, declined and reopened requests change quietly. */
const NOTIFIED_STATUSES = new Set([ContentRequestStatus.IN_PROGRESS, ContentRequestStatus.RELEASED]);

/** Everyone who voted for or boosted the request, minus banned accounts. Which channel each one hears on (the bell,
 * email, both or neither) is decided per reader by `notify`. */
export async function requestSubscribers(
  requestId: number,
): Promise<Pick<User, 'id' | 'username' | 'email' | 'preferences'>[]> {
  return User.createQueryBuilder('u')
    .select(['u.id', 'u.username', 'u.email', 'u.preferences'])
    .where(
      `u.id IN (SELECT "user_id" FROM "ContentRequestVote" WHERE "request_id" = :requestId
                UNION SELECT "user_id" FROM "ContentRequestBoost" WHERE "request_id" = :requestId)`,
      { requestId },
    )
    .andWhere('u.banned = false')
    .getMany();
}

/**
 * Tell every subscriber when a request moves to IN_PROGRESS or RELEASED: a bell entry and an email, each as the reader
 * keeps the "requests" category switched on. Runs after the status change is saved and never throws: the change
 * stands even if the mail queue is down.
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
    let emailed = 0;
    for (const user of subscribers) {
      const sent = await notify(user, 'request-update', { status, title: request.title, path }, () =>
        sendRequestUpdateEmail({
          userId: user.id,
          email: user.email,
          requestId: request.id,
          username: user.username,
          status,
          title: request.title,
          coverUrl: request.coverUrl,
          voteCount: request.voteCount,
          path,
        }),
      );
      if (sent) emailed += 1;
    }
    logger.info(
      { requestId: request.id, status, subscribers: subscribers.length, emailed },
      'Content request update sent',
    );
    return emailed;
  } catch (err) {
    logger.error({ err, requestId: request.id }, 'Could not send the content request update');
    return 0;
  }
}
