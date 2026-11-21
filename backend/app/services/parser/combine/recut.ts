/*
 * Re-cutting groups. The upstream split and repair stages and rewrite rules rebuild tokens with new text and offsets,
 * and some move a boundary inside a Sudachi morpheme (どうして → どう|し|て, 行こ|うっ|て → 行こう|って). Our groups keep
 * the morphemes they are made of (`Group.members`, which become `parts`), so a re-cut re-tiles the span's morphemes:
 * a morpheme wholly inside a new piece stays as it is, and the part of one a boundary cuts through becomes a synthetic
 * morpheme (`synthetic: true`) with its own code-point offsets, surface and reading, its POS and A units narrowed
 * from the morpheme it was cut from. A piece's reading is the one the stage gives, else its members' readings.
 */

import type { Morpheme } from '../sudachi';
import { baseKind, classOf } from './group';
import { isAllKana, isKana, toKatakana } from './kana';
import { chars, cpLength, escapeRegExp } from './text';
import type { Group, GroupFlags, WordClass } from './types';

/** One run of a morpheme surface and the reading it aligns to: a kana is its own run, matched literally; consecutive
 * other characters (kanji, digits) form one run matched lazily. */
interface ReadingRun {
  from: number;
  to: number;
  reading: string;
}

function alignRuns(surface: string, reading: string): ReadingRun[] | undefined {
  const cs = chars(surface);
  const runs: Array<{ from: number; to: number; literal: boolean }> = [];
  for (let k = 0; k < cs.length; k++) {
    const literal = isKana(cs[k]);
    const last = runs.at(-1);
    if (!literal && last && !last.literal) last.to = k + 1;
    else runs.push({ from: k, to: k + 1, literal });
  }
  const pattern = runs
    .map((run) => (run.literal ? `(${escapeRegExp(toKatakana(cs.slice(run.from, run.to).join('')))})` : '(.+?)'))
    .join('');
  const match = new RegExp(`^${pattern}$`, 'u').exec(toKatakana(reading));
  if (!match) return undefined;
  return runs.map((run, k) => ({ from: run.from, to: run.to, reading: match[k + 1] as string }));
}

/** The reading of code points [from, to) of a morpheme, when the alignment can tell (not inside a kanji run). */
export function sliceReading(surface: string, reading: string, from: number, to: number): string | undefined {
  if (from === 0 && to >= cpLength(surface)) return reading;
  const runs = alignRuns(surface, reading);
  if (!runs) return undefined;
  let out = '';
  for (const run of runs) {
    if (run.to <= from || run.from >= to) continue;
    if (run.from < from || run.to > to) return undefined;
    out += run.reading;
  }
  return out;
}

/** The part [b, e) of a morpheme: itself when it lies wholly inside, else a synthetic piece of it. */
export function cutMorpheme(morpheme: Morpheme, b: number, e: number): Morpheme {
  const from = Math.max(b, morpheme.b);
  const to = Math.min(e, morpheme.e);
  if (from === morpheme.b && to === morpheme.e) return morpheme;
  const s = chars(morpheme.s)
    .slice(from - morpheme.b, to - morpheme.b)
    .join('');
  const r =
    sliceReading(morpheme.s, morpheme.r, from - morpheme.b, to - morpheme.b) ?? (isAllKana(s) ? toKatakana(s) : '');
  const a = morpheme.a.filter((unit) => unit.b >= from && unit.e <= to);
  return { ...morpheme, s, b: from, e: to, r, d: s, n: s, a: a.length > 1 ? a : [], synthetic: true };
}

/** The morphemes that tile [b, e), cut where a boundary falls inside one. */
export function membersIn(members: readonly Morpheme[], b: number, e: number): Morpheme[] {
  return members.filter((member) => member.e > b && member.b < e).map((member) => cutMorpheme(member, b, e));
}

/** The six UniDic fields a piece gets when a stage gives it a class its source morpheme's POS does not have. */
const POS_OF_CLASS: Partial<Record<WordClass, Morpheme['pos']>> = {
  Noun: ['名詞', '普通名詞', '一般', '*', '*', '*'],
  CommonNoun: ['名詞', '普通名詞', '一般', '*', '*', '*'],
  Name: ['名詞', '固有名詞', '一般', '*', '*', '*'],
  Numeral: ['名詞', '数詞', '*', '*', '*', '*'],
  Pronoun: ['代名詞', '*', '*', '*', '*', '*'],
  Verb: ['動詞', '一般', '*', '*', '*', '*'],
  IAdjective: ['形容詞', '一般', '*', '*', '*', '*'],
  NaAdjective: ['形状詞', '一般', '*', '*', '*', '*'],
  Adverb: ['副詞', '*', '*', '*', '*', '*'],
  Particle: ['助詞', '*', '*', '*', '*', '*'],
  Auxiliary: ['助動詞', '*', '*', '*', '*', '*'],
  Conjunction: ['接続詞', '*', '*', '*', '*', '*'],
  Interjection: ['感動詞', '一般', '*', '*', '*', '*'],
  Prefix: ['接頭辞', '*', '*', '*', '*', '*'],
  Suffix: ['接尾辞', '名詞的', '一般', '*', '*', '*'],
  Counter: ['接尾辞', '名詞的', '助数詞', '*', '*', '*'],
  PrenounAdjectival: ['連体詞', '*', '*', '*', '*', '*'],
  Filler: ['フィラー', '*', '*', '*', '*', '*'],
};

const NOUN_CLASSES = new Set<WordClass>(['Noun', 'CommonNoun', 'Name', 'Numeral', 'Counter']);

/** Whether a morpheme POS already says `cls` (an Expression keeps whatever its head says). */
function posFits(pos: Morpheme['pos'], cls: WordClass): boolean {
  if (cls === 'Expression' || cls === 'Unknown') return true;
  const own = classOf(pos[0]);
  return own === cls || (NOUN_CLASSES.has(cls) && own === 'Noun') || (cls === 'Counter' && own === 'Suffix');
}

/** One output of a re-cut. Unset fields default from `from`, as `new WordInfo(source) { ... }` does, or,
 * with `fresh`, as `new WordInfo { ... }` does: the piece's own text as its lemma, no sections, no flags. */
export interface Piece {
  s: string;
  /** The group the piece copies its other fields from; default: the input group the piece starts in. */
  from?: Group;
  fresh?: boolean;
  d?: string;
  n?: string;
  cls?: WordClass;
  /** Katakana; '' or unset derives it from the members. */
  r?: string;
  pos?: Morpheme['pos'];
  sec?: Group['sec'];
  flags?: GroupFlags;
}

/**
 * `groups[start, start + count)` re-cut into `pieces`, whose surfaces must spell the same text. Offsets tile the span
 * by surface length (`AssignOffsets`); members are the span's morphemes re-tiled (see {@link membersIn}).
 */
export function recut(groups: readonly Group[], start: number, count: number, pieces: readonly Piece[]): Group[] {
  const span = groups.slice(start, start + count);
  const text = span.map((group) => group.s).join('');
  if (pieces.map((piece) => piece.s).join('') !== text)
    throw new Error(`re-cut does not conserve '${text}': ${pieces.map((piece) => piece.s).join('|')}`);
  const all = span.flatMap((group) => group.members);
  let b = (span[0] as Group).b;
  return pieces.map((piece) => {
    const e = b + cpLength(piece.s);
    const source = piece.from ?? span.find((group) => group.b <= b && b < group.e) ?? (span[0] as Group);
    const members = membersIn(all, b, e);
    const sameSpan = source.b === b && source.e === e;
    const surfaceChanged = piece.s !== source.s;
    const cls = piece.cls ?? source.cls;
    const r = piece.r || (sameSpan && !piece.fresh ? source.r : members.map((member) => member.r).join(''));
    const fresh = piece.fresh === true;
    const group: Group = {
      ...source,
      s: piece.s,
      b,
      e,
      r,
      d: piece.d ?? (fresh || surfaceChanged ? piece.s : source.d),
      n: piece.n ?? (fresh || surfaceChanged ? piece.s : source.n),
      // A new surface whose class its morpheme's POS does not say gets a POS that says it. A group a stage only
      // reclassifies keeps Sudachi's POS, which is what the card shows (the class is working state).
      pos: piece.pos ?? (surfaceChanged && !posFits(source.pos, cls) ? (POS_OF_CLASS[cls] ?? source.pos) : source.pos),
      members,
      kind: baseKind(cls),
      deconjugation: null,
      cls,
      sec: piece.sec ?? (fresh ? ['*', '*', '*'] : source.sec),
      flags: piece.flags ?? (fresh ? {} : source.flags),
    };
    b = e;
    return group;
  });
}

/** `groups` with `groups[start, start + count)` replaced by `out`. */
export function splice(groups: readonly Group[], start: number, count: number, out: readonly Group[]): Group[] {
  return [...groups.slice(0, start), ...out, ...groups.slice(start + count)];
}

/** `ScanRewrite`: `tryAt` either consumes
 * groups from `i` (returning how many, after writing its outputs to `emit()`) or returns 0 to keep `groups[i]`.
 * `emit()` is the output so far, copied from the input on first use, so a rule may also rewrite what it already
 * holds; `last()` is its last group without copying (`result != null ? result[^1] : tokens[i - 1]`). Returns
 * the input when nothing fired. */
export function scanRewrite(
  groups: Group[],
  tryAt: (groups: readonly Group[], i: number, emit: () => Group[], last: () => Group | undefined) => number,
): Group[] {
  let out: Group[] | undefined;
  let i = 0;
  const emit = () => {
    out ??= groups.slice(0, i);
    return out;
  };
  const last = () => (out ? out.at(-1) : groups[i - 1]);
  for (; i < groups.length; i++) {
    const consumed = tryAt(groups, i, emit, last);
    if (consumed > 0) i += consumed - 1;
    else out?.push(groups[i] as Group);
  }
  return out ?? groups;
}
