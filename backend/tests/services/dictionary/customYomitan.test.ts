import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { r2Client, r2ObjectKey, resolveArtifactsWithin } from '@app/services/dictionary/custom/r2Storage';
import {
  closeAllArtifactHandles,
  queryArtifactFrequencies,
  queryArtifactPitches,
  queryArtifactTerms,
} from '@app/services/dictionary/custom/sqlitePool';
import {
  detectDefinitionLang,
  normalizeGlossary,
  sanitizeStructuredContent,
  structuredContentToText,
} from '@app/services/dictionary/custom/structuredContent';
import { ImportThreadError, runYomitanImportInThread } from '@app/services/dictionary/custom/importRunner';
import {
  IMPORTER_VERSION,
  importYomitanZipToSqlite,
  inspectYomitanZip,
  parseYomitanIndexJson,
  YomitanValidationError,
} from '@app/services/dictionary/custom/yomitanImport';
import { ZipFormatError, ZipLimitError, ZipReader } from '@app/services/dictionary/custom/zipReader';
import { buildZip } from '../../fixtures/yomitanZip';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nadeshiko-yomitan-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  closeAllArtifactHandles();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('structuredContent sanitization & normalization', () => {
  it('sanitizes allowed tags/styles and strips scripts, unsafe CSS, and javascript links', () => {
    const clean = sanitizeStructuredContent([
      {
        tag: 'div',
        style: {
          fontWeight: 'bold',
          marginLeft: '0.5em',
          backgroundImage: 'url(https://evil.example/x.png)',
          fontSize: 'expression(alert(1))',
        },
        content: [
          { tag: 'script', content: 'alert(1)' },
          { tag: 'a', href: 'javascript:alert(1)', content: 'bad link' },
          { tag: 'a', href: 'https://example.com/word', content: 'good link' },
          { tag: 'ruby', content: ['食', { tag: 'rt', content: 'た' }] },
          'べる',
        ],
      },
    ]);

    expect(clean).toEqual({
      tag: 'div',
      style: { fontWeight: 'bold', marginLeft: '0.5em' },
      content: [
        { tag: 'a', content: 'bad link' },
        { tag: 'a', href: 'https://example.com/word', content: 'good link' },
        { tag: 'ruby', content: ['食', { tag: 'rt', content: 'た' }] },
        'べる',
      ],
    });
    expect(structuredContentToText(clean)).toBe('bad linkgood link食べる');
  });

  it('preserves short img titles (Meikyo icons) and drops bare images + empty wrappers', () => {
    const clean = sanitizeStructuredContent([
      { tag: 'span', content: { tag: 'img', path: 'icon.png' } },
      { tag: 'span', content: { tag: 'img', path: 'bungo.png', title: '文語形' } },
      'ざ・る',
    ]);
    expect(clean).toEqual([
      { tag: 'span', content: { tag: 'span', data: { content: 'img-title' }, content: '文語形' } },
      'ざ・る',
    ]);
    expect(structuredContentToText(clean)).toBe('文語形ざ・る');
  });

  it('normalizes plain, text-object, structured-content, and legacy tuple glossaries while skipping images', () => {
    const items = normalizeGlossary([
      'to eat',
      { type: 'text', text: 'to consume' },
      { type: 'image', path: 'pic.png' },
      ['食べる', ['v1']],
      { type: 'structured-content', content: [{ tag: 'p', content: '食物をかんで飲み込む。' }] },
    ]);

    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({ text: 'to eat' });
    expect(items[1]).toEqual({ text: 'to consume' });
    expect(items[2]).toEqual({ text: '食べる (v1)' });
    expect(items[3]?.text).toBe('食物をかんで飲み込む。');
    expect(items[3]?.structuredContent).toEqual({ tag: 'p', content: '食物をかんで飲み込む。' });
    expect(detectDefinitionLang(items[0]!.text)).toBe('en');
    expect(detectDefinitionLang(items[3]!.text)).toBe('ja');
  });
});

describe('ZipReader', () => {
  it('reads stored and deflated UTF-8 entries and rejects zip bombs', async () => {
    const dir = makeTempDir();
    const zipPath = join(dir, 'sample.zip');
    writeFileSync(
      zipPath,
      buildZip([
        { name: 'index.json', data: '{"title":"テスト","format":3,"revision":"1"}', deflate: false },
        { name: 'term_bank_1.json', data: 'a'.repeat(5000), deflate: true },
      ]),
    );

    const reader = await ZipReader.open(zipPath);
    try {
      expect(reader.listEntries()).toHaveLength(2);
      const indexText = await reader.readEntryText(reader.getEntry('index.json')!, 1024);
      expect(JSON.parse(indexText).title).toBe('テスト');

      await expect(reader.readEntryText(reader.getEntry('term_bank_1.json')!, 100)).rejects.toThrow(ZipLimitError);
    } finally {
      await reader.close();
    }
  });

  it('rejects non-ZIP files', async () => {
    const dir = makeTempDir();
    const badPath = join(dir, 'bad.zip');
    writeFileSync(badPath, 'not a zip archive at all');
    await expect(ZipReader.open(badPath)).rejects.toThrow(ZipFormatError);
  });
});

describe('yomitanImport + sqlitePool', () => {
  it('validates index.json format 3 and rejects unsupported versions', () => {
    expect(() => parseYomitanIndexJson('{"title":"Old","format":2,"revision":"1"}')).toThrow(YomitanValidationError);
    expect(() => parseYomitanIndexJson('{"format":3}')).toThrow(YomitanValidationError);
    const parsed = parseYomitanIndexJson(
      JSON.stringify({ title: '明鏡国語辞典', revision: '2.0', format: 3, frequencyMode: 'rank-based' }),
    );
    expect(parsed.title).toBe('明鏡国語辞典');
    expect(parsed.frequencyMode).toBe('rank-based');
  });

  it('imports terms, tags, frequency (all 4 shapes), and pitch into SQLite and answers lookups accurately', async () => {
    const dir = makeTempDir();
    const zipPath = join(dir, 'combined.zip');
    const sqlitePath = join(dir, 'combined.sqlite');

    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'index.json',
          data: JSON.stringify({
            title: 'テスト辞書',
            revision: '2026-11-19',
            format: 3,
            author: 'Tester',
            frequencyMode: 'rank-based',
          }),
          deflate: true,
        },
        {
          name: 'tag_bank_1.json',
          data: JSON.stringify([['v1', 'partOfSpeech', 0, 'Ichidan verb', 0]]),
          deflate: true,
        },
        {
          name: 'term_bank_1.json',
          data: JSON.stringify([
            [
              '食べる',
              'たべる',
              'v1',
              'v1',
              10,
              [{ type: 'structured-content', content: ['固形の食物をかんで飲み込む。'] }],
              1,
              '',
            ],
            ['開く', 'ひらく', 'v5k', 'v5k', 5, ['to open (hiraku)'], 2, ''],
            ['開く', 'あく', 'v5k', 'v5k', 5, ['to open (aku)'], 3, ''],
          ]),
          deflate: true,
        },
        {
          name: 'term_meta_bank_1.json',
          data: JSON.stringify([
            ['食べる', 'freq', 195],
            ['開く', 'freq', { reading: 'ひらく', frequency: { value: 420, displayValue: '#420' } }],
            ['開く', 'freq', { reading: 'あく', frequency: '880' }],
            ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 2, nasal: [], devoice: [] }] }],
            ['開く', 'pitch', { reading: 'ひらく', pitches: [{ position: 2 }] }],
            ['開く', 'pitch', { reading: 'あく', pitches: [{ position: 0 }] }],
          ]),
          deflate: true,
        },
        {
          // Bundled image that must be ignored without error.
          name: 'img/ignored.png',
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          deflate: false,
        },
      ]),
    );

    const inspected = await inspectYomitanZip(zipPath);
    expect(inspected.title).toBe('テスト辞書');

    const result = await importYomitanZipToSqlite(zipPath, sqlitePath);
    expect(result.hasTerms).toBe(true);
    expect(result.hasFrequency).toBe(true);
    expect(result.hasPitch).toBe(true);
    expect(result.termCount).toBe(3);
    expect(result.frequencyCount).toBe(3);
    expect(result.pitchCount).toBe(3);
    expect(result.sqliteBytes).toBeGreaterThan(0);

    const taberu = queryArtifactTerms(sqlitePath, '食べる', 'たべる', 'たべる');
    expect(taberu.rows).toHaveLength(1);
    expect(taberu.rows[0]?.glossary[0]?.text).toBe('固形の食物をかんで飲み込む。');
    expect(taberu.tags.get('v1')?.notes).toBe('Ichidan verb');

    // Reading disambiguation: 開く (ひらく) vs 開く (あく)
    const hiraku = queryArtifactTerms(sqlitePath, '開く', 'ひらく', 'ひらく');
    expect(hiraku.rows).toHaveLength(1);
    expect(hiraku.rows[0]?.glossary[0]?.text).toBe('to open (hiraku)');

    const hirakuFreq = queryArtifactFrequencies(sqlitePath, '開く', 'ひらく', 'ひらく');
    expect(hirakuFreq).toEqual([{ expression: '開く', reading: 'ひらく', value: 420, displayValue: '#420' }]);

    const akuPitch = queryArtifactPitches(sqlitePath, '開く', 'あく', 'あく');
    expect(akuPitch).toHaveLength(1);
    expect(akuPitch[0]?.pitches[0]?.position).toBe(0);
  });
});

describe('an unreadable dictionary file', () => {
  it('costs only its own dictionary: no rows, no throw, and the corrupt copy is removed', async () => {
    const dir = makeTempDir();
    const file = join(dir, 'broken.sqlite');
    // What a store that keeps `aws-chunked` framing hands back instead of the SQLite file.
    writeFileSync(file, Buffer.from('3\r\nabc\r\n0\r\nx-amz-checksum-crc32:AAAA\r\n'));

    expect(queryArtifactTerms(file, '猫', 'ねこ', 'ねこ').rows).toEqual([]);
    expect(queryArtifactPitches(file, '猫', 'ねこ', 'ねこ')).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(file)).toBe(false);
  });
});

describe('importRunner (import off the main thread)', () => {
  function writeSmallDictionary(dir: string): string {
    const zipPath = join(dir, 'small.zip');
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'index.json',
          data: JSON.stringify({ title: 'スレッド辞書', revision: '1', format: 3 }),
          deflate: true,
        },
        {
          name: 'term_bank_1.json',
          data: JSON.stringify([['猫', 'ねこ', 'n', '', 1, ['cat'], 1, '']]),
          deflate: true,
        },
      ]),
    );
    return zipPath;
  }

  it('builds the same SQLite file in a worker thread', async () => {
    const dir = makeTempDir();
    const zipPath = writeSmallDictionary(dir);
    const sqlitePath = join(dir, 'small.sqlite');

    const result = await runYomitanImportInThread(zipPath, sqlitePath);
    expect(result.index.title).toBe('スレッド辞書');
    expect(result.termCount).toBe(1);
    expect(queryArtifactTerms(sqlitePath, '猫', 'ねこ', 'ねこ').rows[0]?.glossary[0]?.text).toBe('cat');
  });

  it('passes the import error back from the thread', async () => {
    const dir = makeTempDir();
    const zipPath = join(dir, 'bad.zip');
    writeFileSync(zipPath, buildZip([{ name: 'index.json', data: JSON.stringify({ title: 'Old', format: 2 }) }]));

    await expect(runYomitanImportInThread(zipPath, join(dir, 'bad.sqlite'))).rejects.toMatchObject({
      name: 'YomitanValidationError',
      message: expect.stringContaining('only format 3'),
    });
  });

  it('stops an import that runs past its time limit', async () => {
    const dir = makeTempDir();
    const zipPath = writeSmallDictionary(dir);

    await expect(runYomitanImportInThread(zipPath, join(dir, 'slow.sqlite'), { timeoutMs: 1 })).rejects.toBeInstanceOf(
      ImportThreadError,
    );
  });

  it('records the importer version that built an artifact', () => {
    expect(Number.isInteger(IMPORTER_VERSION) && IMPORTER_VERSION > 0).toBe(true);
  });
});

describe('r2Storage', () => {
  it('builds normalized object keys and a path-style R2 client', async () => {
    expect(r2ObjectKey('abc123', '/user-dicts/prod/')).toBe('user-dicts/prod/abc123.sqlite');
    expect(r2ObjectKey('abc123', '')).toBe('abc123.sqlite');

    const r2 = {
      endpoint: 'https://account123.r2.cloudflarestorage.com',
      bucket: 'nadeshiko-production',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'SECRETEXAMPLE',
      prefix: 'user-dicts/prod',
    };
    const client = r2Client(r2);
    expect(client.config.forcePathStyle).toBe(true);
    expect(await client.config.region()).toBe('auto');
    expect((await client.config.endpoint!()).hostname).toBe('account123.r2.cloudflarestorage.com');
    // One client per credentials.
    expect(r2Client(r2)).toBe(client);
  });

  it('answers within the wait with what is cached, and reports the rest missing', async () => {
    // No R2 in tests: an artifact not on disk can never arrive, so it is reported missing rather than waited on.
    const { paths, missing } = await resolveArtifactsWithin(['not-cached-anywhere'], 50);
    expect(paths.size).toBe(0);
    expect(missing).toBe(1);
  });
});
