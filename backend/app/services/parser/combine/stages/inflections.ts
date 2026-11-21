import type { DeconjugatedForm } from '../../deconjugator';
import { AUXILIARY_VERBS } from '../data/ruleData';
import {
  append,
  compoundExists,
  containsText,
  deconj,
  hasSection,
  isImperative,
  isInflectableBase,
  isInflectionPart,
  isNounClass,
  known,
  SECTION,
} from '../group';
import { deconjugationKey } from '../kana';
import type { CombineContext, Group, WordClass } from '../types';

const VIA = 'CombineInflections';

const findEndingWith = (forms: readonly DeconjugatedForm[], suffix: string) =>
  forms.find((form) => form.text.endsWith(suffix) && form.text.length > suffix.length);

/** `TryGodanDictForm`: a godan 連用形 ending back to its dictionary ending (切り → 切る). */
export function tryGodanDictForm(text: string): string | null {
  if (text.length < 2) return null;
  const ending: Record<string, string> = {
    い: 'う',
    き: 'く',
    ぎ: 'ぐ',
    し: 'す',
    ち: 'つ',
    に: 'ぬ',
    び: 'ぶ',
    み: 'む',
    り: 'る',
  };
  const dict = ending[text.at(-1) as string];
  return dict ? text.slice(0, -1) + dict : null;
}

const QUOTE_VERBS = new Set(['思う', 'おもう', '言う', 'いう', '聞く', 'きく', '考える', '感じる']);

/** `ShouldStopMerging`, verbatim in its checks. */
function shouldStopMerging(current: Group, next: Group, groups: readonly Group[], i: number, cls: WordClass): boolean {
  const after = groups[i + 2];

  // Negative stem な may merge before すぎる (わからなすぎる).
  const isNegativeStemBeforeDependant =
    next.s === 'な' &&
    next.cls === 'Auxiliary' &&
    next.d === 'ない' &&
    after !== undefined &&
    (hasSection(after, SECTION.PossibleDependant) || hasSection(after, SECTION.Dependant)) &&
    (after.d === 'すぎる' || after.d === '過ぎる');

  if (['は', 'よ', 'し', 'を', 'が', 'か', 'ください', 'かな'].includes(next.s)) return true;
  if (next.s === 'な' && !isNegativeStemBeforeDependant) return true;

  // Standalone よう is always 様; volitional よう arrives inside the verb token.
  if (next.s === 'よう' && next.d === 'よう') return true;

  // いけ after ちゃ/じゃ/きゃ/にゃ is obligation/prohibition, not a compound.
  if (next.d === 'いける' && ['ちゃ', 'じゃ', 'きゃ', 'にゃ'].some((tail) => current.s.endsWith(tail))) return true;

  if (next.s === 'ん' && (next.d === 'の' || next.d === 'ん')) return true;

  const isTte = next.s === 'って' && next.d === 'って';
  // An imperative has no te-form, so a following って is quotative (来い|って).
  if (isTte && isImperative(current)) return true;

  // って before ん/んだ/んです is quotative, not te-form.
  if (next.s === 'って' && after && ['ん', 'んだ', 'んです'].includes(after.s)) return true;

  // Quotative って stays split before a kanji or kana quote verb (かな+って+思ったら); つか+って+ください re-merges.
  if (isTte && after && QUOTE_VERBS.has(after.d)) return true;

  // って before a noun, punctuation or end (なくなった+って+話) is quotative; re-merging leaves an unresolvable blob.
  if (isTte && (!after || isNounClass(after.cls) || after.cls === 'SupplementarySymbol')) return true;

  // って before a sentence-ending particle (待つ+って+さ) is quotative; re-merging leaves an unresolvable blob.
  if (isTte && after?.cls === 'Particle' && ['さ', 'よ', 'ね', 'わ', 'ぞ', 'ぜ'].includes(after.s)) return true;

  // Benefactives stay separate (させて|いただきます); the て+貰う deconj rules serve Dependant-path merges only.
  if ((current.s.endsWith('て') || current.s.endsWith('で')) && ['いただく', '頂く', '貰う'].includes(next.d))
    return true;

  // A verb after an adjective くて starts a new clause (頭が良くて + やりたい).
  if (cls === 'IAdjective' && current.s.endsWith('て') && next.cls === 'Verb') return true;

  if (current.s.endsWith('ん') && (next.s === 'だ' || next.s === 'です')) return true;
  if (next.s === 'じゃ' && next.d === 'だ') return true;
  if (cls === 'NaAdjective' && next.s === 'で' && next.d === 'だ') return true;

  return false;
}

/**
 * A verb, adjective or suru-noun with the inflection parts after it (食べ|させ|られ|た, 勉強|し|た), merged one part at
 * a time while deconjugating the joined surface still reaches the base's dictionary form and that form is a word.
 * Mirrors `CombineInflections`. Left out: stealing そう from a
 * fused そうだ/そうか token (新しそうだ), which would split a morpheme.
 */
export function combineInflections(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;

  for (let i = 0; i < groups.length; i++) {
    const word = groups[i] as Group;

    const isBase =
      (isInflectableBase(word.cls) ||
        hasSection(word, SECTION.PossibleSuru) ||
        hasSection(word, SECTION.PossibleVerbSuruNoun) ||
        (word.cls === 'Suffix' && hasSection(word, SECTION.VerbLike))) &&
      word.n !== '物' &&
      !hasSection(word, SECTION.AuxiliaryVerbStem);

    if (!isBase) {
      out.push(word);
      continue;
    }

    let current = word;
    let cls = current.cls;
    let dictForm = current.d;
    const normForm = current.n;
    let dictHira = deconjugationKey(dictForm);
    const dictionaryHasBase = () => known(ctx, dictForm) || (normForm !== dictForm && known(ctx, normForm));

    while (i + 1 < groups.length) {
      const next = groups[i + 1] as Group;
      if (shouldStopMerging(current, next, groups, i, cls)) break;

      let isValidPart =
        isInflectionPart(next.cls) ||
        hasSection(next, SECTION.AuxiliaryVerbStem) ||
        hasSection(next, SECTION.ConjunctionParticle) ||
        hasSection(next, SECTION.Dependant) ||
        hasSection(next, SECTION.PossibleDependant);

      // Sudachi tags やれ as an interjection; after a て-form it is auxiliary やる's imperative.
      if (!isValidPart && next.s === 'やれ' && next.cls === 'Interjection' && current.s.endsWith('て'))
        isValidPart = true;

      // Sudachi tags colloquial ねえ (ない) as the noun 姉; after a て/で-form it is the negative.
      if (
        !isValidPart &&
        next.s === 'ねえ' &&
        next.cls === 'Noun' &&
        (current.s.endsWith('て') || current.s.endsWith('で'))
      )
        isValidPart = true;

      // Sudachi tags なさそう as NaAdjective, failing isValidPart, yet it attaches to the negative stem (食べなさそう).
      if (!isValidPart && next.d === 'なさそう') {
        const forms = deconj(ctx, current.s + next.s);
        const target = cls === 'Noun' ? `${dictHira}する` : dictHira;
        if (containsText(forms, target)) {
          if (cls === 'Noun') {
            dictForm = `${dictForm}する`;
            cls = 'Verb';
          }
          current = append(current, next, { cls, d: dictForm, flags: { inflected: true, via: VIA } });
          changed = true;
          i++;
          break;
        }
      }

      // Kansai negative せん (しない) is tagged noun/prefix by Sudachi; after a suru base it inflects (卑下せん).
      if (!isValidPart && next.s === 'せん' && hasSection(current, SECTION.PossibleSuru)) isValidPart = true;

      if (!isValidPart) break;

      let merged = false;
      let newDictForm: string | null = null;
      const target = cls === 'Noun' ? `${dictHira}する` : dictHira;
      const forms = deconj(ctx, current.s + next.s);
      let scenarioA = containsText(forms, target) && dictionaryHasBase();

      // Noun + す before べき is する+べき (帰投 + すべき), not a short causative; godan -す verbs (愛す) still merge.
      const after = groups[i + 2];
      if (
        scenarioA &&
        cls === 'Noun' &&
        next.s === 'す' &&
        after &&
        (after.s === 'べき' || after.d === 'べし') &&
        !known(ctx, `${current.s}す`)
      )
        scenarioA = false;

      if (scenarioA) {
        if (cls === 'NaAdjective') {
          const match = forms.find((form) => form.text === target) as DeconjugatedForm;
          const hasVerbStemTag = match.tags.some((tag) => tag.startsWith('stem-') && tag !== 'stem-adj-base');
          if (hasVerbStemTag) {
            const verbForm = forms.find(
              (form) =>
                form.text !== target &&
                form.tags.length > 0 &&
                (form.tags.at(-1) as string).startsWith('v') &&
                known(ctx, form.text),
            );
            if (verbForm) {
              merged = true;
              newDictForm = verbForm.text;
              cls = 'Verb';
            }
          } else {
            merged = true;
          }
        } else {
          merged = true;
          if (cls === 'Noun') {
            newDictForm = `${dictForm}する`;
            cls = 'Verb';
          }
        }
      } else if (cls === 'Noun' && hasSection(current, SECTION.PossibleVerbSuruNoun)) {
        if (
          forms.some((form) => form.text === dictHira && form.tags.includes('stem-adj-base')) &&
          dictionaryHasBase()
        ) {
          merged = true;
          cls = 'NaAdjective';
        }
      } else if (
        cls === 'Verb' &&
        !['て', 'で', 'たく', 'なく', 'たり', 'だり'].some((tail) => current.s.endsWith(tail)) &&
        !AUXILIARY_VERBS.has(next.d) &&
        (hasSection(next, SECTION.VerbLike) ||
          (next.cls === 'Verb' && hasSection(next, SECTION.PossibleDependant)) ||
          next.cls === 'Suffix')
      ) {
        const suffixDict = deconjugationKey(next.d);
        let match = findEndingWith(forms, suffixDict);
        if (!match && next.cls === 'Suffix') {
          const verbDict = tryGodanDictForm(suffixDict);
          if (verbDict) match = findEndingWith(forms, verbDict);
        }
        if (match && compoundExists(ctx, match.text)) {
          merged = true;
          newDictForm = match.text;
          cls = match.tags.at(-1) === 'adj-i' ? 'IAdjective' : 'Verb';
        }
      }

      if (!merged) break;
      current = append(current, next, { cls, d: newDictForm ?? current.d, flags: { inflected: true, via: VIA } });
      changed = true;
      dictForm = current.d;
      dictHira = deconjugationKey(dictForm);
      i++;
    }

    out.push(current);
  }

  return changed ? out : groups;
}
