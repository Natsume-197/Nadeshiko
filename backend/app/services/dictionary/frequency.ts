import type { DataSource } from 'typeorm';
import { analyse, type Morpheme } from '@app/services/parser/sudachi';
import { tokenPos } from '@app/services/parser/pos';
import { parseWithNadeshiko } from '@app/services/parser/nadeshiko';
import { loadLexicon } from '@app/services/parser/combine/lexicon';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { SlimToken } from '@app/models/Segment';
import { ALL_CATEGORIES, type CategoryType } from '@app/models/Media';
import { insertChunks, recordSource } from './import/db';
import { hasKanji, lookupKeys, toHiragana } from './import/entries';
import { type IdentifyQuery, loadWords, scoreWord, type StoredWord } from './identify';
import { type CollocationCounts, collocationRows, countCollocations, writeCollocations } from './collocations';

/**
 * Word frequency from our own corpus (task 40), per JMdict word. Every served sentence is analysed by the Sudachi
 * sidecar; each morpheme is counted under its normalised form, surface and reading, and each distinct triple is
 * then given to the JMdict word our own ranking picks for it. Sudachi's normalised form is what tells homographs
 * written in kana apart: いる meaning "to be" normalises to 居る, meaning "to need" to 要る.
 *
 * Counts are whole morphemes (split mode B), plus once more for every expression, compound, counter or function word
 * our own parser groups out of several (のに, 心臓麻痺, 二人, じゃない): those are words of their own on the card, and
 * counting only their pieces left them without a rank. Their pieces keep their own counts too.
 *
 * The same pass counts every kanji written (`dict.kanji_frequency`), for the kanji card's rank in our corpus, and mines
 * the noun + particle + verb collocations the parser uses to name a verb written in kana (`dict.collocation`, see
 * ./collocations.ts).
 *
 * Every count is also kept per kind of media (anime, drama, YouTube, audiobooks: the sentence's media category), for
 * `dict.frequency_category`: the card's rank in each kind.
 */

const PAGE = 2_000;
/** Rows per INSERT when writing the tables. */
const WRITE_BATCH = 10_000;
/** Dictionary lookups run at once while attributing forms to words. */
const LOOKUP_CONCURRENCY = 16;
const NOT_WORDS = new Set(['補助記号', '記号', '空白']);

export interface FrequencyReport {
  segments: number;
  morphemes: number;
  /** Distinct (normalised form, surface, reading) triples. */
  distinct: number;
  /** Morphemes given to a JMdict word. */
  attributed: number;
  words: number;
  /** Distinct kanji written in the corpus. */
  kanji: number;
  /** Collocation rows kept for `dict.collocation`. */
  collocations: number;
  /** Words ranked in each kind of media. */
  categories: Partial<Record<CategoryType, number>>;
  dryRun: boolean;
}

/** The kinds of media counted apart, in a fixed order: a triple's `byCategory[i]` is its count in `CATEGORIES[i]`. */
export const CATEGORIES: readonly CategoryType[] = ALL_CATEGORIES;

/** One row of `dict.frequency_form`. */
export interface FormFrequencyRow {
  word_id: number;
  form_text: string;
  count: number;
  /** Fraction of this word's attributed occurrences written in this form (0..1). */
  share: number;
  rank: number;
}

function commonPrefixLen(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

const SINGLE_HAN = /\p{Script=Han}/u;

function kanjiSequence(text: string): string {
  return [...text].filter((ch) => SINGLE_HAN.test(ch)).join('');
}

/**
 * Picks which spelling (`dict.form.text`) of `word` a corpus surface (`triple.s`) was written in, handling inflected
 * verbs and adjectives (e.g. `食べた` -> `食べる`, `たべた` -> `たべる`, `喰べた` -> `喰べる`). Exported for tests.
 */
export function attributeForm(triple: Pick<Triple, 's' | 'r'>, word: StoredWord): string | null {
  const surface = triple.s;
  if (!surface) return null;
  const active = word.forms.filter((f) => f.active);
  if (active.length === 0) return null;

  const exact = active.find((f) => f.text === surface);
  if (exact) return exact.text;

  if (hasKanji(surface)) {
    const kanjiForms = active.filter((f) => !f.kana);
    if (kanjiForms.length === 0) return null;
    const seq = kanjiSequence(surface);
    const sameKanji = kanjiForms.filter((f) => kanjiSequence(f.text) === seq);
    const pool = sameKanji.length > 0 ? sameKanji : kanjiForms;
    let best = pool[0];
    let bestPrefix = best ? commonPrefixLen(surface, best.text) : -1;
    for (let i = 1; i < pool.length; i += 1) {
      const candidate = pool[i];
      if (!candidate) continue;
      const prefix = commonPrefixLen(surface, candidate.text);
      if (prefix > bestPrefix) {
        best = candidate;
        bestPrefix = prefix;
      }
    }
    return best && (sameKanji.length > 0 || bestPrefix > 0) ? best.text : null;
  }

  const kanaForms = active.filter((f) => f.kana);
  if (kanaForms.length === 0) return null;
  const surfaceHira = toHiragana(surface);
  const exactKana = kanaForms.find((f) => toHiragana(f.text) === surfaceHira);
  if (exactKana) return exactKana.text;
  if (triple.r) {
    const readingHira = toHiragana(triple.r);
    const byReading = kanaForms.find((f) => toHiragana(f.text) === readingHira);
    if (byReading) return byReading.text;
  }
  let best = kanaForms[0];
  let bestPrefix = best ? commonPrefixLen(surfaceHira, toHiragana(best.text)) : -1;
  for (let i = 1; i < kanaForms.length; i += 1) {
    const candidate = kanaForms[i];
    if (!candidate) continue;
    const prefix = commonPrefixLen(surfaceHira, toHiragana(candidate.text));
    if (prefix > bestPrefix) {
      best = candidate;
      bestPrefix = prefix;
    }
  }
  return best?.text ?? null;
}

/**
 * Per-spelling counts as table rows: each form gets its share of its word's occurrences (0..1) and its global rank
 * across all forms. Exported for tests.
 */
export function formFrequencyRows(byWordForm: Map<number, Map<string, number>>): FormFrequencyRow[] {
  const rows: Omit<FormFrequencyRow, 'rank'>[] = [];
  for (const [word_id, forms] of byWordForm) {
    const rounded: Array<{ form_text: string; count: number }> = [];
    let total = 0;
    for (const [form_text, raw] of forms) {
      const count = Math.round(raw);
      if (count <= 0) continue;
      rounded.push({ form_text, count });
      total += count;
    }
    if (total <= 0) continue;
    for (const { form_text, count } of rounded) {
      rows.push({ word_id, form_text, count, share: count / total });
    }
  }
  rows.sort((a, b) => b.count - a.count || a.word_id - b.word_id || a.form_text.localeCompare(b.form_text));
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/** One row of `dict.frequency_category`. */
export interface CategoryRow {
  word_id: number;
  category: CategoryType;
  count: number;
  per_million: number;
  rank: number;
}

/**
 * Per-category counts as table rows: in each category, the words it has, most frequent first, ranked from 1, per
 * million words of that category. A word under half an occurrence in a category (a tie shared three ways, say) is
 * not ranked there. Exported for tests.
 */
export function categoryRows(byWord: Map<number, number[]>, morphemesByCategory: number[]): CategoryRow[] {
  const out: CategoryRow[] = [];
  for (const [index, category] of CATEGORIES.entries()) {
    const total = Math.max(1, morphemesByCategory[index] ?? 0);
    const rows = [...byWord]
      .map(([word_id, counts]) => ({ word_id, count: Math.round(counts[index] ?? 0) }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.word_id - b.word_id);
    for (const [position, row] of rows.entries()) {
      out.push({ ...row, category, per_million: (row.count / total) * 1e6, rank: position + 1 });
    }
  }
  return out;
}

/** How often one kanji is written: every occurrence, and the sentences it is in. */
export interface KanjiCount {
  count: number;
  sentences: number;
}

const HAN = /\p{Script=Han}/gu;

/** Add a sentence's kanji to the running counts. Exported for tests. */
export function countKanji(text: string, counts: Map<string, KanjiCount>): void {
  const seen = new Set<string>();
  for (const [character] of text.matchAll(HAN)) {
    // 々 is a repeat mark, not a kanji; it is Han by script.
    if (character === '々' || character === '〆' || character === '〇') continue;
    let entry = counts.get(character);
    if (!entry) {
      entry = { count: 0, sentences: 0 };
      counts.set(character, entry);
    }
    entry.count += 1;
    if (!seen.has(character)) {
      seen.add(character);
      entry.sentences += 1;
    }
  }
}

/** Kanji counts as table rows, most written first, ranked from 1. Exported for tests. */
export function kanjiRows(counts: Map<string, KanjiCount>) {
  return [...counts]
    .map(([character, { count, sentences }]) => ({ character, count, sentences }))
    .sort((a, b) => b.count - a.count || (a.character < b.character ? -1 : 1))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * One way the corpus writes a word: Sudachi's normalised form (`n`, 居る), and either the kana dictionary form when
 * the reader saw it in kana (`kana`, いる), or the surface with its reading when they saw kanji (`s`/`r`, 居た/イタ).
 */
export interface Triple {
  n: string;
  kana?: string;
  s?: string;
  r?: string;
  pt?: string;
  count: number;
  /** The count split by kind of media, in `CATEGORIES` order; absent when not counted that way. */
  byCategory?: number[];
}

function tripleOf(m: Morpheme): Omit<Triple, 'count'> {
  const pt = tokenPos(m.pos, 'word', m.d).pt;
  // Met in kana, the dictionary form is the reading; the surface's own reading would be the inflection's (イタ).
  return hasKanji(m.s) ? { n: m.n, s: m.s, r: m.r, pt } : { n: m.n, kana: toHiragana(m.d), pt };
}

/** Kinds of token our parser groups into a word of its own; inflected verbs (食べられない) stay under the verb. A
 * grouped function word counts only when its dictionary form is not one of its morphemes': のに is a word, だった is
 * だ, already counted. */
const GROUPED = new Set(['expression', 'compound', 'counter', 'function']);

/** Exported for tests. */
export function tokenTripleOf(token: SlimToken): Omit<Triple, 'count'> | null {
  const d = token.d;
  if (!d || !token.kind || !GROUPED.has(token.kind) || (token.parts?.length ?? 0) < 2) return null;
  return hasKanji(token.s)
    ? { n: d, s: token.s, r: token.r, pt: token.pt }
    : { n: d, kana: toHiragana(d), pt: token.pt };
}

const tripleKey = (t: Omit<Triple, 'count' | 'byCategory'>) =>
  [t.n, t.kana ?? '', t.s ?? '', t.r ?? '', t.pt ?? ''].join('\u0000');

/** Count every word morpheme of the served corpus. */
async function countMorphemes(
  dataSource: DataSource,
  onPage?: (done: number) => void,
): Promise<{
  triples: Map<string, Triple>;
  kanji: Map<string, KanjiCount>;
  collocations: CollocationCounts;
  segments: number;
  morphemes: number;
  /** Word morphemes per kind of media, in `CATEGORIES` order. */
  morphemesByCategory: number[];
}> {
  const triples = new Map<string, Triple>();
  const kanji = new Map<string, KanjiCount>();
  const collocations: CollocationCounts = new Map();
  const lexicon = await loadLexicon(dataSource);
  const morphemesByCategory = CATEGORIES.map(() => 0);
  let cursor = 0;
  let segments = 0;
  let morphemes = 0;

  for (;;) {
    const rows: Array<{ id: number; content: string; category: string | null }> = await dataSource.query(
      `SELECT s.id, s.content, m.category
         FROM "Segment" s LEFT JOIN "Media" m ON m.id = s.media_id
        WHERE s.id > $1 AND s.status IN ('ACTIVE', 'VERIFIED') AND coalesce(s.content, '') <> ''
        ORDER BY s.id LIMIT $2`,
      [cursor, PAGE],
    );
    if (rows.length === 0) break;
    const texts = rows.map((row) => row.content);
    // -1 for a category we do not split by: the sentence still counts in the totals.
    const categoryOf = rows.map((row) => CATEGORIES.indexOf(row.category as CategoryType));
    for (const text of texts) countKanji(text, kanji);
    const add = (triple: Omit<Triple, 'count' | 'byCategory'>, category: number) => {
      const key = tripleKey(triple);
      let seen = triples.get(key);
      if (!seen) {
        seen = { ...triple, count: 0, byCategory: CATEGORIES.map(() => 0) };
        triples.set(key, seen);
      }
      seen.count += 1;
      if (category >= 0 && seen.byCategory) seen.byCategory[category] = (seen.byCategory[category] ?? 0) + 1;
    };
    const [analysed, parsed] = await Promise.all([analyse(texts), parseWithNadeshiko(dataSource, texts)]);
    for (const [index, sentence] of analysed.entries()) {
      const category = categoryOf[index] ?? -1;
      for (const m of sentence) {
        if (NOT_WORDS.has(m.pos[0]) || !m.n) continue;
        morphemes += 1;
        if (category >= 0) morphemesByCategory[category] = (morphemesByCategory[category] ?? 0) + 1;
        add(tripleOf(m), category);
      }
    }
    for (const [index, sentence] of parsed.entries()) {
      countCollocations(sentence, collocations, lexicon, deconjugate);
      const lemmas = new Set((analysed[index] ?? []).flatMap((m) => [m.n, m.d]));
      for (const token of sentence) {
        const triple = tokenTripleOf(token);
        if (triple && !lemmas.has(triple.n)) add(triple, categoryOf[index] ?? -1);
      }
    }
    segments += rows.length;
    cursor = rows[rows.length - 1]?.id ?? cursor;
    onPage?.(segments);
  }
  return { triples, kanji, collocations, segments, morphemes, morphemesByCategory };
}

/**
 * The JMdict words a triple belongs to: the best-scoring ones by `scoreWord`, sharing the count when several tie.
 * Names (JMnedict) never get one. Exported for tests.
 */
export function attribute(triple: Triple, words: StoredWord[]): Array<{ id: number; share: number }> {
  const query: IdentifyQuery = { lemma: triple.n, surface: triple.s, reading: triple.r, pos: triple.pt, locale: 'en' };
  // Met in kana, only words with that kana spelling can be meant: 居る read いる, not 居る read おる.
  const { kana } = triple;
  const spelled = (word: StoredWord) => !kana || word.forms.some((form) => form.kana && toHiragana(form.text) === kana);
  // Without the stored frequency, so a recount does not just confirm the last one.
  const scored = words
    .filter((word) => word.source === 'jmdict' && word.active && spelled(word))
    .map((word) => ({ ...word, frequency: null }))
    .map((word) => ({ id: word.id, score: scoreWord(word, query) }));
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((entry) => entry.score));
  const top = scored.filter((entry) => entry.score === best);
  return top.map((entry) => ({ id: entry.id, share: triple.count / top.length }));
}

/** Count the corpus and replace `dict.frequency`. Needs the Sudachi sidecar and JMdict imported. */
export async function computeFrequency(
  dataSource: DataSource,
  options: { dryRun?: boolean; onPage?: (done: number) => void } = {},
): Promise<FrequencyReport> {
  const { triples, kanji, collocations, segments, morphemes, morphemesByCategory } = await countMorphemes(
    dataSource,
    options.onPage,
  );
  const collocationTable = collocationRows(collocations);

  // One dictionary lookup per normalised form, shared by every triple that has it.
  const byForm = new Map<string, Triple[]>();
  for (const triple of triples.values()) {
    const list = byForm.get(triple.n);
    if (list) list.push(triple);
    else byForm.set(triple.n, [triple]);
  }

  // Looked up LOOKUP_CONCURRENCY forms at a time and attributed as each batch arrives, in `byForm`'s order, so only
  // one batch of dictionary words is held at once.
  const forms = [...byForm];
  const counts = new Map<number, number>();
  const byCategory = new Map<number, number[]>();
  const byWordForm = new Map<number, Map<string, number>>();
  let attributed = 0;
  for (let i = 0; i < forms.length; i += LOOKUP_CONCURRENCY) {
    const slice = forms.slice(i, i + LOOKUP_CONCURRENCY);
    const batch = await Promise.all(slice.map(([form]) => loadWords(dataSource, lookupKeys(form))));
    for (const [index, [, list]] of slice.entries()) {
      const words = batch[index] ?? [];
      const wordById = new Map(words.map((w) => [w.id, w]));
      for (const triple of list) {
        const owners = attribute(triple, words);
        if (owners.length > 0) attributed += triple.count;
        for (const { id, share } of owners) {
          counts.set(id, (counts.get(id) ?? 0) + share);
          const ownerWord = wordById.get(id);
          const formText = ownerWord ? attributeForm(triple, ownerWord) : null;
          if (formText) {
            let formCounts = byWordForm.get(id);
            if (!formCounts) {
              formCounts = new Map();
              byWordForm.set(id, formCounts);
            }
            formCounts.set(formText, (formCounts.get(formText) ?? 0) + share);
          }
          if (!triple.byCategory) continue;
          // Shared between tied owners the same way as the total.
          const part = share / triple.count;
          let split = byCategory.get(id);
          if (!split) {
            split = CATEGORIES.map(() => 0);
            byCategory.set(id, split);
          }
          for (const [category, count] of triple.byCategory.entries()) {
            split[category] = (split[category] ?? 0) + count * part;
          }
        }
      }
    }
  }
  const categoryTable = categoryRows(byCategory, morphemesByCategory);
  const formTable = formFrequencyRows(byWordForm);

  const rows = [...counts]
    .map(([word_id, count]) => ({ word_id, count: Math.max(1, Math.round(count)) }))
    .sort((a, b) => b.count - a.count || a.word_id - b.word_id)
    .map((row, index) => ({ ...row, rank: index + 1, per_million: (row.count / Math.max(1, morphemes)) * 1e6 }));

  const report: FrequencyReport = {
    segments,
    morphemes,
    distinct: triples.size,
    attributed,
    words: rows.length,
    kanji: kanji.size,
    collocations: collocationTable.length,
    categories: Object.fromEntries(
      CATEGORIES.map((category) => [category, categoryTable.filter((row) => row.category === category).length]),
    ),
    dryRun: options.dryRun ?? false,
  };
  const kanjiTable = kanjiRows(kanji);
  if (report.dryRun) return report;

  await dataSource.transaction(async (manager) => {
    await manager.query(`DELETE FROM dict.frequency`);
    await insertChunks(
      manager,
      `INSERT INTO dict.frequency (word_id, count, per_million, rank)
       SELECT x.word_id, x.count, x.per_million, x.rank
         FROM jsonb_to_recordset($1::jsonb) AS x(word_id int, count int, per_million real, rank int)`,
      rows,
      WRITE_BATCH,
    );
    await manager.query(`DELETE FROM dict.frequency_category`);
    await insertChunks(
      manager,
      `INSERT INTO dict.frequency_category (word_id, category, count, per_million, rank)
       SELECT x.word_id, x.category, x.count, x.per_million, x.rank
         FROM jsonb_to_recordset($1::jsonb)
           AS x(word_id int, category text, count int, per_million real, rank int)`,
      categoryTable,
      WRITE_BATCH,
    );
    await manager.query(`DELETE FROM dict.frequency_form`);
    await insertChunks(
      manager,
      `INSERT INTO dict.frequency_form (word_id, form_text, count, share, rank)
       SELECT x.word_id, x.form_text, x.count, x.share, x.rank
         FROM jsonb_to_recordset($1::jsonb)
           AS x(word_id int, form_text text, count int, share real, rank int)`,
      formTable,
      WRITE_BATCH,
    );
    await manager.query(`DELETE FROM dict.kanji_frequency`);
    await insertChunks(
      manager,
      `INSERT INTO dict.kanji_frequency (character, count, sentences, rank)
       SELECT x.character, x.count, x.sentences, x.rank
         FROM jsonb_to_recordset($1::jsonb) AS x(character text, count int, sentences int, rank int)`,
      kanjiTable,
      WRITE_BATCH,
    );
    await writeCollocations(manager, collocationTable);
    await recordSource(manager, 'corpus-frequency', `${new Date().toISOString().slice(0, 10)}, ${segments} segments`);
  });
  return report;
}
