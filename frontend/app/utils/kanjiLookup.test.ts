import { describe, test, expect, vi, beforeEach } from 'vitest';
import { __kanjiLookupTesting, fetchKanji, peekKanji, splitKunReading } from './kanjiLookup';

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
