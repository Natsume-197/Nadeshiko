import { append } from '../group';
import type { CombineContext, Group } from '../types';

/**
 * (ours) A noun followed by a bare verb stem in 連用形 that JMdict lists together as a noun (道場|破り → 道場破り,
 * 人|殺し → 人殺し) is that noun. The user dictionary can make Sudachi cut these where it used to keep them whole.
 */
export function joinNounStemCompounds(groups: Group[], ctx: CombineContext): Group[] {
  if (groups.length < 2) return groups;
  const out: Group[] = [];
  let changed = false;
  for (const group of groups) {
    const previous = out.at(-1);
    const text = previous ? previous.s + group.s : '';
    if (
      previous &&
      (previous.cls === 'Noun' || previous.cls === 'CommonNoun') &&
      previous.members.length === 1 &&
      group.cls === 'Verb' &&
      group.members.length === 1 &&
      group.pos[5].startsWith('連用形') &&
      ctx.lexicon.hasClass(text, 'noun')
    ) {
      out[out.length - 1] = append(previous, group, { d: text, n: text, cls: 'Noun', deconjugation: null });
      changed = true;
      continue;
    }
    out.push(group);
  }
  return changed ? out : groups;
}
