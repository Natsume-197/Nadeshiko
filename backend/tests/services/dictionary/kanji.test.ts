import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import {
  isSingleCharacter,
  KANJI_WORDS,
  kanjiCard,
  RELATED_KANJI,
  readingForms,
  readingInWord,
  readingKey,
} from '@app/services/dictionary/kanji';

setupTestSuite();

interface SeedWord {
  id: number;
  forms: Array<{ text: string; kana?: boolean; common?: boolean; appliesToKanji?: string[] }>;
  en?: string[];
  es?: string[];
  rank?: number;
  /** Furigana for the first written form and the first kana form, as JmdictFurigana splits them. */
  furigana?: Array<{ text: string; ruby?: string }>;
}

async function seedWord({ id, forms, en = [], es = [], rank, furigana }: SeedWord) {
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
  const written = forms.find((form) => !form.kana)?.text;
  const reading = forms.find((form) => form.kana)?.text;
  if (furigana && written && reading) {
    await TestDataSource.query(
      `INSERT INTO dict.furigana (text, reading, source, segments) VALUES ($1, $2, 'jmdict-furigana', $3)`,
      [written, reading, JSON.stringify(furigana)],
    );
  }
}

beforeEach(async () => {
  await TestDataSource.query(
    `INSERT INTO dict.kanji (character, stroke_count, grade, frequency, radical, on_readings, kun_readings, meanings_en,
                             meanings_es)
     VALUES ('食', 9, 2, 328, 184, '{ショク,ジキ}', '{く.う,た.べる}', '{eat,food}', '{comer}'),
            ('良', 7, 4, 501, 138, '{リョウ}', '{よ.い}', '{good}', '{bueno}'),
            ('飯', 12, 4, 1046, 184, '{ハン}', '{めし}', '{meal}', '{}'),
            ('館', 16, 3, 613, 184, '{カン}', '{}', '{building}', '{}'),
            ('蝕', 15, NULL, NULL, 142, '{ショク}', '{むしば.む}', '{eclipse}', '{}')`,
  );
  await TestDataSource.query(
    `INSERT INTO dict.kanji_component (character, components)
     VALUES ('食', '{𠆢,良,食}'), ('飯', '{食,又,厂}'), ('蝕', '{食,虫}')`,
  );
  await TestDataSource.query(
    `INSERT INTO dict.kanji_strokes (character, paths, numbers) VALUES ('食', ARRAY['M1,1', 'M2,2'], '[[1,2],[3,4]]')`,
  );
  await TestDataSource.query(`INSERT INTO dict.kanji_jlpt (character, level) VALUES ('食', 5)`);
  await TestDataSource.query(`INSERT INTO dict.kanji_kanken (character, level) VALUES ('食', '9級')`);
  await TestDataSource.query(
    `INSERT INTO dict.radical (glyph, number, variant_of, reading, meaning)
     VALUES ('⾷', 184, NULL, 'しょく', 'food, to eat'), ('⻟', 184, '⾷', 'しょくへん', 'food, to eat'),
            ('𠆢', 9, '⼈', 'ひとやね', 'person')`,
  );
});

describe('kanjiCard', () => {
  it('answers meanings, strokes, JLPT, radical and parts with what they mean', async () => {
    const card = await kanjiCard(TestDataSource, '食', 'en');

    expect(card).toMatchObject({
      character: '食',
      strokeCount: 9,
      grade: 2,
      frequency: 328,
      jlpt: 5,
      kanken: '9級',
      meanings: ['eat', 'food'],
      meaningsLanguage: 'en',
      strokes: ['M1,1', 'M2,2'],
      strokeNumbers: [
        [1, 2],
        [3, 4],
      ],
      // The radical code point decomposes to 食, which has a card.
      radical: { glyph: '⾷', number: 184, reading: 'しょく', meaning: 'food, to eat', character: '食' },
      // A shape with no card takes the radical's meaning; the kanji itself is never one of its parts.
      components: [
        { character: '𠆢', hasCard: false, meaning: 'person' },
        { character: '良', hasCard: true, meaning: 'good' },
      ],
    });
  });

  it('gives the Spanish meanings when there are some, and English otherwise', async () => {
    expect(await kanjiCard(TestDataSource, '食', 'es')).toMatchObject({
      meanings: ['comer'],
      meaningsLanguage: 'es',
      components: [
        { character: '𠆢', meaning: 'person' },
        { character: '良', meaning: 'bueno' },
      ],
    });
    expect(await kanjiCard(TestDataSource, '飯', 'es')).toMatchObject({
      meanings: ['meal'],
      meaningsLanguage: 'en',
      strokes: [],
      strokeNumbers: [],
      jlpt: null,
    });
  });

  it('lists the kanji under the same radical, and those that contain it under another', async () => {
    const card = await kanjiCard(TestDataSource, '食', 'en');

    // School kanji by grade: 館 (3) before 飯 (4).
    expect(card?.sameRadical).toEqual([
      { character: '館', reading: 'カン', meaning: 'building', grade: 3 },
      { character: '飯', reading: 'ハン', meaning: 'meal', grade: 4 },
    ]);
    expect(card?.sameRadicalCount).toBe(2);
    // 飯 contains 食 too, but is already listed under the radical.
    expect(card?.containedIn).toEqual([{ character: '蝕', reading: 'ショク', meaning: 'eclipse', grade: null }]);
    expect(card?.containedInCount).toBe(1);
  });

  it('lists the words written with it that our corpus uses most, with a reading and a gloss', async () => {
    await seedWord({
      id: 1358280,
      forms: [
        { text: '食べる', common: true },
        { text: 'たべる', kana: true },
      ],
      en: ['to eat'],
      es: ['comer'],
      rank: 195,
    });
    await seedWord({
      id: 1356690,
      forms: [{ text: '食事' }, { text: 'しょくじ', kana: true }],
      en: ['meal'],
      rank: 900,
    });
    // Not counted in our corpus: not listed.
    await seedWord({
      id: 1000001,
      forms: [{ text: '食卓' }, { text: 'しょくたく', kana: true }],
      en: ['dining table'],
    });
    // Counted, but not written with 食.
    await seedWord({ id: 1000002, forms: [{ text: '飯' }, { text: 'めし', kana: true }], en: ['meal'], rank: 5 });

    const card = await kanjiCard(TestDataSource, '食', 'es');

    expect(card?.words).toEqual([
      { id: 'jmdict:1358280', headword: '食べる', reading: 'たべる', frequency: 195, gloss: 'comer' },
      { id: 'jmdict:1356690', headword: '食事', reading: 'しょくじ', frequency: 900, gloss: 'meal' },
    ]);
  });

  it('reads a spelling with the kana form that applies to it, and joins the first glosses', async () => {
    await seedWord({
      id: 1000003,
      forms: [
        { text: '食物' },
        { text: 'くいもの', kana: true, appliesToKanji: ['食い物'] },
        { text: 'しょくもつ', kana: true, appliesToKanji: ['食物'] },
      ],
      en: ['food', 'foodstuff', 'eatables', 'victuals'],
      rank: 300,
    });

    expect((await kanjiCard(TestDataSource, '食', 'en'))?.words).toEqual([
      {
        id: 'jmdict:1000003',
        headword: '食物',
        reading: 'しょくもつ',
        frequency: 300,
        gloss: 'food; foodstuff; eatables',
      },
    ]);
  });

  it('sorts its most frequent words under the reading the kanji has in each', async () => {
    await seedWord({
      id: 1,
      forms: [{ text: '食べる' }, { text: 'たべる', kana: true }],
      rank: 1,
      furigana: [{ text: '食', ruby: 'た' }, { text: 'べる' }],
    });
    await seedWord({
      id: 2,
      forms: [{ text: '食器' }, { text: 'しょっき', kana: true }],
      rank: 2,
      furigana: [
        { text: '食', ruby: 'しょっ' },
        { text: '器', ruby: 'き' },
      ],
    });
    await seedWord({
      id: 3,
      forms: [{ text: '食う' }, { text: 'くう', kana: true }],
      rank: 3,
      furigana: [{ text: '食', ruby: 'く' }, { text: 'う' }],
    });

    const card = await kanjiCard(TestDataSource, '食', 'en');

    const brief = (card?.readings ?? []).map((r) => [r.reading, r.examples.map((e) => e.headword)]);
    expect(brief).toEqual([
      ['ショク', ['食器']],
      ['ジキ', []],
      ['く.う', ['食う']],
      ['た.べる', ['食べる']],
    ]);
    // Each example carries its furigana, for ruby over the word.
    expect(card?.readings[0]?.examples[0]).toEqual({
      id: 'jmdict:2',
      headword: '食器',
      reading: 'しょっき',
      furigana: [
        { text: '食', ruby: 'しょっ' },
        { text: '器', ruby: 'き' },
      ],
    });
  });

  it('takes examples from the dictionary for a reading our corpus never uses', async () => {
    await seedWord({
      id: 1,
      forms: [{ text: '食事' }, { text: 'しょくじ', kana: true }],
      rank: 1,
      furigana: [
        { text: '食', ruby: 'しょく' },
        { text: '事', ruby: 'じ' },
      ],
    });
    // Not in our corpus (no rank), but a common dictionary word read ジキ.
    await seedWord({
      id: 2,
      forms: [
        { text: '断食', common: true },
        { text: 'だんじき', kana: true },
      ],
      furigana: [
        { text: '断', ruby: 'だん' },
        { text: '食', ruby: 'じき' },
      ],
    });

    const readings = (await kanjiCard(TestDataSource, '食', 'en'))?.readings ?? [];

    expect(readings.find((r) => r.reading === 'ショク')?.examples.map((e) => e.headword)).toEqual(['食事']);
    expect(readings.find((r) => r.reading === 'ジキ')?.examples).toEqual([
      {
        id: 'jmdict:2',
        headword: '断食',
        reading: 'だんじき',
        furigana: [
          { text: '断', ruby: 'だん' },
          { text: '食', ruby: 'じき' },
        ],
      },
    ]);
    // Not listed among the corpus words: it was never counted.
    expect((await kanjiCard(TestDataSource, '食', 'en'))?.words.map((w) => w.headword)).toEqual(['食事']);
  });

  it(`lists at most ${KANJI_WORDS} words`, async () => {
    for (let i = 0; i < KANJI_WORDS + 2; i += 1) {
      await seedWord({ id: 2000000 + i, forms: [{ text: `食${i}` }], en: ['x'], rank: i + 1 });
    }

    expect((await kanjiCard(TestDataSource, '食', 'en'))?.words).toHaveLength(KANJI_WORDS);
  });

  it(`lists ${RELATED_KANJI} related kanji for the word card, and all of them for the kanji's page`, async () => {
    const extra = Array.from({ length: RELATED_KANJI + 3 }, (_, i) => String.fromCodePoint(0x4e00 + i));
    for (const kanji of extra) {
      await TestDataSource.query(
        `INSERT INTO dict.kanji (character, stroke_count, radical, meanings_en) VALUES ($1, 1, 184, '{x}')`,
        [kanji],
      );
    }

    const short = await kanjiCard(TestDataSource, '食', 'en');
    const all = await kanjiCard(TestDataSource, '食', 'en', { related: 'all' });

    expect(short?.sameRadical).toHaveLength(RELATED_KANJI);
    expect(short?.sameRadicalCount).toBe(RELATED_KANJI + 5);
    expect(all?.sameRadical).toHaveLength(RELATED_KANJI + 5);
  });

  it('answers null for a kanji it does not have', async () => {
    expect(await kanjiCard(TestDataSource, '鬱', 'en')).toBeNull();
  });
});

describe('which reading a word uses', () => {
  const keys = ['ショク', 'ジキ', 'く.う', 'く.らう', 'た.べる'].map(readingKey);

  it('finds rendaku and a doubled consonant', () => {
    expect([...readingForms('しょく')]).toEqual(['しょく', 'じょく', 'しょっ', 'じょっ']);
    expect(
      readingInWord(
        [
          { text: '餌', ruby: 'え' },
          { text: '食', ruby: 'じき' },
        ],
        '食',
        keys,
      ),
    ).toBe(1);
  });

  it('tells kun readings with the same stem apart by their okurigana', () => {
    expect(readingInWord([{ text: '食', ruby: 'く' }, { text: 'らう' }], '食', keys)).toBe(3);
    expect(readingInWord([{ text: '食', ruby: 'く' }, { text: 'う' }], '食', keys)).toBe(2);
  });

  it('gives up on a reading none of them explains', () => {
    expect(readingInWord([{ text: '今日', ruby: 'きょう' }], '今', keys)).toBeNull();
    expect(readingInWord([{ text: '食', ruby: 'めし' }], '食', keys)).toBeNull();
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
