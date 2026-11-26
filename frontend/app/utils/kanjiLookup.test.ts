import { describe, test, expect, vi, beforeEach } from 'vitest';
import { setReaderStack } from './wordLookup';
import {
  __kanjiLookupTesting,
  fetchCustomKanji,
  fetchKanji,
  kanjiBadges,
  markKanji,
  peekCustomKanji,
  peekKanji,
  splitKunReading,
  splitReading,
} from './kanjiLookup';

const $fetch = vi.fn();
vi.stubGlobal('$fetch', $fetch);

beforeEach(() => {
  $fetch.mockReset();
  __kanjiLookupTesting.clear();
});

describe('fetchKanji', () => {
  test('asks the frontend server, and keeps the answer for the tab', async () => {
    $fetch.mockResolvedValue({ character: '本' });

    expect(await fetchKanji('本', 'es')).toEqual({ card: { character: '本' } });
    expect($fetch).toHaveBeenCalledWith(`/api/dictionary/kanji/${encodeURIComponent('本')}`, {
      query: { locale: 'es' },
      timeout: 8000,
    });
    expect(peekKanji('本', 'es')).toEqual({ card: { character: '本' } });
    expect(peekKanji('本', 'en')).toBeUndefined();
  });

  test('asks once for two simultaneous opens', async () => {
    $fetch.mockResolvedValue({ character: '本' });

    await Promise.all([fetchKanji('本', 'en'), fetchKanji('本', 'en')]);

    expect($fetch).toHaveBeenCalledTimes(1);
  });

  test('remembers "no card", but not a failure', async () => {
    $fetch.mockRejectedValueOnce({ response: { status: 404 } });
    expect(await fetchKanji('〆', 'en')).toEqual({ card: null, reason: 'missing' });
    expect(peekKanji('〆', 'en')).toEqual({ card: null, reason: 'missing' });

    $fetch.mockRejectedValueOnce({ response: { status: 503 } });
    expect(await fetchKanji('本', 'en')).toEqual({ card: null, reason: 'failed' });
    expect(peekKanji('本', 'en')).toBeUndefined();
  });

  test('evicts the least recently used card, not the first one asked', async () => {
    const { CACHE_LIMIT } = __kanjiLookupTesting;
    $fetch.mockImplementation((url: string) =>
      Promise.resolve({ character: decodeURIComponent(url.split('/').pop()!) }),
    );
    for (let i = 0; i < CACHE_LIMIT; i++) await fetchKanji(`k${i}`, 'en');
    // Reading the oldest makes it fresh, so the next one in line goes instead.
    expect(peekKanji('k0', 'en')).toBeDefined();
    await fetchKanji('new', 'en');

    expect(peekKanji('k0', 'en')).toBeDefined();
    expect(peekKanji('k1', 'en')).toBeUndefined();
  });
});

describe('splitReading', () => {
  test('splits kun readings and leaves on readings whole', () => {
    expect(splitReading({ kind: 'kun' }, 'た.べる')).toEqual({ stem: 'た', okurigana: 'べる' });
    expect(splitReading({ kind: 'on' }, 'ショク.X')).toEqual({ stem: 'ショク.X', okurigana: '' });
  });
});

describe('splitKunReading', () => {
  test('sets the okurigana apart and keeps prefix and suffix marks', () => {
    expect(splitKunReading('た.べる')).toEqual({ stem: 'た', okurigana: 'べる' });
    expect(splitKunReading('もと')).toEqual({ stem: 'もと', okurigana: '' });
    expect(splitKunReading('-ぼん')).toEqual({ stem: '-ぼん', okurigana: '' });
  });
});

describe('kanjiBadges', () => {
  const t = (key: string, named?: Record<string, unknown>) => `${key}${named ? JSON.stringify(named) : ''}`;
  const card = (over: Record<string, unknown>) =>
    ({ jlpt: null, kanken: null, grade: null, strokeCount: 9, frequency: null, ...over }) as never;

  test('reads JLPT, Kanken, grade, strokes and newspaper rank in that order, JLPT standing out', () => {
    expect(kanjiBadges(card({ jlpt: 5, kanken: '9級', grade: 2, frequency: 328 }), t)).toEqual([
      { id: 'jlpt', text: 'N5', strong: true },
      { id: 'kanken', text: '漢検 9級' },
      { id: 'grade', text: 'tokenTooltip.kanjiGrade{"grade":2}' },
      { id: 'strokes', text: 'tokenTooltip.kanjiStrokes{"count":9}' },
      { id: 'freq', text: 'tokenTooltip.kanjiNewspaper{"rank":328}' },
    ]);
  });

  test('ranks by our own sentences once they are counted, instead of newspapers', () => {
    expect(kanjiBadges(card({ frequency: 328, corpusRank: 82 }), t).at(-1)).toEqual({
      id: 'freq',
      text: 'tokenTooltip.kanjiCorpusRank{"rank":82}',
    });
  });

  test('names the jōyō and jinmeiyō grades, and leaves out what it does not know', () => {
    expect(kanjiBadges(card({ grade: 8 }), t).map((b) => b.text)).toEqual([
      'tokenTooltip.kanjiJoyo',
      'tokenTooltip.kanjiStrokes{"count":9}',
    ]);
    expect(kanjiBadges(card({ grade: 9 }), t)[0]?.text).toBe('tokenTooltip.kanjiJinmeiyo');
  });
});

describe('markKanji', () => {
  test('marks the kanji wherever it is in a word, the rest in runs', () => {
    expect(markKanji('給食', '食')).toEqual([
      { text: '給', hit: false },
      { text: '食', hit: true },
    ]);
    expect(markKanji('食べ物', '食')).toEqual([
      { text: '食', hit: true },
      { text: 'べ物', hit: false },
    ]);
    expect(markKanji('女の子と女', '女').filter((run) => run.hit)).toHaveLength(2);
    expect(markKanji('ひと', '人')).toEqual([{ text: 'ひと', hit: false }]);
  });
});

describe('fetchCustomKanji', () => {
  const ANSWER = {
    entries: [{ dictionary: 'custom:1', dictionaryName: 'KANJIDIC', meanings: ['book'], tags: [] }],
    frequencies: [],
  };

  test('asks nothing for a reader without custom dictionaries', async () => {
    setReaderStack(null);
    expect(await fetchCustomKanji('本')).toBeNull();
    expect($fetch).not.toHaveBeenCalled();
  });

  test('asks the frontend server with the stack as cache key, and keeps the answer for that stack', async () => {
    setReaderStack('fp-1');
    $fetch.mockResolvedValue(ANSWER);

    expect(await fetchCustomKanji('本')).toEqual(ANSWER);
    expect($fetch).toHaveBeenCalledWith(`/api/dictionary/kanji/${encodeURIComponent('本')}/custom`, {
      query: { stack: 'fp-1' },
      timeout: 8000,
    });
    expect(peekCustomKanji('本')).toEqual(ANSWER);

    setReaderStack('fp-2');
    expect(peekCustomKanji('本')).toBeUndefined();
    setReaderStack(null);
  });

  test('does not keep an answer still missing a dictionary, nor a failure', async () => {
    setReaderStack('fp-1');
    $fetch.mockResolvedValueOnce({ ...ANSWER, pending: true });
    expect(await fetchCustomKanji('人')).toEqual(ANSWER);
    expect(peekCustomKanji('人')).toBeUndefined();

    $fetch.mockRejectedValueOnce({ response: { status: 503 } });
    expect(await fetchCustomKanji('日')).toBeNull();
    expect(peekCustomKanji('日')).toBeUndefined();
    setReaderStack(null);
  });
});
