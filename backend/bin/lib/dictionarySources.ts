import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipReader } from '@app/services/dictionary/custom/zipReader';

/**
 * Upstream open-source dictionary and kanji files not covered by `refreshDictionary` (which already handles JMdict,
 * JMnedict, JmdictFurigana, KANJIDIC2, and KRADFILE from GitHub Releases).
 *
 * Commits match the production 3.0.0 imports so a local developer gets the same word cards, pitch accents (Kanjium),
 * JLPT/Kanken badges, stroke-order SVGs, radicals, and noun-verb collocations as staging and production.
 */

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

export const KANJIVG_REPO = 'KanjiVG/kanjivg';
export const KANJIVG_ASSET_PATTERN = /^kanjivg-.*-main\.zip$/;
/** Refuse anything bigger: `kanjivg-*-main.zip` is ~13 MB compressed. */
export const MAX_KANJIVG_ZIP_BYTES = 100 * 1024 * 1024;
/** Individual KanjiVG SVG files are ~2–20 KB; 256 KB caps any corrupt entry. */
const MAX_SVG_BYTES = 256 * 1024;

export const DICTIONARY_PINNED_SOURCES = {
  jlpt: {
    sourceName: 'jlpt',
    version: 'b062d4e38c4bdd0950ae1d4ec55f04b176182e03',
    files: [1, 2, 3, 4, 5].map((level) => ({
      level,
      filename: `n${level}.csv`,
      url: `https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/b062d4e38c4bdd0950ae1d4ec55f04b176182e03/original_data/n${level}.csv`,
    })),
  },
  kanjium: {
    sourceName: 'kanjium-pitch',
    version: '685d4d723d6d20bf9beb169103aeac188eb067ad',
    filename: 'accents.txt',
    url: 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/685d4d723d6d20bf9beb169103aeac188eb067ad/data/source_files/raw/accents.txt',
  },
  kanjiJlpt: {
    sourceName: 'kanji-jlpt',
    version: '00fd7079c3890f430759536f91aa5e854ec0ca4f',
    filename: 'kanji.json',
    url: 'https://raw.githubusercontent.com/davidluzgouveia/kanji-data/00fd7079c3890f430759536f91aa5e854ec0ca4f/kanji.json',
  },
  radicals: {
    sourceName: 'radicals',
    version: 'e1e24d39fc43e839948a8c7e99743b0994dedad5',
    filename: 'japanese-radicals.csv',
    url: 'https://raw.githubusercontent.com/kanjialive/kanji-data-media/e1e24d39fc43e839948a8c7e99743b0994dedad5/language-data/japanese-radicals.csv',
  },
  kanken: {
    sourceName: 'kanken',
    version: '0be3577f7939ec85d2b4e373a7a94262e7449e13',
    filename: 'kanken.csv',
    url: 'https://raw.githubusercontent.com/mimneko/kanji-data/0be3577f7939ec85d2b4e373a7a94262e7449e13/%E6%BC%A2%E6%A4%9C%E6%BC%A2%E5%AD%97%E8%BE%9E%E5%85%B8%E6%BC%A2%E5%AD%97.csv',
  },
  collocations: {
    sourceName: 'collocations',
    version: 'e09d6f7f',
    filename: 'noun_verb_collocations.tsv',
    url: 'https://raw.githubusercontent.com/Sirush/Jiten/e09d6f7f/Shared/resources/noun_verb_collocations.tsv',
  },
} as const;

const USER_AGENT = 'nadeshiko-dictionary-setup';

export function selectKanjiVgAsset(release: GitHubRelease): GitHubReleaseAsset {
  const asset = release.assets.find((candidate) => KANJIVG_ASSET_PATTERN.test(candidate.name));
  if (!asset) throw new Error(`${KANJIVG_REPO} ${release.tag_name} has no asset matching kanjivg-*-main.zip`);
  if (asset.size > MAX_KANJIVG_ZIP_BYTES) {
    throw new Error(`${asset.name} is ${asset.size} bytes (exceeds ${MAX_KANJIVG_ZIP_BYTES})`);
  }
  return asset;
}

export async function latestGitHubRelease(repo: string): Promise<GitHubRelease> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${repo}'s latest release`);
  return (await response.json()) as GitHubRelease;
}

export async function downloadToFile(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(destinationPath),
  );
}

/**
 * Extract only `kanji/*.svg` entries from a KanjiVG release archive into `outputDir`, flattening filenames safely so
 * `importKanjiVg(dataSource, outputDir, tag)` can read them directly. Uses the repo's pure-Node `ZipReader` so no
 * external `unzip` binary is required on Windows, macOS, or Linux.
 */
export async function extractKanjiVgZip(zipPath: string, outputDir: string): Promise<number> {
  await mkdir(outputDir, { recursive: true });
  const reader = await ZipReader.open(zipPath);
  let extracted = 0;

  try {
    for (const entry of reader.listEntries()) {
      if (entry.name.endsWith('/')) continue;
      if (!/(^|\/)kanji\/[^/]+\.svg$/i.test(entry.name)) continue;

      const safeName = basename(entry.name);
      if (!safeName || safeName === '.' || safeName === '..') continue;

      const svg = await reader.readEntryText(entry, MAX_SVG_BYTES);
      await writeFile(join(outputDir, safeName), svg, 'utf8');
      extracted += 1;
    }
  } finally {
    await reader.close();
  }

  return extracted;
}
