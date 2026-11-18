import type { DataSource } from 'typeorm';
import { analyse, type Morpheme } from '@app/services/parser/sudachi';
import { tokenPos } from '@app/services/parser/pos';
import { parseWithNadeshiko } from '@app/services/parser/nadeshiko';
import { loadLexicon } from '@app/services/parser/combine/lexicon';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { SlimToken } from '@app/models/Segment';
import { lookupKeys, toHiragana } from './import/entries';
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
 */

const PAGE = 2_000;
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
  dryRun: boolean;
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
}

const hasKanji = (text: string) => /\p{Script=Han}/u.test(text);

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

const tripleKey = (t: Omit<Triple, 'count'>) => [t.n, t.kana ?? '', t.s ?? '', t.r ?? '', t.pt ?? ''].join('\u0000');

/** Count every word morpheme of the served corpus. Exported for tests. */
export async function countMorphemes(
  dataSource: DataSource,
  onPage?: (done: number) => void,
): Promise<{
  triples: Map<string, Triple>;
  kanji: Map<string, KanjiCount>;
  collocations: CollocationCounts;
  segments: number;
  morphemes: number;
}> {
  const triples = new Map<string, Triple>();
  const kanji = new Map<string, KanjiCount>();
  const collocations: CollocationCounts = new Map();
  const lexicon = await loadLexicon(dataSource);
  let cursor = 0;
  let segments = 0;
  let morphemes = 0;

  for (;;) {
    const rows: Array<{ id: number; content: string }> = await dataSource.query(
      `SELECT id, content FROM "Segment"
        WHERE id > $1 AND status IN ('ACTIVE', 'VERIFIED') AND coalesce(content, '') <> ''
        ORDER BY id LIMIT $2`,
      [cursor, PAGE],
    );
    if (rows.length === 0) break;
    const texts = rows.map((row) => row.content);
    for (const text of texts) countKanji(text, kanji);
    const add = (triple: Omit<Triple, 'count'>) => {
      const key = tripleKey(triple);
      const seen = triples.get(key);
      if (seen) seen.count += 1;
      else triples.set(key, { ...triple, count: 1 });
    };
    const [analysed, parsed] = await Promise.all([analyse(texts), parseWithNadeshiko(dataSource, texts)]);
    for (const sentence of analysed) {
      for (const m of sentence) {
        if (NOT_WORDS.has(m.pos[0]) || !m.n) continue;
        morphemes += 1;
        add(tripleOf(m));
      }
    }
    for (const [index, sentence] of parsed.entries()) {
      countCollocations(sentence, collocations, lexicon, deconjugate);
      const lemmas = new Set((analysed[index] ?? []).flatMap((m) => [m.n, m.d]));
      for (const token of sentence) {
        const triple = tokenTripleOf(token);
        if (triple && !lemmas.has(triple.n)) add(triple);
      }
    }
    segments += rows.length;
    cursor = rows[rows.length - 1]?.id ?? cursor;
    onPage?.(segments);
  }
  return { triples, kanji, collocations, segments, morphemes };
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
  const { triples, kanji, collocations, segments, morphemes } = await countMorphemes(dataSource, options.onPage);
  const collocationTable = collocationRows(collocations);

  // One dictionary lookup per normalised form, shared by every triple that has it.
  const byForm = new Map<string, Triple[]>();
  for (const triple of triples.values()) {
    const list = byForm.get(triple.n);
    if (list) list.push(triple);
    else byForm.set(triple.n, [triple]);
  }

  const counts = new Map<number, number>();
  let attributed = 0;
  for (const [form, list] of byForm) {
    const words = await loadWords(dataSource, lookupKeys(form));
    for (const triple of list) {
      const owners = attribute(triple, words);
      if (owners.length > 0) attributed += triple.count;
      for (const { id, share } of owners) counts.set(id, (counts.get(id) ?? 0) + share);
    }
  }

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
    dryRun: options.dryRun ?? false,
  };
  const kanjiTable = kanjiRows(kanji);
  if (report.dryRun) return report;

  await dataSource.transaction(async (manager) => {
    await manager.query(`DELETE FROM dict.frequency`);
    for (let i = 0; i < rows.length; i += 10_000) {
      await manager.query(
        `INSERT INTO dict.frequency (word_id, count, per_million, rank)
         SELECT x.word_id, x.count, x.per_million, x.rank
           FROM jsonb_to_recordset($1::jsonb) AS x(word_id int, count int, per_million real, rank int)`,
        [JSON.stringify(rows.slice(i, i + 10_000))],
      );
    }
    await manager.query(`DELETE FROM dict.kanji_frequency`);
    for (let i = 0; i < kanjiTable.length; i += 10_000) {
      await manager.query(
        `INSERT INTO dict.kanji_frequency (character, count, sentences, rank)
         SELECT x.character, x.count, x.sentences, x.rank
           FROM jsonb_to_recordset($1::jsonb) AS x(character text, count int, sentences int, rank int)`,
        [JSON.stringify(kanjiTable.slice(i, i + 10_000))],
      );
    }
    await writeCollocations(manager, collocationTable);
    await manager.query(
      `INSERT INTO dict.source (name, version, imported_at) VALUES ('corpus-frequency', $1, now())
       ON CONFLICT (name) DO UPDATE SET version = EXCLUDED.version, imported_at = now()`,
      [`${new Date().toISOString().slice(0, 10)}, ${segments} segments`],
    );
  });
  return report;
}
