import '@config/boot';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { importCollocations } from '@app/services/dictionary/collocations';
import { importJlpt } from '@app/services/dictionary/import/importJlpt';
import {
  importKanjiJlpt,
  importKanjiVg,
  importKanken,
  importRadicals,
} from '@app/services/dictionary/import/importKanji';
import { importKanjiumPitch } from '@app/services/dictionary/import/importPitch';
import { refreshDictionary } from '@app/services/dictionary/refresh';
import {
  DICTIONARY_PINNED_SOURCES,
  downloadToFile,
  extractKanjiVgZip,
  KANJIVG_REPO,
  latestGitHubRelease,
  selectKanjiVgAsset,
} from './lib/dictionarySources';
import { runWithDatabase } from './lib/runWithDatabase';

/**
 * Download and import all public open-source dictionary and kanji datasets into `dict.*` for local development.
 *
 *   npm run dictionary:setup --workspace backend
 *   node --env-file-if-exists=.env --import tsx bin/setupDictionary.ts [--force]
 *
 * Step 1 runs `refreshDictionary` (JMdict, JMnedict, JmdictFurigana, KANJIDIC2, KRADFILE).
 * Step 2 downloads and imports the supplementary sources (JLPT vocab, Kanjium pitch, KanjiVG strokes,
 * Kanji JLPT, radicals, Kanken, and Jiten noun-verb collocations).
 *
 * Safe to rerun: any source whose version is already recorded in `dict.source` is skipped unless `--force` is given.
 */

const { values: args } = parseArgs({
  options: {
    force: { type: 'boolean', default: false },
  },
});

async function storedVersions(): Promise<Map<string, string>> {
  const rows: Array<{ name: string; version: string }> = await AppDataSource.query(
    `SELECT name, version FROM dict.source`,
  );
  return new Map(rows.map((row) => [row.name, row.version]));
}

async function main(): Promise<void> {
  const force = args.force ?? false;
  await AppDataSource.initialize();

  const startedAt = Date.now();
  const dir = await mkdtemp(join(tmpdir(), 'nadeshiko-dict-setup-'));

  try {
    logger.info('Step 1/2: Refreshing core releases (JMdict, JMnedict, furigana, KANJIDIC2, KRADFILE)...');
    const coreOutcomes = await refreshDictionary(AppDataSource);
    for (const outcome of coreOutcomes) {
      logger.info({ source: outcome.source, tag: outcome.tag, result: outcome.result }, 'core dictionary source');
    }

    const stored = await storedVersions();
    const needsImport = (sourceName: string, version: string): boolean => force || stored.get(sourceName) !== version;

    logger.info(
      'Step 2/2: Importing supplementary sources (JLPT, Kanjium pitch, KanjiVG, radicals, Kanken, collocations)...',
    );

    // JLPT vocabulary (n1..n5)
    const { jlpt } = DICTIONARY_PINNED_SOURCES;
    if (needsImport(jlpt.sourceName, jlpt.version)) {
      const jlptDir = join(dir, 'jlpt');
      await mkdir(jlptDir, { recursive: true });
      const files = await Promise.all(
        jlpt.files.map(async (file) => {
          const dest = join(jlptDir, file.filename);
          await downloadToFile(file.url, dest);
          return { level: file.level, path: dest };
        }),
      );
      logger.info(await importJlpt(AppDataSource, files, jlpt.version), 'jlpt imported');
    } else {
      logger.info({ source: jlpt.sourceName, version: jlpt.version }, 'up to date');
    }

    // Kanjium pitch accents
    const { kanjium } = DICTIONARY_PINNED_SOURCES;
    if (needsImport(kanjium.sourceName, kanjium.version)) {
      const dest = join(dir, kanjium.filename);
      await downloadToFile(kanjium.url, dest);
      logger.info(await importKanjiumPitch(AppDataSource, dest, kanjium.version), 'kanjium pitch imported');
    } else {
      logger.info({ source: kanjium.sourceName, version: kanjium.version }, 'up to date');
    }

    // KanjiVG stroke order
    const kanjiVgRelease = await latestGitHubRelease(KANJIVG_REPO);
    if (needsImport('kanjivg', kanjiVgRelease.tag_name)) {
      const asset = selectKanjiVgAsset(kanjiVgRelease);
      const zipPath = join(dir, asset.name);
      const svgDir = join(dir, 'kanjivg');
      await downloadToFile(asset.browser_download_url, zipPath);
      const count = await extractKanjiVgZip(zipPath, svgDir);
      logger.info({ tag: kanjiVgRelease.tag_name, extractedSvgs: count }, 'extracted KanjiVG archive');
      logger.info(await importKanjiVg(AppDataSource, svgDir, kanjiVgRelease.tag_name), 'kanjivg imported');
      await rm(zipPath, { force: true });
      await rm(svgDir, { recursive: true, force: true });
    } else {
      logger.info({ source: 'kanjivg', version: kanjiVgRelease.tag_name }, 'up to date');
    }

    // Kanji JLPT
    const { kanjiJlpt } = DICTIONARY_PINNED_SOURCES;
    if (needsImport(kanjiJlpt.sourceName, kanjiJlpt.version)) {
      const dest = join(dir, kanjiJlpt.filename);
      await downloadToFile(kanjiJlpt.url, dest);
      logger.info(await importKanjiJlpt(AppDataSource, dest, kanjiJlpt.version), 'kanji-jlpt imported');
    } else {
      logger.info({ source: kanjiJlpt.sourceName, version: kanjiJlpt.version }, 'up to date');
    }

    // Kanji radicals
    const { radicals } = DICTIONARY_PINNED_SOURCES;
    if (needsImport(radicals.sourceName, radicals.version)) {
      const dest = join(dir, radicals.filename);
      await downloadToFile(radicals.url, dest);
      logger.info(await importRadicals(AppDataSource, dest, radicals.version), 'radicals imported');
    } else {
      logger.info({ source: radicals.sourceName, version: radicals.version }, 'up to date');
    }

    // Kanken levels
    const { kanken } = DICTIONARY_PINNED_SOURCES;
    if (needsImport(kanken.sourceName, kanken.version)) {
      const dest = join(dir, kanken.filename);
      await downloadToFile(kanken.url, dest);
      logger.info(await importKanken(AppDataSource, dest, kanken.version), 'kanken imported');
    } else {
      logger.info({ source: kanken.sourceName, version: kanken.version }, 'up to date');
    }

    // Noun-verb collocations
    const { collocations } = DICTIONARY_PINNED_SOURCES;
    if (needsImport(collocations.sourceName, collocations.version)) {
      const dest = join(dir, collocations.filename);
      await downloadToFile(collocations.url, dest);
      logger.info(await importCollocations(AppDataSource, dest, collocations.version), 'collocations imported');
    } else {
      logger.info({ source: collocations.sourceName, version: collocations.version }, 'up to date');
    }

    logger.info({ seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)) }, 'dictionary setup done');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

runWithDatabase('dictionary:setup', main);
