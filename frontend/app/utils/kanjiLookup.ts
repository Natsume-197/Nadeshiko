/**
 * The word card's kanji view (task 44): one kanji's card from our own dictionary, through the frontend server's
 * cached `/api/dictionary/kanji/:character`. Shared across card instances like the word lookup: in-flight requests
 * are deduplicated, answers (including "no card") are kept for the tab, failures stay retryable.
 */

import { apiErrorStatus } from '~/utils/apiError';
import { lruRecall, lruRemember } from '~/utils/lruMap';
import type { DictionarySense } from '~/utils/wordCard';
import { readerStack } from '~/utils/wordLookup';

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

const remember = (key: string, answer: KanjiLookup) => lruRemember(resolved, key, answer, CACHE_LIMIT);

/** The answer if this tab already has it, so the view can open filled in. */
export function peekKanji(character: string, locale: 'en' | 'es'): KanjiLookup | undefined {
  return lruRecall(resolved, keyOf(character, locale));
}

/** Never rejects: a missing kanji and a failed request each come back with their reason. */
export function fetchKanji(character: string, locale: 'en' | 'es'): Promise<KanjiLookup> {
  const key = keyOf(character, locale);
  const answered = lruRecall(resolved, key);
  if (answered) return Promise.resolve(answered);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = $fetch<KanjiCardData>(`/api/dictionary/kanji/${encodeURIComponent(character)}`, {
    query: { locale },
    timeout: 8000,
  })
    .then((card): KanjiLookup => remember(key, { card }))
    .catch((error: unknown): KanjiLookup => {
      if (apiErrorStatus(error) === 404) return remember(key, { card: null, reason: 'missing' });
      return { card: null, reason: 'failed' };
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/** One kanji from one of the reader's own dictionaries (task 48): a Yomitan kanji entry, or the article of a kanji
 *  dictionary shipped as a term dictionary (`senses`). */
export interface CustomKanjiEntry {
  dictionary: string;
  dictionaryName: string;
  onyomi?: string[];
  kunyomi?: string[];
  meanings?: string[];
  tags: Array<{ category: string; code: string; label: string }>;
  stats?: Array<{ code: string; label: string; category: string; value: string }>;
  senses?: DictionarySense[];
}

export interface CustomKanjiFrequency {
  dictionary: string;
  dictionaryName: string;
  value: number | null;
  displayValue: string;
}

export interface CustomKanjiData {
  entries: CustomKanjiEntry[];
  frequencies: CustomKanjiFrequency[];
}

const customResolved = new Map<string, CustomKanjiData>();
const customInFlight = new Map<string, Promise<CustomKanjiData | null>>();

/** The reader's own kanji dictionaries' part of the card, if this tab already has it. */
export function peekCustomKanji(character: string): CustomKanjiData | undefined {
  const stack = readerStack();
  return stack ? lruRecall(customResolved, `${character}:${stack}`) : undefined;
}

/**
 * The reader's own kanji dictionaries' part of the card, through `/api/dictionary/kanji/:character/custom`; `null`
 * without a custom stack or when the request fails (the card then shows only ours). Keyed by the stack, so a change
 * of dictionaries asks again; an answer still missing a dictionary is not kept.
 */
export function fetchCustomKanji(character: string): Promise<CustomKanjiData | null> {
  const stack = readerStack();
  if (!stack) return Promise.resolve(null);
  const key = `${character}:${stack}`;
  const answered = lruRecall(customResolved, key);
  if (answered) return Promise.resolve(answered);
  const pending = customInFlight.get(key);
  if (pending) return pending;

  const request = $fetch<CustomKanjiData & { pending?: boolean }>(
    `/api/dictionary/kanji/${encodeURIComponent(character)}/custom`,
    // `stack` only keys the browser's HTTP cache; the server reads the stack from the session.
    { query: { stack }, timeout: 8000 },
  )
    .then((answer): CustomKanjiData => {
      const data = { entries: answer?.entries ?? [], frequencies: answer?.frequencies ?? [] };
      return answer?.pending ? data : lruRemember(customResolved, key, data, CACHE_LIMIT);
    })
    .catch(() => null)
    .finally(() => customInFlight.delete(key));

  customInFlight.set(key, request);
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

/** A reading of either kind split for display: kun readings set their okurigana apart, on readings are all stem. */
export function splitReading(
  entry: Pick<KanjiCardReading, 'kind'>,
  reading: string,
): { stem: string; okurigana: string } {
  return entry.kind === 'kun' ? splitKunReading(reading) : { stem: reading, okurigana: '' };
}

export const __kanjiLookupTesting = {
  CACHE_LIMIT,
  clear: () => {
    resolved.clear();
    customResolved.clear();
  },
};

export interface KanjiBadge {
  id: string;
  text: string;
  /** Drawn in the accent colour: the one a learner looks for first. */
  strong?: boolean;
}

/** A word cut into runs, the given kanji marked, so a kanji's page and card can colour it inside its words (食 in
 *  食べる, 給食). */
export function markKanji(text: string, kanji: string): Array<{ text: string; hit: boolean }> {
  const runs: Array<{ text: string; hit: boolean }> = [];
  for (const character of text) {
    const hit = character === kanji;
    const last = runs[runs.length - 1];
    if (last && last.hit === hit && !hit) last.text += character;
    else runs.push({ text: character, hit });
  }
  return runs;
}

/** The tag (`EN`) shown when the meanings fell back to another language than the reader's; `null` when they did not. */
export function meaningsTag(card: KanjiCardData | null | undefined, locale: string): string | null {
  return card && card.meaningsLanguage !== locale ? card.meaningsLanguage.toUpperCase() : null;
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
