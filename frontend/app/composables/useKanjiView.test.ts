import { describe, test, expect, vi, beforeEach } from 'vitest';

const fetchKanji = vi.fn();
const peekKanji = vi.fn();
vi.mock('~/utils/kanjiLookup', () => ({
  fetchKanji: (...a: unknown[]) => fetchKanji(...a),
  peekKanji: (...a: unknown[]) => peekKanji(...a),
}));

const { useKanjiView } = await import('./useKanjiView');

const card = (character: string) => ({ character }) as never;

beforeEach(() => {
  fetchKanji.mockReset();
  peekKanji.mockReset();
  peekKanji.mockReturnValue(undefined);
});

describe('the kanji view', () => {
  test('opens a kanji this tab already has, with no loading state', async () => {
    peekKanji.mockReturnValue({ card: card('本') });
    const view = useKanjiView(() => 'en');

    const shown = view.show('本');
    expect(view.state.value).not.toBe('loading');
    await shown;

    expect(view.state.value).toBe('shown');
    expect(fetchKanji).not.toHaveBeenCalled();
  });

  test('asks for one it does not have, in the reader language', async () => {
    fetchKanji.mockResolvedValue({ card: card('本') });
    const view = useKanjiView(() => 'es');

    const shown = view.show('本');
    expect(view.state.value).toBe('loading');
    await shown;

    expect(fetchKanji).toHaveBeenCalledWith('本', 'es');
    expect(view.card.value).toEqual(card('本'));
  });

  test('tells a missing kanji from a failed request', async () => {
    const view = useKanjiView(() => 'en');

    fetchKanji.mockResolvedValue({ card: null, reason: 'missing' });
    await view.show('〆');
    expect(view.state.value).toBe('missing');

    fetchKanji.mockResolvedValue({ card: null, reason: 'failed' });
    await view.show('本');
    expect(view.state.value).toBe('unavailable');
  });

  test('a late answer for a kanji the reader left does not paint over the card', async () => {
    let answer: (value: unknown) => void = () => {};
    fetchKanji.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const view = useKanjiView(() => 'en');

    const shown = view.show('本');
    view.clear();
    answer({ card: card('本') });
    await shown;

    expect(view.kanji.value).toBeNull();
    expect(view.card.value).toBeNull();
    expect(view.state.value).toBe('idle');
  });
});
