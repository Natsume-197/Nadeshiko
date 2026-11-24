import type { DataSource } from 'typeorm';
import type { SlimToken, TokenPart } from '@app/models/Segment';
import { combine, type Group, loadLexicon } from './combine';
import { hasHanScript as hasKanji, toHiragana } from './combine/kana';
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

/**
 * A sentence split once for its tokens. The parser counts offsets in code points (Sudachi and `preprocess` both do),
 * but every reader of a token's `b`/`e` slices the JavaScript string, which counts UTF-16 units: 𠮟 or an emoji is one
 * code point and two units. `utf16[i]` is where code point `i` starts, so offsets are converted once, here.
 */
export interface SentenceText {
  chars: readonly string[];
  utf16: readonly number[];
}

export function sentenceText(text: string): SentenceText {
  const chars = [...text];
  const utf16 = [0];
  for (const char of chars) utf16.push((utf16.at(-1) as number) + char.length);
  return { chars, utf16 };
}

/** The finer pieces inside a token: its Sudachi morphemes when it groups several, else that morpheme's A units. */
function partsOf(group: Group, at: (point: number) => number): TokenPart[] | undefined {
  const pieces = group.members.length > 1 ? group.members : (group.members[0]?.a ?? []);
  if (pieces.length <= 1) return undefined;
  return pieces.map((piece) => ({ s: piece.s, b: at(piece.b), e: at(piece.e) }));
}

export function toSlimToken(
  group: Group,
  /** The sentence, or {@link sentenceText} of it (split once per sentence by the caller). */
  sentence: string | SentenceText,
  rubies: Map<string, Array<{ reading: string; segments: RubySegment[] }>>,
): SlimToken {
  const text = typeof sentence === 'string' ? sentenceText(sentence) : sentence;
  // Offsets past the sentence (never expected) are kept as they are rather than turned into NaN.
  const at = (point: number) => text.utf16[point] ?? point;
  const pos = tokenPos(group.pos, group.kind, group.d);
  const token: SlimToken = {
    s: group.s,
    d: group.d || group.s,
    // Symbols read as themselves, as the current parser stores them.
    r: pos.posLabel === 'Symbol' || !group.r ? group.s : group.r,
    b: at(group.b),
    e: at(group.e),
    p: pos.p,
    kind: group.kind,
    posLabel: pos.posLabel,
  };
  if (pos.pt) token.pt = pos.pt;

  const parts = partsOf(group, at);
  if (parts) token.parts = parts;

  if (hasKanji(group.s)) {
    const candidates = [...(rubies.get(group.d) ?? []), ...(group.n !== group.d ? (rubies.get(group.n) ?? []) : [])];
    const trailing = text.chars.slice(group.e, group.e + 3).join('');
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

  return sentences.map((groups, index) => {
    const text = sentenceText(texts[index] ?? '');
    return groups.filter((group) => group.s !== '').map((group) => toSlimToken(group, text, rubies));
  });
}
