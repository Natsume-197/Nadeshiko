import type { Job, PgBoss } from 'pg-boss';
import { AppDataSource } from '@config/database';
import { config } from '@config/config';
import { logger } from '@config/log';
import { refreshDictionary } from '@app/services/dictionary/refresh';
import { DICTIONARY_REFRESH_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

/** Weekly refresh of our own dictionary from upstream releases; a no-op unless DICTIONARY_REFRESH_ENABLED. */
export async function registerDictionaryRefreshWorker(boss: PgBoss): Promise<void> {
  await boss.work(
    DICTIONARY_REFRESH_QUEUE,
    instrumentedHandler(DICTIONARY_REFRESH_QUEUE, async (_jobs: Job[]) => {
      if (!config.DICTIONARY_REFRESH_ENABLED) {
        logger.info('Dictionary refresh is disabled (DICTIONARY_REFRESH_ENABLED)');
        return;
      }
      const outcomes = await refreshDictionary(AppDataSource);
      logger.info({ outcomes }, 'Dictionary refresh finished');
    }),
  );

  logger.info('Dictionary refresh worker registered');
}
