import { InMemoryLexicon } from '@app/services/parser/combine';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { CombineContext } from '@app/services/parser/combine';

/** A slice of JMdict big enough for the fixtures: each key and the classes its entries have there. */
const VERBS = [
  '言う',
  'やる',
  '待つ',
  '入る',
  '押す',
  '食べる',
  '逃げ切る',
  '切る',
  '行く',
  'する',
  '書く',
  'ある',
  'いる',
  'しれる',
  '知れる',
  '降る',
  '降りる',
  '手に入る',
  // A suru noun: JMdict's vs sense counts as a verb class.
  '勉強',
];
const NOUNS = [
  'お方',
  '達人',
  '注文',
  'ご注文',
  'うさぎ',
  '勉強',
  '彼',
  '彼ら',
  'ため',
  '総合',
  '格闘技',
  '総合格闘技',
  '本当',
  '犬',
  '動物',
  '田中',
  '方',
];
const ADJECTIVES = ['ない', 'よい', '良い', '高い', '怖い'];
const EXPRESSIONS = [
  '手に入る',
  'ですか',
  'かもしれない',
  'そのため',
  'には',
  'んだ',
  'とは',
  'では',
  'さすがは',
  'のです',
];

export const lexicon = new InMemoryLexicon([...NOUNS, 'です', 'た', 'のに', 'てる'], {
  verb: VERBS,
  'adj-i': ADJECTIVES,
  exp: EXPRESSIONS,
  prt: ['のに', 'には', 'とは'],
  conj: ['では'],
  adv: ['本当に'],
});

export const ctx: CombineContext = { lexicon, deconjugate };
