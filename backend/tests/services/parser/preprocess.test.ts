import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Morpheme } from '@app/services/parser/sudachi';

/** A stand-in for the sidecar: one morpheme per chunk, so the test sees exactly the chunks preprocessing made. */
const sent: string[] = [];
vi.mock('@app/services/parser/sudachi', () => ({
  analyse: async (texts: string[]) => {
    sent.push(...texts);
    return texts.map((text): Morpheme[] => [
      {
        s: text,
        b: 0,
        e: [...text].length,
        pos: ['名詞', '*', '*', '*', '*', '*'],
        d: text,
        n: text,
        r: text,
        a: [],
      },
    ]);
  },
}));

const { analyseSentences, preprocess } = await import('@app/services/parser/preprocess');

const tiles = (text: string, morphemes: Array<{ s: string; b: number; e: number }>) => {
  const chars = [...text];
  let pos = 0;
  for (const morpheme of morphemes) {
    if (morpheme.b !== pos || chars.slice(morpheme.b, morpheme.e).join('') !== morpheme.s) return false;
    pos = morpheme.e;
  }
  return pos === chars.length;
};

describe('preprocess (upstream PreprocessText)', () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it('forces upstream boundaries without changing the text (すみません|でした, 不|適応)', async () => {
    const [sorry] = await analyseSentences(['すみませんでした']);
    expect(sent).toEqual(['すみません', 'でした']);
    expect(sorry?.map((morpheme) => morpheme.s)).toEqual(['すみません', 'でした']);
    sent.length = 0;
    await analyseSentences(['不適応']);
    expect(sent).toEqual(['不', '適応']);
  });

  it('reads an emphatic っ off the word and keeps it in the surface (だめっ)', async () => {
    const [dame] = await analyseSentences(['だめっ']);
    expect(sent).toEqual(['だめ', 'っ']);
    expect(dame?.map((morpheme) => [morpheme.s, morpheme.ns])).toEqual([['だめっ', 'だめ']]);
  });

  it('drops a shouted small vowel and collapses ー runs for Sudachi only (行けぇーー)', async () => {
    const [ike] = await analyseSentences(['行けぇーー']);
    // Read with and without the final stretch; the reading without it wins and the ー stays in the surface.
    expect(sent).toEqual(['行けー', '行け']);
    expect(ike?.map((morpheme) => [morpheme.s, morpheme.ns])).toEqual([['行けぇーー', '行け']]);
  });

  it('tiles the original sentence whatever the rewrites', async () => {
    const texts = ['「ごめんなさいっ」……もう、いいの！', 'ぶっ壊れた!? そういうことか', 'ヤバ～い、どしたの'];
    const analysed = await analyseSentences(texts);
    texts.forEach((text, k) => {
      expect(tiles(text, analysed[k] ?? [])).toBe(true);
    });
  });

  it('normalises full-width marks for Sudachi (? → ？)', () => {
    expect(preprocess('え?').text).toContain('？');
  });
});
