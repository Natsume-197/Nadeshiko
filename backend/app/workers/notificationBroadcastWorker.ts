import type { Job, PgBoss } from 'pg-boss';
import { dispatchNotificationBroadcast } from '@app/services/notifications/broadcast';
import { logger } from '@config/log';
import { NOTIFICATION_BROADCAST_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

interface NotificationBroadcastJob {
  broadcastId: number;
}

export async function registerNotificationBroadcastWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    NOTIFICATION_BROADCAST_QUEUE,
    instrumentedHandler(NOTIFICATION_BROADCAST_QUEUE, async (jobs: Job<NotificationBroadcastJob>[]) => {
      for (const job of jobs) {
        if (job.data?.broadcastId) {
          await dispatchNotificationBroadcast(job.data.broadcastId);
        }
      }
    }),
  );
  logger.info('Notification broadcast worker registered');
}
