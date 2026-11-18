import { describe, expect, it } from 'vitest';
import type { SlimToken } from '@app/models/Segment';
import {
  type CollocationCounts,
  collocationRows,
  countCollocations,
  MIN_TOTAL,
  verbReading,
} from '@app/services/dictionary/collocations';
import { InMemoryLexicon } from '@app/services/parser/combine';
import { deconjugate } from '@app/services/parser/deconjugator';

const tok = (s: string, d: string, r: string, pt: string): SlimToken => ({ s, d, r, b: 0, e: 0, p: '', pt });

const lexicon = new InMemoryLexicon([]);
lexicon.addWord(1, [
  { text: '弾く', kana: false },
  { text: 'ひく', kana: true },
  { text: 'はじく', kana: true },
]);
lexicon.addWord(2, [
  { text: '引く', kana: false },
  { text: 'ひく', kana: true },
]);

const piano = (verb: SlimToken, particle = 'を') => [
  tok('ピアノ', 'ピアノ', 'ピアノ', 'noun'),
  tok(particle, particle, 'ヲ', 'prt'),
  verb,
];

describe('verbReading', () => {
  it('picks the reading the surface reading deconjugates to', () => {
    expect(verbReading(tok('弾いた', '弾く', 'ヒイタ', 'verb'), lexicon, deconjugate)).toBe('ひく');
    expect(verbReading(tok('弾いた', '弾く', 'ハジイタ', 'verb'), lexicon, deconjugate)).toBe('はじく');
    expect(verbReading(tok('弾く', '弾く', 'ヒク', 'verb'), lexicon, deconjugate)).toBe('ひく');
  });
});

describe('countCollocations and collocationRows', () => {
  it('keeps a clear winner over enough sentences', () => {
    const counts: CollocationCounts = new Map();
    for (let k = 0; k < 4; k++)
      countCollocations(piano(tok('弾いた', '弾く', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
    countCollocations(piano(tok('引いた', '引く', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
    expect(collocationRows(counts)).toEqual([
      { noun: 'ピアノ', particle: 'を', verb_kana: 'ひく', verb: '弾く', count: 4, total: 5 },
    ]);
  });

  it('drops a split or a thin group, and ignores kana verbs and non-collocation particles', () => {
    const counts: CollocationCounts = new Map();
    for (let k = 0; k < 2; k++) {
      countCollocations(piano(tok('弾いた', '弾く', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
      countCollocations(piano(tok('引いた', '引く', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
    }
    for (let k = 0; k < MIN_TOTAL - 1; k++)
      countCollocations(piano(tok('弾いた', '弾く', 'ヒイタ', 'verb'), 'が'), counts, lexicon, deconjugate);
    countCollocations(piano(tok('ひいた', 'ひく', 'ヒイタ', 'verb')), counts, lexicon, deconjugate);
    countCollocations(piano(tok('弾いた', '弾く', 'ヒイタ', 'verb'), 'の'), counts, lexicon, deconjugate);
    expect(collocationRows(counts)).toEqual([]);
    expect(counts.size).toBe(2);
  });
});
