import { deconjugationKey } from '../kana';
import { deconj } from '../group';
import type { CombineContext, Group } from '../types';

/**
 * (ours) The dictionary form readers look up and mine, where the combined form is not a JMdict headword. Runs after
 * AssignKinds, so the conjugation chain the card prints is still the one to the verb (勉強した: past of 勉強する).
 *
 * - A suru-noun with its する (帰属する, 心配した) keeps its surface and its chain to the suru verb, but its lemma is
 *   the noun (帰属): JMdict files suru verbs under the noun (vs), so that is the card's entry and the word readers
 *   mine.
 * - A potential verb Sudachi gives its own lemma (勝てる, 許せない → 許せる) takes the verb it is the potential of
 *   (勝つ, 許す) when JMdict has no entry for the potential form, and its chain goes to that verb, so the card says
 *   potential (許せない: potential, negative of 許す).
 */

const SURU = /(?:する|為る)$/u;

function suruNounLemma(group: Group, ctx: CombineContext): string | undefined {
  if (group.members.length < 2 || group.members[0]?.pos[0] !== '名詞') return undefined;
  if (!SURU.test(group.d)) return undefined;
  const stem = group.d.replace(SURU, '');
  if (!stem || stem !== group.members[0]?.s) return undefined;
  // JMdict's suru verbs are nouns with a vs sense, which the lexicon files under the verb class.
  return ctx.lexicon.hasClass(stem, 'verb') ? stem : undefined;
}

const isPotentialStep = (step: string) => step === 'potential' || step === 'passive/potential';

function potentialRepair(group: Group, ctx: CombineContext): Group | undefined {
  if (group.cls !== 'Verb' || !group.d || ctx.lexicon.has(group.d)) return undefined;
  const base = deconj(ctx, group.d).find(
    (form) =>
      form.process.some(isPotentialStep) &&
      form.tags.some((tag) => tag.startsWith('v')) &&
      ctx.lexicon.hasClass(form.text, 'verb'),
  );
  if (!base) return undefined;
  // The chain from the surface itself to the base verb, so the potential step is in it.
  const target = deconjugationKey(base.text);
  const chain =
    deconj(ctx, group.s).find((form) => deconjugationKey(form.text) === target && form.process.some(isPotentialStep)) ??
    group.deconjugation;
  return { ...group, d: base.text, n: base.text, deconjugation: chain };
}

export function repairLemmas(groups: Group[], ctx: CombineContext): Group[] {
  let changed = false;
  const out = groups.map((group) => {
    const noun = suruNounLemma(group, ctx);
    if (noun) {
      changed = true;
      return { ...group, d: noun, n: noun };
    }
    const potential = potentialRepair(group, ctx);
    if (potential) {
      changed = true;
      return potential;
    }
    return group;
  });
  return changed ? out : groups;
}
