import { describe, expect, test } from 'vitest';
import { brief, isWordQuery, pickEntries, pickEntry, toHiragana } from './wordEntry';

describe('isWordQuery', () => {
  test('a word in any Japanese script is one', () => {
    for (const query of ['食べる', 'たべる', 'テレビ', '々', 'ラーメン', '𠮟る']) expect(isWordQuery(query)).toBe(true);
  });

  test('phrases, other scripts and long text are not', () => {
    for (const query of ['', ' ', '食べる 飲む', 'tabemasu', '食べる。', '1人', 'あ'.repeat(17)]) {
      expect(isWordQuery(query)).toBe(false);
    }
  });
});

describe('pickEntry', () => {
  const taberu = { headword: '食べる', forms: [{ text: '食べる' }, { text: 'たべる' }] };
  const name = { headword: '食部', name: true, forms: [{ text: 'たべる' }] };
  const other = { headword: '食う', forms: [{ text: 'くう' }] };

  test('the best-ranked candidate spelled like the query, by headword or form, in either kana', () => {
    expect(pickEntry([other, taberu], '食べる')).toBe(taberu);
    expect(pickEntry([taberu], 'たべる')).toBe(taberu);
    expect(pickEntry([taberu], 'タベル')).toBe(taberu);
  });

  test('a word before a name, a name when nothing else fits', () => {
    expect(pickEntry([name, taberu], 'たべる')).toBe(taberu);
    expect(pickEntry([name], 'たべる')).toBe(name);
  });

  test('nothing for an inflected or partial query', () => {
    expect(pickEntry([taberu], '食べた')).toBeNull();
    expect(pickEntry([taberu], '食べ')).toBeNull();
  });
});

describe('pickEntries', () => {
  const kana = (headword: string, extra: object = {}) => ({
    headword,
    forms: [{ text: headword }, { text: 'はし' }],
    ...extra,
  });

  test('homographs: the best one is the entry, the other words spelled the same follow, never names', () => {
    const bridge = kana('橋');
    const chopsticks = kana('箸');
    const edge = kana('端');
    const name = kana('橋本', { name: true });

    const picked = pickEntries([bridge, name, chopsticks, edge], 'はし');

    expect(picked.entry).toBe(bridge);
    expect(picked.others).toEqual([chopsticks, edge]);
    expect(picked.inflected).toBe(false);
  });

  test('the entry is the homograph most used in Nadeshiko, the rest follow by use, uncounted ones last', () => {
    const edge = kana('端', { frequency: 2477 });
    const bridge = kana('橋', { frequency: 900 });
    const chopsticks = kana('箸', { frequency: 1500 });
    const ladder = kana('梯', { frequency: null });

    const picked = pickEntries([edge, ladder, bridge, chopsticks], 'はし');

    expect(picked.entry).toBe(bridge);
    expect(picked.others).toEqual([chopsticks, edge, ladder]);
  });

  test('a conjugated search gets the word it is a form of, marked inflected', () => {
    const taberu = { headword: '食べる', baseForm: true, forms: [{ text: '食べる' }] };

    expect(pickEntries([taberu], '食べた')).toEqual({ entry: taberu, others: [], inflected: true });
  });

  test('nothing at all when no candidate is spelled like the search or is its base form', () => {
    expect(pickEntries([{ headword: '食べる', forms: [{ text: '食べる' }] }], '食べ')).toEqual({
      entry: null,
      others: [],
      inflected: false,
    });
  });
});

test('brief keeps the headword, reading and first English meaning', () => {
  const word = {
    headword: '箸',
    reading: 'ハシ',
    entries: [
      {
        senses: [
          { definitions: [{ lang: 'en', text: 'chopsticks' }] },
          { definitions: [{ lang: 'es', text: 'palillos' }] },
        ],
      },
    ],
  };
  expect(brief(word)).toEqual({ headword: '箸', reading: 'ハシ', gloss: 'chopsticks' });
  expect(brief({ ...word, entries: [] })).toEqual({ headword: '箸', reading: 'ハシ', gloss: null });
});

test('toHiragana turns katakana into hiragana and leaves the rest', () => {
  expect(toHiragana('ラーメン食べる')).toBe('らーめん食べる');
});
