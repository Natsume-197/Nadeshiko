import { describe, expect, it } from 'vitest';
import { type KanjiOgCard, type OgNode, kanjiOgRequest, kanjiOgTree, readingsOf } from './kanjiOgImage';

const SHOKU: KanjiOgCard = {
  character: '食',
  strokeCount: 9,
  jlpt: 5,
  kanken: '9級',
  readings: [
    { kind: 'on', reading: 'ショク' },
    { kind: 'on', reading: 'ジキ' },
    { kind: 'kun', reading: 'く.う' },
    { kind: 'kun', reading: 'た.べる' },
    { kind: 'kun', reading: '-ぐ.い' },
  ],
  meanings: ['alimento', 'comida', 'eclipse', 'comer'],
};

/** Every string drawn in the image, in order. */
function texts(node: OgNode | string): string[] {
  if (typeof node === 'string') return [node];
  const children = node.props.children;
  if (children === undefined) return [];
  return (Array.isArray(children) ? children : [children]).flatMap(texts);
}

describe('kanjiOgRequest', () => {
  it('reads the kanji and language from the address', () => {
    expect(kanjiOgRequest('es', '%E9%A3%9F.png')).toEqual({ character: '食', locale: 'es' });
    expect(kanjiOgRequest('en', '食.png')).toEqual({ character: '食', locale: 'en' });
  });

  it('has no image for other languages, other files, several characters or a kanji outside the jōyō list', () => {
    expect(kanjiOgRequest('fr', '食.png')).toBeNull();
    expect(kanjiOgRequest('en', '食.jpg')).toBeNull();
    expect(kanjiOgRequest('en', '食事.png')).toBeNull();
    expect(kanjiOgRequest('en', '蝕.png')).toBeNull();
    expect(kanjiOgRequest('en', '%E0%A4%A.png')).toBeNull();
    expect(kanjiOgRequest(undefined, undefined)).toBeNull();
  });
});

describe('readingsOf', () => {
  it('drops the okurigana dot and the affix dashes, and repeats nothing', () => {
    expect(readingsOf(SHOKU, 'on')).toEqual(['ショク', 'ジキ']);
    expect(readingsOf(SHOKU, 'kun')).toEqual(['くう', 'たべる', 'ぐい']);
    expect(
      readingsOf(
        {
          ...SHOKU,
          readings: [
            { kind: 'kun', reading: 'ひと-' },
            { kind: 'kun', reading: 'ひと' },
          ],
        },
        'kun',
      ),
    ).toEqual(['ひと']);
  });
});

describe('kanjiOgTree', () => {
  it('draws the kanji, three meanings, the readings and the levels, and the site name', () => {
    expect(texts(kanjiOgTree(SHOKU))).toEqual([
      '食',
      'alimento, comida, eclipse',
      'ON',
      'ショク、',
      'ジキ',
      'KUN',
      'くう、',
      'たべる、',
      'ぐい',
      'JLPT N5',
      '漢検 9級',
      '9画',
      'Nadeshiko',
    ]);
  });

  it('leaves out what a kanji does not have', () => {
    const drawn = texts(
      kanjiOgTree({ ...SHOKU, jlpt: null, kanken: null, readings: [{ kind: 'on', reading: 'ウツ' }] }),
    );

    expect(drawn).not.toContain('KUN');
    expect(drawn.filter((text) => text.startsWith('JLPT') || text.startsWith('漢検'))).toEqual([]);
    expect(drawn).toContain('9画');
  });
});
