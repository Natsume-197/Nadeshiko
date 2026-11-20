import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasOwnDictionaries, personalEntryFor, personalEntryFrom } from '~/utils/personalWordEntry';
import type { DictionaryWord } from '~/utils/wordCard';

const word = (headword: string, dictionaries: string[], extra: Partial<DictionaryWord> = {}): DictionaryWord =>
  ({
    id: `jmdict:${headword}`,
    headword,
    reading: null,
    frequency: 100,
    forms: [],
    entries: dictionaries.map((dictionary) => ({
      dictionary,
      dictionaryName: dictionary,
      senses: [{ position: 0, definitions: [{ lang: 'en', text: `${headword} in ${dictionary}` }], tags: [] }],
    })),
    ...extra,
  }) as unknown as DictionaryWord;

describe("the search entry with the reader's own dictionaries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts an uploaded entry or frequency badge, not JMdict alone', () => {
    expect(hasOwnDictionaries(word('猫', ['jmdict']))).toBe(false);
    expect(hasOwnDictionaries(word('猫', ['custom:1', 'jmdict']))).toBe(true);
    expect(
      hasOwnDictionaries(
        word('猫', ['jmdict'], {
          customFrequencies: [{ dictionary: 'custom:2', dictionaryName: 'Freq', value: 5, displayValue: '5' }],
        }),
      ),
    ).toBe(true);
  });

  it('builds the entry and its homographs as the server does, only when uploads add something', () => {
    const answer = personalEntryFrom(
      [word('橋', ['custom:1', 'jmdict']), word('箸', ['jmdict'], { frequency: 900 })],
      'はし',
      'en',
    );
    expect(answer).toBeNull();

    const kana = [word('はし', ['custom:1', 'jmdict']), word('はし', ['jmdict'], { id: 'jmdict:端', frequency: 900 })];
    expect(personalEntryFrom(kana, 'はし', 'en')?.entry?.entries?.[0]?.dictionary).toBe('custom:1');
    expect(personalEntryFrom([word('猫', ['jmdict'])], '猫', 'en')).toBeNull();
  });

  it("asks the reader's private word-card route and gives up quietly on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ candidates: [word('やばい', ['custom:11', 'jmdict'])] })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('$fetch', fetchMock);

    const answer = await personalEntryFor('やばい', 'en', 'fp1');
    expect(answer?.entry?.headword).toBe('やばい');
    expect(fetchMock).toHaveBeenCalledWith(`/api/dictionary/words/candidates/${encodeURIComponent('やばい')}`, {
      query: { locale: 'en', stack: 'fp1' },
    });

    expect(await personalEntryFor('やばい', 'en', 'fp1')).toBeNull();
  });
});
