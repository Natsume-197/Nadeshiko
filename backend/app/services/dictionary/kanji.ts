import type { DataSource } from 'typeorm';
import { toHiragana } from './import/entries';

/**
 * The kanji card (task 44): everything the word card shows when a reader opens one of a word's kanji. KANJIDIC2 for
 * readings, meanings and radical, KRADFILE for its parts, KanjiVG for the stroke order, Waller's lists for JLPT, Kanji
 * alive for radical names, and, what no other dictionary can give, the words written with it that our own subtitles
 * use most, also sorted under the reading the kanji has in each (from JmdictFurigana).
 */

export interface KanjiComponent {
  character: string;
  /** Has a kanji card of its own, so the card can open it. KRADFILE also lists strokes and radical shapes (ノ, ⻌). */
  hasCard: boolean;
  /** The kanji's first meaning, or the radical's (Kanji alive, English) for a shape with no card. */
  meaning: string | null;
}

export interface KanjiWord {
  id: string;
  /** The spelling with this kanji: the word's most common one that contains it. */
  headword: string;
  reading: string | null;
  /** Rank in our corpus, 1 being the most frequent word. */
  frequency: number;
  /** The first sense's first glosses in the requested language, English when it has none. */
  gloss: string | null;
}

export interface KanjiExample extends Pick<KanjiWord, 'id' | 'headword' | 'reading'> {
  /** The headword as JmdictFurigana splits it, ruby over each kanji run (`[{text: '食', ruby: 'しょく'}, …]`). */
  furigana: Array<{ text: string; ruby?: string }>;
}

export interface KanjiReading {
  kind: 'on' | 'kun';
  /** As KANJIDIC2 writes it: katakana for on, hiragana with `.` before the okurigana for kun. */
  reading: string;
  /** Up to three of our most frequent words where the kanji is read this way. */
  examples: KanjiExample[];
}

export interface KanjiRadical {
  glyph: string;
  number: number;
  reading: string;
  meaning: string;
  /** The kanji this radical is written as, when it has a card (⾷ is 食). */
  character: string | null;
}

export interface RelatedKanji {
  character: string;
  reading: string | null;
  meaning: string | null;
  /** School grade, as on the kanji's own card: 1-6 and 8 are jōyō, 9-10 jinmeiyō. */
  grade: number | null;
}

export interface KanjiCard {
  character: string;
  strokeCount: number;
  /** KANJIDIC2's school grade: 1-6 elementary, 8 the rest of the jōyō list, 9-10 jinmeiyō (names). */
  grade: number | null;
  /** Rank among the 2,500 most used kanji in newspapers. */
  frequency: number | null;
  /** Rank by how often it is written in our own sentences (`dict.kanji_frequency`); null before the first count. */
  corpusRank: number | null;
  /** Current JLPT level (5 = N5), from Waller's unofficial lists. */
  jlpt: number | null;
  /** Kanji Kentei level it is tested at (`10級` easiest to `1級`), from mimneko/kanji-data. */
  kanken: string | null;
  radical: KanjiRadical | null;
  readings: KanjiReading[];
  /** In the requested language when KANJIDIC2 has it there; otherwise English. */
  meanings: string[];
  meaningsLanguage: 'en' | 'es';
  components: KanjiComponent[];
  /** One SVG path (KanjiVG, 109×109 view box) per stroke, in writing order; empty when KanjiVG does not draw it. */
  strokes: string[];
  /** Where KanjiVG places each stroke's number, `[x, y]`; empty when it has none. */
  strokeNumbers: Array<[number, number]>;
  words: KanjiWord[];
  /** Other kanji filed under the same radical, school kanji first. */
  sameRadical: RelatedKanji[];
  sameRadicalCount: number;
  /** Kanji built with this one as a part (KRADFILE), school kanji first. */
  containedIn: RelatedKanji[];
  containedInCount: number;
}

/** How many words the card can list (it shows the first few and expands). */
export const KANJI_WORDS = 40;
/** How many of our most frequent words are sorted under the readings. */
const READING_SAMPLE = 200;
const EXAMPLES_PER_READING = 3;
/** How many related kanji each list carries on the card, and on the kanji's own page (`related: 'all'`). */
export const RELATED_KANJI = 12;
export const RELATED_KANJI_ALL = 3000;
/** How many glosses of a word's first sense make its one-line summary. */
const GLOSSES_PER_WORD = 3;

/** One character: a single code point (some kanji are outside the BMP, so not `length === 1`). */
export function isSingleCharacter(text: string): boolean {
  return [...text].length === 1;
}

/** The voiced forms a reading's first kana takes under rendaku. */
const VOICED: Record<string, string[]> = {
  か: ['が'],
  き: ['ぎ'],
  く: ['ぐ'],
  け: ['げ'],
  こ: ['ご'],
  さ: ['ざ'],
  し: ['じ'],
  す: ['ず'],
  せ: ['ぜ'],
  そ: ['ぞ'],
  た: ['だ'],
  ち: ['ぢ', 'じ'],
  つ: ['づ', 'ず'],
  て: ['で'],
  と: ['ど'],
  は: ['ば', 'ぱ'],
  ひ: ['び', 'ぴ'],
  ふ: ['ぶ', 'ぷ'],
  へ: ['べ', 'ぺ'],
  ほ: ['ぼ', 'ぽ'],
};

/** The ways a reading can be written in a word's furigana: as is, with rendaku (こ → ご in 子供 → 双子), and shortened
 * before a doubled consonant (しょく → しょっ in 食器). */
export function readingForms(stem: string): Set<string> {
  const forms = new Set([stem]);
  for (const voiced of VOICED[stem[0] ?? ''] ?? []) forms.add(voiced + stem.slice(1));
  for (const form of [...forms]) {
    if (form.length > 1 && 'つちくき'.includes(form.at(-1) ?? '')) forms.add(`${form.slice(0, -1)}っ`);
  }
  return forms;
}

export interface ReadingKey {
  index: number;
  forms: Set<string>;
  okurigana: string;
}

/** A KANJIDIC2 reading as furigana would show it: hiragana, without the prefix/suffix marks, okurigana split off. */
export function readingKey(reading: string, index: number): ReadingKey {
  const plain = toHiragana(reading.replace(/-/g, ''));
  const dot = plain.indexOf('.');
  const stem = dot === -1 ? plain : plain.slice(0, dot);
  return { index, forms: readingForms(stem), okurigana: dot === -1 ? '' : plain.slice(dot + 1) };
}

/** Which of the kanji's readings it has in one word, from that word's furigana: the reading whose written forms include
 * the kanji's ruby, and among kun readings sharing a stem (く.う, く.らう) the one whose okurigana the following kana
 * agree with longest. Null for a reading none of them explains (今日 read as one きょう has no ruby for 今 alone). */
export function readingInWord(
  segments: Array<{ text: string; ruby?: string }>,
  character: string,
  keys: ReadingKey[],
): number | null {
  const at = segments.findIndex((segment) => segment.text === character && segment.ruby);
  if (at === -1) return null;
  const ruby = segments[at]?.ruby ?? '';
  const after = segments
    .slice(at + 1)
    .filter((segment) => !segment.ruby)
    .map((segment) => segment.text)
    .join('');

  let best: { index: number; score: number } | null = null;
  for (const key of keys) {
    if (!key.forms.has(ruby)) continue;
    let score = 0;
    while (score < key.okurigana.length && key.okurigana[score] === after[score]) score += 1;
    // Okurigana the word does not have means another reading: 食 read た in 食べ物 is た.べる, not た.ぶ.
    if (key.okurigana && after && score === 0) continue;
    if (!best || score > best.score) best = { index: key.index, score };
  }
  return best?.index ?? null;
}

interface KanjiRowResult {
  character: string;
  stroke_count: number;
  grade: number | null;
  frequency: number | null;
  corpus_rank: number | null;
  radical: number | null;
  on_readings: string[];
  kun_readings: string[];
  meanings_en: string[];
  jlpt: number | null;
  kanken: string | null;
  components: Array<{ character: string; has_card: boolean; meaning: string | null }> | null;
  strokes: string[] | null;
  stroke_numbers: Array<[number, number]> | null;
}

interface WordRowResult {
  word_id: number;
  headword: string;
  reading: string | null;
  rank: number;
  segments: Array<{ text: string; ruby?: string }> | null;
  glosses_en: Array<{ text: string }> | null;
}

interface RelatedRowResult {
  character: string;
  reading: string | null;
  meaning: string | null;
  grade: number | null;
  total: number;
}

/** First English meaning of a kanji. */
const meaningSql = (alias: string) => `${alias}.meanings_en[1]`;

/**
 * One kanji's card. `related: 'all'` lists every kanji under the same radical and every kanji built with it (for the
 * kanji's own page); the word card asks for the first few only.
 */
export async function kanjiCard(
  dataSource: DataSource,
  character: string,
  _locale: 'en' | 'es',
  options: { related?: 'short' | 'all' } = {},
): Promise<KanjiCard | null> {
  const relatedLimit = options.related === 'all' ? RELATED_KANJI_ALL : RELATED_KANJI;
  const [row]: KanjiRowResult[] = await dataSource.query(
    `SELECT k.character, k.stroke_count, k.grade, k.frequency, k.radical, k.on_readings, k.kun_readings, k.meanings_en,
            j.level AS jlpt, kk.level AS kanken, kf.rank AS corpus_rank, s.paths AS strokes,
            s.numbers AS stroke_numbers,
            (SELECT jsonb_agg(jsonb_build_object(
                      'character', part,
                      'has_card', o.character IS NOT NULL,
                      'meaning', coalesce(${meaningSql('o')}, r.meaning))
                    ORDER BY ord)
               FROM unnest(c.components) WITH ORDINALITY AS u(part, ord)
               LEFT JOIN dict.kanji o ON o.character = part
               LEFT JOIN dict.radical r ON r.glyph = part
              WHERE part <> k.character) AS components
       FROM dict.kanji k
       LEFT JOIN dict.kanji_component c ON c.character = k.character
       LEFT JOIN dict.kanji_strokes s ON s.character = k.character
       LEFT JOIN dict.kanji_jlpt j ON j.character = k.character
       LEFT JOIN dict.kanji_kanken kk ON kk.character = k.character
       LEFT JOIN dict.kanji_frequency kf ON kf.character = k.character
      WHERE k.character = $1`,
    [character],
  );
  if (!row) return null;

  const [words, radical, sameRadical, containedIn] = await Promise.all([
    wordsWith(dataSource, character),
    radicalOf(dataSource, row.radical),
    relatedKanji(
      dataSource,
      `FROM dict.kanji k WHERE k.radical = $2 AND k.character <> $1`,
      [character, row.radical ?? -1],
      relatedLimit,
    ),
    relatedKanji(
      dataSource,
      // Not the ones already listed under the same radical: for a kanji that is a radical itself (食), most kanji that
      // contain it are filed under it.
      `FROM dict.kanji_component c JOIN dict.kanji k ON k.character = c.character
        WHERE c.components @> ARRAY[$1] AND c.character <> $1 AND k.radical IS DISTINCT FROM $2`,
      [character, row.radical ?? -1],
      relatedLimit,
    ),
  ]);

  return {
    character: row.character,
    strokeCount: row.stroke_count,
    grade: row.grade,
    frequency: row.frequency,
    corpusRank: row.corpus_rank,
    jlpt: row.jlpt,
    kanken: row.kanken,
    radical,
    readings: await readingsWithExamples(dataSource, row, words),
    meanings: row.meanings_en,
    meaningsLanguage: 'en',
    components: (row.components ?? []).map((part) => ({
      character: part.character,
      hasCard: part.has_card,
      meaning: part.meaning,
    })),
    strokes: row.strokes ?? [],
    strokeNumbers: row.stroke_numbers ?? [],
    words: words.slice(0, KANJI_WORDS).map((word) => {
      const glosses = word.glosses_en ?? [];
      return {
        id: `jmdict:${word.word_id}`,
        headword: word.headword,
        reading: word.reading,
        frequency: word.rank,
        gloss:
          glosses.length > 0
            ? glosses
                .slice(0, GLOSSES_PER_WORD)
                .map((gloss) => gloss.text)
                .join('; ')
            : null,
      };
    }),
    sameRadical: sameRadical.map(({ character, reading, meaning, grade }) => ({ character, reading, meaning, grade })),
    sameRadicalCount: sameRadical[0]?.total ?? 0,
    containedIn: containedIn.map(({ character, reading, meaning, grade }) => ({ character, reading, meaning, grade })),
    containedInCount: containedIn[0]?.total ?? 0,
  };
}

/** Our most frequent words written with the kanji, with each one's furigana so the readings can be told apart. */
function wordsWith(dataSource: DataSource, character: string): Promise<WordRowResult[]> {
  return dataSource.query(
    // Words our corpus counted, spelled with this kanji in one of their active written forms. The forms are found
    // through `form_chars_idx`, so the cost follows how many spellings use the kanji (a few thousand at most), not the
    // size of the ranking. The spelling shown is the most common form with the kanji; the reading is the first kana
    // form that applies to it.
    `WITH top AS (
       SELECT fr.word_id, fr.rank,
              (SELECT f.text FROM dict.form f
                WHERE f.word_id = fr.word_id AND NOT f.kana AND f.active AND string_to_array(f.text, NULL) @> ARRAY[$1]
                ORDER BY f.common DESC, f.idx LIMIT 1) AS text
         FROM dict.frequency fr
         JOIN dict.word w ON w.id = fr.word_id AND w.active AND w.source = 'jmdict'
        WHERE EXISTS (SELECT 1 FROM dict.form f
                       WHERE f.word_id = fr.word_id AND NOT f.kana AND f.active
                         AND string_to_array(f.text, NULL) @> ARRAY[$1])
        ORDER BY fr.rank
        LIMIT $2
     ), read AS (
       SELECT t.*,
              (SELECT k.text FROM dict.form k
                WHERE k.word_id = t.word_id AND k.kana AND k.active
                  AND (k.applies_to_kanji = '{}' OR '*' = ANY (k.applies_to_kanji) OR t.text = ANY (k.applies_to_kanji))
                ORDER BY k.idx LIMIT 1) AS reading
         FROM top t
     ), numbered AS (
       SELECT r.*, row_number() OVER (ORDER BY r.rank) AS n FROM read r
     )
     SELECT r.word_id, r.text AS headword, r.rank, r.reading,
            (SELECT fu.segments FROM dict.furigana fu
              WHERE fu.text = r.text AND fu.reading = r.reading AND fu.source = 'jmdict-furigana') AS segments,
            -- Glosses only for the words the card lists; the rest are only sorted under readings.
            CASE WHEN r.n <= $3 THEN
              (SELECT s.glosses FROM dict.sense s WHERE s.word_id = r.word_id AND s.lang = 'eng' ORDER BY s.idx LIMIT 1)
            END AS glosses_en
       FROM numbered r
      ORDER BY r.rank`,
    [character, READING_SAMPLE, KANJI_WORDS],
  );
}

async function radicalOf(dataSource: DataSource, number: number | null): Promise<KanjiRadical | null> {
  if (number === null) return null;
  const [radical]: Array<{ glyph: string; number: number; reading: string; meaning: string }> = await dataSource.query(
    `SELECT glyph, number, reading, meaning FROM dict.radical WHERE number = $1 AND variant_of IS NULL`,
    [number],
  );
  if (!radical) return null;
  // A Kangxi radical code point decomposes to the kanji it is written as (⾷ to 食).
  const asKanji = radical.glyph.normalize('NFKC');
  const [card] = await dataSource.query(`SELECT 1 FROM dict.kanji WHERE character = $1`, [asKanji]);
  return { ...radical, character: card ? asKanji : null };
}

/** School kanji first (by grade), then names, then the rest; within each, the more frequent first. */
function relatedKanji(
  dataSource: DataSource,
  from: string,
  params: unknown[],
  limit: number,
): Promise<RelatedRowResult[]> {
  return dataSource.query(
    `SELECT k.character, coalesce(k.on_readings[1], k.kun_readings[1]) AS reading, ${meaningSql('k')} AS meaning,
            k.grade, count(*) OVER ()::int AS total
       ${from}
      ORDER BY coalesce(k.grade, 99), coalesce(k.frequency, 9999), k.character
      LIMIT ${Number(limit)}`,
    params,
  );
}

/** How many of the dictionary's words with the kanji are tried for readings our corpus left without examples. */
const DICTIONARY_SAMPLE = 400;

type ExampleRow = Pick<WordRowResult, 'word_id' | 'headword' | 'reading' | 'segments'>;

/**
 * Words written with the kanji straight from the dictionary, common spellings and short words first: examples for a
 * reading our subtitles never use (食 read ジキ in 餌食 and 断食), or that a small corpus has not met yet.
 */
function dictionaryWordsWith(dataSource: DataSource, character: string): Promise<ExampleRow[]> {
  return dataSource.query(
    `WITH forms AS (
       SELECT DISTINCT ON (f.word_id) f.word_id, f.text, f.common AS form_common, w.common AS word_common
         FROM dict.form f
         JOIN dict.word w ON w.id = f.word_id AND w.active AND w.source = 'jmdict'
        WHERE NOT f.kana AND f.active AND string_to_array(f.text, NULL) @> ARRAY[$1]
        ORDER BY f.word_id, f.common DESC, f.idx
     ), top AS (
       SELECT * FROM forms
        ORDER BY form_common DESC, word_common DESC, char_length(text), word_id
        LIMIT $2
     ), read AS (
       SELECT t.word_id, t.text, t.form_common, t.word_common,
              (SELECT k.text FROM dict.form k
                WHERE k.word_id = t.word_id AND k.kana AND k.active
                  AND (k.applies_to_kanji = '{}' OR '*' = ANY (k.applies_to_kanji) OR t.text = ANY (k.applies_to_kanji))
                ORDER BY k.idx LIMIT 1) AS reading
         FROM top t
     )
     SELECT r.word_id, r.text AS headword, r.reading,
            (SELECT fu.segments FROM dict.furigana fu
              WHERE fu.text = r.text AND fu.reading = r.reading AND fu.source = 'jmdict-furigana') AS segments
       FROM read r
      ORDER BY r.form_common DESC, r.word_common DESC, char_length(r.text), r.word_id`,
    [character, DICTIONARY_SAMPLE],
  );
}

/**
 * The kanji's readings, on first, each with up to three example words: our corpus's most frequent first, so the
 * examples are the words a reader of anime meets; a reading the corpus gives none gets the dictionary's common words
 * instead. A reading still empty after both is one learners will rarely meet.
 */
async function readingsWithExamples(
  dataSource: DataSource,
  row: KanjiRowResult,
  words: WordRowResult[],
): Promise<KanjiReading[]> {
  const all = [
    ...row.on_readings.map((reading) => ({ kind: 'on' as const, reading })),
    ...row.kun_readings.map((reading) => ({ kind: 'kun' as const, reading })),
  ];
  const keys = all.map((entry, index) => readingKey(entry.reading, index));
  const examples = all.map((): KanjiReading['examples'] => []);

  const sortIn = (candidates: ExampleRow[], only?: Set<number>) => {
    for (const word of candidates) {
      if (!word.segments) continue;
      const index = readingInWord(word.segments, row.character, keys);
      if (index === null || (only && !only.has(index))) continue;
      const list = examples[index];
      if (
        list &&
        list.length < EXAMPLES_PER_READING &&
        !list.some((example) => example.id === `jmdict:${word.word_id}`)
      ) {
        list.push({
          id: `jmdict:${word.word_id}`,
          headword: word.headword,
          reading: word.reading,
          furigana: word.segments,
        });
      }
    }
  };

  sortIn(words);
  const empty = new Set(examples.flatMap((list, index) => (list.length === 0 ? [index] : [])));
  if (empty.size > 0) sortIn(await dictionaryWordsWith(dataSource, row.character), empty);

  return all.map((entry, index) => ({ ...entry, examples: examples[index] ?? [] }));
}

export interface KanjiIndexEntry {
  character: string;
  grade: number | null;
  jlpt: number | null;
  frequency: number | null;
  reading: string | null;
  meaning: string | null;
}

/**
 * Every kanji a learner is likely to study, for the kanji index page: the 2,136 jōyō kanji (grades 1-6 and 8) and
 * any other kanji on the JLPT lists, school kanji first by grade, then by newspaper frequency.
 */
export async function kanjiIndex(dataSource: DataSource, _locale: 'en' | 'es'): Promise<KanjiIndexEntry[]> {
  return dataSource.query(
    `SELECT k.character, k.grade, j.level AS jlpt, k.frequency,
            coalesce(k.on_readings[1], k.kun_readings[1]) AS reading,
            k.meanings_en[1] AS meaning
       FROM dict.kanji k
       LEFT JOIN dict.kanji_jlpt j ON j.character = k.character
      WHERE (k.grade BETWEEN 1 AND 8 AND k.grade <> 7) OR j.level IS NOT NULL
      ORDER BY coalesce(k.grade, 99), coalesce(k.frequency, 9999), k.character`,
  );
}
