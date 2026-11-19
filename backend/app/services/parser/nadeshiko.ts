import type { DataSource } from 'typeorm';
import type { SlimToken, TokenPart } from '@app/models/Segment';
import { toHiragana } from '@app/services/dictionary/import/entries';
import { combine, type Group, loadLexicon } from './combine';
import { deconjugate } from './deconjugator';
import { type RubySegment, surfaceFurigana } from './furigana';
import { inflectionLabels } from './labels';
import { tokenPos } from './pos';
import { analyseSentences } from './preprocess';

/**
 * Nadeshiko's own parser (task 40, phase 3): Sudachi split mode B from the sidecar, combine stages checked against
 * our JMdict, furigana alignment over JmdictFurigana, and a rule-based
 * deconjugator for inflection chains. Produces the same `SlimToken` shape the current parser stores, so the word
 * card, search and Anki read either. Runs in shadow until it is switched on.
 */

/** `<revision>`: bump when output changes in a way stored rows should be reparsed for. */
export const NADESHIKO_PARSER_REVISION = 6;

const hasKanji = (text: string) => /\p{Script=Han}/u.test(text);

/** Dictionary rubies per spelling, from `dict.furigana` (JMdict's own first). */
async function rubiesFor(
  dataSource: DataSource,
  spellings: string[],
): Promise<Map<string, Array<{ reading: string; segments: RubySegment[] }>>> {
  const out = new Map<string, Array<{ reading: string; segments: RubySegment[] }>>();
  if (spellings.length === 0) return out;
  const rows: Array<{ text: string; reading: string; segments: RubySegment[] }> = await dataSource.query(
    `SELECT text, reading, segments FROM dict.furigana
      WHERE text = ANY($1::varchar[])
      ORDER BY text, source = 'jmdict-furigana' DESC`,
    [spellings],
  );
  for (const row of rows) {
    const list = out.get(row.text) ?? [];
    list.push({ reading: row.reading, segments: row.segments });
    out.set(row.text, list);
  }
  return out;
}

/** Order a spelling's rubies so the one the sentence actually reads comes first: the reading of its leading kanji
 * run must start the token's own reading (開く: ひら for 開いた read ひらいた, あ for あいた). */
function byReading(candidates: Array<{ reading: string; segments: RubySegment[] }>, reading: string): RubySegment[][] {
  const read = toHiragana(reading);
  const fits = (segments: RubySegment[]) => {
    let prefix = '';
    for (const segment of segments) {
      if (!segment.ruby) break;
      prefix += segment.ruby;
    }
    return prefix !== '' && read.startsWith(prefix);
  };
  return [...candidates]
    .sort((a, b) => Number(fits(b.segments)) - Number(fits(a.segments)))
    .map((candidate) => candidate.segments);
}

/** The finer pieces inside a token: its Sudachi morphemes when it groups several, else that morpheme's A units. */
function partsOf(group: Group): TokenPart[] | undefined {
  if (group.members.length > 1) return group.members.map((member) => ({ s: member.s, b: member.b, e: member.e }));
  const pieces = group.members[0]?.a ?? [];
  return pieces.length > 1 ? pieces.map((piece) => ({ s: piece.s, b: piece.b, e: piece.e })) : undefined;
}

export function toSlimToken(
  group: Group,
  sentence: string,
  rubies: Map<string, Array<{ reading: string; segments: RubySegment[] }>>,
): SlimToken {
  const pos = tokenPos(group.pos, group.kind, group.d);
  const token: SlimToken = {
    s: group.s,
    d: group.d || group.s,
    // Symbols read as themselves, as the current parser stores them.
    r: pos.posLabel === 'Symbol' || !group.r ? group.s : group.r,
    b: group.b,
    e: group.e,
    p: pos.p,
    kind: group.kind,
    posLabel: pos.posLabel,
  };
  if (pos.pt) token.pt = pos.pt;

  const parts = partsOf(group);
  if (parts) token.parts = parts;

  if (hasKanji(group.s)) {
    const candidates = [...(rubies.get(group.d) ?? []), ...(group.n !== group.d ? (rubies.get(group.n) ?? []) : [])];
    const trailing = [...sentence].slice(group.e, group.e + 3).join('');
    const f = surfaceFurigana(group.s, { rubies: byReading(candidates, group.r), reading: group.r, trailing });
    if (f) token.f = f;
  }

  // Any conjugated group, expressions too (手に入って, だったら): the chain is what the card prints.
  if (group.deconjugation && group.kind !== 'symbol') {
    const labels = inflectionLabels(group.deconjugation.process, group.s);
    // The base is the verb the chain ends at (勉強する for 勉強した, whose lemma is the noun 勉強).
    if (labels.length > 0) token.inflection = { labels, base: group.deconjugation.text || token.d };
  }
  return token;
}

/** One token array per input, in input order; a sentence with nothing in it is an empty array. */
export async function parseWithNadeshiko(dataSource: DataSource, texts: string[]): Promise<SlimToken[][]> {
  if (texts.length === 0) return [];
  const [morphemes, lexicon] = await Promise.all([analyseSentences(texts, 'B'), loadLexicon(dataSource)]);
  const sentences = morphemes.map((list) => combine(list, { lexicon, deconjugate }));

  const spellings = new Set<string>();
  for (const groups of sentences) {
    for (const group of groups) {
      if (!hasKanji(group.s)) continue;
      spellings.add(group.d);
      if (group.n) spellings.add(group.n);
    }
  }
  const rubies = await rubiesFor(dataSource, [...spellings]);

  return sentences.map((groups, index) =>
    groups.filter((group) => group.s !== '').map((group) => toSlimToken(group, texts[index] ?? '', rubies)),
  );
}
