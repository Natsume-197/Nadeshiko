import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JMdictDictionaryMetadata } from '@scriptin/jmdict-simplified-types';
import { readDictionary, readJsonArray } from '@app/services/dictionary/import/readers';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nadeshiko-dict-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents, 'utf8');
  return path;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

const FURIGANA = [
  { text: '食べる', reading: 'たべる', furigana: [{ ruby: '食', rt: 'た' }, { ruby: 'べる' }] },
  // Braces, brackets, quotes and escapes inside strings must not be read as structure.
  { text: '「{a}」', reading: 'x"[y]\\', furigana: [{ ruby: '「{a}」' }] },
  { text: '大人', reading: 'おとな', furigana: [{ ruby: '大人', rt: 'おとな' }] },
];

describe('readJsonArray', () => {
  it('reads every object of a JmdictFurigana-style file, BOM included', async () => {
    const path = file('furigana.json', `﻿${JSON.stringify(FURIGANA)}`);

    expect(await collect(readJsonArray(path))).toEqual(FURIGANA);
  });

  it.each([[1], [3], [7]])('reads the same objects when they straddle %i-byte chunks', async (chunkSize) => {
    const path = file(`furigana-${chunkSize}.json`, `﻿${JSON.stringify(FURIGANA, null, 2)}`);

    expect(await collect(readJsonArray(path, { chunkSize }))).toEqual(FURIGANA);
  });

  it('refuses a file cut off mid-object', async () => {
    const path = file('cut.json', JSON.stringify(FURIGANA).slice(0, 40));

    await expect(collect(readJsonArray(path))).rejects.toThrow(/middle of a JSON value/);
  });
});

describe('readDictionary', () => {
  it('reports the metadata and then yields every entry', async () => {
    const words = Array.from({ length: 2_500 }, (_, i) => ({
      id: String(1_000_000 + i),
      kanji: [],
      kana: [{ common: false, text: `か${i}`, tags: [], appliesToKanji: ['*'] }],
      sense: [],
    }));
    const path = file(
      'jmdict.json',
      JSON.stringify({
        version: '3.6.2',
        languages: ['all'],
        commonOnly: false,
        dictDate: '2026-11-02',
        dictRevisions: ['1.09'],
        tags: { v1: 'Ichidan verb' },
        words,
      }),
    );
    let metadata: JMdictDictionaryMetadata | null = null;

    // More entries than the high-water mark, so the parser has to pause and resume.
    const read = await collect(
      readDictionary('jmdict', path, (m) => {
        metadata = m;
      }),
    );

    expect(read.map((word) => word.id)).toEqual(words.map((word) => word.id));
    expect(metadata).toMatchObject({ version: '3.6.2', dictDate: '2026-11-02', tags: { v1: 'Ichidan verb' } });
  });
});
