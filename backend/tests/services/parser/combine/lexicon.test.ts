import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { InMemoryLexicon, loadLexicon } from '@app/services/parser/combine';
import { classMask, readingOfForm } from '@app/services/parser/combine/lexicon';

describe('InMemoryLexicon', () => {
  it('matches katakana against hiragana keys and keeps kanji as written', () => {
    const lexicon = new InMemoryLexicon(['うさぎ', '手に入る']);
    expect(lexicon.has('ウサギ')).toBe(true);
    expect(lexicon.has('うさぎ')).toBe(true);
    expect(lexicon.has('手に入る')).toBe(true);
    expect(lexicon.has('てにいる')).toBe(false);
  });

  it('answers class questions only for tagged keys', () => {
    const lexicon = new InMemoryLexicon(['です'], { exp: ['ですか'], prt: ['のに'] });
    expect(lexicon.has('ですか')).toBe(true);
    expect(lexicon.hasClass('ですか', 'exp')).toBe(true);
    expect(lexicon.hasClass('ですか', 'verb')).toBe(false);
    expect(lexicon.hasClass('です', 'exp')).toBe(false);
    expect(lexicon.hasClass('のに', 'prt')).toBe(true);
  });
});

describe('classMask', () => {
  it('follows FromJmDict: v* tags are verbs except vulg/vet/vidg', () => {
    const lexicon = new InMemoryLexicon([]);
    lexicon.add('手に入る', classMask(['exp', 'v5r']));
    lexicon.add('くそ', classMask(['n', 'vulg']));
    expect(lexicon.hasClass('手に入る', 'exp')).toBe(true);
    expect(lexicon.hasClass('手に入る', 'verb')).toBe(true);
    expect(lexicon.hasClass('くそ', 'verb')).toBe(false);
    expect(lexicon.has('くそ')).toBe(true);
  });
});

describe('readingsOf and formReading', () => {
  // 気に入る (1221740) and 何か (1188270) as JMdict lists them.
  const lexicon = new InMemoryLexicon([]);
  lexicon.addWord(
    1221740,
    [
      { text: '気に入る', kana: false },
      { text: '気にいる', kana: false },
      { text: 'きにいる', kana: true, appliesTo: ['*'] },
    ],
    { common: true },
  );
  lexicon.addWord(
    1188270,
    [
      { text: '何か', kana: false },
      { text: 'なにか', kana: true, appliesTo: ['*'] },
      { text: 'なんか', kana: true, appliesTo: ['*'] },
    ],
    { common: true, keepForms: true },
  );

  it('lists each word spelled with a kanji form, with the readings that apply to it', () => {
    expect(lexicon.readingsOf('気に入る')).toEqual([{ id: 1221740, common: true, kana: ['きにいる'] }]);
    expect(lexicon.readingsOf('何か')[0]?.kana).toEqual(['なにか', 'なんか']);
    expect(lexicon.readingsOf('きにいる')).toEqual([]);
  });

  it('reads a pinned form: kana as itself, kanji as its first reading', () => {
    expect(lexicon.formReading(1188270, 2)).toBe('なんか');
    expect(lexicon.formReading(1188270, 0)).toBe('なにか');
    expect(lexicon.formReading(1188270)).toBe('なにか');
    expect(lexicon.formReading(1221740)).toBeUndefined();
  });

  it('keeps a reading restricted to other spellings off a kanji form', () => {
    expect(
      readingOfForm(
        [
          { text: '一月', kana: false },
          { text: 'ひと月', kana: false },
          { text: 'ひとつき', kana: true, appliesTo: ['*'] },
          { text: 'いちげつ', kana: true, appliesTo: ['一月'] },
        ],
        1,
      ),
    ).toBe('ひとつき');
  });
});

describe('loadLexicon', () => {
  it('reads every active JMdict key with its classes and flags and every kanji-spelled word, once per data source', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("'uk'")
        ? [{ key: 'うさぎ', kana: true, common: true }]
        : sql.includes('json_agg')
          ? [
              {
                id: 1307230,
                common: true,
                forms: [
                  ['４時', false, []],
                  ['四時', false, []],
                  ['よじ', true, ['*']],
                ],
              },
            ]
          : [
              { key: '手に入る', pos: ['exp', 'v5r'] },
              { key: 'ウサギ', pos: ['n'] },
              { key: '何', pos: null },
            ],
    );
    const dataSource = { query } as unknown as DataSource;
    const lexicon = await loadLexicon(dataSource);
    expect(await loadLexicon(dataSource)).toBe(lexicon);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[0]).toContain("w.source = 'jmdict' AND w.active");
    expect(lexicon.hasClass('手に入る', 'exp')).toBe(true);
    expect(lexicon.has('うさぎ')).toBe(true);
    expect(lexicon.has('何')).toBe(true);
    // Kana-written and common spellings carry their flags.
    expect(lexicon.hasClass('ウサギ', 'kana')).toBe(true);
    expect(lexicon.hasClass('うさぎ', 'common')).toBe(true);
    expect(lexicon.hasClass('何', 'kana')).toBe(false);
    expect(lexicon.readingsOf('四時')[0]?.kana).toEqual(['よじ']);
    // A pinned word (四時 is an hour pin) keeps its forms.
    expect(lexicon.formReading(1307230, 1)).toBe('よじ');
  });
});
