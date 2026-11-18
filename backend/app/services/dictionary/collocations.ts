import type { DataSource, EntityManager } from 'typeorm';
import type { SlimToken } from '@app/models/Segment';
import { collocationParticle, type Lexicon } from '@app/services/parser/combine/lexicon';
import type { DeconjugatedForm } from '@app/services/parser/deconjugator';
import { toHiragana } from './import/entries';

/**
 * Noun + particle + verb collocations mined from our own corpus (task 45), for `dict.collocation`. A sentence that
 * writes the verb in kanji names it (ピアノを弾いた is 弾く, not 引く); counted under the noun, the particle and the
 * verb's reading (ピアノ, を, ひく), those sentences tell the parser which verb a sentence means when it writes the
 * same verb in kana (ピアノをひいた). Mined in the frequency job's pass, from our parser's tokens.
 */

/** A rule needs this many sentences with a kanji verb after the noun and particle… */
export const MIN_TOTAL = 3;
/** …and this share of them on one verb. */
export const MIN_SHARE = 0.8;

const HAS_KANJI = /\p{Script=Han}/u;
const NOUNS = new Set(['noun', 'pron']);

export interface CollocationRow {
  noun: string;
  particle: string;
  verb_kana: string;
  verb: string;
  count: number;
  total: number;
}

/** Counts per (noun, particle, verb reading), per kanji verb. */
export type CollocationCounts = Map<string, Map<string, number>>;

const keyOf = (noun: string, particle: string, verbKana: string) => `${noun}\u0000${particle}\u0000${verbKana}`;

/**
 * The reading a kanji verb token is in: the one of its JMdict readings its own surface reading deconjugates to
 * (弾いた read ヒイタ → ひく, not はじく). Undefined when none or several fit. Exported for tests.
 */
export function verbReading(
  token: SlimToken,
  lexicon: Lexicon,
  deconjugate: (text: string) => readonly DeconjugatedForm[],
): string | undefined {
  const readings = new Set(lexicon.readingsOf(token.d).flatMap((word) => word.kana));
  if (readings.size === 0) return undefined;
  const surface = toHiragana(token.r);
  const reached = new Set([surface, ...deconjugate(surface).map((form) => form.text)]);
  const fits = [...readings].filter((kana) => reached.has(kana));
  return fits.length === 1 ? fits[0] : undefined;
}

/** Adds one sentence's noun + particle + kanji-verb triples to `counts`. Exported for tests. */
export function countCollocations(
  tokens: readonly SlimToken[],
  counts: CollocationCounts,
  lexicon: Lexicon,
  deconjugate: (text: string) => readonly DeconjugatedForm[],
): void {
  for (let i = 2; i < tokens.length; i++) {
    const verb = tokens[i] as SlimToken;
    if (verb.pt !== 'verb' || !HAS_KANJI.test(verb.s) || !HAS_KANJI.test(verb.d)) continue;
    const particle = tokens[i - 1] as SlimToken;
    const noun = tokens[i - 2] as SlimToken;
    if (particle.pt !== 'prt' || !noun.pt || !NOUNS.has(noun.pt) || !noun.d) continue;
    const filed = collocationParticle(particle.s);
    if (!filed) continue;
    const kana = verbReading(verb, lexicon, deconjugate);
    if (!kana) continue;
    const key = keyOf(noun.d, filed, kana);
    let byVerb = counts.get(key);
    if (!byVerb) {
      byVerb = new Map();
      counts.set(key, byVerb);
    }
    byVerb.set(verb.d, (byVerb.get(verb.d) ?? 0) + 1);
  }
}

/** The rows worth keeping: a clear winner over enough sentences. Exported for tests. */
export function collocationRows(counts: CollocationCounts): CollocationRow[] {
  const rows: CollocationRow[] = [];
  for (const [key, byVerb] of counts) {
    const [noun, particle, verbKana] = key.split('\u0000') as [string, string, string];
    let total = 0;
    let best: [string, number] | undefined;
    for (const entry of byVerb) {
      total += entry[1];
      if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry;
    }
    if (!best || total < MIN_TOTAL || best[1] / total < MIN_SHARE) continue;
    rows.push({ noun, particle, verb_kana: verbKana, verb: best[0], count: best[1], total });
  }
  return rows.sort(
    (a, b) =>
      b.total - a.total || (keyOf(a.noun, a.particle, a.verb_kana) < keyOf(b.noun, b.particle, b.verb_kana) ? -1 : 1),
  );
}

/** Where a `dict.collocation` row comes from: mined from our corpus, or converted from an external table. */
export type CollocationSource = 'corpus' | 'imported';

/** Replaces one source's rows of `dict.collocation` (the frequency job's `corpus` rows, inside its transaction, or
 * the importer's `imported` ones). */
export async function writeCollocations(
  manager: EntityManager | DataSource,
  rows: readonly CollocationRow[],
  source: CollocationSource = 'corpus',
) {
  await manager.query(`DELETE FROM dict.collocation WHERE source = $1`, [source]);
  for (let i = 0; i < rows.length; i += 10_000) {
    await manager.query(
      `INSERT INTO dict.collocation (noun, particle, verb_kana, verb, count, total, source)
       SELECT x.noun, x.particle, x.verb_kana, x.verb, x.count, x.total, $2
         FROM jsonb_to_recordset($1::jsonb) AS x(noun text, particle text, verb_kana text, verb text, count int, total int)`,
      [JSON.stringify(rows.slice(i, i + 10_000)), source],
    );
  }
}

/** One row of an external noun + particle + verb collocation table, by JMdict id: after the noun and particle, a pick
 * of `rivalVerb` should be `targetVerb`. `count`/`total` are its evidence, when the note gives it. */
export interface ExternalCollocation {
  noun: number;
  particle: string;
  rivalVerb: number;
  targetVerb: number;
  count: number;
  total: number;
}

/** Parses the external TSV: `noun id, particle, picked verb id, verb id to prefer, bonus, note "… (n/m)"`; `#` lines
 * are comments. Exported for tests. */
export function parseExternalCollocations(text: string): ExternalCollocation[] {
  const rows: ExternalCollocation[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [noun, particle, rival, target, , note = ''] = line.split('\t');
    const evidence = /\((\d+)\/(\d+)\)\s*$/.exec(note);
    if (!noun || !particle || !rival || !target) continue;
    rows.push({
      noun: Number(noun),
      particle,
      rivalVerb: Number(rival),
      targetVerb: Number(target),
      count: evidence ? Number(evidence[1]) : 0,
      total: evidence ? Number(evidence[2]) : 0,
    });
  }
  return rows;
}

/** One JMdict word's active forms, in index order. */
export interface WordForms {
  forms: Array<{ text: string; kana: boolean }>;
}

/**
 * External rows as our rows: by spelling, since our tokens carry no word id. A row is kept for every spelling of the
 * noun and every reading the two verbs share (the homophone a kana sentence cannot tell apart), naming the target's
 * first kanji spelling. A key that two rows give different verbs keeps the one with more evidence. Exported for tests.
 */
export function convertExternalCollocations(
  rows: readonly ExternalCollocation[],
  words: ReadonlyMap<number, WordForms>,
): CollocationRow[] {
  const kept = new Map<string, CollocationRow>();
  for (const row of rows) {
    const particle = collocationParticle(row.particle);
    const noun = words.get(row.noun);
    const rival = words.get(row.rivalVerb);
    const target = words.get(row.targetVerb);
    if (!particle || !noun || !rival || !target) continue;
    const verb = target.forms.find((form) => !form.kana)?.text;
    if (!verb) continue;
    const rivalKana = new Set(rival.forms.filter((form) => form.kana).map((form) => toHiragana(form.text)));
    const shared = [...new Set(target.forms.filter((form) => form.kana).map((form) => toHiragana(form.text)))].filter(
      (kana) => rivalKana.has(kana),
    );
    for (const nounText of new Set(noun.forms.map((form) => form.text))) {
      for (const verbKana of shared) {
        const key = keyOf(nounText, particle, verbKana);
        const seen = kept.get(key);
        if (seen && (seen.verb === verb || seen.total >= row.total)) continue;
        kept.set(key, { noun: nounText, particle, verb_kana: verbKana, verb, count: row.count, total: row.total });
      }
    }
  }
  return [...kept.values()];
}

export interface ImportCollocationsReport {
  source: 'collocations';
  version: string;
  /** Rows in the file. */
  read: number;
  /** Rows written, by spelling. */
  rows: number;
  dryRun: boolean;
}

/** Replaces the `imported` rows of `dict.collocation` from an external table, and records its version. */
export async function importCollocations(
  dataSource: DataSource,
  text: string,
  version: string,
  options: { dryRun?: boolean } = {},
): Promise<ImportCollocationsReport> {
  const external = parseExternalCollocations(text);
  const ids = [...new Set(external.flatMap((row) => [row.noun, row.rivalVerb, row.targetVerb]))];
  const found: Array<{ id: number; forms: WordForms['forms'] }> = await dataSource.query(
    `SELECT w.id, json_agg(json_build_object('text', f.text, 'kana', f.kana) ORDER BY f.idx) AS forms
       FROM dict.word w
       JOIN dict.form f ON f.word_id = w.id AND f.active
      WHERE w.source = 'jmdict' AND w.active AND w.id = ANY($1::int[])
      GROUP BY w.id`,
    [ids],
  );
  const words = new Map(found.map((word) => [word.id, { forms: word.forms }]));
  const rows = convertExternalCollocations(external, words);
  const dryRun = options.dryRun ?? false;
  if (!dryRun) {
    await dataSource.transaction(async (manager) => {
      await writeCollocations(manager, rows, 'imported');
      await manager.query(
        `INSERT INTO dict.source (name, version, imported_at) VALUES ('collocations', $1, now())
         ON CONFLICT (name) DO UPDATE SET version = EXCLUDED.version, imported_at = now()`,
        [version],
      );
    });
  }
  return { source: 'collocations', version, read: external.length, rows: rows.length, dryRun };
}
