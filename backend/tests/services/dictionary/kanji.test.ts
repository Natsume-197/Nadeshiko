import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import { isSingleCharacter, KANJI_WORDS, kanjiCard } from '@app/services/dictionary/kanji';

setupTestSuite();

interface SeedWord {
  id: number;
  forms: Array<{ text: string; kana?: boolean; common?: boolean; appliesToKanji?: string[] }>;
  en?: string[];
  es?: string[];
  rank?: number;
}

async function seedWord({ id, forms, en = [], es = [], rank }: SeedWord) {
  await TestDataSource.query(`INSERT INTO dict.word (id, source) VALUES ($1, 'jmdict')`, [id]);
  for (const [idx, form] of forms.entries()) {
    await TestDataSource.query(
      `INSERT INTO dict.form (word_id, idx, text, kana, common, applies_to_kanji) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, idx, form.text, form.kana ?? false, form.common ?? false, form.appliesToKanji ?? []],
    );
  }
  for (const [lang, glosses] of [
    ['eng', en],
    ['spa', es],
  ] as const) {
    if (glosses.length === 0) continue;
    await TestDataSource.query(`INSERT INTO dict.sense (word_id, idx, lang, glosses) VALUES ($1, $2, $3, $4)`, [
      id,
      lang === 'eng' ? 0 : 1,
      lang,
      JSON.stringify(glosses.map((text) => ({ text, type: null }))),
    ]);
  }
  if (rank !== undefined) {
    await TestDataSource.query(`INSERT INTO dict.frequency (word_id, count, per_million, rank) VALUES ($1, 1, 1, $2)`, [
      id,
      rank,
    ]);
  }
}

beforeEach(async () => {
  await TestDataSource.query(
    `INSERT INTO dict.kanji (character, stroke_count, grade, frequency, on_readings, kun_readings, meanings_en, meanings_es)
     VALUES ('本', 5, 1, 10, '{ホン}', '{もと}', '{book,origin}', '{libro}'),
            ('木', 4, 1, 317, '{ボク,モク}', '{き}', '{tree,wood}', '{}')`,
  );
  await TestDataSource.query(`INSERT INTO dict.kanji_component (character, components) VALUES ('本', '{一,木,本}')`);
  await TestDataSource.query(`INSERT INTO dict.kanji_strokes (character, paths) VALUES ('本', ARRAY['M1,1', 'M2,2'])`);
});

describe('kanjiCard', () => {
  it('answers readings, meanings, parts and strokes', async () => {
    const card = await kanjiCard(TestDataSource, '本', 'en');

    expect(card).toMatchObject({
      character: '本',
      strokeCount: 5,
      grade: 1,
      frequency: 10,
      onReadings: ['ホン'],
      kunReadings: ['もと'],
      meanings: ['book', 'origin'],
      meaningsLanguage: 'en',
      // 一 has no card of its own here; the kanji itself is never listed as its own part.
      components: [
        { character: '一', hasCard: false },
        { character: '木', hasCard: true },
      ],
      strokes: ['M1,1', 'M2,2'],
    });
  });

  it('gives the Spanish meanings when there are some, and English otherwise', async () => {
    expect(await kanjiCard(TestDataSource, '本', 'es')).toMatchObject({ meanings: ['libro'], meaningsLanguage: 'es' });
    expect(await kanjiCard(TestDataSource, '木', 'es')).toMatchObject({
      meanings: ['tree', 'wood'],
      meaningsLanguage: 'en',
      strokes: [],
      components: [],
    });
  });

  it('lists the words written with it that our corpus uses most, with a reading and a gloss', async () => {
    await seedWord({
      id: 1522150,
      forms: [
        { text: '本当', common: true },
        { text: 'ほんとう', kana: true },
      ],
      en: ['truth', 'reality', 'actuality', 'fact'],
      es: ['verdad'],
      rank: 120,
    });
    await seedWord({ id: 1583070, forms: [{ text: '日本' }, { text: 'にほん', kana: true }], en: ['Japan'], rank: 40 });
    // Not counted in our corpus: not listed.
    await seedWord({ id: 1000001, forms: [{ text: '本棚' }, { text: 'ほんだな', kana: true }], en: ['bookshelf'] });
    // Counted, but not written with 本.
    await seedWord({ id: 1000002, forms: [{ text: '木' }, { text: 'き', kana: true }], en: ['tree'], rank: 5 });

    const card = await kanjiCard(TestDataSource, '本', 'es');

    expect(card?.words).toEqual([
      { id: 'jmdict:1583070', headword: '日本', reading: 'にほん', frequency: 40, gloss: 'Japan' },
      { id: 'jmdict:1522150', headword: '本当', reading: 'ほんとう', frequency: 120, gloss: 'verdad' },
    ]);
  });

  it('reads a spelling with the kana form that applies to it', async () => {
    await seedWord({
      id: 1000003,
      forms: [
        { text: '本気' },
        { text: 'ほんぎ', kana: true, appliesToKanji: ['本儀'] },
        { text: 'ほんき', kana: true, appliesToKanji: ['本気'] },
      ],
      en: ['seriousness', 'earnestness', 'truth', 'sanctity'],
      rank: 300,
    });

    const card = await kanjiCard(TestDataSource, '本', 'en');

    expect(card?.words).toEqual([
      {
        id: 'jmdict:1000003',
        headword: '本気',
        reading: 'ほんき',
        frequency: 300,
        gloss: 'seriousness; earnestness; truth',
      },
    ]);
  });

  it(`lists at most ${KANJI_WORDS} words`, async () => {
    for (let i = 0; i < KANJI_WORDS + 2; i += 1) {
      await seedWord({ id: 2000000 + i, forms: [{ text: `本${i}` }], en: ['x'], rank: i + 1 });
    }

    expect((await kanjiCard(TestDataSource, '本', 'en'))?.words).toHaveLength(KANJI_WORDS);
  });

  it('answers null for a kanji it does not have', async () => {
    expect(await kanjiCard(TestDataSource, '鬱', 'en')).toBeNull();
  });
});

describe('isSingleCharacter', () => {
  it('counts code points, so a kanji outside the BMP is one character', () => {
    expect(isSingleCharacter('本')).toBe(true);
    expect(isSingleCharacter('𠮟')).toBe(true);
    expect(isSingleCharacter('本当')).toBe(false);
    expect(isSingleCharacter('')).toBe(false);
  });
});
