/*
 * Two stages that name the word a group stands for, after the groups are final.
 *
 * ResolveOrphanDeverbalNoun follows an upstream form-choice rule (Apache-2.0, see ../../NOTICE): a kanji verb's
 * 連用形 that JMdict lists only as a bound noun suffix, or not at all (探し, 捜し), is the verb when no noun hosts it
 * (用事なら|探し|に is 探す). Upstream lowers the suffix entry's score; we have no scores, so the group becomes the verb.
 *
 * ApplyCollocations is ours: a verb written in kana after a noun and a particle takes the kanji verb our corpus writes
 * there (ピアノを|ひいた is 弾く), from `dict.collocation`, which the frequency job mines from sentences that write the
 * verb in kanji.
 */

import { deconj, hasSection, SECTION } from '../group';
import { hasKanji, isKanji, toHiragana } from '../kana';
import { collocationParticle } from '../lexicon';
import type { CombineContext, Group, WordClass } from '../types';

/** Kana a 連用形 (ます stem) can end in. */
const MASU_STEM_ENDINGS = new Set([...'いきぎしじちにびみりえけげせぜてでねべめれ']);

/** Classes that can host a bound suffix: a noun, a suffix or a number before it. */
const NOMINAL_HOSTS = new Set<WordClass>([
  'Noun',
  'CommonNoun',
  'Name',
  'Pronoun',
  'Suffix',
  'NounSuffix',
  'Numeral',
  'Counter',
]);

/** Clause material that proves the token before is no host: a particle, a predicate, an adverb or a conjunction. */
const CLAUSE_MATERIAL = new Set<WordClass>([
  'Particle',
  'Verb',
  'IAdjective',
  'NaAdjective',
  'Auxiliary',
  'Expression',
  'Adverb',
  'Conjunction',
]);

const NON_SUFFIX_CLASSES = ['noun', 'verb', 'adj-i', 'adj-na', 'adv', 'exp', 'prt', 'conj', 'aux'] as const;

/** `IsDeverbalBoundSuffix`, over our lexicon: a kanji-initial ます-stem spelling JMdict lists only as a suffix, or not
 * at all (our JMdict may predate the suffix entry). */
function isDeverbalBoundSuffix(ctx: CombineContext, text: string): boolean {
  const cs = [...text];
  if (cs.length < 2 || !isKanji(cs[0]) || !MASU_STEM_ENDINGS.has(cs.at(-1) as string)) return false;
  if (!ctx.lexicon.has(text)) return true;
  return ctx.lexicon.hasClass(text, 'suf') && !NON_SUFFIX_CLASSES.some((cls) => ctx.lexicon.hasClass(text, cls));
}

/** `IsNotNominalHost`: only a resolved non-nominal or the start of the sentence counts. */
function isNotNominalHost(previous: Group | undefined): boolean {
  if (!previous) return true;
  return CLAUSE_MATERIAL.has(previous.cls) && !NOMINAL_HOSTS.has(previous.cls) && !hasSection(previous, SECTION.Suffix);
}

/** `ResolveOrphanDeverbalNoun`: 用事なら|探し|に → 探す. */
export function resolveOrphanDeverbalNoun(groups: Group[], ctx: CombineContext): Group[] {
  let out: Group[] | undefined;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i] as Group;
    if (group.cls !== 'Noun' && group.cls !== 'CommonNoun' && group.cls !== 'Suffix') continue;
    if (group.flags.pin !== undefined || !isDeverbalBoundSuffix(ctx, group.s)) continue;
    if (!isNotNominalHost(groups[i - 1])) continue;
    const verb = deconj(ctx, group.s).find(
      (form) =>
        form.tags.includes('stem-ren') &&
        (form.tags.at(-1) ?? '').startsWith('v') &&
        [...form.text].length >= 2 &&
        ctx.lexicon.hasClass(form.text, 'verb'),
    );
    if (!verb) continue;
    out ??= [...groups];
    out[i] = { ...group, d: verb.text, n: verb.text, cls: 'Verb', deconjugation: verb };
  }
  return out ?? groups;
}

const COLLOCATION_HOSTS = new Set<WordClass>(['Noun', 'CommonNoun', 'Name', 'Pronoun']);

/** `ApplyCollocations`: a kana verb after noun + particle takes the kanji verb the corpus writes there. */
export function applyCollocations(groups: Group[], ctx: CombineContext): Group[] {
  let out: Group[] | undefined;
  for (let i = 2; i < groups.length; i++) {
    const verb = groups[i] as Group;
    if (verb.cls !== 'Verb' || verb.flags.pin !== undefined || hasKanji(verb.s) || hasKanji(verb.d) || !verb.d)
      continue;
    const particle = groups[i - 1] as Group;
    const noun = groups[i - 2] as Group;
    if (particle.cls !== 'Particle' || !COLLOCATION_HOSTS.has(noun.cls)) continue;
    const filed = collocationParticle(particle.s);
    if (!filed) continue;
    // A kana spelling that is how a word is usually written (する, いる, できる) already names that word; a table row
    // for it would only move the common verb to a rare homophone (する → 擦る) or to a kanji spelling nobody uses.
    if (ctx.lexicon.hasClass(verb.d, 'usual-kana')) continue;
    const target = ctx.lexicon.collocation(noun.d, filed, toHiragana(verb.d));
    // The target must be a spelling of the same reading, or the table and the token disagree on the word.
    if (!target || !ctx.lexicon.readingsOf(target).some((word) => word.kana.includes(toHiragana(verb.d)))) continue;
    out ??= [...groups];
    out[i] = { ...verb, d: target, n: target };
  }
  return out ?? groups;
}
