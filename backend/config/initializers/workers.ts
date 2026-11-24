import { PgBoss } from 'pg-boss';
import { registerActivityRetentionWorker } from '@app/workers/activityRetentionWorker';
import { registerAffinityRetentionWorker } from '@app/workers/affinityRetentionWorker';
import { registerEmailWorkers } from '@app/workers/emailWorker';
import { registerEmailLifecycleWorker } from '@app/workers/emailLifecycleWorker';
import { registerEsSyncWorkers } from '@app/workers/esSyncWorker';
import { registerTokenParseWorker } from '@app/workers/tokenParseWorker';
import { registerDictionaryRefreshWorker } from '@app/workers/dictionaryRefreshWorker';
import { registerRecurringLinesWorker } from '@app/workers/recurringLinesWorker';
import { registerPatreonMembershipRefreshWorker } from '@app/workers/patreonMembershipRefreshWorker';
import { registerUserDictionaryImportWorker } from '@app/workers/userDictionaryImportWorker';
import { registerWordWatchWorkers } from '@app/workers/wordWatchWorker';
import { closeAllArtifactHandles } from '@app/services/dictionary/custom/sqlitePool';
import { sendRecurringSweepJob } from '@app/workers/recurringLinesQueue';
import { setBossInstance } from '@app/workers/pgBossClient';
import { registerQueueMetrics } from '@app/workers/workerInstrumentation';
import {
  ALL_QUEUES,
  ACTIVITY_RETENTION_QUEUE,
  AFFINITY_RETENTION_QUEUE,
  EMAIL_SEND_QUEUE,
  EMAIL_LIFECYCLE_QUEUE,
  ES_SYNC_CREATE_QUEUE,
  ES_SYNC_DELETE_QUEUE,
  ES_SYNC_UPDATE_QUEUE,
  TOKEN_PARSE_QUEUE,
  TOKEN_SWEEP_QUEUE,
  DICTIONARY_REFRESH_QUEUE,
  RECURRING_RECOMPUTE_QUEUE,
  RECURRING_SWEEP_QUEUE,
  PATREON_MEMBERSHIP_REFRESH_QUEUE,
  USER_DICTIONARY_IMPORT_QUEUE,
  USER_DICTIONARY_MAINTENANCE_QUEUE,
  WORD_WATCH_FIRST_QUEUE,
  WORD_WATCH_DIGEST_QUEUE,
} from '@app/workers/queueNames';
import { getAppPostgresConfig } from '@config/postgresConfig';
import { logger } from '@config/log';
import type { RuntimeInitializer } from './types';

let boss: PgBoss | null = null;

export const workersInitializer: RuntimeInitializer = {
  name: 'workers',
  initialize: async () => {
    const { host, port, user, password, database } = getAppPostgresConfig();
    const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}`;

    boss = new PgBoss({
      connectionString: databaseUrl,
      schema: 'pgboss',
      application_name: 'nadeshiko-backend',
      monitorIntervalSeconds: 120, // Poll every 2min instead of 1min
    });

    boss.on('error', (error: Error) => {
      logger.error({ err: error }, 'PgBoss error');
    });

    await boss.start();

    const queues = [
      {
        name: ES_SYNC_CREATE_QUEUE,
        options: {
          // pg-boss measures retryDelay in seconds, not milliseconds. Ten retries with backoff capped at five minutes
          // ride out about twenty minutes of Elasticsearch trouble; five 1-2-4-8-16 s retries gave up after half a
          // minute and left the batch out of search for good.
          retryLimit: 10,
          retryDelay: 1,
          retryBackoff: true,
          retryDelayMax: 300,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: ES_SYNC_UPDATE_QUEUE,
        options: {
          retryLimit: 10,
          retryDelay: 1,
          retryBackoff: true,
          retryDelayMax: 300,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: ES_SYNC_DELETE_QUEUE,
        options: {
          retryLimit: 10,
          retryDelay: 1,
          retryBackoff: true,
          retryDelayMax: 300,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: EMAIL_SEND_QUEUE,
        options: {
          retryLimit: 5,
          retryDelay: 1,
          retryBackoff: true,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
      {
        name: EMAIL_LIFECYCLE_QUEUE,
        options: {
          // One retry covers a transient DB failure; beyond that a query failure should wait for tomorrow’s sweep
          // rather than repeat indefinitely.
          retryLimit: 1,
          retryDelay: 300,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
      {
        name: ACTIVITY_RETENTION_QUEUE,
        options: {
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: AFFINITY_RETENTION_QUEUE,
        options: {
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: TOKEN_PARSE_QUEUE,
        options: {
          // Retry the pull across deploys and Sudachi sidecar restarts or timeouts.
          retryLimit: 5,
          retryDelay: 30,
          retryBackoff: true,
          // Generous: a full pull is 500 sentences, and a slow sidecar is
          // exactly when a tighter expiry would start killing work that was
          // going to succeed.
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: TOKEN_SWEEP_QUEUE,
        options: {
          // This query sweep gets one retry for a DB blip; later failures wait for tomorrow.
          retryLimit: 1,
          retryDelay: 300,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
      {
        name: DICTIONARY_REFRESH_QUEUE,
        options: {
          // One retry after five minutes for a network blip; a second failure waits for next week rather than
          // retrying into the same upstream problem. The import is resumable (a rerun only applies what changed).
          retryLimit: 1,
          retryDelay: 300,
          // A full import of JMdict and JMnedict took ~3 minutes on a desktop; leave room for a slower server.
          expireInSeconds: 2 * 3600,
          retentionSeconds: 7 * 86400,
        },
      },
      {
        name: RECURRING_RECOMPUTE_QUEUE,
        options: {
          // A recompute is idempotent (it writes only changed rows), so retrying through a DB or queue blip is safe.
          retryLimit: 5,
          retryDelay: 30,
          retryBackoff: true,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
      {
        name: RECURRING_SWEEP_QUEUE,
        options: {
          retryLimit: 1,
          retryDelay: 300,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
      {
        name: PATREON_MEMBERSHIP_REFRESH_QUEUE,
        options: {
          // Per-connection failures are absorbed inside the run, so a retry only covers the connection list failing to
          // load; anything later waits for tomorrow, well inside the quota's seven-day staleness bound.
          retryLimit: 1,
          retryDelay: 300,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
      {
        name: USER_DICTIONARY_IMPORT_QUEUE,
        options: {
          // Large monolingual Yomitan zips finish in seconds on SQLite; no retries because the temp zip is cleaned up
          // on failure and the user can re-upload directly.
          retryLimit: 0,
          retryDelay: 0,
          expireInSeconds: 1800,
          retentionSeconds: 86400,
        },
      },
      {
        name: WORD_WATCH_FIRST_QUEUE,
        options: {
          // One retry for a DB or Elasticsearch blip; a second failure waits for tomorrow. A rerun is safe: met alerts
          // are closed as they are found, and the email job key carries the day.
          retryLimit: 1,
          retryDelay: 300,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        },
      },
      {
        name: WORD_WATCH_DIGEST_QUEUE,
        options: {
          // Same as above; the email job key carries the ISO week.
          retryLimit: 1,
          retryDelay: 300,
          expireInSeconds: 3600,
          retentionSeconds: 7 * 86400,
        },
      },
      {
        name: USER_DICTIONARY_MAINTENANCE_QUEUE,
        options: {
          retryLimit: 1,
          retryDelay: 300,
          expireInSeconds: 900,
          retentionSeconds: 86400,
        },
      },
    ];

    // `createQueue` leaves existing queues unchanged, so update each one to keep the stored options in sync.
    for (const queue of queues) {
      await boss.createQueue(queue.name, queue.options);
      await boss.updateQueue(queue.name, queue.options);
    }

    await boss.schedule(ACTIVITY_RETENTION_QUEUE, '0 3 * * *', {});
    // An hour after the activity sweep, so the two nightly deletes do not
    // contend for the same window.
    await boss.schedule(AFFINITY_RETENTION_QUEUE, '0 4 * * *', {});
    // Run the affinity sweep before the recap so month-boundary tallies are complete.
    await boss.schedule(EMAIL_LIFECYCLE_QUEUE, '0 5 * * *', {});
    // Run this last so it cannot queue work for rows the retention sweep is about to delete.
    await boss.schedule(TOKEN_SWEEP_QUEUE, '0 6 * * *', {});
    // Tuesdays: jmdict-simplified releases on Mondays. Does nothing unless DICTIONARY_REFRESH_ENABLED.
    await boss.schedule(DICTIONARY_REFRESH_QUEUE, '0 7 * * 2', {});
    // Repairs recurring-line flags a lost recompute or an unhooked write path left stale.
    await boss.schedule(RECURRING_SWEEP_QUEUE, '30 6 * * *', { reason: 'nightly' });
    // Re-checks linked Patreon memberships, so an API-only patron who cancels drops back to their own quota within a
    // day. Clear of the database sweeps, since its time is spent waiting on Patreon.
    await boss.schedule(PATREON_MEMBERSHIP_REFRESH_QUEUE, '15 2 * * *', {});
    // Custom dictionaries (task 48): interrupted imports, orphaned artifacts, local cache size. A no-op while
    // USER_DICTIONARIES_ENABLED is off.
    await boss.schedule(USER_DICTIONARY_MAINTENANCE_QUEUE, '45 2 * * *', {});
    // Word alerts (task 52): after the lifecycle sweep, out of search's busy hours. The digest goes out on Mondays,
    // after the daily sweep has run.
    await boss.schedule(WORD_WATCH_FIRST_QUEUE, '30 5 * * *', {});
    await boss.schedule(WORD_WATCH_DIGEST_QUEUE, '15 6 * * 1', {});
    logger.info('PgBoss initialized, queues created, cron scheduled');

    setBossInstance(boss);
    registerQueueMetrics(boss, ALL_QUEUES);

    await registerEsSyncWorkers(boss);
    await registerEmailWorkers(boss);
    await registerEmailLifecycleWorker(boss);
    await registerActivityRetentionWorker(boss);
    await registerAffinityRetentionWorker(boss);
    await registerTokenParseWorker(boss);
    await registerDictionaryRefreshWorker(boss);
    await registerRecurringLinesWorker(boss);
    await registerPatreonMembershipRefreshWorker(boss);
    await registerUserDictionaryImportWorker(boss);
    await registerWordWatchWorkers(boss);
    // Also sweep at boot: the first deploy fills the flags with no manual step, and any later deploy converges them.
    // Collapsed to one sweep per ten minutes, so a burst of restarts does not queue several.
    await sendRecurringSweepJob('boot');
  },
  shutdown: async () => {
    closeAllArtifactHandles();
    if (boss) {
      await boss.stop();
      boss = null;
      logger.info('PgBoss stopped');
    }
  },
};
