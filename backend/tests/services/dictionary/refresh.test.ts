import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import { extractTgz } from '@app/services/dictionary/import/untar';
import { refreshDictionary } from '@app/services/dictionary/refresh';

setupTestSuite();

/** A ustar archive, built by hand so the test needs no tar tool. */
function tar(entries: Array<{ name: string; body: string; type?: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const { name, body, type = '0' } of entries) {
    const data = Buffer.from(body, 'utf8');
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
    header.write('00000000000\0', 136, 'ascii');
    header.write('        ', 148, 'ascii');
    header.write(type, 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nadeshiko-refresh-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('extractTgz', () => {
  it('writes the regular files, skips metadata entries, and keeps names inside the folder', async () => {
    const archive = join(dir, 'a.tgz');
    const big = 'x'.repeat(1300);
    writeFileSync(
      archive,
      tar([
        { name: 'PaxHeader', body: '30 path=whatever\n', type: 'x' },
        { name: '../../escape/jmdict.json', body: big },
        { name: 'b.json', body: '[]' },
      ]),
    );

    const files = await extractTgz(archive, dir);

    expect(files).toEqual([join(dir, 'jmdict.json'), join(dir, 'b.json')]);
    expect(readFileSync(join(dir, 'jmdict.json'), 'utf8')).toBe(big);
    expect(readFileSync(join(dir, 'b.json'), 'utf8')).toBe('[]');
  });
});

describe('refreshDictionary', () => {
  const jmdict = JSON.stringify({
    version: '3.6.2',
    languages: ['all'],
    commonOnly: false,
    dictDate: '2026-11-09',
    dictRevisions: ['1.09'],
    tags: { n: 'noun' },
    words: [
      {
        id: '1381380',
        kanji: [{ common: true, text: '青', tags: [] }],
        kana: [{ common: true, text: 'あお', tags: [], appliesToKanji: ['*'] }],
        sense: [
          {
            partOfSpeech: ['n'],
            appliesToKanji: ['*'],
            appliesToKana: ['*'],
            related: [],
            antonym: [],
            field: [],
            dialect: [],
            misc: [],
            info: [],
            languageSource: [],
            gloss: [{ lang: 'eng', gender: null, type: null, text: 'blue' }],
          },
        ],
      },
    ],
  });
  const jmnedict = JSON.stringify({ ...JSON.parse(jmdict), words: [] });
  const furigana = JSON.stringify([{ text: '青', reading: 'あお', furigana: [{ ruby: '青', rt: 'あお' }] }]);

  const files: Record<string, Buffer> = {
    'jmdict-all-3.6.2+20261109.json.tgz': tar([{ name: 'jmdict-all-3.6.2.json', body: jmdict }]),
    'jmnedict-all-3.6.2+20261109.json.tgz': tar([{ name: 'jmnedict-all-3.6.2.json', body: jmnedict }]),
    'JmdictFurigana.json.tar.gz': tar([{ name: 'JmdictFurigana.json', body: `﻿${furigana}` }]),
    'JmnedictFurigana.json.tar.gz': tar([{ name: 'JmnedictFurigana.json', body: '[]' }]),
  };
  const release = (tag: string, names: string[]) => ({
    tag_name: tag,
    assets: names.map((name) => ({ name, browser_download_url: `https://dl/${name}`, size: files[name]!.length })),
  });

  function stubGitHub() {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('scriptin/jmdict-simplified/releases/latest')) {
        return Response.json(
          release('3.6.2+20261109', ['jmdict-all-3.6.2+20261109.json.tgz', 'jmnedict-all-3.6.2+20261109.json.tgz']),
        );
      }
      if (url.includes('Doublevil/JmdictFurigana/releases/latest')) {
        return Response.json(
          release('2.3.2+2026-11-25', ['JmdictFurigana.json.tar.gz', 'JmnedictFurigana.json.tar.gz']),
        );
      }
      const name = url.replace('https://dl/', '');
      const body = files[name];
      return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('downloads and imports every source with a new release', async () => {
    stubGitHub();

    const outcomes = await refreshDictionary(TestDataSource);

    expect(outcomes.map(({ source, result }) => [source, result])).toEqual([
      ['jmdict', 'imported'],
      ['jmnedict', 'imported'],
      ['jmdict-furigana', 'imported'],
      ['jmnedict-furigana', 'imported'],
    ]);
    expect(await TestDataSource.query(`SELECT name, version FROM dict.source ORDER BY name`)).toEqual([
      { name: 'jmdict', version: '3.6.2+20261109' },
      { name: 'jmdict-furigana', version: '2.3.2+2026-11-25' },
      { name: 'jmnedict', version: '3.6.2+20261109' },
      { name: 'jmnedict-furigana', version: '2.3.2+2026-11-25' },
    ]);
    expect(await TestDataSource.query(`SELECT text FROM dict.form WHERE word_id = 1381380 ORDER BY idx`)).toEqual([
      { text: '青' },
      { text: 'あお' },
    ]);
  });

  it('downloads nothing when every source is already at its latest release', async () => {
    const fetchMock = stubGitHub();
    await refreshDictionary(TestDataSource);
    fetchMock.mockClear();

    const outcomes = await refreshDictionary(TestDataSource);

    expect(outcomes.every((outcome) => outcome.result === 'up to date')).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url).filter((url) => String(url).startsWith('https://dl/'))).toEqual([]);
  });
});
