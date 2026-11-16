import { describe, it, expect } from 'vitest';
import { align, guessRubyText, surfaceFurigana, toRubyText, type RubySegment } from '@app/services/parser/furigana';

const formatGroups = (surface: string, ruby: string, trailing = '') =>
  align(surface, ruby, trailing).map((g) => `${g.offset}:${g.length}:${g.reading}`);

/** Bracketed ruby text (食[た]べる) as our dict.furigana segments. */
const segments = (rubyText: string): RubySegment[] =>
  [...rubyText.matchAll(/([^぀-ヿ[\]]+)\[([^\]]*)\]|([぀-ヿ]+)/g)].map((m) =>
    m[3] !== undefined ? { text: m[3] } : { text: m[1] ?? '', ruby: m[2] ?? '' },
  );

describe('align (ported from the upstream example-sentence token tests)', () => {
  it.each([
    ['食べた', '食[た]べる', ['0:1:た']],
    ['引き出した', '引[ひ]き出[だ]す', ['0:1:ひ', '2:1:だ']],
    ['お茶', 'お茶[ちゃ]', ['1:1:ちゃ']],
    ['今日', '今日[きょう]', ['0:2:きょう']],
    ['一ヶ月', '一ヶ月[いっかげつ]', ['0:3:いっかげつ']],
    ['読ンだ', '読[よ]む', ['0:1:よ']],
  ])('follows the surface %s until inflection starts', (surface, ruby, expected) => {
    expect(formatGroups(surface, ruby)).toEqual(expected);
  });

  it.each([
    ['来る', '', 'く'],
    ['来た', '', 'き'],
    ['来ます', '', 'き'],
    ['来なさい', '', 'き'],
    ['来ない', '', 'こ'],
    ['来なかった', '', 'こ'],
    ['来れば', '', 'く'],
    ['来られる', '', 'こ'],
    ['来い', '', 'こ'],
    ['来', 'ます', 'き'],
    ['來た', '', 'き'],
  ])('reads kuru in %s (+%s) as %s', (surface, trailing, expected) => {
    const ruby = surface.startsWith('來') ? '來[く]る' : '来[く]る';
    expect(align(surface, ruby, trailing)).toEqual([{ offset: 0, length: 1, reading: expected }]);
  });

  it.each([
    ['やって来た', 'やって来[く]る', ['3:1:き']],
    ['持って来ない', '持[も]って来[く]る', ['0:1:も', '3:1:こ']],
    ['来る日', '来[く]る日[ひ]', ['0:1:く', '2:1:ひ']],
  ])('resolves kuru inside compounds and leaves fixed nouns alone: %s', (surface, ruby, expected) => {
    expect(formatGroups(surface, ruby)).toEqual(expected);
  });

  it.each([
    ['あり得る', '', ['2:1:う']],
    ['あり得べき', '', ['2:1:う']],
    ['あり得ません', '', ['2:1:え']],
    ['有り得ない', '', ['0:1:あ', '2:1:え']],
    ['あり得', 'ない', ['2:1:え']],
  ])('reads uru as e outside the plain form: %s', (surface, trailing, expected) => {
    const ruby = surface.startsWith('有') ? '有[あ]り得[う]る' : 'あり得[う]る';
    expect(formatGroups(surface, ruby, trailing)).toEqual(expected);
  });

  it('drops kuru ruby when nothing disambiguates it', () => {
    expect(align('来', '来[く]る')).toEqual([]);
  });

  it.each([
    ['たべた', '食[た]べる'],
    ['喰べた', '食[た]べる'],
    ['食べた', 'たべる'],
    ['食べた', ''],
  ])('gives nothing when %s is not the spelling %s', (surface, ruby) => {
    expect(align(surface, ruby)).toEqual([]);
  });
});

describe('guessRubyText', () => {
  it.each([
    ['東京都', 'とうきょうと', '東京都[とうきょうと]'],
    ['東京都', 'トウキョウト', '東京都[トウキョウト]'],
    ['食べる', 'たべる', '食[た]べる'],
    ['引き出す', 'ひきだす', '引[ひ]き出[だ]す'],
    ['お茶', 'おちゃ', 'お茶[ちゃ]'],
  ])('splits %s / %s into %s', (kanji, kana, expected) => {
    expect(guessRubyText(kanji, kana)).toBe(expected);
  });

  it.each([
    ['たべる', 'たべる'],
    ['引き出す', 'ひだす'],
  ])('gives null when %s cannot be split along %s', (kanji, kana) => {
    expect(guessRubyText(kanji, kana)).toBeNull();
  });
});

describe('toRubyText', () => {
  it('turns segments into bracketed ruby text', () => {
    expect(toRubyText([{ text: '食', ruby: 'た' }, { text: 'べる' }])).toBe('食[た]べる');
    expect(toRubyText(segments('引[ひ]き出[だ]す'))).toBe('引[ひ]き出[だ]す');
  });
});

describe('surfaceFurigana', () => {
  it('aligns 食べました to the surface with ruby over the kanji only', () => {
    expect(surfaceFurigana('食べました', { rubies: [segments('食[た]べる')] })).toEqual([
      { t: '食', r: 'た' },
      { t: 'べました' },
    ]);
  });

  it.each([
    ['来ない', 'こ'],
    ['来ます', 'き'],
    ['来る', 'く'],
  ])('reads 来 in %s as %s', (surface, reading) => {
    expect(surfaceFurigana(surface, { rubies: [segments('来[く]る')] })).toEqual([
      { t: '来', r: reading },
      { t: surface.slice(1) },
    ]);
  });

  it('reads 来 from the text after the token', () => {
    expect(surfaceFurigana('来', { rubies: [segments('来[く]る')], trailing: 'ました' })).toEqual([
      { t: '来', r: 'き' },
    ]);
  });

  it('reads 得る as うる and あり得ない as え', () => {
    expect(surfaceFurigana('得る', { rubies: [segments('得[う]る')] })).toEqual([{ t: '得', r: 'う' }, { t: 'る' }]);
    expect(surfaceFurigana('あり得ない', { rubies: [segments('あり得[う]る')] })).toEqual([
      { t: 'あり' },
      { t: '得', r: 'え' },
      { t: 'ない' },
    ]);
  });

  it('merges touching per-kanji groups into one box (忘却)', () => {
    expect(surfaceFurigana('忘却', { rubies: [segments('忘[ぼう]却[きゃく]')] })).toEqual([
      { t: '忘却', r: 'ぼうきゃく' },
    ]);
  });

  it('keeps okurigana splits apart (引き出した)', () => {
    expect(surfaceFurigana('引き出した', { rubies: [segments('引[ひ]き出[だ]す')] })).toEqual([
      { t: '引', r: 'ひ' },
      { t: 'き' },
      { t: '出', r: 'だ' },
      { t: 'した' },
    ]);
  });

  it('falls back to the word’s other spellings when its own form does not align', () => {
    // Upstream BuildPlacesGroupsAtSentenceOffsetsAndFallsBackToSiblingSpellings: the token is the kana form.
    expect(surfaceFurigana('食べた', { rubies: [[{ text: 'たべる' }], segments('食[た]べる')] })).toEqual([
      { t: '食', r: 'た' },
      { t: 'べた' },
    ]);
  });

  it('guesses 東京都 from the Sudachi reading when no dictionary ruby is given', () => {
    expect(surfaceFurigana('東京都', { reading: 'トウキョウト' })).toEqual([{ t: '東京都', r: 'とうきょうと' }]);
  });

  it('falls back to the reading when the dictionary spelling does not match the surface', () => {
    expect(surfaceFurigana('喰べた', { rubies: [segments('食[た]べる')], reading: 'タベタ' })).toEqual([
      { t: '喰', r: 'た' },
      { t: 'べた' },
    ]);
  });

  it('gives no furigana for a kana-only surface', () => {
    expect(surfaceFurigana('たべました', { rubies: [segments('食[た]べる')], reading: 'タベマシタ' })).toBeUndefined();
    expect(surfaceFurigana('カタカナ', { reading: 'カタカナ' })).toBeUndefined();
  });

  it('gives no furigana when nothing aligns and there is no reading', () => {
    expect(surfaceFurigana('喰べた', { rubies: [segments('食[た]べる')] })).toBeUndefined();
  });
});
