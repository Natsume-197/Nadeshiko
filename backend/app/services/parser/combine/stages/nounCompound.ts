import { isNounClass, mergeAdjacentWhere } from '../group';
import type { CombineContext, Group } from '../types';

/**
 * (ours) A noun followed by a bare verb stem in 連用形 that JMdict lists together as a noun (道場|破り → 道場破り,
 * 人|殺し → 人殺し) is that noun. The user dictionary can make Sudachi cut these where it used to keep them whole.
 */
export function joinNounStemCompounds(groups: Group[], ctx: CombineContext): Group[] {
  return mergeAdjacentWhere(
    groups,
    (previous, group) =>
      isNounClass(previous.cls) &&
      previous.members.length === 1 &&
      group.cls === 'Verb' &&
      group.members.length === 1 &&
      group.pos[5].startsWith('連用形') &&
      ctx.lexicon.hasClass(previous.s + group.s, 'noun'),
    (previous, group) => {
      const text = previous.s + group.s;
      return { d: text, n: text, cls: 'Noun' };
    },
  );
}
