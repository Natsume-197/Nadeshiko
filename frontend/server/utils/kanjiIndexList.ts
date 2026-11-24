import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import type { KanjiIndexEntry } from '~~/server/utils/kanjiIndex';

const TIMEOUT_MS = 5000;
const CARD_TIMEOUT_MS = 3000;

/** Every jōyō and JLPT kanji (about 2,400) with one reading and meaning, from the backend's kanji index. */
export async function fetchKanjiIndexList(locale: 'en' | 'es'): Promise<KanjiIndexEntry[]> {
  const config = useRuntimeConfig();
  const answer = await $fetch<{ kanji: KanjiIndexEntry[] }>(internalBackendUrl(config, '/v1/dictionary/kanji'), {
    query: { locale },
    headers: buildInternalBackendHeaders(config),
    timeout: TIMEOUT_MS,
  });
  return answer.kanji;
}

/** One kanji's card from the backend, as the word card's kanji view and the kanji page draw it. */
export function fetchKanjiCard<T>(character: string, locale: 'en' | 'es', related: 'short' | 'all'): Promise<T> {
  const config = useRuntimeConfig();
  return $fetch<T>(internalBackendUrl(config, `/v1/dictionary/kanji/${encodeURIComponent(character)}`), {
    query: { locale, related },
    headers: buildInternalBackendHeaders(config),
    timeout: CARD_TIMEOUT_MS,
  });
}
