import { append, hasSection, SECTION } from '../group';
import { deconjugationKey } from '../kana';
import type { CombineContext, Group } from '../types';

const isNaAdjectiveToken = (group: Group) =>
  group.cls === 'NaAdjective' ||
  hasSection(group, SECTION.PossibleNaAdjective) ||
  hasSection(group, SECTION.NaAdjectiveLike);

/**
 * 飲ん|だ and 飲ん|で are past and て-forms of む/ぬ/ぶ/ぐ verbs, while たくさん|で and さん|だ take the copula.
 * The one part of the repair stage `RepairNTokenisation`
 * the combine stages depend on: CombineInflections stops before だ after a stem in ん, and CombineAuxiliary only
 * re-joins a stem the deconjugator does not also read as a slurred negative (読ん could be 読る's).
 */
export function repairNdaPastTense(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;

  for (let i = 0; i < groups.length; i++) {
    const current = groups[i] as Group;
    const next = groups[i + 1];
    if (
      next &&
      current.s.endsWith('ん') &&
      current.s.length > 1 &&
      !isNaAdjectiveToken(current) &&
      current.cls !== 'Suffix' &&
      !deconjugationKey(current.d).endsWith('ん') &&
      (next.s === 'だ' || next.s === 'で')
    ) {
      const forms = ctx.deconjugate(deconjugationKey(current.s + next.s));
      const isNdaVerbForm = forms.some(
        (form) =>
          (form.tags.includes('v5m') && form.text.endsWith('む')) ||
          (form.tags.includes('v5n') && form.text.endsWith('ぬ')) ||
          (form.tags.includes('v5b') && form.text.endsWith('ぶ')) ||
          (form.tags.includes('v5g') && form.text.endsWith('ぐ')),
      );
      if (isNdaVerbForm) {
        out.push(append(current, next, { cls: 'Verb', flags: { inflected: true, via: 'RepairNTokenisation' } }));
        changed = true;
        i++;
        continue;
      }
    }
    out.push(current);
  }

  return changed ? out : groups;
}
