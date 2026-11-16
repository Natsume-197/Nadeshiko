import { describe, it, expect } from 'vitest';
import type { JMdictDictionaryMetadata } from '@scriptin/jmdict-simplified-types';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import type { FormInput, ImportEntry, SenseInput } from '@app/services/dictionary/import/entries';
import { importDictionary, importFurigana } from '@app/services/dictionary/import/importDictionary';

setupTestSuite();

const META: JMdictDictionaryMetadata = {
  version: '3.6.2',
  languages: ['all'],
  commonOnly: false,
  dictDate: '2026-11-02',
  dictRevisions: ['1.09'],
  tags: { v1: 'Ichidan verb' },
};

const kanji = (text: string): FormInput => ({ text, kana: false, common: true, tags: [], appliesToKanji: [] });
const kana = (text: string): FormInput => ({ text, kana: true, common: true, tags: [], appliesToKanji: ['*'] });
const sense = (lang: 'eng' | 'spa', text: string): SenseInput => ({
  lang,
  pos: ['v1'],
  misc: [],
  field: [],
  dialect: [],
  info: [],
  appliesToKanji: ['*'],
  appliesToKana: ['*'],
  related: [],
  antonym: [],
  glosses: [{ text, type: null }],
});
const word = (id: number, forms: FormInput[], senses: SenseInput[] = [sense('eng', `word ${id}`)]): ImportEntry => ({
  id,
  source: 'jmdict',
  common: true,
  forms,
  senses,
});

async function* iterate<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}

const run = (entries: ImportEntry[], options: { dryRun?: boolean } = {}) =>
  importDictionary(TestDataSource, 'jmdict', iterate(entries), () => META, { batchSize: 3, ...options });

const query = <T>(sql: string, params: unknown[] = []) => TestDataSource.query(sql, params) as Promise<T[]>;

/** Filler entries so a test can drop one word without tripping the truncated-file guard. */
const filler = Array.from({ length: 10 }, (_, i) => word(2_000_000 + i, [kana(`ふぃら${i}`)]));

describe('importDictionary', () => {
  it('writes words, forms, senses, lookups and the source version', async () => {
    const report = await run([
      word(1358280, [kanji('食べる'), kana('たべる')], [sense('eng', 'to eat'), sense('spa', 'comer')]),
    ]);

    expect(report).toMatchObject({ entries: 1, wordsAdded: 1, formsAdded: 2, senses: 2, version: '3.6.2' });
    expect(await query(`SELECT idx, text, kana, active FROM dict.form WHERE word_id = 1358280 ORDER BY idx`)).toEqual([
      { idx: 0, text: '食べる', kana: false, active: true },
      { idx: 1, text: 'たべる', kana: true, active: true },
    ]);
    expect(await query(`SELECT lang, glosses FROM dict.sense WHERE word_id = 1358280 ORDER BY idx`)).toEqual([
      { lang: 'eng', glosses: [{ text: 'to eat', type: null }] },
      { lang: 'spa', glosses: [{ text: 'comer', type: null }] },
    ]);
    expect(await query(`SELECT version, tags FROM dict.source WHERE name = 'jmdict'`)).toEqual([
      { version: '3.6.2', tags: { v1: 'Ichidan verb' } },
    ]);
  });

  it('finds a katakana spelling under its hiragana too', async () => {
    await run([word(1080510, [kana('カメラ')])]);

    const found = await query<{ key: string }>(`SELECT key FROM dict.lookup WHERE word_id = 1080510`);
    expect(found.map((row) => row.key).sort()).toEqual(['かめら', 'カメラ']);
  });

  it('keeps form indexes across a reimport, and a dropped spelling stays findable', async () => {
    await run([word(1358280, [kanji('喰べる'), kanji('食べる'), kana('たべる')])]);

    const report = await run([word(1358280, [kana('たべる'), kanji('食べる'), kanji('食る')])]);

    expect(report).toMatchObject({ formsAdded: 1, formsDeactivated: 1 });
    expect(await query(`SELECT idx, text, active FROM dict.form WHERE word_id = 1358280 ORDER BY idx`)).toEqual([
      { idx: 0, text: '喰べる', active: false },
      { idx: 1, text: '食べる', active: true },
      { idx: 2, text: 'たべる', active: true },
      { idx: 3, text: '食る', active: true },
    ]);
    expect(await query(`SELECT form_idx FROM dict.lookup WHERE key = '喰べる'`)).toEqual([{ form_idx: 0 }]);
  });

  it('replaces senses rather than appending to them', async () => {
    await run([word(1, [kana('あ')], [sense('eng', 'old'), sense('eng', 'older')])]);

    await run([word(1, [kana('あ')], [sense('eng', 'new')])]);

    expect(await query(`SELECT idx, glosses FROM dict.sense WHERE word_id = 1`)).toEqual([
      { idx: 0, glosses: [{ text: 'new', type: null }] },
    ]);
  });

  it('flags a word upstream dropped as inactive, without deleting it', async () => {
    await run([...filler, word(1, [kana('あ')])]);

    const report = await run(filler);

    expect(report.wordsDeactivated).toBe(1);
    expect(await query(`SELECT active FROM dict.word WHERE id = 1`)).toEqual([{ active: false }]);
    expect(await query(`SELECT active FROM dict.form WHERE word_id = 1`)).toEqual([{ active: false }]);
    expect(await query(`SELECT count(*)::int AS n FROM dict.sense WHERE word_id = 1`)).toEqual([{ n: 1 }]);
  });

  it('brings a dropped word back when upstream restores it', async () => {
    await run([...filler, word(1, [kana('あ')])]);
    await run(filler);

    const report = await run([...filler, word(1, [kana('あ')])]);

    expect(report).toMatchObject({ wordsReactivated: 1, formsReactivated: 1 });
    expect(await query(`SELECT active FROM dict.word WHERE id = 1`)).toEqual([{ active: true }]);
  });

  it('deactivates nothing when the file looks truncated', async () => {
    await run(filler);

    const report = await run(filler.slice(0, 2));

    expect(report.wordsDeactivated).toBe(0);
    expect(report.deactivationSkipped).toMatch(/2 entries for 10 active words/);
    expect(await query(`SELECT count(*)::int AS n FROM dict.word WHERE active`)).toEqual([{ n: 10 }]);
  });

  describe('a name that is in both JMdict and JMnedict under the same ent_seq', () => {
    const asName = (entry: ImportEntry): ImportEntry => ({
      ...entry,
      source: 'jmnedict',
      common: false,
      senses: [sense('eng', 'from JMnedict')],
    });
    const names = (entries: ImportEntry[]) =>
      importDictionary(TestDataSource, 'jmnedict', iterate(entries), () => META, { batchSize: 3 });
    const channel = word(
      5000011,
      [kanji('２ちゃんねる'), kana('にちゃんねる')],
      [sense('eng', '2channel (online forum)')],
    );

    it('keeps the JMdict copy', async () => {
      await run([channel]);

      const report = await names([asName(channel), asName(word(5000000, [kana('ちゅせん')]))]);

      expect(report).toMatchObject({ skippedOwnedByJmdict: 1, wordsAdded: 1 });
      expect(await query(`SELECT source FROM dict.word WHERE id = 5000011`)).toEqual([{ source: 'jmdict' }]);
      expect(await query(`SELECT glosses FROM dict.sense WHERE word_id = 5000011`)).toEqual([
        { glosses: [{ text: '2channel (online forum)', type: null }] },
      ]);
    });

    it('lets JMnedict take it over once JMdict drops it', async () => {
      await run([...filler, channel]);
      await run(filler);

      const report = await names([asName(channel)]);

      expect(report.skippedOwnedByJmdict).toBe(0);
      expect(await query(`SELECT source, active FROM dict.word WHERE id = 5000011`)).toEqual([
        { source: 'jmnedict', active: true },
      ]);
    });
  });

  it('a dry run reports the changes and writes nothing', async () => {
    const report = await run([word(1358280, [kanji('食べる')])], { dryRun: true });

    expect(report).toMatchObject({ dryRun: true, wordsAdded: 1, formsAdded: 1 });
    expect(await query(`SELECT count(*)::int AS n FROM dict.word`)).toEqual([{ n: 0 }]);
    expect(await query(`SELECT count(*)::int AS n FROM dict.source`)).toEqual([{ n: 0 }]);
  });
});

describe('importFurigana', () => {
  const entries = [
    { text: '食べる', reading: 'たべる', furigana: [{ ruby: '食', rt: 'た' }, { ruby: 'べる' }] },
    { text: '大人', reading: 'おとな', furigana: [{ ruby: '大人', rt: 'おとな' }] },
  ];

  it('stores ruby in the word card’s shape', async () => {
    const report = await importFurigana(TestDataSource, 'jmdict-furigana', '2.3.1', iterate(entries));

    expect(report.rows).toBe(2);
    expect(await query(`SELECT segments FROM dict.furigana WHERE text = '食べる'`)).toEqual([
      { segments: [{ text: '食', ruby: 'た' }, { text: 'べる' }] },
    ]);
  });

  it('replaces only its own source', async () => {
    await importFurigana(TestDataSource, 'jmdict-furigana', '2.3.1', iterate(entries));
    await importFurigana(TestDataSource, 'jmnedict-furigana', '2.3.1', iterate([entries[1]!]));

    await importFurigana(TestDataSource, 'jmdict-furigana', '2.3.2', iterate([entries[0]!]));

    const rows = await query<{ text: string; source: string }>(`SELECT text, source FROM dict.furigana`);
    expect(rows.map((row) => `${row.source}:${row.text}`).sort()).toEqual([
      'jmdict-furigana:食べる',
      'jmnedict-furigana:大人',
    ]);
  });
});
