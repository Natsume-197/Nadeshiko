import type { DataSource } from 'typeorm';

/**
 * The kanji card (task 44): everything the word card shows when a reader opens one of a word's kanji. KANJIDIC2 for
 * readings and meanings, KRADFILE for its parts, KanjiVG for the stroke order, and, what no other dictionary can
 * give, the words written with it that our own subtitles use most (`dict.frequency`).
 */

export interface KanjiComponent {
  character: string;
  /** Has a kanji card of its own, so the card can open it. KRADFILE also lists strokes and radical shapes (ノ, ｜). */
  hasCard: boolean;
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

export interface KanjiCard {
  character: string;
  strokeCount: number;
  /** KANJIDIC2's school grade: 1-6 elementary, 8 the rest of the jōyō list, 9-10 jinmeiyō (names). */
  grade: number | null;
  /** Rank among the 2,500 most used kanji in newspapers. */
  frequency: number | null;
  onReadings: string[];
  kunReadings: string[];
  /** In the requested language when KANJIDIC2 has it there; otherwise English. */
  meanings: string[];
  meaningsLanguage: 'en' | 'es';
  components: KanjiComponent[];
  /** One SVG path (KanjiVG, 109×109 view box) per stroke, in writing order; empty when KanjiVG does not draw it. */
  strokes: string[];
  words: KanjiWord[];
}

/** How many words the card lists. */
export const KANJI_WORDS = 8;

/** How many glosses of a word's first sense make its one-line summary. */
const GLOSSES_PER_WORD = 3;

interface KanjiRowResult {
  character: string;
  stroke_count: number;
  grade: number | null;
  frequency: number | null;
  on_readings: string[];
  kun_readings: string[];
  meanings_en: string[];
  meanings_es: string[];
  components: Array<{ character: string; has_card: boolean }> | null;
  strokes: string[] | null;
}

interface WordRowResult {
  word_id: number;
  headword: string;
  reading: string | null;
  rank: number;
  glosses_local: Array<{ text: string }> | null;
  glosses_en: Array<{ text: string }> | null;
}

/** One character: a single code point (some kanji are outside the BMP, so not `length === 1`). */
export function isSingleCharacter(text: string): boolean {
  return [...text].length === 1;
}

export async function kanjiCard(
  dataSource: DataSource,
  character: string,
  locale: 'en' | 'es',
): Promise<KanjiCard | null> {
  const [row]: KanjiRowResult[] = await dataSource.query(
    `SELECT k.character, k.stroke_count, k.grade, k.frequency, k.on_readings, k.kun_readings, k.meanings_en,
            k.meanings_es, s.paths AS strokes,
            (SELECT jsonb_agg(jsonb_build_object(
                      'character', part,
                      'has_card', part <> k.character AND EXISTS (SELECT 1 FROM dict.kanji o WHERE o.character = part))
                    ORDER BY ord)
               FROM unnest(c.components) WITH ORDINALITY AS u(part, ord)
              WHERE part <> k.character) AS components
       FROM dict.kanji k
       LEFT JOIN dict.kanji_component c ON c.character = k.character
       LEFT JOIN dict.kanji_strokes s ON s.character = k.character
      WHERE k.character = $1`,
    [character],
  );
  if (!row) return null;

  const words: WordRowResult[] = await dataSource.query(
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
        LIMIT $3
     )
     SELECT t.word_id, t.text AS headword, t.rank,
            (SELECT k.text FROM dict.form k
              WHERE k.word_id = t.word_id AND k.kana AND k.active
                AND (k.applies_to_kanji = '{}' OR '*' = ANY (k.applies_to_kanji) OR t.text = ANY (k.applies_to_kanji))
              ORDER BY k.idx LIMIT 1) AS reading,
            (SELECT s.glosses FROM dict.sense s WHERE s.word_id = t.word_id AND s.lang = $2 ORDER BY s.idx LIMIT 1)
              AS glosses_local,
            (SELECT s.glosses FROM dict.sense s WHERE s.word_id = t.word_id AND s.lang = 'eng' ORDER BY s.idx LIMIT 1)
              AS glosses_en
       FROM top t
      ORDER BY t.rank`,
    [character, locale === 'es' ? 'spa' : 'eng', KANJI_WORDS],
  );

  const meaningsLanguage = locale === 'es' && row.meanings_es.length > 0 ? 'es' : 'en';
  return {
    character: row.character,
    strokeCount: row.stroke_count,
    grade: row.grade,
    frequency: row.frequency,
    onReadings: row.on_readings,
    kunReadings: row.kun_readings,
    meanings: meaningsLanguage === 'es' ? row.meanings_es : row.meanings_en,
    meaningsLanguage,
    components: (row.components ?? []).map((part) => ({ character: part.character, hasCard: part.has_card })),
    strokes: row.strokes ?? [],
    words: words.map((word) => {
      const glosses = word.glosses_local ?? word.glosses_en ?? [];
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
  };
}
