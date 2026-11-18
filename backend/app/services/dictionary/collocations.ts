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

/** Replaces `dict.collocation` inside the frequency job's transaction. */
export async function writeCollocations(manager: EntityManager | DataSource, rows: readonly CollocationRow[]) {
  await manager.query(`DELETE FROM dict.collocation`);
  for (let i = 0; i < rows.length; i += 10_000) {
    await manager.query(
      `INSERT INTO dict.collocation (noun, particle, verb_kana, verb, count, total)
       SELECT x.noun, x.particle, x.verb_kana, x.verb, x.count, x.total
         FROM jsonb_to_recordset($1::jsonb) AS x(noun text, particle text, verb_kana text, verb text, count int, total int)`,
      [JSON.stringify(rows.slice(i, i + 10_000))],
    );
  }
}
