import '@config/boot';
import { parseArgs } from 'node:util';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { computeFrequency } from '@app/services/dictionary/frequency';
import { runWithDatabase } from './lib/runWithDatabase';

/**
 * Recount how often each JMdict word occurs in our corpus and replace `dict.frequency` (task 40). Needs SUDACHI_URL
 * and the dictionary imported. Reads every served sentence once; rerun after large ingests.
 *
 *   node --import tsx bin/computeFrequency.ts [--dry-run]
 */
const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const startedAt = Date.now();
  const report = await computeFrequency(AppDataSource, {
    dryRun: values['dry-run'],
    onPage: (done) => {
      if (done % 20_000 === 0) logger.info({ segments: done }, 'frequency: counting');
    },
  });
  logger.info({ ...report, seconds: Math.round((Date.now() - startedAt) / 1000) }, 'frequency computed');
}

runWithDatabase('frequency', main);
