import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import {
  importKanjiumPitch,
  importPitch,
  kanjiumPitchOf,
  pitchOf,
  readFeatures,
  splitFeature,
} from '@app/services/dictionary/import/importPitch';

setupTestSuite();

/** A UniDic feature line: 29 fields, with the ones we read set. */
function feature(opts: { pos?: string; pos2?: string; form?: string; reading: string; text: string; accent: string }) {
  const fields = Array.from({ length: 29 }, () => '*');
  fields[0] = opts.pos ?? '名詞';
  fields[1] = opts.pos2 ?? '普通名詞';
  fields[5] = opts.form ?? '*';
  fields[6] = opts.reading;
  fields[7] = opts.text;
  fields[8] = opts.text;
  fields[24] = opts.accent.includes(',') ? `"${opts.accent}"` : opts.accent;
  return fields.join(',');
}

/** A MeCab sys.dic with empty double-array and token tables: only the header and the feature table matter here. */
function sysDic(lines: string[]): Buffer {
  const features = Buffer.from(`${lines.join('\0')}\0`, 'utf8');
  const doubleArray = Buffer.alloc(16);
  const tokens = Buffer.alloc(8);
  const header = Buffer.alloc(72);
  const size = 72 + doubleArray.length + tokens.length + features.length;
  header.writeUInt32LE((size ^ 0xef718f77) >>> 0, 0);
  header.writeUInt32LE(102, 4);
  header.writeUInt32LE(doubleArray.length, 24);
  header.writeUInt32LE(tokens.length, 28);
  header.writeUInt32LE(features.length, 32);
  header.write('UTF-8', 40, 'ascii');
  return Buffer.concat([header, doubleArray, tokens, features]);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nadeshiko-unidic-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('splitFeature', () => {
  it('keeps a quoted field with a comma in it whole', () => {
    expect(splitFeature('副詞,*,"1,0",x')).toEqual(['副詞', '*', '1,0', 'x']);
    expect(splitFeature('補助記号,読点,*,"，",","')).toEqual(['補助記号', '読点', '*', '，', ',']);
  });
});

describe('pitchOf', () => {
  it("keys a spelling by its own reading, not its lexeme's (いい under いい, not よい)", () => {
    const fields = splitFeature(
      feature({ pos: '形容詞', form: '終止形-一般', reading: 'ヨイ', text: 'いい', accent: '1' }),
    );
    fields[20] = 'イイ';
    expect(pitchOf(fields)).toEqual({ text: 'いい', reading: 'いい', downsteps: [1], proper: false });
  });

  it('reads the spelling, the reading in hiragana and every accepted accent', () => {
    const fields = splitFeature(feature({ reading: 'アア', text: 'ああ', accent: '1,0', pos: '副詞' }));

    expect(pitchOf(fields)).toEqual({ text: 'ああ', reading: 'ああ', downsteps: [1, 0], proper: false });
  });

  it('takes a verb only in its dictionary form', () => {
    const base = { pos: '動詞', reading: 'タベル', text: '食べる', accent: '2' };

    expect(pitchOf(splitFeature(feature({ ...base, form: '終止形-一般' })))?.downsteps).toEqual([2]);
    expect(pitchOf(splitFeature(feature({ ...base, form: '連用形-一般' })))).toBeNull();
  });

  it('skips symbols and entries with no accent', () => {
    expect(pitchOf(splitFeature(feature({ pos: '補助記号', reading: '*', text: '。', accent: '*' })))).toBeNull();
    expect(pitchOf(splitFeature(feature({ reading: 'ウ', text: '雨', accent: '*' })))).toBeNull();
  });
});

describe('importPitch', () => {
  it('reads a MeCab dictionary and keeps proper nouns only where no ordinary word has the pair', async () => {
    const path = join(dir, 'sys.dic');
    writeFileSync(
      path,
      sysDic([
        feature({ reading: 'ハシ', text: '橋', accent: '2' }),
        feature({ reading: 'ハシ', text: '橋', accent: '1', pos2: '固有名詞' }),
        feature({ reading: 'タナカ', text: '田中', accent: '0', pos2: '固有名詞' }),
        feature({ reading: 'アメ', text: '雨', accent: '1' }),
      ]),
    );

    expect(await collect(readFeatures(path))).toHaveLength(4);
    const report = await importPitch(TestDataSource, path, '202512');

    expect(report).toMatchObject({ lines: 4, pairs: 3 });
    const rows: Array<{ text: string }> = await TestDataSource.query(`SELECT text, reading, downsteps FROM dict.pitch`);
    const byText = (a: { text: string }, b: { text: string }) => (a.text < b.text ? -1 : 1);
    expect(rows.sort(byText)).toEqual(
      [
        { text: '田中', reading: 'たなか', downsteps: [0] },
        { text: '橋', reading: 'はし', downsteps: [2] },
        { text: '雨', reading: 'あめ', downsteps: [1] },
      ].sort(byText),
    );
  });

  it('refuses a file that is not a MeCab dictionary', async () => {
    const path = join(dir, 'nope.dic');
    writeFileSync(path, Buffer.alloc(200));

    await expect(importPitch(TestDataSource, path, 'x')).rejects.toThrow(/not a MeCab dictionary/);
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe('kanjiumPitchOf', () => {
  it('reads spelling, reading and accents, dropping part-of-speech labels', () => {
    expect(kanjiumPitchOf('心臓麻痺\tしんぞうまひ\t5')).toEqual({
      text: '心臓麻痺',
      reading: 'しんぞうまひ',
      downsteps: [5],
    });
    expect(kanjiumPitchOf('２つ\tふたつ\t(副)0,(名)3')).toEqual({ text: '２つ', reading: 'ふたつ', downsteps: [0, 3] });
  });

  it('takes a kana spelling as its own reading, and skips a line with no accent', () => {
    expect(kanjiumPitchOf('ああ\t\t0')).toEqual({ text: 'ああ', reading: 'ああ', downsteps: [0] });
    expect(kanjiumPitchOf('何\tなに\t')).toBeNull();
  });
});

describe('importKanjiumPitch', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kanjium-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('replaces only its own rows, next to UniDic’s', async () => {
    await TestDataSource.query(
      `INSERT INTO dict.pitch (text, reading, downsteps, source) VALUES ('橋', 'はし', '{2}', 'unidic')`,
    );
    const path = join(dir, 'accents.txt');
    writeFileSync(path, ['橋\tはし\t2', '心臓麻痺\tしんぞうまひ\t5', ''].join('\n'));

    await importKanjiumPitch(TestDataSource, path, 'abc');
    writeFileSync(path, '心臓麻痺\tしんぞうまひ\t5\n');
    const report = await importKanjiumPitch(TestDataSource, path, 'def');

    expect(report).toMatchObject({ lines: 1, pairs: 1 });
    expect(await TestDataSource.query(`SELECT text, source FROM dict.pitch ORDER BY source, text`)).toEqual([
      { text: '心臓麻痺', source: 'kanjium' },
      { text: '橋', source: 'unidic' },
    ]);
  });
});
