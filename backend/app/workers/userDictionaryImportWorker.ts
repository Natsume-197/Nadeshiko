import type { Job, PgBoss } from 'pg-boss';
import { config } from '@config/config';
import { logger } from '@config/log';
import {
  failInterruptedImports,
  processArtifactImportJob,
  runUserDictionaryMaintenance,
} from '@app/services/dictionary/custom/service';
import { USER_DICTIONARY_IMPORT_QUEUE, USER_DICTIONARY_MAINTENANCE_QUEUE } from './queueNames';
import { instrumentedHandler } from './workerInstrumentation';

export interface UserDictionaryImportPayload {
  artifactId: number;
  tmpZipPath: string;
}

export async function registerUserDictionaryImportWorker(boss: PgBoss): Promise<void> {
  // Run one import at a time so concurrent large monolingual zips do not spike container RAM on the shared Hetzner host.
  // Each import runs in its own thread with its own heap cap (`importRunner.ts`), off the request path.
  await boss.work<UserDictionaryImportPayload>(
    USER_DICTIONARY_IMPORT_QUEUE,
    { batchSize: 1 },
    instrumentedHandler(USER_DICTIONARY_IMPORT_QUEUE, async (jobs: Job<UserDictionaryImportPayload>[]) => {
      for (const job of jobs) {
        const { artifactId, tmpZipPath } = job.data;
        await processArtifactImportJob(artifactId, tmpZipPath);
      }
    }),
  );

  await boss.work(
    USER_DICTIONARY_MAINTENANCE_QUEUE,
    { batchSize: 1 },
    instrumentedHandler(USER_DICTIONARY_MAINTENANCE_QUEUE, async () => {
      await runUserDictionaryMaintenance();
    }),
  );

  // At boot, imports a previous container was running went away with its disk: report them now rather than at the
  // nightly run. Only those past the queue's expiry, so a rolling deploy's still-running import is left alone.
  if (config.USER_DICTIONARIES_ENABLED) {
    await failInterruptedImports().catch((error) =>
      logger.warn({ err: error }, 'Could not mark interrupted custom dictionary imports at boot'),
    );
  }
}
