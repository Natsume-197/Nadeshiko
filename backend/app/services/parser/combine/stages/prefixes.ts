import { PREFIX_COMBINE_EXCLUSIONS } from '../data/ruleData';
import { isNounForCompounding, known, knownVerbOrAdjective, prepend } from '../group';
import { isKanji, toHiragana } from '../kana';
import type { CombineContext, Group } from '../types';

const VIA = 'CombinePrefixes';

// Prefix combine runs before noun compounding: お|母|上 must yield お + 母上, not お母; お+手+紙 → お手紙 is a word.
function completesCompoundWithFollowing(groups: readonly Group[], prefixIndex: number, ctx: CombineContext): boolean {
  if (prefixIndex + 2 >= groups.length) return false;
  const head = groups[prefixIndex + 1] as Group;
  const following = groups[prefixIndex + 2] as Group;
  if (!isNounForCompounding(following.cls) || following.s.length === 0) return false;
  return known(ctx, head.s + following.s) && !known(ctx, (groups[prefixIndex] as Group).s + head.s + following.s);
}

/**
 * お/ご/相/再… + the word after it, when the whole is a dictionary word (お方, ご注文, 相次ぐ). Mirrors
 * `CombinePrefixes`. Left out: its last branch, which re-cuts an
 * unattested next token (相+当腹 → 相当+腹), because a group cannot hold part of a morpheme.
 */
export function combinePrefixes(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  let i = 0;

  while (i < groups.length) {
    const current = groups[i] as Group;
    const next = groups[i + 1];

    // Sudachi tags emphatic ど as Adverb (truncated どう); before an i-adjective it is a prefix (ど偉い).
    const isEmphaticDo = current.s === 'ど' && current.cls === 'Adverb' && next?.cls === 'IAdjective';

    if ((current.cls === 'Prefix' || isEmphaticDo) && next) {
      const isKanjiPrefix = isKanji(current.s[0]);
      // Kanji prefixes (相, 再, 不) may take verbs/adjectives; kana prefixes (お, ご) only nominals.
      const isContentWord =
        next.cls === 'Noun' ||
        next.cls === 'NaAdjective' ||
        next.cls === 'Adverb' ||
        next.cls === 'NominalAdjective' ||
        next.cls === 'CommonNoun' ||
        ((isKanjiPrefix || isEmphaticDo) && (next.cls === 'Verb' || next.cls === 'IAdjective'));

      if (isContentWord) {
        const merged = tryMerge(groups, i, current, next, ctx);
        if (merged) {
          out.push(merged);
          changed = true;
          i += 2;
          continue;
        }
      }
    }

    out.push(current);
    i++;
  }

  return changed ? out : groups;
}

function tryMerge(groups: Group[], i: number, prefix: Group, next: Group, ctx: CombineContext): Group | null {
  const combined = prefix.s + next.s;
  const flags = { via: VIA };

  if (
    !PREFIX_COMBINE_EXCLUSIONS.has(combined) &&
    known(ctx, combined) &&
    !completesCompoundWithFollowing(groups, i, ctx)
  ) {
    const cls = next.cls === 'Verb' || next.cls === 'IAdjective' ? 'Noun' : next.cls;
    return prepend(prefix, next, { d: combined, n: combined, cls, flags });
  }

  // Inflected verb: 相 + 次い → 相次ぐ; POS kept so CombineInflections and deconjugation still apply.
  if (next.cls === 'Verb' && next.d && next.d !== next.s) {
    const dictionaryCombined = prefix.s + next.d;
    if (!PREFIX_COMBINE_EXCLUSIONS.has(dictionaryCombined) && knownVerbOrAdjective(ctx, dictionaryCombined)) {
      return prepend(prefix, next, { d: dictionaryCombined, n: dictionaryCombined, flags });
    }
  }

  // Classical i-adjective: 故 + 無き → 故無い (2112310); IAdjective kept so deconjugation reaches adj-i.
  if (next.cls === 'IAdjective' && next.n && next.n !== next.s) {
    const normalizedCombined = prefix.s + next.n;
    if (!PREFIX_COMBINE_EXCLUSIONS.has(normalizedCombined) && known(ctx, normalizedCombined)) {
      return prepend(prefix, next, { d: normalizedCombined, n: normalizedCombined, flags });
    }
  }

  // Colloquial surfaces carry the standard form in Reading (古 + くせー reading クサイ → 古くさい).
  if (next.r) {
    const readingHira = toHiragana(next.r);
    if (readingHira !== next.s && readingHira !== combined && !known(ctx, next.s)) {
      const readingCombined = prefix.s + readingHira;
      if (!PREFIX_COMBINE_EXCLUSIONS.has(readingCombined) && known(ctx, readingCombined)) {
        return prepend(prefix, next, { d: readingCombined, n: readingCombined, flags });
      }
    }
  }

  return null;
}
