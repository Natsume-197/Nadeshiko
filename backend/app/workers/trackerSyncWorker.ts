import { Job, PgBoss } from 'pg-boss';
import { TrackerConnection, User } from '@app/models';
import { canUseCustomTheme } from '@app/services/themes/customTheme';
import { listConfiguredTrackerProviders } from '@app/services/tracker/registry';
import { syncTrackerConnection } from '@app/services/tracker/service';
import { logger } from '@config/log';
import { TRACKER_SYNC_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

const INTER_USER_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Daily background sync for patrons who enabled automatic tracker updates (task 54).
 *
 * Runs shortly after `patreon-membership-refresh` so lapsed memberships are already reflected and skipped.
 */
export async function registerTrackerSyncWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    TRACKER_SYNC_QUEUE,
    instrumentedHandler(TRACKER_SYNC_QUEUE, async (_jobs: Job[]) => {
      await runAutomaticTrackerSync();
    }),
  );

  logger.info('Tracker sync worker registered');
}

export async function runAutomaticTrackerSync(options?: {
  delayMs?: number;
}): Promise<{ synced: number; skipped: number; failed: number }> {
  const configured = new Set(listConfiguredTrackerProviders());
  if (configured.size === 0) {
    logger.info('No anime tracker providers configured; skipping automatic tracker sync');
    return { synced: 0, skipped: 0, failed: 0 };
  }

  const connections = await TrackerConnection.find({
    where: { autoSyncEnabled: true },
    order: { id: 'ASC' },
  });

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const delayMs = options?.delayMs ?? INTER_USER_DELAY_MS;

  for (const connection of connections) {
    if (!configured.has(connection.provider)) {
      skipped += 1;
      continue;
    }

    const user = await User.findOne({
      where: { id: connection.userId },
      select: { id: true, role: true },
    });
    if (!user || !(await canUseCustomTheme(user))) {
      skipped += 1;
      continue;
    }

    try {
      await syncTrackerConnection(connection, {
        enforceCooldown: false,
        canUsePatronPerks: true,
      });
      synced += 1;
    } catch (err) {
      failed += 1;
      logger.warn(
        { err, userId: connection.userId, provider: connection.provider },
        'Automatic tracker sync failed for one connection',
      );
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  logger.info({ synced, skipped, failed, total: connections.length }, 'Automatic tracker sync complete');
  return { synced, skipped, failed };
}
