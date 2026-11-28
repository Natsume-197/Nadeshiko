import type { Job, PgBoss } from 'pg-boss';
import { dispatchEmailBroadcast } from '@app/services/email/broadcast';
import { logger } from '@config/log';
import { EMAIL_BROADCAST_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

interface EmailBroadcastJob {
  broadcastId: number;
}

export async function registerEmailBroadcastWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    EMAIL_BROADCAST_QUEUE,
    instrumentedHandler(EMAIL_BROADCAST_QUEUE, async (jobs: Job<EmailBroadcastJob>[]) => {
      for (const job of jobs) {
        if (job.data?.broadcastId) {
          await dispatchEmailBroadcast(job.data.broadcastId);
        }
      }
    }),
  );
  logger.info('Email broadcast worker registered');
}
