import type { DataSource } from 'typeorm';
import { config } from '@config/config';
import { logger } from '@config/log';
import { analyse, type Morpheme } from '@app/services/parser/sudachi';
import { tokenPos } from '@app/services/parser/pos';
import { deconjugate } from '@app/services/parser/deconjugator';
import { inflectionLabels } from '@app/services/parser/labels';
import { hasKanji, lookupKeys, toHiragana, toKatakana } from './import/entries';

/**
 * Nadeshiko's own answer to "which word is this token?" (task 40): ranked candidates from `dict.*`, in the same
 * shape the word card renders.
 *
 * Ranking uses what a stored token carries: lemma, surface, the surface's reading, and the short POS tag
 * (`SlimToken.pt`). It follows the usual form preference (search-only and rare spellings rank down, common words
 * up) plus two checks of our own: the reading of the kanji stem, which is what separates 開く read ひらく from
 * 開く read あく, and the part of speech.
 */

export interface IdentifyQuery {
  lemma: string;
  surface?: string;
  /** Reading of the SURFACE (タベマシタ for 食べました), as tokens store it. */
  reading?: string;
  /** The short POS tag: noun, verb, adj, adv, prt, aux, pron, det, conj, intj, pref, suf, exp. */
  pos?: string;
  locale: 'en' | 'es';
}

export interface CandidateTag {
  category: 'partOfSpeech' | 'misc' | 'field' | 'dialect';
  code: string;
  label: string;
}

/** The word card's candidate (`DictionaryWord` in the frontend's `wordCard.ts`). */
export interface DictionaryCandidate {
  id: string;
  headword: string;
  reading: string | null;
  common: boolean;
  name: boolean;
  sourceId: string;
  dictionary: 'jmdict' | 'jmnedict';
  jlpt: string | null;
  frequency: number | null;
  /** Rank in each kind of media the word occurs in (`dict.frequency_category`), most used kind first. Absent when
   * never counted that way. */
  frequencyByCategory?: Array<{
    category: 'ANIME' | 'JDRAMA' | 'YOUTUBE' | 'AUDIOBOOK';
    rank: number;
    perMillion: number;
  }>;
  furigana?: Array<{ text: string; ruby?: string }>;
  /** True when the word was found only as the dictionary form of what was looked up (食べた → 食べる). */
  baseForm?: boolean;
  /** With `baseForm`: what the conjugation does, in the card's inflection labels, outermost first (食べた: past). */
  inflection?: string[];
  /** UniDic accent: 0 flat, n the mora the pitch drops after. `audioUrl` is set by `withPitchAudio` where a clip of
   * that reading and accent is uploaded. */
  pitch?: Array<{ downstep: number; audioUrl?: string }>;
  /** The words a compound or expression is made of (捜査本部: 捜査, 本部), each one the card can open. Absent for a
   * word of one piece, or when the Sudachi sidecar is not configured. */
  parts?: Array<{ text: string; lemma: string; reading: string; id: string }>;
  forms: Array<{ text: string; script: 'kanji' | 'kana'; common: boolean }>;
  entries: Array<{
    dictionary: string;
    dictionaryName: string;
    senses: Array<{
      position: number;
      definitions: Array<{ lang: 'en' | 'es'; text: string }>;
      tags: CandidateTag[];
      notes?: string[];
    }>;
  }>;
}

const MAX_CANDIDATES = 8;
/** Words fetched per lookup before ranking; names (JMnedict) come last and are capped by this too. */
const MAX_FETCHED = 60;

/** JMnedict's name types. A JMdict entry whose every sense is tagged with one of these is a name too: ~7,300
 * entries live in both dictionaries under the same ent_seq. */
const NAME_TYPES = new Set([
  'char',
  'company',
  'creat',
  'dei',
  'doc',
  'ev',
  'fem',
  'fict',
  'given',
  'group',
  'leg',
  'masc',
  'myth',
  'obj',
  'organization',
  'oth',
  'person',
  'place',
  'product',
  'relig',
  'serv',
  'ship',
  'station',
  'surname',
  'unclass',
  'work',
]);

const SEARCH_ONLY = new Set(['sK', 'sk']);
const RARE = new Set(['rK', 'rk', 'oK', 'ok', 'iK', 'ik', 'io', 'ateji', 'gikun']);

/** JMdict part-of-speech codes each short tag stands for. */
const POS_FAMILIES: Record<string, (code: string) => boolean> = {
  verb: (c) => (/^v/.test(c) && c !== 'vt' && c !== 'vi') || c === 'aux-v',
  noun: (c) => /^n($|-)/.test(c) || c === 'num' || c === 'ctr',
  adj: (c) => /^adj-/.test(c) && c !== 'adj-pn',
  adv: (c) => /^adv/.test(c) || c === 'n-adv',
  prt: (c) => c === 'prt',
  aux: (c) => /^aux/.test(c) || c === 'cop',
  pron: (c) => c === 'pn',
  det: (c) => c === 'adj-pn',
  conj: (c) => c === 'conj',
  intj: (c) => c === 'int',
  pref: (c) => c === 'pref' || c === 'n-pref',
  suf: (c) => c === 'suf' || c === 'n-suf' || c === 'ctr',
  exp: (c) => c === 'exp',
};

export interface StoredForm {
  idx: number;
  text: string;
  kana: boolean;
  common: boolean;
  tags: string[];
  applies_to_kanji: string[];
  active: boolean;
}

export interface StoredSense {
  idx: number;
  lang: 'eng' | 'spa';
  pos: string[];
  misc: string[];
  field: string[];
  dialect: string[];
  info: string[];
  applies_to_kanji: string[];
  applies_to_kana: string[];
  glosses: Array<{ text: string; type: string | null }>;
}

export interface StoredWord {
  id: number;
  source: 'jmdict' | 'jmnedict';
  common: boolean;
  active: boolean;
  jlpt: number | null;
  /** How often it occurs in our corpus (`dict.frequency`); null when never seen or not computed yet. */
  frequency?: { rank: number; perMillion: number } | null;
  forms: StoredForm[];
  senses: StoredSense[];
}

const isKana = (char: string) => /[぀-ヿ]/.test(char);

/** The reading of a word's leading kanji, found by stripping the kana tail the spelling and its reading share:
 * 開く/ひらく and 開いた/ひらいた both give ひら. A spelling with no kanji gives ''. */
export function stemReading(text: string, reading: string): string {
  const spelled = [...text];
  const read = [...toHiragana(reading)];
  let i = spelled.length;
  let j = read.length;
  while (i > 0 && j > 0) {
    const char = spelled[i - 1] ?? '';
    if (!isKana(char) || toHiragana(char) !== read[j - 1]) break;
    i -= 1;
    j -= 1;
  }
  return i === 0 ? '' : read.slice(0, j).join('');
}

function appliesTo(kanaForm: StoredForm, kanjiText: string): boolean {
  return kanaForm.applies_to_kanji.includes('*') || kanaForm.applies_to_kanji.includes(kanjiText);
}

const usable = (form: StoredForm) => form.active && !form.tags.some((tag) => SEARCH_ONLY.has(tag));

/** JMdict's `uk` ("usually written using kana alone") on the word's first sense. */
const usuallyKana = (word: StoredWord) => word.senses[0]?.misc.includes('uk') ?? false;

export function isName(word: StoredWord): boolean {
  if (word.source === 'jmnedict') return true;
  return word.senses.length > 0 && word.senses.every((sense) => sense.misc.some((tag) => NAME_TYPES.has(tag)));
}

/** How well a stored word fits the token; higher is better. Exported for tests. */
export function scoreWord(word: StoredWord, query: IdentifyQuery): number {
  const keys = new Set(lookupKeys(query.lemma));
  const matched = word.forms.filter((form) => keys.has(form.text) || keys.has(toHiragana(form.text)));
  let score = matched.some((form) => form.text === query.lemma) ? 100 : 60;

  // A kanji word found through its kana spelling: likely when it is usually written in kana (こと → 事) or that
  // reading is a common one (うそ → 嘘, not the bullfinch 鷽 or the otter), unlikely otherwise. Between common
  // homographs (はし: 橋, 箸, 端) the corpus frequency below decides.
  const hasKanjiForms = word.forms.some((form) => !form.kana);
  if (hasKanjiForms && matched.length > 0 && matched.every((form) => form.kana)) {
    score += usuallyKana(word) || matched.some((form) => form.common) ? 15 : -15;
  }

  if (matched.length > 0 && matched.every((form) => !form.active)) score -= 30;
  if (matched.length > 0 && matched.every((form) => form.tags.some((tag) => SEARCH_ONLY.has(tag)))) score -= 20;
  else if (matched.length > 0 && matched.every((form) => form.tags.some((tag) => RARE.has(tag)))) score -= 10;

  // Reading: only meaningful when the lemma has kanji to be read.
  if (query.reading && hasKanji(query.lemma)) {
    const wanted = stemReading(query.surface || query.lemma, query.reading);
    const kanaForms = word.forms.filter((form) => form.kana);
    const fits = kanaForms.some((form) => stemReading(query.lemma, form.text) === wanted);
    score += fits ? 50 : -40;
  }

  const family = query.pos ? POS_FAMILIES[query.pos] : undefined;
  if (family) {
    const codes = word.senses.flatMap((sense) => sense.pos);
    score += codes.some(family) ? 30 : -30;
  }

  if (word.common) score += 20;
  if (word.jlpt !== null) score += 5;
  // How often our corpus uses it, on a log scale capped at 20: it decides between homographs the other signals
  // leave tied (いる: 居る over 要る) without outweighing a reading or part of speech that does not fit.
  if (word.frequency) score += Math.min(20, 5 * Math.log10(1 + word.frequency.perMillion));
  if (isName(word)) score -= 50;
  if (!word.active) score -= 30;
  return score;
}

function headwordOf(word: StoredWord, query: IdentifyQuery): StoredForm | undefined {
  const kanji = word.forms.filter((form) => !form.kana);
  const kana = word.forms.filter((form) => form.kana);
  // A word usually written in kana is shown in kana, however the reader met it: する, not 為る, and わかる for 分かった.
  if (usuallyKana(word)) {
    const met = kana.find((form) => usable(form) && form.text === toHiragana(query.lemma));
    return met ?? kana.find(usable) ?? kana[0];
  }
  // Otherwise as the reader met it if that is a kanji spelling the dictionary shows (not a search-only one). A kana
  // match does not decide the headword: はし should read 橋, 箸 and 端, not はし three times.
  const matched = word.forms.find((form) => form.text === query.lemma && !form.kana && usable(form));
  if (matched) return matched;
  return (
    kanji.find((form) => usable(form) && !form.tags.some((tag) => RARE.has(tag))) ??
    kanji.find(usable) ??
    kana.find(usable) ??
    word.forms[0]
  );
}

function readingOf(word: StoredWord, headword: StoredForm, query: IdentifyQuery): StoredForm | undefined {
  // A kana headword reads as the kana form the reader met when the word has one (のだ met as んだ reads ンダ), else as
  // itself.
  if (headword.kana) {
    return word.forms.find((form) => form.kana && form.active && form.text === toHiragana(query.lemma)) ?? headword;
  }
  const options = word.forms.filter((form) => form.kana && usable(form) && appliesTo(form, headword.text));
  // Met in kana: the reading is the spelling the reader saw (羽 read は, not はね).
  const seen = options.find((form) => form.text === toHiragana(query.lemma));
  if (seen && !hasKanji(query.lemma)) return seen;
  if (query.reading && hasKanji(query.lemma)) {
    const wanted = stemReading(query.surface || query.lemma, query.reading);
    const fit = options.find((form) => stemReading(query.lemma, form.text) === wanted);
    if (fit) return fit;
  }
  return options[0] ?? word.forms.find((form) => form.kana);
}

/** English senses only, in upstream order; one definition per gloss, as the card expects. */
function sensesOf(word: StoredWord, tags: Record<string, string>) {
  const label = (code: string) => tags[code] ?? code;
  const ordered = word.senses.filter((sense) => sense.lang === 'eng').sort((a, b) => a.idx - b.idx);
  return ordered.map((sense, position) => {
    const notes = sense.info.filter((note) => note.trim());
    return {
      position,
      definitions: sense.glosses.map((gloss) => ({ lang: 'en' as const, text: gloss.text })),
      tags: [
        ...sense.pos.map((code) => ({ category: 'partOfSpeech' as const, code, label: label(code) })),
        ...sense.misc.map((code) => ({ category: 'misc' as const, code, label: label(code) })),
        ...sense.field.map((code) => ({ category: 'field' as const, code, label: label(code) })),
        ...sense.dialect.map((code) => ({ category: 'dialect' as const, code, label: label(code) })),
      ],
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
}

const pairKey = (text: string, reading: string) => `${text}\u0000${reading}`;

/** Where to look for a word's pitch, best first: its headword with its reading, then, for a kana headword, each
 * kanji spelling that reading belongs to (UniDic files こと under 事). */
function pitchKeys(word: StoredWord, headword: StoredForm | undefined, reading: StoredForm | undefined): string[] {
  if (!headword || !reading) return [];
  const keys = [pairKey(headword.text, reading.text)];
  if (headword.kana) {
    for (const form of word.forms) {
      if (!form.kana && usable(form) && appliesTo(reading, form.text)) keys.push(pairKey(form.text, reading.text));
    }
  }
  return keys;
}

/** One ruby per run of kanji: 自分 over じぶん rather than 自 じ + 分 ぶん. Kana between kanji
 * keeps its own segment (お + 前 まえ). */
export function groupKanjiRuns(
  segments: Array<{ text: string; ruby?: string }>,
): Array<{ text: string; ruby?: string }> {
  const out: Array<{ text: string; ruby?: string }> = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last?.ruby && segment.ruby)
      out[out.length - 1] = { text: last.text + segment.text, ruby: last.ruby + segment.ruby };
    else out.push({ ...segment });
  }
  return out;
}

/** Every spelling, kana and kanji taken in turn (きょう, 今日, こんにち, こんち…), the order the card lists them in.
 * Search-only spellings included. */
function interleaved(forms: StoredForm[]): StoredForm[] {
  const kana = forms.filter((form) => form.kana);
  const kanji = forms.filter((form) => !form.kana);
  const out: StoredForm[] = [];
  for (let i = 0; i < Math.max(kana.length, kanji.length); i++) {
    const pair = [kana[i], kanji[i]].filter((form): form is StoredForm => form !== undefined);
    out.push(...pair);
  }
  return out;
}

/** One stored word in the card's shape. `furigana` maps "spelling\0reading" to its ruby and `pitch` to its
 * downsteps. */
function toCandidate(
  { word, headword, reading }: { word: StoredWord; headword?: StoredForm; reading?: StoredForm },
  tags: Record<string, string>,
  furigana: Map<string, Array<{ text: string; ruby?: string }>>,
  pitch: Map<string, number[]> = new Map(),
): DictionaryCandidate {
  // A kana headword gets one ruby-less segment: the card then prints the word alone instead of
  // repeating it in katakana beside itself.
  const ruby =
    headword && reading && !headword.kana
      ? furigana.get(pairKey(headword.text, reading.text))
      : headword?.kana
        ? [{ text: headword.text }]
        : undefined;
  const downsteps = pitchKeys(word, headword, reading)
    .map((key) => pitch.get(key))
    .find((found) => found && found.length > 0);
  const dictionaryName = word.source === 'jmdict' ? 'JMdict' : 'JMnedict';

  return {
    id: `${word.source}:${word.id}`,
    headword: headword?.text ?? '',
    // Katakana: the card shows it beside a kana headword in the picker and keeps the hiragana
    // spelling among the forms, so the case is visible.
    reading: reading ? toKatakana(reading.text) : null,
    common: word.common,
    name: isName(word),
    sourceId: String(word.id),
    dictionary: word.source,
    jlpt: word.jlpt === null ? null : `N${word.jlpt}`,
    // Rank in our corpus, shown on the card as "#N" (it ranks words, not spellings).
    frequency: word.frequency?.rank ?? null,
    ...(ruby ? { furigana: groupKanjiRuns(ruby) } : {}),
    // The card draws at most two patterns, so a word with more keeps UniDic's first two.
    ...(downsteps ? { pitch: downsteps.slice(0, 2).map((downstep) => ({ downstep })) } : {}),
    forms: interleaved(word.forms.filter((form) => form.active)).map((form) => ({
      text: form.text,
      script: form.kana ? ('kana' as const) : ('kanji' as const),
      common: form.common,
    })),
    entries: [{ dictionary: word.source, dictionaryName, senses: sensesOf(word, tags) }],
  };
}

let tagCache: { at: number; tags: Record<string, string> } | null = null;
const TAG_CACHE_MS = 10 * 60_000;

async function tagLabels(dataSource: DataSource): Promise<Record<string, string>> {
  if (tagCache && Date.now() - tagCache.at < TAG_CACHE_MS) return tagCache.tags;
  const rows: Array<{ tags: Record<string, string> }> = await dataSource.query(
    `SELECT tags FROM dict.source WHERE name IN ('jmnedict', 'jmdict') ORDER BY name = 'jmdict'`,
  );
  // JMdict last, so its wording wins where both define a code.
  const tags = Object.assign({}, ...rows.map((row) => row.tags)) as Record<string, string>;
  tagCache = { at: Date.now(), tags };
  return tags;
}

/** The words filed under any of `keys`, JMdict first, with their forms, senses, JLPT level and frequency. */
export async function loadWords(dataSource: DataSource, keys: string[]): Promise<StoredWord[]> {
  const ids: Array<{ id: number }> = await dataSource.query(
    `SELECT DISTINCT w.id, w.source = 'jmdict' AS lexical
       FROM dict.lookup l JOIN dict.word w ON w.id = l.word_id
      WHERE l.key = ANY($1::varchar[])
      ORDER BY lexical DESC, w.id
      LIMIT $2`,
    [keys, MAX_FETCHED],
  );
  if (ids.length === 0) return [];
  const wordIds = ids.map((row) => row.id);

  const [words, forms, senses] = await Promise.all([
    dataSource.query(
      `SELECT w.id, w.source, w.common, w.active, j.level AS jlpt, f.rank, f.per_million
         FROM dict.word w
         LEFT JOIN dict.jlpt j ON j.word_id = w.id
         LEFT JOIN dict.frequency f ON f.word_id = w.id
        WHERE w.id = ANY($1::int[])`,
      [wordIds],
    ) as Promise<
      Array<Omit<StoredWord, 'forms' | 'senses' | 'frequency'> & { rank: number | null; per_million: number | null }>
    >,
    dataSource.query(
      `SELECT word_id, idx, text, kana, common, tags, applies_to_kanji, active
         FROM dict.form WHERE word_id = ANY($1::int[]) ORDER BY word_id, idx`,
      [wordIds],
    ) as Promise<Array<StoredForm & { word_id: number }>>,
    dataSource.query(
      `SELECT word_id, idx, lang, pos, misc, field, dialect, info, applies_to_kanji, applies_to_kana, glosses
         FROM dict.sense WHERE word_id = ANY($1::int[]) ORDER BY word_id, idx`,
      [wordIds],
    ) as Promise<Array<StoredSense & { word_id: number }>>,
  ]);

  const formsByWord = groupByWord(forms);
  const sensesByWord = groupByWord(senses);
  return words.map(({ rank, per_million, ...word }) => ({
    ...word,
    frequency: rank === null ? null : { rank, perMillion: per_million ?? 0 },
    forms: formsByWord.get(word.id) ?? [],
    senses: sensesByWord.get(word.id) ?? [],
  }));
}

/** Rows grouped by `word_id`, each group in the rows' order. */
function groupByWord<T extends { word_id: number }>(rows: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const row of rows) {
    const list = out.get(row.word_id);
    if (list) list.push(row);
    else out.set(row.word_id, [row]);
  }
  return out;
}

/** Parts of speech a word spelled like the whole surface may have, by the token's own: what JMdict files inflected
 * forms under. A verb's surface may be an expression (すみません), an adjective's an adverb (早く), the copula's an
 * expression, or a conjunction of three kana or more (だった, だろう, だったら; not じゃ, which is じゃあ "then"). */
const SURFACE_POS: Record<string, (code: string, surface: string) => boolean> = {
  verb: (code) => code === 'exp' || code === 'int' || POS_FAMILIES.verb?.(code) === true,
  adj: (code) => code === 'exp' || /^adv/.test(code) || POS_FAMILIES.adj?.(code) === true,
  aux: (code, surface) => code === 'exp' || /^aux/.test(code) || (code === 'conj' && [...surface].length >= 3),
};
const SURFACE_POS_OTHERWISE = (code: string) =>
  code === 'exp' || /^adv/.test(code) || code === 'conj' || code === 'prt' || /^aux/.test(code) || code === 'int';

/**
 * A JMdict word spelled exactly like the token's surface, which the card shows before the lemma's: だった
 * rather than だ, 確かに rather than 確か, される rather than する. Guarded so a homograph cannot slip in that way:
 * a kana surface only matches a kanji word usually written in kana (しよう is not 使用), the reading must be the
 * token's, and the part of speech must be the token's or a function word's, and the word common (だし is not 出汁; して stays する).
 */
export function surfaceWord(words: StoredWord[], query: IdentifyQuery): StoredWord | undefined {
  const surface = query.surface;
  if (!surface || surface === query.lemma) return undefined;
  const family = query.pos ? POS_FAMILIES[query.pos] : undefined;
  const reading = query.reading ? toHiragana(query.reading) : undefined;
  const fits = (word: StoredWord) => {
    if (word.source !== 'jmdict' || !word.active || isName(word)) return false;
    const spelled = word.forms.find((form) => form.text === surface && usable(form));
    if (!spelled) return false;
    if (spelled.kana && word.forms.some((form) => !form.kana) && !usuallyKana(word)) return false;
    if (reading && !word.forms.some((form) => form.kana && form.active && toHiragana(form.text) === reading)) {
      return false;
    }
    const codes = word.senses.flatMap((sense) => sense.pos);
    // Common words only: rare entries spelled like an inflection (して prt, し aux-v, で aux, じゃ cop, 来た int)
    // must not take the card from the verb or copula the reader met.
    if (!word.common) return false;
    const inflecting = SURFACE_POS[query.pos ?? ''];
    if (inflecting) {
      // An inflection is never a particle, whatever else the word is: で, し and な (静かな) are particles too.
      if (codes.includes('prt')) return false;
      return codes.some((code) => inflecting(code, surface));
    }
    return codes.some(SURFACE_POS_OTHERWISE) || (family ? codes.some(family) : false);
  };
  const surfaceQuery = { ...query, lemma: surface };
  return words
    .filter(fits)
    .map((word) => ({ word, score: scoreWord(word, surfaceQuery) }))
    .sort((a, b) => b.score - a.score || a.word.id - b.word.id)[0]?.word;
}

/** What a token written with ASCII may be filed under: full-width (L → Ｌ, FBI → ＦＢＩ) and, for digits, kanji
 * numerals (1 → 一, 2人 → 二人). Empty when the text has no ASCII. */
export function asciiVariants(text: string): string[] {
  if (!/[!-~]/.test(text)) return [];
  const wide = text.replace(/[!-~]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0));
  const numerals = text.replace(/[0-9]/g, (digit) => '〇一二三四五六七八九'[Number(digit)] ?? digit);
  return [...new Set([wide, numerals].filter((variant) => variant !== text))];
}

/** Ranked candidates for one token, best first; empty when nothing matches. */
export async function identifyWord(dataSource: DataSource, query: IdentifyQuery): Promise<DictionaryCandidate[]> {
  // The words the surface may be an inflection of depend only on the query, so they load alongside the rest.
  const [lemmaWords, surfaceWords, baseWords] = await Promise.all([
    loadWords(dataSource, lookupKeys(query.lemma)),
    query.surface && query.surface !== query.lemma ? loadWords(dataSource, lookupKeys(query.surface)) : [],
    baseFormWords(dataSource, query),
  ]);
  let words = lemmaWords;
  // A lemma the dictionary does not know (Sudachi's lemma for a merged token, say) can still be found by surface.
  if (words.length === 0) words = surfaceWords;
  // Then by its full-width or kanji-numeral spelling, for tokens written in ASCII.
  if (words.length === 0) {
    const variants = asciiVariants(query.surface || query.lemma).flatMap(lookupKeys);
    if (variants.length > 0) words = await loadWords(dataSource, variants);
  }
  // Last, an inflected form no dictionary files (食べた, 行かない): the words it is a conjugation of, marked so a
  // caller can say "a form of 食べる" rather than present 食べる as what was looked up.
  let fromBase = new Set<number>();
  if (words.length === 0) {
    words = baseWords;
    fromBase = new Set(words.map((word) => word.id));
  }
  if (words.length === 0) return [];

  const exact = surfaceWord(surfaceWords, query);
  const surfaceQuery = { ...query, lemma: query.surface ?? query.lemma };
  const queryFor = (word: StoredWord) => (word === exact ? surfaceQuery : query);

  const ranked = [
    ...(exact ? [exact] : []),
    ...words
      .filter((word) => word.id !== exact?.id)
      .map((word) => ({ word, score: scoreWord(word, query) }))
      .sort((a, b) => b.score - a.score || a.word.id - b.word.id)
      .map(({ word }) => word),
  ].slice(0, MAX_CANDIDATES);

  ranked.splice(0, ranked.length, ...rowFilter(ranked));
  // Other words the surface may be an inflection of, after ours: 分かった can also be 分かつ, 食べられない 食べられる.
  const rankedIds = new Set(ranked.map((word) => word.id));
  const others = baseWords.filter((word) => !rankedIds.has(word.id));
  for (const word of others) if (ranked.length < MAX_CANDIDATES) ranked.push(word);

  const picks = ranked.map((word) => {
    const headword = headwordOf(word, queryFor(word));
    return { word, headword, reading: headword ? readingOf(word, headword, queryFor(word)) : undefined };
  });
  const pairs = picks.flatMap(({ headword, reading }) =>
    headword && reading && !headword.kana ? [{ text: headword.text, reading: reading.text }] : [],
  );
  const pitchPairs = picks.flatMap(({ word, headword, reading }) =>
    pitchKeys(word, headword, reading).map((key) => {
      const [text, read] = key.split('\u0000');
      return { text, reading: read };
    }),
  );
  type RubyRow = { text: string; reading: string; segments: Array<{ text: string; ruby?: string }> };
  type PitchRow = { text: string; reading: string; downsteps: number[] };
  const [tags, rubyRows, pitchRows, parts, byCategory] = await Promise.all([
    tagLabels(dataSource),
    pairs.length === 0
      ? ([] as RubyRow[])
      : (dataSource.query(
          `SELECT DISTINCT ON (f.text, f.reading) f.text, f.reading, f.segments
             FROM dict.furigana f
             JOIN jsonb_to_recordset($1::jsonb) AS x(text varchar, reading varchar)
               ON f.text = x.text AND f.reading = x.reading
            ORDER BY f.text, f.reading, f.source = 'jmdict-furigana' DESC`,
          [JSON.stringify(pairs)],
        ) as Promise<RubyRow[]>),
    pitchPairs.length === 0
      ? ([] as PitchRow[])
      : (dataSource.query(
          // UniDic last, so where both sources have a spelling and reading its accent is the one kept below.
          `SELECT p.text, p.reading, p.downsteps
             FROM dict.pitch p
             JOIN jsonb_to_recordset($1::jsonb) AS x(text varchar, reading varchar)
               ON p.text = x.text AND p.reading = x.reading
            ORDER BY p.source = 'unidic'`,
          [JSON.stringify(pitchPairs)],
        ) as Promise<PitchRow[]>),
    partsOf(
      dataSource,
      picks.map(({ headword }) => headword?.text ?? ''),
    ),
    categoryFrequency(
      dataSource,
      ranked.map((word) => word.id),
    ),
  ]);
  const furigana = new Map(rubyRows.map((row) => [pairKey(row.text, row.reading), row.segments]));
  const pitch = new Map(pitchRows.map((row) => [pairKey(row.text, row.reading), row.downsteps]));

  const candidates = picks.map((pick) => toCandidate(pick, tags, furigana, pitch));
  return candidates.map((candidate, index) => {
    const found = parts[index];
    const split = byCategory.get(ranked[index]?.id ?? -1);
    return {
      ...candidate,
      ...(found ? { parts: found } : {}),
      ...(split ? { frequencyByCategory: split } : {}),
      ...baseFormFields(query.surface || query.lemma, ranked[index], fromBase),
    };
  });
}

/** Each word's rank per kind of media, most used kind first (by occurrences per million words of that kind). */
async function categoryFrequency(
  dataSource: DataSource,
  wordIds: number[],
): Promise<Map<number, NonNullable<DictionaryCandidate['frequencyByCategory']>>> {
  const out = new Map<number, NonNullable<DictionaryCandidate['frequencyByCategory']>>();
  if (wordIds.length === 0) return out;
  type Category = NonNullable<DictionaryCandidate['frequencyByCategory']>[number]['category'];
  let rows: Array<{ word_id: number; category: Category; rank: number; per_million: number }>;
  try {
    rows = await dataSource.query(
      `SELECT word_id, category, rank, per_million FROM dict.frequency_category
        WHERE word_id = ANY($1::int[])
        ORDER BY word_id, per_million DESC, category`,
      [wordIds],
    );
  } catch (error) {
    // An extra on the card: never worth failing the lookup for.
    logger.warn({ err: error }, 'Could not read the per-category frequency; the card goes without it');
    return out;
  }
  for (const row of rows) {
    const list = out.get(row.word_id) ?? [];
    list.push({ category: row.category, rank: row.rank, perMillion: row.per_million });
    out.set(row.word_id, list);
  }
  return out;
}

/** `baseForm` and `inflection` for a candidate found only as the dictionary form of the text looked up. */
function baseFormFields(
  surface: string,
  word: StoredWord | undefined,
  fromBase: Set<number>,
): Pick<DictionaryCandidate, 'baseForm' | 'inflection'> {
  if (!word || !fromBase.has(word.id)) return {};
  const labels = baseFormLabels(surface, word);
  return labels.length > 0 ? { baseForm: true, inflection: labels } : { baseForm: true };
}

/**
 * What a conjugation does to a word, in the word card's inflection labels (食べた → 食べる: past; 行かない → 行く:
 * negative): the shortest real deconjugation of `surface` that lands on one of the word's spellings with a part of
 * speech it has. The same labels the parser stores on tokens (./labels), so the entry and the card say the same.
 */
function baseFormLabels(surface: string, word: StoredWord): string[] {
  let best: readonly string[] | null = null;
  for (const form of deconjugate(surface)) {
    const tag = form.tags.at(-1);
    if (!tag || tag.startsWith('stem') || form.text === surface) continue;
    if (form.process.some((step) => step.includes('slang'))) continue;
    if (!word.forms.some((spelling) => spelling.text === form.text && usable(spelling))) continue;
    if (!word.senses.some((sense) => sense.pos.includes(tag))) continue;
    if (!best || form.process.length < best.length) best = form.process;
  }
  return best ? inflectionLabels(best, surface) : [];
}

/** Deconjugation steps that only take a verb to its stem or te-form. */
const STEM_STEPS = new Set(['(infinitive)', '(te form)', '(unstressed infinitive)']);

/**
 * The candidate row offers no names under a word that is not one (のか: not the name 温夏; という: not 伊藤).
 * Homographs of any part of speech stay (もう: 盲, 網, 猛). The first candidate is never dropped. Exported for tests.
 */
export function rowFilter(ranked: StoredWord[]): StoredWord[] {
  const [first, ...rest] = ranked;
  if (!first || isName(first)) return ranked;
  return [first, ...rest.filter((word) => !isName(word))];
}

/**
 * JMdict words the token's surface is an inflection of, best first: every base form the
 * deconjugator reaches whose grammatical tag one of the word's senses carries (分かった: 分かつ v5t; 食べられない:
 * 食べられる v1; 初めて: 初める), offered in the candidate row. Stems and made-up forms (分かう) find nothing.
 */
async function baseFormWords(dataSource: DataSource, query: IdentifyQuery): Promise<StoredWord[]> {
  // The surface as met, or the lemma when the token is already a dictionary form: 初めて can still be 初める's
  // te-form, 本当に 本当 with に.
  const surface = query.surface || query.lemma;
  const tagsByText = new Map<string, Set<string>>();
  // A word that inflects may be any real conjugation of another (never a slang one: そんな is not 剃る's "slang
  // negative"); anything else only a stem or te-form of a verb (感じ: 感じる, 初めて: 初める), not しかし as 敷く.
  const inflects = !query.pos || ['verb', 'adj', 'aux', 'exp'].includes(query.pos);
  for (const form of deconjugate(surface)) {
    const tag = form.tags.at(-1);
    if (!tag || tag.startsWith('stem') || form.text === surface || form.text === query.lemma) continue;
    if (form.process.some((step) => step.includes('slang'))) continue;
    if (!inflects && (form.process.length > 2 || !form.process.every((step) => STEM_STEPS.has(step)))) continue;
    const seen = tagsByText.get(form.text) ?? new Set<string>();
    seen.add(tag);
    tagsByText.set(form.text, seen);
  }
  if (tagsByText.size === 0) return [];
  const words = await loadWords(dataSource, [...tagsByText.keys()]);
  return words
    .filter((word) => word.source === 'jmdict' && word.active && !isName(word))
    .map((word) => {
      const text = [...tagsByText.keys()].find((key) => word.forms.some((form) => form.text === key && usable(form)));
      const tags = text ? tagsByText.get(text) : undefined;
      const fits = tags && word.senses.some((sense) => sense.pos.some((code) => tags.has(code)));
      return fits && text ? { word, score: scoreWord(word, { ...query, lemma: text }) } : null;
    })
    .filter((entry): entry is { word: StoredWord; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.word.id - b.word.id)
    .map((entry) => entry.word);
}

/** Content words, the only pieces a part is made of: grammar is not split out (お母さん, 私たち, だった and
 * お願いします have no parts; 捜査本部, そういう and あの子 do). A verb counts unless it is a
 * support verb (する, ある, いる, ござる: 非自立可能); an adjective counts even then (わけではない: わけ, ない). */
function isContent(m: Morpheme): boolean {
  const [pos1, pos2] = m.pos;
  if (pos1 === '動詞') return pos2 !== '非自立可能';
  return ['名詞', '代名詞', '形容詞', '形状詞', '副詞', '連体詞'].includes(pos1);
}

/**
 * The words each headword is made of, as the card shows them: the headword cut into Sudachi's shortest units
 * (split mode A), grammar left out, each piece given to the JMdict word our ranking picks for it. Null for a
 * headword that does not split into at least two such words. One sidecar call for all of them; without the sidecar
 * (SUDACHI_URL unset, or down) the card goes without parts rather than failing. Exported for tests.
 */
const PARTS_CONCURRENCY = 4;

export async function partsOf(
  dataSource: DataSource,
  headwords: string[],
  split?: (texts: string[]) => Promise<Morpheme[][]>,
): Promise<Array<DictionaryCandidate['parts'] | null>> {
  const splitter = split ?? (config.SUDACHI_URL ? (texts: string[]) => analyse(texts, 'A') : undefined);
  if (!splitter) return headwords.map(() => null);
  const wanted = headwords.map((headword) => headword.length > 1);
  if (!wanted.some(Boolean)) return headwords.map(() => null);

  let analysed: Morpheme[][];
  try {
    analysed = await splitter(headwords.map((headword, index) => (wanted[index] ? headword : '')));
  } catch (error) {
    logger.warn({ err: error }, 'Could not split headwords into parts; the card goes without them');
    return headwords.map(() => null);
  }

  const keyOf = (m: Morpheme) => `${m.d}\u0000${m.s}\u0000${m.r}`;
  const splits = Array.from(analysed, (morphemes, index) =>
    wanted[index] && morphemes && morphemes.length >= 2 ? morphemes.filter(isContent) : null,
  );

  // Each distinct content morpheme gets its own lookup (one shared lookup would hit the MAX_FETCHED cap and change
  // what each finds), PARTS_CONCURRENCY at a time so one word card cannot crowd the connection pool.
  const unique = new Map<string, Morpheme>();
  for (const m of splits.flatMap((content) => content ?? [])) if (!unique.has(keyOf(m))) unique.set(keyOf(m), m);
  const resolveOne = async ([key, m]: [string, Morpheme]) => {
    const words = (await loadWords(dataSource, lookupKeys(m.d))).filter(
      (word) => word.source === 'jmdict' && word.active,
    );
    const pos = tokenPos(m.pos, 'word', m.d).pt;
    const query: IdentifyQuery = { lemma: m.d, surface: m.s, reading: m.r, pos, locale: 'en' };
    const best = words
      .map((word) => ({ word, score: scoreWord(word, query) }))
      .sort((a, b) => b.score - a.score || a.word.id - b.word.id)[0]?.word;
    return [key, best ? `${best.source}:${best.id}` : null] as const;
  };
  const entries = [...unique];
  const resolved = new Map<string, string | null>();
  for (let i = 0; i < entries.length; i += PARTS_CONCURRENCY) {
    for (const [key, id] of await Promise.all(entries.slice(i, i + PARTS_CONCURRENCY).map(resolveOne))) {
      resolved.set(key, id);
    }
  }

  return splits.map((content) => {
    if (!content) return null;
    const parts: NonNullable<DictionaryCandidate['parts']> = [];
    for (const m of content) {
      const id = resolved.get(keyOf(m));
      if (id) parts.push({ text: m.s, lemma: m.d, reading: m.r, id });
    }
    return parts.length >= 2 ? parts : null;
  });
}

export const __testing = { POS_FAMILIES, NAME_TYPES, resetTagCache: () => (tagCache = null) };
