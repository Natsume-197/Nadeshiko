import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import { easiestLevels, importJlpt, parseJlptCsv } from '@app/services/dictionary/import/importJlpt';

setupTestSuite();

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nadeshiko-jlpt-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const HEADER = 'jmdict_seq,kana,kanji,waller_definition';

describe('parseJlptCsv', () => {
  it('reads the JMdict id from each row and skips the header', () => {
    const csv = `${HEADER}\n1198180,あう,会う,to meet\n1381380,あお,青,blue\n`;

    expect(parseJlptCsv(csv)).toEqual({ ids: [1198180, 1381380], withoutId: 0, kanaOnly: [] });
  });

  it('is not thrown by quoted commas, and counts rows Waller listed with no JMdict id', () => {
    const csv = `${HEADER}\r\n1000000,あ,亜,"at, in, on"\r\n,い,依,depending on\r\n`;

    expect(parseJlptCsv(csv)).toEqual({ ids: [1000000], withoutId: 1, kanaOnly: [] });
  });

  it('collects the rows Waller wrote in hiragana only, not katakana loanwords', () => {
    const csv = `${HEADER}\n2216210,それ,,that\n1000000,カラー,,colour\n1198180,あう,会う,to meet\n`;

    expect(parseJlptCsv(csv).kanaOnly).toEqual(['それ']);
  });
});

describe('easiestLevels', () => {
  it('keeps the easiest level for a word listed at several', () => {
    const { levels, multiLevel } = easiestLevels([
      { level: 2, ids: [1593670, 1] },
      { level: 4, ids: [1593670] },
    ]);

    expect(levels.get(1593670)).toBe(4);
    expect(levels.get(1)).toBe(2);
    expect(multiLevel).toBe(1);
  });
});

describe('importJlpt', () => {
  async function seedWords(ids: number[]) {
    await TestDataSource.query(`INSERT INTO dict.word (id, source) SELECT unnest($1::int[]), 'jmdict'`, [ids]);
  }

  function files(byLevel: Record<number, number[]>) {
    return [1, 2, 3, 4, 5].map((level) => {
      const path = join(dir, `n${level}-${Math.random()}.csv`);
      const rows = (byLevel[level] ?? []).map((id) => `${id},か,漢,gloss`);
      writeFileSync(path, [HEADER, ...rows].join('\n'), 'utf8');
      return { level, path };
    });
  }

  it('gives each known word its level and reports the ids JMdict does not have', async () => {
    await seedWords([1198180, 1381380]);

    const report = await importJlpt(TestDataSource, files({ 5: [1198180], 3: [1381380, 9999999] }), 'abc123');

    expect(report).toMatchObject({ words: 2, unknownIds: [9999999], rows: 3 });
    expect(await TestDataSource.query(`SELECT word_id, level FROM dict.jlpt ORDER BY word_id`)).toEqual([
      { word_id: 1198180, level: 5 },
      { word_id: 1381380, level: 3 },
    ]);
    expect(await TestDataSource.query(`SELECT version FROM dict.source WHERE name = 'jlpt'`)).toEqual([
      { version: 'abc123' },
    ]);
  });

  it('gives the level of a hiragana-only row to the common word usually written in that kana', async () => {
    await seedWords([1006970, 2216210, 1590000]);
    await TestDataSource.query(
      `INSERT INTO dict.form (word_id, idx, text, kana, common) VALUES
         (1006970, 0, '其れ', false, false), (1006970, 1, 'それ', true, true),
         (2216210, 0, 'それ', true, false),
         (1590000, 0, '逸れ', false, true), (1590000, 1, 'それ', true, true)`,
    );
    await TestDataSource.query(
      `INSERT INTO dict.sense (word_id, idx, lang, misc, glosses) VALUES
         (1006970, 0, 'eng', '{uk}', '[]'), (2216210, 0, 'eng', '{}', '[]'), (1590000, 0, 'eng', '{}', '[]')`,
    );
    const csv = (level: number, rows: string[]) => {
      const path = join(dir, `n${level}-${Math.random()}.csv`);
      writeFileSync(path, [HEADER, ...rows].join('\n'), 'utf8');
      return { level, path };
    };

    const report = await importJlpt(
      TestDataSource,
      [csv(5, ['2216210,それ,,that']), csv(1, ['1006970,それ,其れ,it'])],
      'v1',
    );

    // 其れ (usually kana) takes N5; 逸れ, whose first sense is not uk, keeps none.
    expect(report.widenedByKana).toBe(1);
    expect(await TestDataSource.query(`SELECT word_id, level FROM dict.jlpt ORDER BY word_id`)).toEqual([
      { word_id: 1006970, level: 5 },
      { word_id: 2216210, level: 5 },
    ]);
  });

  it('replaces the previous levels', async () => {
    await seedWords([1, 2]);
    await importJlpt(TestDataSource, files({ 1: [1, 2] }), 'v1');

    await importJlpt(TestDataSource, files({ 2: [2] }), 'v2');

    expect(await TestDataSource.query(`SELECT word_id, level FROM dict.jlpt`)).toEqual([{ word_id: 2, level: 2 }]);
  });

  it('a dry run writes nothing', async () => {
    await seedWords([1]);

    const report = await importJlpt(TestDataSource, files({ 5: [1] }), 'v1', { dryRun: true });

    expect(report.words).toBe(1);
    expect(await TestDataSource.query(`SELECT count(*)::int AS n FROM dict.jlpt`)).toEqual([{ n: 0 }]);
  });
});
