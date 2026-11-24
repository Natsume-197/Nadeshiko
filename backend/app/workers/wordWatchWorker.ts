import { PgBoss, Job } from 'pg-boss';
import { logger } from '@config/log';
import { runFirstAppearanceSweep, runNewSentencesSweep } from '@app/services/wordWatches/sweep';
import { WORD_WATCH_DIGEST_QUEUE, WORD_WATCH_FIRST_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/** Word alerts (task 52): the daily first-appearance sweep and the weekly new-sentences digest. */
export async function registerWordWatchWorkers(boss: PgBoss): Promise<void> {
  await boss.work(
    WORD_WATCH_FIRST_QUEUE,
    instrumentedHandler(WORD_WATCH_FIRST_QUEUE, async (_jobs: Job[]) => {
      await runFirstAppearanceSweep();
    }),
  );
  await boss.work(
    WORD_WATCH_DIGEST_QUEUE,
    instrumentedHandler(WORD_WATCH_DIGEST_QUEUE, async (_jobs: Job[]) => {
      await runNewSentencesSweep();
    }),
  );

  logger.info('Word alert workers registered');
}
