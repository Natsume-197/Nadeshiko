import '@config/boot';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { JMdictDictionaryMetadata } from '@scriptin/jmdict-simplified-types';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { fromJmdict, fromJmnedict, type ImportEntry } from '@app/services/dictionary/import/entries';
import { type FuriganaEntry, readDictionary, readJsonArray } from '@app/services/dictionary/import/readers';
import { importDictionary, importFurigana } from '@app/services/dictionary/import/importDictionary';
import { importJlpt } from '@app/services/dictionary/import/importJlpt';
import { importKanjiumPitch, importPitch } from '@app/services/dictionary/import/importPitch';

/**
 * Load Nadeshiko's own dictionary (task 40) into `dict.*` from extracted upstream files:
 *
 *   node --import tsx bin/importDictionary.ts \
 *     --jmdict jmdict-all-3.6.2.json --jmnedict jmnedict-all-3.6.2.json \
 *     --jmdict-furigana JmdictFurigana.json --jmnedict-furigana JmnedictFurigana.json \
 *     --furigana-version 2.3.1+2026-10-25 \
 *     --jlpt-dir <folder with n1.csv..n5.csv> --jlpt-version <stephenmk/yomitan-jlpt-vocab commit> \
 *     --unidic <unidic-cwj sys.dic> --unidic-version 202512  *     --kanjium <kanjium data/source_files/raw/accents.txt> --kanjium-version <kanjium commit> [--dry-run]
 *
 * Any subset of the files can be given. Safe to rerun: forms keep their indexes, missing words are only flagged
 * inactive. `--dry-run` does all the work in one transaction, prints what would change, and rolls it back.
 */

const { values: args } = parseArgs({
  options: {
    jmdict: { type: 'string' },
    jmnedict: { type: 'string' },
    'jmdict-furigana': { type: 'string' },
    'jmnedict-furigana': { type: 'string' },
    'furigana-version': { type: 'string' },
    'jlpt-dir': { type: 'string' },
    'jlpt-version': { type: 'string' },
    unidic: { type: 'string' },
    'unidic-version': { type: 'string' },
    kanjium: { type: 'string' },
    'kanjium-version': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function requireFile(path: string | undefined, flag: string): string | undefined {
  if (path !== undefined && !existsSync(path)) throw new Error(`--${flag}: no such file ${path}`);
  return path;
}

async function* mapped<T>(source: AsyncIterable<T>, map: (entry: T) => ImportEntry): AsyncGenerator<ImportEntry> {
  for await (const entry of source) yield map(entry);
}

async function main(): Promise<void> {
  const dryRun = args['dry-run'] ?? false;
  const jmdict = requireFile(args.jmdict, 'jmdict');
  const jmnedict = requireFile(args.jmnedict, 'jmnedict');
  const jmdictFurigana = requireFile(args['jmdict-furigana'], 'jmdict-furigana');
  const jmnedictFurigana = requireFile(args['jmnedict-furigana'], 'jmnedict-furigana');
  const furiganaVersion = args['furigana-version'];
  const jlptDir = args['jlpt-dir'];
  const jlptVersion = args['jlpt-version'];
  const unidic = requireFile(args.unidic, 'unidic');
  const unidicVersion = args['unidic-version'];
  const kanjium = requireFile(args.kanjium, 'kanjium');
  const kanjiumVersion = args['kanjium-version'];
  const jlptFiles = jlptDir
    ? [1, 2, 3, 4, 5].map((level) => ({ level, path: requireFile(join(jlptDir, `n${level}.csv`), 'jlpt-dir') ?? '' }))
    : [];

  if (!jmdict && !jmnedict && !jmdictFurigana && !jmnedictFurigana && !jlptDir && !unidic && !kanjium) {
    throw new Error(
      'Nothing to import: pass --jmdict, --jmnedict, --jmdict-furigana, --jmnedict-furigana, --jlpt-dir, --unidic and/or --kanjium',
    );
  }
  if ((jmdictFurigana || jmnedictFurigana) && !furiganaVersion) {
    throw new Error('--furigana-version is required with a furigana file (JmdictFurigana carries none itself)');
  }
  if (jlptDir && !jlptVersion) {
    throw new Error('--jlpt-version is required with --jlpt-dir (the yomitan-jlpt-vocab commit the files came from)');
  }

  if (unidic && !unidicVersion) throw new Error('--unidic-version is required with --unidic (e.g. 202512)');
  if (kanjium && !kanjiumVersion) throw new Error('--kanjium-version is required with --kanjium (the Kanjium commit)');

  await AppDataSource.initialize();

  const startedAt = Date.now();
  const progress = (report: { source: string; entries: number }) => {
    if (report.entries % 50_000 < 2_000) logger.info({ source: report.source, entries: report.entries }, 'importing');
  };

  for (const [source, path] of [
    ['jmdict', jmdict],
    ['jmnedict', jmnedict],
  ] as const) {
    if (!path) continue;
    let metadata: JMdictDictionaryMetadata | null = null;
    const raw = readDictionary(source, path, (m) => {
      metadata = m;
    });
    const entries =
      source === 'jmdict'
        ? mapped(raw as AsyncIterable<Parameters<typeof fromJmdict>[0]>, fromJmdict)
        : mapped(raw as AsyncIterable<Parameters<typeof fromJmnedict>[0]>, fromJmnedict);
    const report = await importDictionary(AppDataSource, source, entries, () => metadata, {
      dryRun,
      onProgress: progress,
    });
    logger.info(report, `${source} ${dryRun ? 'dry run' : 'imported'}`);
  }

  for (const [source, path] of [
    ['jmdict-furigana', jmdictFurigana],
    ['jmnedict-furigana', jmnedictFurigana],
  ] as const) {
    if (!path || !furiganaVersion) continue;
    const report = await importFurigana(AppDataSource, source, furiganaVersion, readJsonArray<FuriganaEntry>(path), {
      dryRun,
    });
    logger.info(report, `${source} ${dryRun ? 'dry run' : 'imported'}`);
  }

  // After JMdict, since a level only attaches to a word that exists.
  if (jlptFiles.length > 0 && jlptVersion) {
    const report = await importJlpt(AppDataSource, jlptFiles, jlptVersion, { dryRun });
    logger.info(
      { ...report, unknownIds: report.unknownIds.slice(0, 20), unknownCount: report.unknownIds.length },
      `jlpt ${dryRun ? 'dry run' : 'imported'}`,
    );
  }

  if (unidic && unidicVersion) {
    const report = await importPitch(AppDataSource, unidic, unidicVersion, { dryRun });
    logger.info(report, `unidic pitch ${dryRun ? 'dry run' : 'imported'}`);
  }

  if (kanjium && kanjiumVersion) {
    const report = await importKanjiumPitch(AppDataSource, kanjium, kanjiumVersion, { dryRun });
    logger.info(report, `kanjium pitch ${dryRun ? 'dry run' : 'imported'}`);
  }

  logger.info({ seconds: Math.round((Date.now() - startedAt) / 1000) }, 'dictionary import finished');
}

main()
  .then(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, 'dictionary import failed');
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exit(1);
  });
