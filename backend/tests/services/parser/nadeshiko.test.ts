import { describe, it, expect } from 'vitest';
import { combine } from '@app/services/parser/combine';
import { toSlimToken } from '@app/services/parser/nadeshiko';
import { morphemes } from './combine/fixtures';
import { ctx } from './combine/testLexicon';

// Real sidecar output (SudachiDict 20260116 full, mode B) from the combine fixtures.
const tokens = (text: string, rubies = new Map()) =>
  combine(morphemes(text), ctx).map((group) => toSlimToken(group, text, rubies));

describe('toSlimToken', () => {
  it('writes an inflected verb the way the current parser stores it', () => {
    const rubies = new Map([
      ['食べる', [{ reading: 'たべる', segments: [{ text: '食', ruby: 'た' }, { text: 'べる' }] }]],
    ]);

    const [token] = tokens('食べさせられた', rubies);

    expect(token).toMatchObject({
      s: '食べさせられた',
      d: '食べる',
      b: 0,
      e: 7,
      p: '動詞',
      pt: 'verb',
      posLabel: 'Verb',
      kind: 'inflected',
      f: [{ t: '食', r: 'た' }, { t: 'べさせられた' }],
    });
    expect(token?.inflection?.base).toBe('食べる');
    expect(token?.inflection?.labels[0]).toBe('past');
  });

  it('keeps the Sudachi morphemes of a grouped token as its parts', () => {
    const [token] = tokens('待ってて');

    expect(token?.s).toBe('待ってて');
    expect(token?.parts?.map((part) => part.s)).toEqual(['待っ', 'て', 'て']);
    expect(token?.inflection?.labels).toContain('progressive');
  });
});
