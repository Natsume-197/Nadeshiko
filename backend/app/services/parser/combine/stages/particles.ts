import { SPECIAL_CASES_2, SPECIAL_CASES_3 } from '../data/ruleData';
import { append, span } from '../group';
import type { CombineContext, Group, WordClass } from '../types';

const startsWithShire = (text: string) => ['しれ', 'しんな', 'しんね'].some((head) => text.startsWith(head));

/**
 * Compound particles and the かもしれない / ではない(か) / じゃないか clusters (に|は → には, か|も|しれ|ない).
 * `CombineParticles`. Unlike upstream, which keeps the first
 * particle's dictionary form (に for には), `d` is the merged particle.
 */
export function combineParticles(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  let i = 0;
  const via = { via: 'CombineParticles' };

  while (i < groups.length) {
    const current = groups[i] as Group;
    const next = groups[i + 1];
    const third = groups[i + 2];

    // か+も+しれ* is one expression; the deconjugator recovers かもしれない from contracted しんない.
    if (current.s === 'か' && next?.s === 'も' && third && startsWithShire(third.s)) {
      out.push(span(groups, i, i + 3, { cls: 'Expression', d: 'かもしれない', n: 'かもしれない', flags: via }));
      changed = true;
      i += 3;
      continue;
    }

    // かも already fused upstream (after the ん-repair) arrives as [かも][しれ*].
    if (current.s === 'かも' && next && startsWithShire(next.s)) {
      out.push(span(groups, i, i + 2, { cls: 'Expression', d: 'かもしれない', n: 'かもしれない', flags: via }));
      changed = true;
      i += 2;
      continue;
    }

    // A fused じゃない expression + か → じゃないか; a verb negative (しない か) keeps か separate.
    if (current.cls === 'Expression' && (current.d === 'じゃない' || current.d === 'ではない') && next?.s === 'か') {
      out.push(append(current, next, { d: `${current.d}か`, flags: via }));
      changed = true;
      i += 2;
      continue;
    }

    if (next) {
      const pair = current.s + next.s;
      if (pair === 'には' || pair === 'とは' || pair === 'では' || pair === 'のに') {
        if (pair === 'では' && third && (third.d === 'ない' || third.d === '無い')) {
          const fourth = groups[i + 3];
          const withKa = fourth?.s === 'か';
          const d = withKa ? 'ではないか' : 'ではない';
          out.push(span(groups, i, i + (withKa ? 4 : 3), { cls: 'Expression', d, n: d, flags: via }));
          changed = true;
          i += withKa ? 4 : 3;
          continue;
        }
        out.push(append(current, next, { d: pair, n: pair, flags: via }));
        changed = true;
        i += 2;
        continue;
      }
    }

    out.push(current);
    i++;
  }

  return changed ? out : groups;
}

/** って + kana いう → っていう (2757880); kanji 言う is "to say" (だって|言う|人) and stays split.
 * `CombineQuotativeToIu`, without its second branch, which splits って off a volitional (しようって). */
export function combineQuotativeToIu(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  for (let i = 0; i < groups.length; i++) {
    const word = groups[i] as Group;
    const next = groups[i + 1];
    if (
      next &&
      word.s === 'って' &&
      word.d === 'って' &&
      word.cls === 'Particle' &&
      next.s === 'いう' &&
      next.d === 'いう'
    ) {
      out.push(
        append(word, next, {
          d: 'っていう',
          n: 'っていう',
          cls: 'Conjunction',
          flags: { via: 'CombineQuotativeToIu' },
        }),
      );
      changed = true;
      i++;
      continue;
    }
    out.push(word);
  }
  return changed ? out : groups;
}

const SPECIAL_2 = new Map<string, Array<{ second: string; cls: WordClass }>>();
for (const [first, second, cls] of SPECIAL_CASES_2) {
  const list = SPECIAL_2.get(first) ?? [];
  list.push({ second, cls });
  SPECIAL_2.set(first, list);
}
const SPECIAL_3 = new Map<string, Array<{ second: string; third: string; cls: WordClass }>>();
for (const [first, second, third, cls] of SPECIAL_CASES_3) {
  const list = SPECIAL_3.get(first) ?? [];
  list.push({ second, third, cls });
  SPECIAL_3.set(first, list);
}

/**
 * Verb + ば, then the curated two- and three-token units (ん|だ, です|か, だ|から, 本当|に, に|つい|て…).
 * `CombineFinal`. The tables are SpecialCases2/3, copied in data/ruleData.ts.
 */
export function combineFinal(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  const via = 'CombineFinal';

  for (let i = 0; i < groups.length; i++) {
    const current = groups[i] as Group;
    const next = groups[i + 1];
    if (!next) {
      out.push(current);
      continue;
    }

    if (next.s === 'ば' && current.cls === 'Verb') {
      out.push(append(current, next, { flags: { via, inflected: true } }));
      changed = true;
      i++;
      continue;
    }

    const pairs = SPECIAL_2.get(current.s);
    if (pairs) {
      // ところで (1343110) only sentence-initially or after た/だ; 静かなところで is locative ところ + で.
      const before = groups[i - 1];
      const tokoroDeBlocked =
        current.s === 'ところ' && before !== undefined && !(before.s.endsWith('た') || before.s.endsWith('だ'));
      const match = pairs.find((pair) => !(pair.second === 'で' && tokoroDeBlocked) && next.s === pair.second);
      if (match) {
        const text = current.s + next.s;
        out.push(append(current, next, { d: text, n: text, cls: match.cls, flags: { via } }));
        changed = true;
        i++;
        continue;
      }
    }

    const third = groups[i + 2];
    const triples = third ? SPECIAL_3.get(current.s) : undefined;
    if (third && triples) {
      const match = triples.find(
        (triple) =>
          next.s === triple.second &&
          (third.s === triple.third || (triple.third.endsWith('ー') && third.s === triple.third.slice(0, -1))),
      );
      if (match) {
        const d = current.s + next.s + match.third;
        out.push(span(groups, i, i + 3, { d, n: d, cls: match.cls, flags: { via } }));
        changed = true;
        i += 2;
        continue;
      }
    }

    out.push(current);
  }

  return changed ? out : groups;
}
