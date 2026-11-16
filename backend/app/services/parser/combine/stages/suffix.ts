import { append, DICTIONARY_VERB_ENDINGS, hasSection, known, SECTION } from '../group';
import { hasKanji, isKanji } from '../kana';
import type { CombineContext, Group } from '../types';

const isSuffix = (group: Group) => group.cls === 'Suffix' || hasSection(group, SECTION.Suffix);

/**
 * The few suffixes that belong to the word before them: っこ, さ (高|さ), がる (怖|がる), ぶり, ら after a pronoun
 * (彼|ら), and ぶる when JMdict has the result. Honorifics (さん, ちゃん, 様) and たち stay their own word, as upstream.
 * `CombineSuffix`.
 */
export function combineSuffix(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  let current = groups[0] as Group;
  const via = { via: 'CombineSuffix' };

  for (let i = 1; i < groups.length; i++) {
    const next = groups[i] as Group;
    const previous = groups[i - 1] as Group;
    const adjectiveStem = current.cls === 'IAdjective' && !current.s.endsWith('い') && current.d.endsWith('い');

    if (
      isSuffix(next) &&
      (next.d === 'っこ' ||
        next.d === 'さ' ||
        // 何|がって is が + って, not 何がる.
        (next.d === 'がる' && current.cls !== 'Pronoun') ||
        ((next.d === 'ぶり' || next.d === '振り') && adjectiveStem) ||
        (next.d === 'ら' && previous.cls === 'Pronoun' && previous.s !== '貴様'))
    ) {
      current = append(current, next, { flags: via });
      changed = true;
    } else if (next.d === 'ぶる' && isSuffix(next) && known(ctx, `${current.d}ぶる`)) {
      current = append(current, next, { d: `${current.d}ぶる`, cls: 'Verb', flags: { ...via, inflected: true } });
      changed = true;
    } else if (next.cls === 'Adverb' && next.s === 'がったり' && adjectiveStem) {
      // Sudachi misparses がったり after an adjective stem as an adverb (怖|がったり).
      current = append(current, next, { flags: via });
      changed = true;
    } else {
      out.push(current);
      current = next;
    }
  }
  out.push(current);
  return changed ? out : groups;
}

/**
 * A suffix left without a host becomes a noun, or a verb when its kanji spell an attested verb (レッテル|貼り →
 * 貼る). Changes classes only, never boundaries. `ReclassifyOrphanedSuffixes`.
 */
export function reclassifyOrphanedSuffixes(groups: Group[], ctx: CombineContext): Group[] {
  let out: Group[] | null = null;
  const set = (i: number, group: Group) => {
    out ??= [...groups];
    out[i] = group;
  };

  for (let i = 1; i < groups.length; i++) {
    const word = groups[i] as Group;
    if (word.cls !== 'Suffix') continue;

    // じまい follows ず-forms (わからずじまい) and honorifics follow names; both are genuine suffixes.
    if (['じまい', '仕舞い', 'ちゃん', 'さん', 'くん', '様', '殿', '氏'].includes(word.d)) continue;

    // An unattested kanji "suffix" spelling a verb (レッテル|貼り → 貼る) is a verb; kana ones stay (ぶっ+た ≠ 打つ).
    if (!known(ctx, word.s) && hasKanji(word.s)) {
      const verb = ctx
        .deconjugate(word.s)
        .find(
          (form) =>
            form.text !== word.s &&
            form.text.length >= 2 &&
            DICTIONARY_VERB_ENDINGS.has(form.text.at(-1) as string) &&
            [...word.s].every((char) => !isKanji(char) || form.text.includes(char)) &&
            known(ctx, form.text),
        );
      if (verb) {
        set(i, {
          ...word,
          cls: 'Verb',
          sec: ['*', word.sec[1], word.sec[2]],
          d: verb.text,
          n: verb.text,
          flags: { ...word.flags, reclassifiedSuffix: true },
        });
        continue;
      }
    }

    // A predicate-tail suffix (チッチャ|い) can't host a suffix; 車 after it must reclassify to reach its noun.
    const previous = (out ?? groups)[i - 1] as Group;
    const prevIsPredicateTailSuffix = previous.cls === 'Suffix' && ['い', 'く', 'かっ'].includes(previous.s);
    if (
      ['Noun', 'CommonNoun', 'Numeral', 'Prefix', 'Pronoun'].includes(previous.cls) ||
      (previous.cls === 'Suffix' && !prevIsPredicateTailSuffix)
    )
      continue;

    // 形容詞的 (っぽい) need their POS for the adj branch; 形状詞的 (気) may start expressions (気を引き締める).
    if (word.sec[0] === SECTION.Adjectival || word.sec[0] === SECTION.NaAdjectiveLike) continue;

    set(i, {
      ...word,
      cls: 'CommonNoun',
      sec: ['*', word.sec[1], word.sec[2]],
      flags: { ...word.flags, reclassifiedSuffix: true },
    });
  }

  return out ?? groups;
}
