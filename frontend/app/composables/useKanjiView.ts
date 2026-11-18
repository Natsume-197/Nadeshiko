import { ref } from 'vue';
import { fetchKanji, type KanjiCardData, peekKanji } from '~/utils/kanjiLookup';

export type KanjiViewState = 'idle' | 'loading' | 'shown' | 'missing' | 'unavailable';

/**
 * The word card's kanji view (task 44): which kanji it shows and that kanji's card. A request the reader has walked
 * away from (back to the word, or on to another kanji) is dropped when it lands, the same guard the word lookup has.
 */
export function useKanjiView(locale: () => 'en' | 'es') {
  const kanji = ref<string | null>(null);
  const card = ref<KanjiCardData | null>(null);
  const state = ref<KanjiViewState>('idle');
  let generation = 0;

  async function show(character: string): Promise<void> {
    const mine = ++generation;
    kanji.value = character;
    const cached = peekKanji(character, locale());
    const answer = cached ?? (await loading(character));
    if (mine !== generation) return;
    card.value = answer.card;
    state.value = answer.card ? 'shown' : answer.reason === 'missing' ? 'missing' : 'unavailable';
  }

  function loading(character: string) {
    card.value = null;
    state.value = 'loading';
    return fetchKanji(character, locale());
  }

  /** Back on a word, or the card closed. */
  function clear(): void {
    generation += 1;
    kanji.value = null;
    card.value = null;
    state.value = 'idle';
  }

  return { kanji, card, state, show, clear };
}
