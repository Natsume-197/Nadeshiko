import { In } from 'typeorm';
import { ContentRequestStatus, User } from '@app/models';
import type { ContentRequest } from '@app/models';
import { sendRequestUpdateEmail } from '@app/mailers/email';
import { notify } from '@app/services/notifications/notify';
import { logger } from '@config/log';

/** Statuses that notify subscribers in the bell; IN_PROGRESS and RELEASED also send email. */
const NOTIFIED_STATUSES = new Set([
  ContentRequestStatus.IN_PROGRESS,
  ContentRequestStatus.RELEASED,
  ContentRequestStatus.DECLINED,
]);

const EMAILED_STATUSES = new Set([ContentRequestStatus.IN_PROGRESS, ContentRequestStatus.RELEASED]);

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
 * Tell every subscriber when a request moves to IN_PROGRESS, RELEASED, or DECLINED: a bell entry (folded by
 * `request:<id>`) and, for IN_PROGRESS/RELEASED, an email. Never throws.
 */
export async function notifyRequestSubscribers(
  request: ContentRequest,
  previous: ContentRequestStatus,
): Promise<number> {
  if (request.status === previous || !NOTIFIED_STATUSES.has(request.status)) return 0;
  try {
    const subscribers = await requestSubscribers(request.id);
    const status = request.status;
    const path =
      status === ContentRequestStatus.RELEASED && request.media ? `/media/${request.media.slug}` : '/requests';
    const payload: Record<string, unknown> = {
      status,
      title: request.title,
      path,
      ...(status === ContentRequestStatus.DECLINED && request.declineReason ? { reason: request.declineReason } : {}),
    };
    const groupKey = `request:${request.id}`;
    let emailed = 0;
    for (const user of subscribers) {
      const sendEmail = EMAILED_STATUSES.has(status)
        ? () =>
            sendRequestUpdateEmail({
              userId: user.id,
              email: user.email,
              requestId: request.id,
              username: user.username,
              status: status as 'IN_PROGRESS' | 'RELEASED',
              title: request.title,
              coverUrl: request.coverUrl,
              voteCount: request.voteCount,
              path,
            })
        : undefined;
      const sent = await notify(user, 'request-update', payload, sendEmail, { groupKey });
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

/** Notify voters/boosters of a duplicate request that their backing moved into the canonical request. */
export async function notifyRequestMerged(
  duplicate: Pick<ContentRequest, 'id' | 'title'>,
  into: Pick<ContentRequest, 'id' | 'title'>,
  subscriberIds: number[],
): Promise<void> {
  if (subscriberIds.length === 0) return;
  try {
    const users = await User.find({
      where: { id: In(subscriberIds), banned: false },
      select: { id: true, preferences: true },
    });
    const payload = {
      status: 'MERGED',
      title: duplicate.title,
      mergedIntoTitle: into.title,
      path: '/requests',
    };
    for (const user of users) {
      await notify(user, 'request-update', payload, undefined, { groupKey: `request:${into.id}` });
    }
  } catch (err) {
    logger.error({ err, duplicateId: duplicate.id, intoId: into.id }, 'Could not send merged request notice');
  }
}
