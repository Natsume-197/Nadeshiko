import { describe, expect, it } from 'vitest';
import {
  type KanjiOgCard,
  type OgNode,
  kanjiIndexGroupLabel,
  kanjiIndexOgRequest,
  kanjiIndexOgTree,
  kanjiOgRequest,
  kanjiOgTree,
  readingsOf,
} from './kanjiOgImage';

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

describe('kanjiIndexOgRequest', () => {
  it('reads the grouping and the group from the file name', () => {
    expect(kanjiIndexOgRequest('jlpt-n3.png')).toEqual({ by: 'jlpt', level: 'n3' });
    expect(kanjiIndexOgRequest('jlpt-none.png')).toEqual({ by: 'jlpt', level: 'none' });
    expect(kanjiIndexOgRequest('grade-g6.png')).toEqual({ by: 'grade', level: 'g6' });
    expect(kanjiIndexOgRequest('grade-secondary.png')).toEqual({ by: 'grade', level: 'secondary' });
  });

  it('has no image for a group of the other grouping, an unknown group or another file', () => {
    expect(kanjiIndexOgRequest('jlpt-g3.png')).toBeNull();
    expect(kanjiIndexOgRequest('grade-n5.png')).toBeNull();
    expect(kanjiIndexOgRequest('jlpt-n6.png')).toBeNull();
    expect(kanjiIndexOgRequest('jlpt-n3.jpg')).toBeNull();
    expect(kanjiIndexOgRequest(undefined)).toBeNull();
  });
});

describe('kanjiIndexOgTree', () => {
  it('names the group in Japanese, counts it and shows its first ten kanji', () => {
    expect(kanjiIndexGroupLabel('n5')).toBe('JLPT N5');
    expect(kanjiIndexGroupLabel('g3')).toBe('小学3年');
    expect(kanjiIndexGroupLabel('secondary')).toBe('中学以降');

    const kanji = [...'日一人年大十二本中出三'];
    expect(texts(kanjiIndexOgTree({ id: 'n5', kanji }))).toEqual([
      '漢字',
      'JLPT N5',
      '11 字',
      ...kanji.slice(0, 10),
      'Nadeshiko',
    ]);
  });
});
