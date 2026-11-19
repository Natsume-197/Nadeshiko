import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import type { KanjiIndexEntry } from '~~/server/utils/kanjiIndex';
import { logger } from '~~/server/utils/logger';

/**
 * A kanji's first reading and meaning, for the kanji row of the entry above a word search (商 ショウ "make a deal").
 * From the kanji index list (jōyō and JLPT kanji, about 2,400), loaded once a day per server process: one request,
 * never one per kanji. A kanji outside that list, or a failed load, just has no brief.
 */
export interface KanjiBrief {
  reading: string | null;
  meaning: string | null;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

let loaded: { at: number; briefs: Map<string, KanjiBrief> } | null = null;
let loading: Promise<Map<string, KanjiBrief>> | null = null;

async function load(): Promise<Map<string, KanjiBrief>> {
  const config = useRuntimeConfig();
  const answer = await $fetch<{ kanji: KanjiIndexEntry[] }>(internalBackendUrl(config, '/v1/dictionary/kanji'), {
    query: { locale: 'en' },
    headers: buildInternalBackendHeaders(config),
    timeout: TIMEOUT_MS,
  });
  return new Map(
    answer.kanji.map((entry) => [entry.character, { reading: entry.reading ?? null, meaning: entry.meaning ?? null }]),
  );
}

async function allBriefs(): Promise<Map<string, KanjiBrief>> {
  if (loaded && Date.now() - loaded.at < TTL_MS) return loaded.briefs;
  loading ??= load()
    .then((briefs) => {
      loaded = { at: Date.now(), briefs };
      return briefs;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

const HAN = /\p{Script=Han}/u;

/** Briefs for the kanji in these words, by character; empty when the list cannot be loaded. */
export async function kanjiBriefs(words: readonly string[]): Promise<Record<string, KanjiBrief>> {
  const characters = [...new Set(words.flatMap((word) => [...word].filter((character) => HAN.test(character))))];
  if (characters.length === 0) return {};
  try {
    const briefs = await allBriefs();
    return Object.fromEntries(
      characters.flatMap((character) => {
        const brief = briefs.get(character);
        return brief ? [[character, brief]] : [];
      }),
    );
  } catch (error) {
    logger.warn({ err: error }, 'Kanji briefs for the word entry could not be loaded');
    return {};
  }
}

/** For tests: forget the loaded list. */
export function resetKanjiBriefs(): void {
  loaded = null;
  loading = null;
}
