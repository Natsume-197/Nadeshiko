import { PgBoss, Job } from 'pg-boss';
import { PatreonConnection } from '@app/models';
import { getPatreonConnection, isPatreonConfigured } from '@app/services/patreon/connection';
import { logger } from '@config/log';
import { PATREON_MEMBERSHIP_REFRESH_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/**
 * Re-checks every linked Patreon membership once a day.
 *
 * Membership is otherwise refreshed only when the reader opens Settings, and a reader who only uses the API never
 * does: without this, cancelling would leave them on the higher quota indefinitely. A failure here leaves the stored
 * check time where it was, so the quota's staleness bound takes over if one connection keeps failing (a revoked
 * grant, say) instead of the last answer standing forever.
 */
export async function registerPatreonMembershipRefreshWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    PATREON_MEMBERSHIP_REFRESH_QUEUE,
    instrumentedHandler(PATREON_MEMBERSHIP_REFRESH_QUEUE, async (_jobs: Job[]) => {
      await refreshPatreonMemberships();
    }),
  );

  logger.info('Patreon membership refresh worker registered');
}

export async function refreshPatreonMemberships(): Promise<{ checked: number; failed: number }> {
  // Without credentials every connection would fail and log; one line saying why is enough.
  if (!isPatreonConfigured()) {
    logger.info('Patreon is not configured; skipping the membership refresh');
    return { checked: 0, failed: 0 };
  }

  const connections = await PatreonConnection.find({ select: { id: true, userId: true }, order: { id: 'ASC' } });
  let failed = 0;

  // One at a time: the list is small, and Patreon rate-limits per client. A failure is logged and skipped rather than
  // thrown, so one revoked grant does not stop everyone after it, and a retry does not re-check the ones that worked.
  for (const { userId } of connections) {
    try {
      await getPatreonConnection(userId, true);
    } catch (err) {
      failed += 1;
      logger.warn({ err, userId }, 'Patreon membership refresh failed for one connection');
    }
  }

  const checked = connections.length - failed;
  logger.info({ checked, failed, total: connections.length }, 'Patreon membership refresh complete');
  return { checked, failed };
}
