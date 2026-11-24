import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, test } from 'vitest';
import {
  DICTIONARY_PINNED_SOURCES,
  extractKanjiVgZip,
  MAX_KANJIVG_ZIP_BYTES,
  selectKanjiVgAsset,
} from '../../bin/lib/dictionarySources';

/** Build a minimal valid ZIP archive with DEFLATE-compressed entries for testing `extractKanjiVgZip`. */
function buildZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(rawBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // DEFLATE
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(rawBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); // DEFLATE
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(rawBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, nameBuf, compressed);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, buf) => sum + buf.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

describe('dictionarySources', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test('pins all five JLPT CSV levels under stephenmk/yomitan-jlpt-vocab', () => {
    expect(DICTIONARY_PINNED_SOURCES.jlpt.files.map((f) => f.level)).toEqual([1, 2, 3, 4, 5]);
    for (const file of DICTIONARY_PINNED_SOURCES.jlpt.files) {
      expect(file.url).toContain(`/original_data/n${file.level}.csv`);
    }
  });

  test('selectKanjiVgAsset picks the main zip and rejects missing or oversized assets', () => {
    const asset = selectKanjiVgAsset({
      tag_name: 'r20260714',
      assets: [
        { name: 'kanjivg-20260714-all.zip', browser_download_url: 'https://example.test/all.zip', size: 22_000_000 },
        { name: 'kanjivg-20260714-main.zip', browser_download_url: 'https://example.test/main.zip', size: 12_000_000 },
      ],
    });
    expect(asset.name).toBe('kanjivg-20260714-main.zip');

    expect(() =>
      selectKanjiVgAsset({
        tag_name: 'r20260714',
        assets: [{ name: 'kanjivg-20260714-all.zip', browser_download_url: 'https://example.test/all.zip', size: 10 }],
      }),
    ).toThrow(/kanjivg-\*-main\.zip/);

    expect(() =>
      selectKanjiVgAsset({
        tag_name: 'r20260714',
        assets: [
          {
            name: 'kanjivg-20260714-main.zip',
            browser_download_url: 'https://example.test/main.zip',
            size: MAX_KANJIVG_ZIP_BYTES + 1,
          },
        ],
      }),
    ).toThrow(/exceeds/);
  });

  test('extractKanjiVgZip extracts only kanji/*.svg files flat into outputDir', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'nadeshiko-kanjivg-test-'));
    const zipPath = join(tempDir, 'kanjivg-main.zip');
    const outDir = join(tempDir, 'out');

    writeFileSync(
      zipPath,
      buildZip([
        { name: 'kanji/098df.svg', content: '<svg id="shoku"/>' },
        { name: 'kanjivg-20260714/kanji/06c34.svg', content: '<svg id="mizu"/>' },
        { name: 'README.txt', content: 'ignore me' },
        { name: 'kanji/nested/04e00.svg', content: 'ignore nested' },
      ]),
    );

    const count = await extractKanjiVgZip(zipPath, outDir);
    expect(count).toBe(2);
    expect(readdirSync(outDir).sort()).toEqual(['06c34.svg', '098df.svg']);
    expect(readFileSync(join(outDir, '098df.svg'), 'utf8')).toBe('<svg id="shoku"/>');
    expect(readFileSync(join(outDir, '06c34.svg'), 'utf8')).toBe('<svg id="mizu"/>');
  });
});
