/**
 * The word card's kanji view (task 44): one kanji's card from our own dictionary, through the frontend server's
 * cached `/api/dictionary/kanji/:character`. Shared across card instances like the word lookup: in-flight requests
 * are deduplicated, answers (including "no card") are kept for the tab, failures stay retryable.
 */

export interface KanjiCardComponent {
  character: string;
  /** Has a card of its own, so the view can open it. */
  hasCard: boolean;
}

export interface KanjiCardWord {
  id: string;
  headword: string;
  reading: string | null;
  frequency: number;
  gloss: string | null;
}

export interface KanjiCardData {
  character: string;
  strokeCount: number;
  grade: number | null;
  frequency: number | null;
  onReadings: string[];
  kunReadings: string[];
  meanings: string[];
  meaningsLanguage: 'en' | 'es';
  components: KanjiCardComponent[];
  /** One SVG path per stroke, in KanjiVG's 109×109 view box, in writing order. */
  strokes: string[];
  words: KanjiCardWord[];
}

export type KanjiLookup = { card: KanjiCardData; reason?: undefined } | { card: null; reason: 'missing' | 'failed' };

const resolved = new Map<string, KanjiLookup>();
const inFlight = new Map<string, Promise<KanjiLookup>>();

/** Tab-lifetime bound; the browser's day-long HTTP cache still serves evicted entries. */
const CACHE_LIMIT = 200;

const keyOf = (character: string, locale: string) => `${character}:${locale}`;

function remember(key: string, answer: KanjiLookup): KanjiLookup {
  resolved.delete(key);
  resolved.set(key, answer);
  if (resolved.size > CACHE_LIMIT) {
    const oldest = resolved.keys().next().value;
    if (oldest !== undefined) resolved.delete(oldest);
  }
  return answer;
}

/** The answer if this tab already has it, so the view can open filled in. */
export function peekKanji(character: string, locale: 'en' | 'es'): KanjiLookup | undefined {
  return resolved.get(keyOf(character, locale));
}

/** Never rejects: a missing kanji and a failed request each come back with their reason. */
export function fetchKanji(character: string, locale: 'en' | 'es'): Promise<KanjiLookup> {
  const key = keyOf(character, locale);
  const answered = resolved.get(key);
  if (answered) return Promise.resolve(answered);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = $fetch<KanjiCardData>(`/api/dictionary/kanji/${encodeURIComponent(character)}`, {
    query: { locale },
    timeout: 8000,
  })
    .then((card): KanjiLookup => remember(key, { card }))
    .catch((error: unknown): KanjiLookup => {
      const failure = error as { response?: { status?: number }; statusCode?: number };
      const status = failure?.response?.status ?? failure?.statusCode;
      if (status === 404) return remember(key, { card: null, reason: 'missing' });
      return { card: null, reason: 'failed' };
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/** A kun reading as KANJIDIC2 writes it (`た.べる`, `-ぼん`), split into the kanji's own part and the okurigana,
 * so the view can set the okurigana apart. The `-` that marks a prefix or suffix is kept. */
export function splitKunReading(reading: string): { stem: string; okurigana: string } {
  const dot = reading.indexOf('.');
  return dot === -1
    ? { stem: reading, okurigana: '' }
    : { stem: reading.slice(0, dot), okurigana: reading.slice(dot + 1) };
}

export const __kanjiLookupTesting = { CACHE_LIMIT, clear: () => resolved.clear() };
