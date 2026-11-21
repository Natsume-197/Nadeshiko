import { describe, it, expect } from 'vitest';
import { combine } from '@app/services/parser/combine';
import { sentenceText, toSlimToken } from '@app/services/parser/nadeshiko';
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

  it('writes offsets in UTF-16 units, the way the content string is sliced, after a character outside the BMP', () => {
    // The parser counts code points; 😂 and 𠮟 are one code point but two UTF-16 units.
    const sentence = '😂待ってて';
    const [group] = combine(morphemes('待ってて'), ctx);
    if (!group) throw new Error('no group');
    const shifted = {
      ...group,
      b: group.b + 1,
      e: group.e + 1,
      members: group.members.map((member) => ({ ...member, b: member.b + 1, e: member.e + 1 })),
    };

    const token = toSlimToken(shifted, sentence, new Map());

    expect(sentence.slice(token.b, token.e)).toBe('待ってて');
    expect(token.parts?.map((part) => sentence.slice(part.b, part.e))).toEqual(['待っ', 'て', 'て']);
  });
});

describe('sentenceText', () => {
  it('maps each code point to where it starts in UTF-16 units', () => {
    expect(sentenceText('𠮟られた')).toEqual({ chars: ['𠮟', 'ら', 'れ', 'た'], utf16: [0, 2, 3, 4, 5] });
  });
});
