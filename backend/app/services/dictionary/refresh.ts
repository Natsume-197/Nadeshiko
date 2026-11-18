import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { JMdictDictionaryMetadata, JMdictWord, JMnedictWord } from '@scriptin/jmdict-simplified-types';
import type { DataSource } from 'typeorm';
import { logger } from '@config/log';
import { type DictionarySource, fromJmdict, fromJmnedict, type ImportEntry } from './import/entries';
import { importDictionary, importFurigana } from './import/importDictionary';
import { importKanjidic, importKradfile } from './import/importKanji';
import { type FuriganaEntry, readDictionary, readJsonArray } from './import/readers';
import { extractTgz } from './import/untar';

/**
 * The weekly refresh of `dict.*` from the latest upstream releases (task 40): jmdict-simplified (JMdict, JMnedict,
 * and for the kanji card of task 44 KANJIDIC2 and KRADFILE) and JmdictFurigana. KanjiVG is imported by hand
 * (`bin/importDictionary.ts --kanjivg`): it releases a few times a year, as a zip. A source whose release tag is already in `dict.source` is skipped, so a week with no release
 * costs two GitHub API calls. Files go to a temporary folder, are streamed in, and are deleted afterwards.
 */

interface Release {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

/** What to refresh: the stored source name, its upstream repository, and how to find its asset. */
const SOURCES = [
  { name: 'jmdict', repo: 'scriptin/jmdict-simplified', asset: /^jmdict-all-.*\.json\.tgz$/ },
  { name: 'jmnedict', repo: 'scriptin/jmdict-simplified', asset: /^jmnedict-all-.*\.json\.tgz$/ },
  { name: 'jmdict-furigana', repo: 'Doublevil/JmdictFurigana', asset: /^JmdictFurigana\.json\.tar\.gz$/ },
  { name: 'jmnedict-furigana', repo: 'Doublevil/JmdictFurigana', asset: /^JmnedictFurigana\.json\.tar\.gz$/ },
  { name: 'kanjidic2', repo: 'scriptin/jmdict-simplified', asset: /^kanjidic2-all-.*\.json\.tgz$/ },
  { name: 'kradfile', repo: 'scriptin/jmdict-simplified', asset: /^kradfile-.*\.json\.tgz$/ },
] as const;

type SourceName = (typeof SOURCES)[number]['name'];

/** Refuse anything bigger: the largest asset is ~25 MB compressed. */
const MAX_ASSET_BYTES = 200 * 1024 * 1024;

export interface RefreshOutcome {
  source: SourceName;
  tag: string;
  result: 'imported' | 'up to date';
  detail?: unknown;
}

async function latestRelease(repo: string): Promise<Release> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'nadeshiko-dictionary-refresh' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${repo}'s latest release`);
  return (await response.json()) as Release;
}

async function download(url: string, path: string): Promise<void> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'nadeshiko-dictionary-refresh' },
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(path));
}

async function storedVersions(dataSource: DataSource): Promise<Map<string, string>> {
  const rows: Array<{ name: string; version: string }> = await dataSource.query(
    `SELECT name, version FROM dict.source`,
  );
  return new Map(rows.map((row) => [row.name, row.version]));
}

async function* mapped<T>(source: AsyncIterable<T>, map: (entry: T) => ImportEntry): AsyncGenerator<ImportEntry> {
  for await (const entry of source) yield map(entry);
}

async function importFile(dataSource: DataSource, source: SourceName, path: string, tag: string): Promise<unknown> {
  if (source === 'jmdict-furigana' || source === 'jmnedict-furigana') {
    return importFurigana(dataSource, source, tag, readJsonArray<FuriganaEntry>(path));
  }
  if (source === 'kanjidic2') return importKanjidic(dataSource, path, { versionLabel: tag });
  if (source === 'kradfile') return importKradfile(dataSource, path, { versionLabel: tag });
  let metadata: JMdictDictionaryMetadata | null = null;
  const raw = readDictionary(source, path, (m) => {
    metadata = m;
  });
  const entries =
    source === 'jmdict'
      ? mapped(raw as AsyncIterable<JMdictWord>, fromJmdict)
      : mapped(raw as AsyncIterable<JMnedictWord>, fromJmnedict);
  return importDictionary(dataSource, source as DictionarySource, entries, () => metadata, { versionLabel: tag });
}

/** Refresh every source with a newer release. JMdict goes before JMnedict, so the names both carry stay JMdict's. */
export async function refreshDictionary(dataSource: DataSource): Promise<RefreshOutcome[]> {
  const stored = await storedVersions(dataSource);
  const releases = new Map<string, Release>();
  const outcomes: RefreshOutcome[] = [];
  const dir = await mkdtemp(join(tmpdir(), 'nadeshiko-dict-'));

  try {
    for (const source of SOURCES) {
      const release = releases.get(source.repo) ?? (await latestRelease(source.repo));
      releases.set(source.repo, release);

      if (stored.get(source.name) === release.tag_name) {
        outcomes.push({ source: source.name, tag: release.tag_name, result: 'up to date' });
        continue;
      }

      const asset = release.assets.find((candidate) => source.asset.test(candidate.name));
      if (!asset) throw new Error(`${source.repo} ${release.tag_name} has no asset for ${source.name}`);
      if (asset.size > MAX_ASSET_BYTES) throw new Error(`${asset.name} is ${asset.size} bytes; refusing`);

      const archive = join(dir, asset.name);
      await download(asset.browser_download_url, archive);
      const [file] = await extractTgz(archive, dir);
      if (!file) throw new Error(`${asset.name} held no file`);

      logger.info({ source: source.name, tag: release.tag_name }, 'Importing a new dictionary release');
      const detail = await importFile(dataSource, source.name, file, release.tag_name);
      outcomes.push({ source: source.name, tag: release.tag_name, result: 'imported', detail });

      await rm(archive, { force: true });
      await rm(file, { force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return outcomes;
}
