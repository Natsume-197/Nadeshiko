import { describe, test, expect, vi, beforeEach } from 'vitest';
import { __kanjiLookupTesting, fetchKanji, kanjiBadges, peekKanji, splitKunReading } from './kanjiLookup';

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

  test('names the jōyō and jinmeiyō grades, and leaves out what it does not know', () => {
    expect(kanjiBadges(card({ grade: 8 }), t).map((b) => b.text)).toEqual([
      'tokenTooltip.kanjiJoyo',
      'tokenTooltip.kanjiStrokes{"count":9}',
    ]);
    expect(kanjiBadges(card({ grade: 9 }), t)[0]?.text).toBe('tokenTooltip.kanjiJinmeiyo');
  });
});
