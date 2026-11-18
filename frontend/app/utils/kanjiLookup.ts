/**
 * The word card's kanji view (task 44): one kanji's card from our own dictionary, through the frontend server's
 * cached `/api/dictionary/kanji/:character`. Shared across card instances like the word lookup: in-flight requests
 * are deduplicated, answers (including "no card") are kept for the tab, failures stay retryable.
 */

export interface KanjiCardComponent {
  character: string;
  /** Has a card of its own, so the view can open it. */
  hasCard: boolean;
  /** The kanji's first meaning, or the radical's (English) for a shape with no card. */
  meaning: string | null;
}

/** A word the view links to: enough to open it in the card. */
export interface KanjiCardWordRef {
  id: string;
  headword: string;
  reading: string | null;
}

export interface KanjiCardWord extends KanjiCardWordRef {
  frequency: number;
  gloss: string | null;
}

export interface KanjiCardExample extends KanjiCardWordRef {
  /** The headword in runs, with ruby over each kanji run. */
  furigana: Array<{ text: string; ruby?: string }>;
}

export interface KanjiCardReading {
  kind: 'on' | 'kun';
  /** Katakana for on; hiragana with `.` before the okurigana for kun. */
  reading: string;
  /** Up to three words read this way: the corpus's most frequent, else common dictionary words. */
  examples: KanjiCardExample[];
}

export interface KanjiCardRelated {
  character: string;
  reading: string | null;
  meaning: string | null;
  /** School grade: 1-6 and 8 jōyō, 9-10 jinmeiyō. */
  grade: number | null;
}

export interface KanjiCardRadical {
  glyph: string;
  number: number;
  reading: string;
  meaning: string;
  /** The kanji the radical is written as, when it has a card (⾷ is 食). */
  character: string | null;
}

export interface KanjiCardData {
  character: string;
  strokeCount: number;
  grade: number | null;
  frequency: number | null;
  /** Rank by how often it is written in Nadeshiko's sentences; null before the first count. */
  corpusRank: number | null;
  /** Current JLPT level, 5 for N5. */
  jlpt: number | null;
  /** Kanji Kentei level, `10級` (easiest) to `1級`. */
  kanken: string | null;
  radical: KanjiCardRadical | null;
  readings: KanjiCardReading[];
  meanings: string[];
  meaningsLanguage: 'en' | 'es';
  components: KanjiCardComponent[];
  /** One SVG path per stroke, in KanjiVG's 109×109 view box, in writing order. */
  strokes: string[];
  /** Where each stroke's number goes, `[x, y]` in the same view box; empty when there are none. */
  strokeNumbers: Array<[number, number]>;
  /** Up to 40, most frequent in our corpus first. */
  words: KanjiCardWord[];
  sameRadical: KanjiCardRelated[];
  sameRadicalCount: number;
  containedIn: KanjiCardRelated[];
  containedInCount: number;
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

export interface KanjiBadge {
  id: string;
  text: string;
  /** Drawn in the accent colour: the one a learner looks for first. */
  strong?: boolean;
}

/** The facts row of a kanji (N5, 漢検 9級, grade, strokes, newspaper rank), in the order a learner scans them. */
export function kanjiBadges(
  card: KanjiCardData,
  t: (key: string, named?: Record<string, unknown>, plural?: number) => string,
): KanjiBadge[] {
  const list: KanjiBadge[] = [];
  if (card.jlpt !== null) list.push({ id: 'jlpt', text: `N${card.jlpt}`, strong: true });
  // The level as the exam writes it (漢検 9級), the same in every language.
  if (card.kanken !== null) list.push({ id: 'kanken', text: `漢検 ${card.kanken}` });
  if (card.grade !== null) {
    if (card.grade <= 6) list.push({ id: 'grade', text: t('tokenTooltip.kanjiGrade', { grade: card.grade }) });
    else if (card.grade === 8) list.push({ id: 'grade', text: t('tokenTooltip.kanjiJoyo') });
    else list.push({ id: 'grade', text: t('tokenTooltip.kanjiJinmeiyo') });
  }
  list.push({ id: 'strokes', text: t('tokenTooltip.kanjiStrokes', { count: card.strokeCount }, card.strokeCount) });
  // Our own corpus first: it is what a reader of these sentences meets. Newspapers until it has been counted.
  if (card.corpusRank !== null && card.corpusRank !== undefined)
    list.push({ id: 'freq', text: t('tokenTooltip.kanjiCorpusRank', { rank: card.corpusRank }) });
  else if (card.frequency !== null)
    list.push({ id: 'freq', text: t('tokenTooltip.kanjiNewspaper', { rank: card.frequency }) });
  return list;
}
