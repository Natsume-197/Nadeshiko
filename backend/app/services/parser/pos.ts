/**
 * The three part-of-speech fields a stored token carries, for our own parser (task 40): `p` (raw UniDic primary
 * tag), `pt` (the short tag the word card ranks homographs with) and `posLabel` (what the card prints). The table
 * reproduces what the current parser stores, measured on the dev corpus (2026-11-07), so tokens from either parser
 * read the same: e.g. 助動詞 だ/です is a Copula, 形状詞 よう/みたい/そう (助動詞語幹) an Auxiliary.
 */

export interface TokenPos {
  p: string;
  /** Absent for symbols and whitespace, which have no lookup tag. */
  pt?: string;
  posLabel: string;
}

const COPULAS = new Set(['だ', 'です', 'っす', 'す', 'だー', 'だあ', 'だぁ', 'ッス', 'っス', 'ダ']);

/**
 * `pos` is the head morpheme's six UniDic fields, `kind` the group's kind, `d` its dictionary form. Expressions are
 * stored as 連語, which is not a UniDic tag but is what the current parser writes for them.
 */
export function tokenPos(pos: readonly string[], kind: string, d: string): TokenPos {
  const [pos1 = '', pos2 = ''] = pos;

  if (pos1 === '空白' || pos1 === '補助記号' || pos1 === '記号' || kind === 'symbol') {
    return { p: pos1 || '補助記号', posLabel: 'Symbol' };
  }
  if (kind === 'expression') return { p: '連語', pt: 'exp', posLabel: 'Expression' };

  switch (pos1) {
    case '名詞':
      if (kind === 'counter') return { p: pos1, pt: 'noun', posLabel: 'Counter' };
      if (pos2 === '固有名詞') return { p: pos1, pt: 'noun', posLabel: 'Proper noun' };
      if (pos2 === '数詞') return { p: pos1, pt: 'noun', posLabel: 'Numeric' };
      return { p: pos1, pt: 'noun', posLabel: 'Noun' };
    case '動詞':
      return { p: pos1, pt: 'verb', posLabel: 'Verb' };
    case '形容詞':
      return { p: pos1, pt: 'adj', posLabel: 'Adjective' };
    case '形状詞':
      return { p: pos1, pt: 'adj', posLabel: pos2 === '助動詞語幹' ? 'Auxiliary' : 'Na-adjective' };
    case '助動詞':
      return { p: pos1, pt: 'aux', posLabel: COPULAS.has(d) ? 'Copula' : 'Auxiliary' };
    case '助詞':
      return { p: pos1, pt: 'prt', posLabel: 'Particle' };
    case '代名詞':
      return { p: pos1, pt: 'pron', posLabel: 'Pronoun' };
    case '副詞':
      return { p: pos1, pt: 'adv', posLabel: 'Adverb' };
    case '連体詞':
      return { p: pos1, pt: 'det', posLabel: 'Pre-noun adjectival' };
    case '接続詞':
      return { p: pos1, pt: 'conj', posLabel: 'Conjunction' };
    case '感動詞':
      return { p: pos1, pt: 'intj', posLabel: 'Interjection' };
    case '接頭辞':
      return { p: pos1, pt: 'pref', posLabel: 'Prefix' };
    case '接尾辞':
      return { p: pos1, pt: 'suf', posLabel: kind === 'counter' ? 'Counter' : 'Suffix' };
    default:
      return { p: pos1, posLabel: pos1 };
  }
}
