import {
  COMPLETION_AUX_VERBS,
  endsOnSubsidiaryVerbClass,
  TE_FORM_AUX_CHAIN_VERBS,
  TE_FORM_SUBSIDIARY_VERBS,
} from '../data/ruleData';
import {
  append,
  deconj,
  hasSection,
  isImperative,
  known,
  mergeAdjacentWhere,
  SECTION,
  verbDictFormExists,
} from '../group';
import { deconjugationKey, isKanji } from '../kana';
import type { CombineContext, Group } from '../types';

/*
 * The stages that attach auxiliaries, て/で and subsidiary verbs to a predicate that CombineInflections left, each
 * mirroring the upstream combine stage or helper of the same name.
 */

const inflected = (via: string) => ({ flags: { inflected: true, via } });

/** 逃げ|切った → 逃げ切った when JMdict has 逃げ切る; 紙を|切った stays. `CombineCompletionAuxVerb`. */
export function combineCompletionAuxVerb(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  for (let i = 0; i < groups.length; i++) {
    const word = groups[i] as Group;
    const aux = groups[i + 1];
    if (
      aux &&
      word.cls === 'Verb' &&
      word.s.length >= 2 &&
      !word.s.endsWith('て') &&
      !word.s.endsWith('で') &&
      aux.cls === 'Verb' &&
      COMPLETION_AUX_VERBS.has(aux.d) &&
      known(ctx, word.s + aux.d)
    ) {
      out.push(
        append(word, aux, {
          d: word.s + aux.d,
          n: word.s + aux.d,
          cls: 'Verb',
          ...inflected('CombineCompletionAuxVerb'),
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

/** A stem ending in っ and the て-word after it. `CombineTte`. */
export function combineTte(groups: Group[], _ctx: CombineContext): Group[] {
  return mergeAdjacentWhere(groups, (current, next) => current.s.endsWith('っ') && next.s.startsWith('て'), {
    flags: { via: 'CombineTte' },
  });
}

/** A predicate and an auxiliary-verb stem after it (高|そう, 降り|そう). `CombineAuxiliaryVerbStem`. */
export function combineAuxiliaryVerbStem(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  let current = groups[0] as Group;

  for (let i = 1; i < groups.length; i++) {
    const next = groups[i] as Group;
    const previous = groups[i - 1] as Group;
    // Adjectival suffixes (やすい, にくい) arrive as their stems (やす, にく) and also host そう.
    const isAdjectivalSuffix = previous.cls === 'Suffix' && previous.d.endsWith('い');
    if (
      hasSection(next, SECTION.AuxiliaryVerbStem) &&
      !['ように', 'よう', 'ようです', 'みたい'].includes(next.s) &&
      (previous.cls === 'Verb' ||
        previous.cls === 'IAdjective' ||
        (previous.cls === 'Noun' &&
          (hasSection(previous, SECTION.PossibleNaAdjective) || hasSection(previous, SECTION.PossibleVerbSuruNoun))) ||
        isAdjectivalSuffix)
    ) {
      current = append(current, next, { flags: { via: 'CombineAuxiliaryVerbStem' } });
      changed = true;
    } else {
      out.push(current);
      current = next;
    }
  }
  out.push(current);
  return changed ? out : groups;
}

/** て/で/ちゃ/ば after a verb, adjective or auxiliary. `CombineConjunctiveParticle`. */
export function combineConjunctiveParticle(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [groups[0] as Group];
  let changed = false;
  for (let i = 1; i < groups.length; i++) {
    const current = groups[i] as Group;
    const previous = out.at(-1) as Group;
    if (
      hasSection(current, SECTION.ConjunctionParticle) &&
      ['て', 'で', 'ちゃ', 'ば'].includes(current.s) &&
      (previous.cls === 'Verb' || previous.cls === 'IAdjective' || previous.cls === 'Auxiliary')
    ) {
      out[out.length - 1] = append(previous, current, inflected('CombineConjunctiveParticle'));
      changed = true;
    } else {
      out.push(current);
    }
  }
  return changed ? out : groups;
}

// Keep in sync with ShouldStopMerging's list; kana lemmas included since Sudachi tags 言う as いう freely.
const isQuoteTakingVerb = (group: Group) =>
  ['思う', 'おもう', '言う', 'いう', '聞く', 'きく', '考える', '感じる'].includes(group.d);

/** `IsNdaVerbForm`. */
function isNdaVerbForm(ctx: CombineContext, text: string): boolean {
  return deconj(ctx, text).some(
    (form) =>
      (form.tags.includes('v5m') && form.text.endsWith('む')) ||
      (form.tags.includes('v5n') && form.text.endsWith('ぬ')) ||
      (form.tags.includes('v5b') && form.text.endsWith('ぶ')) ||
      (form.tags.includes('v5g') && form.text.endsWith('ぐ')),
  );
}

/** True only for む/ぬ/ぶ/ぐ past tense (読んだ); a slurred negative ん + copula (知らん + だ) is false.
 * `IsValidNdaPastTense`. */
function isValidNdaPastTense(ctx: CombineContext, verbText: string): boolean {
  if (!verbText.endsWith('ん')) return false;
  const slurred = deconj(ctx, verbText).some((form) =>
    form.process.some((step) => step.includes('slurred negative') || step.includes('colloquial negative')),
  );
  if (slurred) return false;
  return isNdaVerbForm(ctx, `${verbText}だ`);
}

/**
 * An auxiliary after a predicate or another auxiliary (行き|ます|た, だっ|た), minus the long list of auxiliaries
 * that must stay their own word (です, らしい, だろう…), plus で+ある → である. `CombineAuxiliary`.
 */
export function combineAuxiliary(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [groups[0] as Group];
  let changed = false;

  for (let i = 1; i < groups.length; i++) {
    const current = groups[i] as Group;
    const previous = out.at(-1) as Group;

    if (current.cls !== 'Auxiliary') {
      // Copula で keeps DictionaryForm だ after reclassification to Particle; で + ある → である.
      if (previous.s === 'で' && previous.d === 'だ' && (current.d === 'ある' || current.d === '有る')) {
        out[out.length - 1] = append(previous, current, {
          cls: current.cls,
          d: 'である',
          n: 'である',
          flags: { via: 'CombineAuxiliary', kind: 'expression' },
        });
        changed = true;
      } else {
        out.push(current);
      }
      continue;
    }

    const next = groups[i + 1];
    const s = current.s;
    const d = current.d;
    const canHost =
      (previous.cls === 'Verb' ||
        previous.cls === 'IAdjective' ||
        previous.cls === 'NaAdjective' ||
        previous.cls === 'Auxiliary' ||
        hasSection(previous, SECTION.Adjectival)) &&
      (previous.cls !== 'Verb' ||
        hasSection(previous, SECTION.PossibleSuru) ||
        verbDictFormExists(ctx, previous.d, previous.n));
    const allowed =
      canHost &&
      s !== 'な' &&
      s !== 'に' &&
      (d !== 'です' || (previous.cls === 'Verb' && (s === 'でし' || s === 'でした'))) &&
      !['らしい', 'べし', 'む', 'ごとし', '如し', 'ようだ', 'やがる', 'たり', '筈'].includes(d) &&
      !['なら', 'なる', 'だろう', 'で', 'や', 'やろ', 'やしない', 'し', 'なのだ', 'だろ', 'ハズ'].includes(s) &&
      !(s === 'って' && isImperative(previous)) &&
      // Copula だって before a quote verb is quotative (大袈裟|だって|言いたい); ようって folds for CombineQuotativeToIu.
      !(d === 'だ' && s.endsWith('って') && next !== undefined && isQuoteTakingVerb(next)) &&
      !s.startsWith('なん') &&
      (s !== 'だ' || (previous.s.endsWith('ん') && isValidNdaPastTense(ctx, previous.s))) &&
      !(s === 'じゃ' && d === 'だ');

    if (allowed) {
      let dictForm = previous.d;
      if (['ちまう', 'じまう', 'しまう'].includes(d) && known(ctx, previous.s + d)) dictForm = previous.s + d;
      const isPredicate = previous.cls === 'Verb' || previous.cls === 'IAdjective';
      out[out.length - 1] = append(previous, current, {
        d: dictForm,
        flags: isPredicate ? { inflected: true, via: 'CombineAuxiliary' } : { via: 'CombineAuxiliary' },
      });
      changed = true;
      continue;
    }

    if (previous.cls === 'Expression' && d === 'た' && /[てで]$/.test(previous.s)) {
      out[out.length - 1] = append(previous, current, { flags: { via: 'CombineAuxiliary' } });
      changed = true;
      continue;
    }

    out.push(current);
  }

  return changed ? out : groups;
}

/** と + なる that Sudachi splits before punctuation (トラウマとなり、), after a noun-like word. `CombineToNaru`. */
export function combineToNaru(groups: Group[], _ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  for (let i = 0; i < groups.length; i++) {
    const word = groups[i] as Group;
    const next = groups[i + 1];
    if (word.s === 'と' && word.cls === 'Particle' && next) {
      const isNaru =
        (next.cls === 'Verb' || next.cls === 'Auxiliary') &&
        (next.d === 'なる' || next.d === '成る' || next.n === 'なる' || next.n === '成る');
      const previous = out.at(-1);
      const prevIsNounLike =
        previous !== undefined && ['Noun', 'Pronoun', 'Counter', 'Numeral', 'NaAdjective'].includes(previous.cls);
      if (isNaru && [...next.s].length <= 3 && prevIsNounLike) {
        const merged = {
          ...next,
          s: word.s + next.s,
          b: word.b,
          r: word.r + next.r,
          members: [...word.members, ...next.members],
          d: 'となる',
          n: 'なる',
          flags: { ...next.flags, via: 'CombineToNaru' },
        };
        out.push(merged);
        changed = true;
        i++;
        continue;
      }
    }
    out.push(word);
  }
  return changed ? out : groups;
}

/** A verb and the たり/だり after it. `CombineAdverbialParticle`. */
export function combineAdverbialParticle(groups: Group[], _ctx: CombineContext): Group[] {
  return mergeAdjacentWhere(
    groups,
    (current, next) =>
      hasSection(next, SECTION.AdverbialParticle) && (next.d === 'だり' || next.d === 'たり') && current.cls === 'Verb',
    inflected('CombineAdverbialParticle'),
  );
}

/**
 * Subsidiary verbs after a verb: しまう/いく/いる… (Possible)Dependants, a suru-noun's する, and て/で + いる/ある/おく
 * /しまう/みる/やる/くれる… (待っ|て|て, やっ|て|やる). `CombineVerbDependant` and its four passes.
 */
export function combineVerbDependant(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  let out = combineVerbDependants(groups);
  out = combineVerbPossibleDependants(out, ctx);
  out = combineVerbDependantsSuru(out, ctx);
  out = combineVerbDependantsTeiru(out, ctx);
  return out;
}

const VIA_DEPENDANT = inflected('CombineVerbDependant');

function combineVerbDependants(groups: Group[]): Group[] {
  return mergeAdjacentWhere(
    groups,
    (current, next) =>
      hasSection(next, SECTION.Dependant) &&
      current.cls === 'Verb' &&
      next.d !== 'おる' &&
      next.s !== current.s &&
      // An interjection is never a verb dependant: 持って + あ (mis-split 当たれ) must not fuse.
      next.cls !== 'Interjection' &&
      // くて is an i-adjective te-form; dependants attach to verb te-forms only (頭が良くて + やりたい stays split).
      !current.s.endsWith('くて'),
    VIA_DEPENDANT,
  );
}

function combineVerbPossibleDependants(groups: Group[], ctx: CombineContext): Group[] {
  return mergeAdjacentWhere(
    groups,
    (current, next) => {
      const isClassicalWaRowTeForm = next.d.endsWith('う') && next.s.endsWith('いて');
      return (
        hasSection(next, SECTION.PossibleDependant) &&
        current.cls === 'Verb' &&
        !current.s.endsWith('たり') &&
        next.s !== current.s &&
        !current.s.endsWith('くて') &&
        !isClassicalWaRowTeForm &&
        (['しまう', 'こなす', 'いく', '貰う', 'いる', 'ない'].includes(next.d) ||
          // Aspectual だす attaches only to an attested compound (走り出す); 混じり+だした stays split, not unmatchable.
          (next.d === 'だす' && (known(ctx, `${current.s}だす`) || known(ctx, `${current.s}出す`))) ||
          (next.d === '得る' && known(ctx, `${current.s}得る`)) ||
          (next.d === 'する' && (current.s.endsWith('た') || current.s.endsWith('だ'))) ||
          (next.d === '付く' && current.d.length >= 2 && known(ctx, `${current.d.slice(0, -1)}り付く`)))
      );
    },
    VIA_DEPENDANT,
  );
}

/** `KanjiCompoundsWithPrevious`: a single kanji that compounds with the group before it (忘れ|物 → 忘れ物) belongs to
 * that noun, not to a following する. */
export function kanjiCompoundsWithPrevious(groups: readonly Group[], i: number, ctx: CombineContext): boolean {
  const current = groups[i];
  const previous = groups[i - 1];
  return (
    !!current &&
    !!previous &&
    [...current.s].length === 1 &&
    isKanji(current.s) &&
    (previous.cls === 'Verb' || previous.cls === 'Noun' || previous.cls === 'CommonNoun') &&
    known(ctx, previous.s + current.s)
  );
}

function combineVerbDependantsSuru(groups: Group[], ctx: CombineContext): Group[] {
  const out: Group[] = [];
  let changed = false;
  for (let i = 0; i < groups.length; i++) {
    const current = groups[i] as Group;
    const next = groups[i + 1];
    if (next) {
      const isModernSuru =
        next.d === 'する' &&
        next.s !== 'する' &&
        next.s !== 'しない' &&
        !next.s.endsWith('すぎ') &&
        !next.s.endsWith('過ぎ');
      const isLiterarySuru = next.d === 'す' && next.n === '為る';
      const isSuruNoun = hasSection(current, SECTION.PossibleSuru) || hasSection(current, SECTION.PossibleVerbSuruNoun);
      if (isSuruNoun && (isModernSuru || isLiterarySuru) && !kanjiCompoundsWithPrevious(groups, i, ctx)) {
        // Upstream keeps the noun's lemma and finds 油断する at lookup; we name the verb here (as CombineInflections does).
        const d = current.cls === 'Noun' ? `${current.d}する` : current.d;
        out.push(append(current, next, { ...VIA_DEPENDANT, d, cls: 'Verb' }));
        changed = true;
        i++;
        continue;
      }
    }
    out.push(current);
  }
  return changed ? out : groups;
}

function combineVerbDependantsTeiru(groups: Group[], ctx: CombineContext): Group[] {
  const out: Group[] = [];
  let changed = false;
  for (let i = 0; i < groups.length; i++) {
    const current = groups[i] as Group;
    const next = groups[i + 1];
    const after = groups[i + 2];

    if (next && after && current.cls === 'Verb' && next.d === 'て' && TE_FORM_AUX_CHAIN_VERBS.has(after.d)) {
      out.push(append(append(current, next), after, VIA_DEPENDANT));
      changed = true;
      i += 2;
      continue;
    }

    if (next) {
      const isClassicalWaRowTeForm = next.d.endsWith('う') && next.s.endsWith('いて');
      // Demonstratives never attach (夢見て + これ); gated on dict form, not POS, since Pronoun こん (来ん) must (出てこん).
      // これ before an inflection (ない/た/ます) is 来る's ら抜き potential stem and attaches (戻ってこれなかった).
      const isDemonstrative = ['これ', 'それ', 'あれ', 'どれ'].includes(next.d);
      const koreIsPotentialStem =
        next.d === 'これ' &&
        after !== undefined &&
        ['ない', '無い', 'た', 'ます', 'ん', 'ぬ', 'ず', 'る'].includes(after.d);
      if (
        (current.s.endsWith('て') || current.s.endsWith('で')) &&
        (current.cls === 'Verb' || current.cls === 'IAdjective') &&
        // くて is an i-adjective te-form; subsidiary verbs attach to verb te-forms only (良くて + やりたい).
        !current.s.endsWith('くて') &&
        !isClassicalWaRowTeForm &&
        next.cls !== 'IAdjective' &&
        (!isDemonstrative || koreIsPotentialStem)
      ) {
        let isKnownSubsidiary = false;
        if (next.cls === 'Verb' && next.d !== 'おる') {
          isKnownSubsidiary =
            (hasSection(next, SECTION.PossibleDependant) && (next.d === 'いる' || next.d === 'ない')) ||
            TE_FORM_SUBSIDIARY_VERBS.has(next.d) ||
            TE_FORM_SUBSIDIARY_VERBS.has(next.n);
        }
        if (!isKnownSubsidiary) {
          isKnownSubsidiary = ctx.deconjugate(deconjugationKey(next.s)).some((form) => {
            const bareSubsidiary = form.tags.length === 0 && TE_FORM_SUBSIDIARY_VERBS.has(form.text);
            return (
              bareSubsidiary ||
              ((TE_FORM_SUBSIDIARY_VERBS.has(form.text) || TE_FORM_AUX_CHAIN_VERBS.has(form.text)) &&
                endsOnSubsidiaryVerbClass(form))
            );
          });
        }
        if (isKnownSubsidiary) {
          out.push(append(current, next, VIA_DEPENDANT));
          changed = true;
          i++;
          continue;
        }
      }

      // Dialectal とる (contracted ておる) after a っ stem: 待っとる.
      if (current.cls === 'Verb' && current.s.endsWith('っ') && next.d === 'とる') {
        const isTeOruForm = ctx
          .deconjugate(deconjugationKey(next.s))
          .some(
            (form) =>
              form.process.some((step) => step.includes('toru (teoru)')) &&
              form.tags.some((tag) => tag.startsWith('v') || tag.startsWith('stem-te')),
          );
        if (isTeOruForm) {
          out.push(append(current, next, VIA_DEPENDANT));
          changed = true;
          i++;
          continue;
        }
      }
    }

    out.push(current);
  }
  return changed ? out : groups;
}
