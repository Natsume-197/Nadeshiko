import { AMOUNT_COMBINATIONS } from '../data/amountCombinations';
import { hasSection, prepend, SECTION } from '../group';
import { widenDigits } from '../kana';
import type { CombineContext, Group } from '../types';

const PAIRS = new Set(AMOUNT_COMBINATIONS.map(([numeral, counter]) => `${numeral}\u0000${counter}`));

/** Whether AmountCombinations lists this numeral + counter pair; ASCII digits count as their full-width forms. */
export function isAmountCombination(numeral: string, counter: string): boolean {
  return PAIRS.has(`${widenDigits(numeral)}\u0000${widenDigits(counter)}`);
}

/**
 * Whether `next` is a counter suffix a numeral takes. Our generalisation of the closed table, measured against
 * what the current parser stores (2026-11-08): it joins a numeral with a nominal suffix (接尾辞,名詞的: 本, つ, 枚,
 * 歳, 匹, 年生, and 人, which Sudachi tags 一般 rather than 助数詞), but leaves nouns that merely can count
 * (名詞,普通名詞,助数詞可能: 回, 年, 分, 円, 時) as words of their own: 5|分, 10|円.
 */
export function countsWith(next: Group): boolean {
  const [pos1, pos2] = next.pos;
  return pos1 === '接尾辞' && pos2 === '名詞的';
}

/**
 * A numeral and the counter after it (1|つ → 1つ, 三|枚 → 三枚, 16|人 → 16人). Mirrors `CombineAmounts`,
 * whose AmountCombinations table still decides on its own, widened
 * with {@link countsWith}. As upstream, the merged group takes the counter's sections, so it cannot chain into a
 * second counter; `pos` stays the numeral's (名詞,数詞).
 */
export function combineAmounts(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  let current = groups[0] as Group;

  for (let i = 1; i < groups.length; i++) {
    const next = groups[i] as Group;
    if (
      (hasSection(current, SECTION.Amount) || hasSection(current, SECTION.Numeral)) &&
      (isAmountCombination(current.s, next.s) || countsWith(next))
    ) {
      const text = current.s + next.s;
      current = prepend(current, next, {
        d: text,
        n: text,
        cls: 'Noun',
        pos: current.pos,
        flags: { via: 'CombineAmounts', kind: 'counter' },
      });
      changed = true;
    } else {
      out.push(current);
      current = next;
    }
  }
  out.push(current);
  return changed ? out : groups;
}
