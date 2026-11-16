import { describe, expect, it } from 'vitest';
import { type CombineContext, type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import { PIN } from '@app/services/parser/combine/data/pins';
import { applyContextPins, fixReadingAmbiguity } from '@app/services/parser/combine/stages/disambiguation';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { Morpheme } from '@app/services/parser/sudachi';

/** One morpheme: [surface, UniDic POS (comma-separated), katakana reading?, lemma?, normalised form?]. */
type Spec = [string, string, string?, string?, string?];

/** Morphemes laid end to end, one group each. */
function line(...specs: Spec[]): Group[] {
  let b = 0;
  return toGroups(
    specs.map(([s, pos, r = s, d = s, n = d]) => {
      const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
      const morpheme: Morpheme = { s, b, e: b + [...s].length, pos: fields, d, n, r, a: [] };
      b = morpheme.e;
      return morpheme;
    }),
  );
}

const NOUN = '名詞,普通名詞,一般';
const NUMERAL = '名詞,数詞';
const COUNTER = '接尾辞,名詞的,助数詞';
const SUFFIX = '接尾辞,名詞的,一般';
const CASE = '助詞,格助詞';
const VERB = '動詞,一般';

/** JMdict words the pins read, with their forms in index order. */
const lexicon = new InMemoryLexicon(['書き方', '三分の一'], { verb: ['書く', '歩く', '駆け回る'] });
const kanji = (text: string) => ({ text, kana: false });
const kana = (text: string) => ({ text, kana: true });
lexicon.addWord(PIN.kata, [kanji('方'), kana('かた')], { keepForms: true });
lexicon.addWord(PIN.houbou, [kanji('方々'), kana('ほうぼう')], { keepForms: true });
lexicon.addWord(PIN.katagata, [kanji('方々'), kana('かたがた')], { keepForms: true });
lexicon.addWord(PIN.juu, [kanji('重'), kana('じゅう')], { keepForms: true });
lexicon.addWord(PIN.do, [kanji('度'), kana('ど'), kana('たび')], { keepForms: true });
lexicon.addWord(PIN.me, [kanji('目'), kana('め')], { keepForms: true });
lexicon.addWord(PIN.kou, [kanji('項'), kana('こう')], { keepForms: true });
lexicon.addWord(PIN.tai, [kanji('体'), kana('たい')], { keepForms: true });
lexicon.addWord(PIN.suburi, [kanji('素振り'), kana('すぶり')], { keepForms: true });
lexicon.addWord(PIN.bun, [kanji('分'), kana('ぶん')], { keepForms: true });
// 五分: the duration pin reads form 1, ごふん.
lexicon.addWord(2039350, [kana('ごぶ'), kana('ごふん'), kanji('五分')], { keepForms: true });
const ctx: CombineContext = { lexicon, deconjugate };

const read = (groups: readonly Group[]) => groups.map((group) => `${group.s}:${group.r}`);
const contextPins = (...specs: Spec[]) => applyContextPins(line(...specs), ctx);
const ambiguity = (...specs: Spec[]) => fixReadingAmbiguity(line(...specs), ctx);

describe('ApplyContextPins: 方 after a 連用形', () => {
  it('re-cuts 書き方 read ほう into 書き (書く) + 方 (かた), taking the stem reading from the morpheme', () => {
    const lex = new InMemoryLexicon([], { verb: ['書く'] });
    const out = applyContextPins(line(['書き方', NOUN, 'カキホウ']), { ...ctx, lexicon: lex });
    expect(out.map((group) => [group.s, group.d, group.cls, group.r])).toEqual([
      ['書き', '書く', 'Verb', 'カキ'],
      ['方', '方', 'Noun', 'カタ'],
    ]);
    expect(out[1]?.flags.pin).toBe(PIN.kata);
  });

  it('leaves a compound JMdict lists whole (書き方)', () => {
    const input = line(['書き方', NOUN, 'カキカタ']);
    expect(applyContextPins(input, ctx)).toBe(input);
  });

  it.each([
    ['a pinned group', ['書き方', NOUN, 'カキカタ'], 1],
    ['a verb', ['書き方', VERB, 'カキカタ'], undefined],
    ['a stem that is no 連用形 (大人方)', ['大人方', NOUN, 'オトナガタ'], undefined],
  ] as Array<[string, Spec, number | undefined]>)(
    'leaves %s whole even when the stem verb is known',
    (_label, spec, pin) => {
      const input = line(spec);
      if (pin !== undefined) input[0] = { ...(input[0] as Group), flags: { pin } };
      const verbOnly = new InMemoryLexicon([], { verb: ['書く'] });
      expect(applyContextPins(input, { ...ctx, lexicon: verbOnly })).toBe(input);
    },
  );

  it('pins a lone 方 after a 連用形 to かた (書き|方)', () => {
    const out = contextPins(['書き', VERB, 'カキ', '書く'], ['方', NOUN, 'ホウ']);
    expect(out[1]).toMatchObject({ r: 'カタ', flags: { pin: PIN.kata } });
  });

  it('keeps 方 after a verb that is not a 連用形 (書く|方)', () => {
    const input = line(['書く', VERB, 'カク', '書く'], ['方', NOUN, 'ホウ']);
    expect(applyContextPins(input, ctx)).toBe(input);
  });
});

describe('ApplyContextPins: 方々', () => {
  it.each([
    ['を', '歩く'],
    ['に', '駆け回る'],
    ['を', '散る'],
    ['を', '飛び散る'],
  ])('reads 方々|%s|%s ほうぼう', (particle, verb) => {
    const out = contextPins(['方々', NOUN, 'カタガタ'], [particle, CASE], [verb, VERB, verb, verb]);
    expect(out[0]).toMatchObject({ r: 'ホウボウ', flags: { pin: PIN.houbou } });
  });

  it.each([
    [
      'after の (先生の方々)',
      [
        ['先生', NOUN],
        ['の', CASE],
      ],
    ],
    ['after an adnominal (この方々)', [['この', '連体詞']]],
  ] as Array<[string, Spec[]]>)('reads 方々 かたがた %s', (_label, before) => {
    const out = contextPins(...before, ['方々', NOUN, 'ホウボウ'], ['が', CASE]);
    expect(out.at(-2)).toMatchObject({ r: 'カタガタ', flags: { pin: PIN.katagata } });
  });

  it.each([
    [
      'at the start, before a verb that is no movement',
      [
        ['方々', NOUN, 'ホウボウ'],
        ['に', CASE],
        ['話す', VERB],
      ],
    ],
    [
      'before a particle that is not を/に',
      [
        ['方々', NOUN, 'ホウボウ'],
        ['が', CASE],
        ['歩く', VERB],
      ],
    ],
    ['at the end', [['方々', NOUN, 'ホウボウ']]],
  ] as Array<[string, Spec[]]>)('leaves 方々 alone %s', (_label, specs) => {
    const input = line(...specs);
    expect(applyContextPins(input, ctx)).toBe(input);
  });
});

describe('ApplyContextPins: counters', () => {
  it.each([
    ['三', NUMERAL],
    ['何', '代名詞'],
    ['数', NOUN],
    ['第三', '接頭辞'],
    ['１０', NUMERAL],
  ] as Array<[string, string]>)('pins 度 after %s to the counter ど', (numeral, pos) => {
    const out = contextPins([numeral, pos], ['度', COUNTER, 'タビ']);
    expect(out[1]).toMatchObject({ r: 'ド', flags: { pin: PIN.do } });
  });

  it.each([
    [
      'after a word (今度)',
      [
        ['今', NOUN],
        ['度', COUNTER, 'タビ'],
      ],
    ],
    ['at the start', [['度', NOUN, 'タビ']]],
    [
      'after 第 alone',
      [
        ['第', '接頭辞'],
        ['度', COUNTER, 'タビ'],
      ],
    ],
  ] as Array<[string, Spec[]]>)('leaves 度 alone %s', (_label, specs) => {
    const input = line(...specs);
    expect(applyContextPins(input, ctx)).toBe(input);
  });

  it('keeps a 度 that is already pinned', () => {
    const input = line(['三', NUMERAL], ['度', COUNTER, 'タビ']);
    input[1] = { ...(input[1] as Group), flags: { pin: 7 } };
    expect(applyContextPins(input, ctx)).toBe(input);
  });

  it('reads suffix 色 いろ as a noun (空|色), but not after a numeral (三|色)', () => {
    expect(contextPins(['空', NOUN, 'ソラ'], ['色', SUFFIX, 'ショク'])[1]).toMatchObject({ cls: 'Noun', r: 'イロ' });
    const counted = line(['三', NUMERAL, 'サン'], ['色', SUFFIX, 'ショク']);
    expect(applyContextPins(counted, ctx)).toBe(counted);
    const already = line(['空', NOUN, 'ソラ'], ['色', SUFFIX, 'イロ']);
    expect(applyContextPins(already, ctx)).toBe(already);
  });

  it('reads a counter 重 before a noun as the prefix じゅう (重|戦車)', () => {
    const out = contextPins(['重', COUNTER, 'エ'], ['戦車', NOUN, 'センシャ']);
    expect(out[0]).toMatchObject({ s: '重', cls: 'Prefix', r: 'ジュウ', d: '重', flags: { pin: PIN.juu } });
  });

  it('keeps a counter 重 that is not before a noun (二|重|に)', () => {
    const input = line(['二', NUMERAL], ['重', COUNTER, 'ジュウ'], ['に', CASE]);
    expect(applyContextPins(input, ctx)).toBe(input);
  });

  it('pins 目 after a 〜つ counter to the ordinal め (三つ|目)', () => {
    const out = contextPins(['三つ', NUMERAL, 'ミッツ'], ['目', SUFFIX, 'モク']);
    expect(out[1]).toMatchObject({ r: 'メ', d: '目', flags: { pin: PIN.me } });
  });

  it.each([
    ['一つ|目, which has its own entry', '一つ'],
    ['２つ|目, which has its own entry', '２つ'],
    ['a lone つ', 'つ'],
    ['a word in つ that is no numeral (いくつ)', 'いくつ'],
  ])('leaves 目 alone after %s', (_label, before) => {
    const input = line([before, NUMERAL], ['目', SUFFIX, 'モク']);
    expect(applyContextPins(input, ctx)).toBe(input);
  });
});

describe('ApplyContextPins: suffix 家 and 山', () => {
  it('reads suffix 家 before a case particle as the noun いえ (この|家|に)', () => {
    expect(contextPins(['この', '連体詞'], ['家', SUFFIX, 'ケ'], ['に', CASE])[1]).toMatchObject({
      cls: 'Noun',
      r: 'イエ',
    });
  });

  it.each([
    [
      'after a name it suffixes (大野|家|の)',
      [
        ['大野', '名詞,固有名詞,人名'],
        ['家', SUFFIX, 'ケ'],
        ['の', CASE],
      ],
    ],
    [
      'before a particle that is not a case particle',
      [
        ['この', '連体詞'],
        ['家', SUFFIX, 'ケ'],
        ['よ', '助詞,終助詞'],
      ],
    ],
    [
      'at the end',
      [
        ['この', '連体詞'],
        ['家', SUFFIX, 'ケ'],
      ],
    ],
    [
      'when 家 is a noun already',
      [
        ['この', '連体詞'],
        ['家', NOUN, 'イエ'],
        ['に', CASE],
      ],
    ],
  ] as Array<[string, Spec[]]>)('keeps 家 %s', (_label, specs) => {
    const input = line(...specs);
    expect(applyContextPins(input, ctx)).toBe(input);
  });

  it('reads suffix 山 as the noun やま (富士|山)', () => {
    expect(contextPins(['富士', '名詞,固有名詞,地名'], ['山', SUFFIX, 'サン'])[1]).toMatchObject({
      cls: 'Noun',
      r: 'ヤマ',
    });
  });
});

describe('FixReadingAmbiguity: 何, 張り, 寒気', () => {
  it.each([
    ['at the end', 'ナニ', [['何', '代名詞', 'ナン']]],
    [
      'before が',
      'ナニ',
      [
        ['何', '代名詞', 'ナン'],
        ['が', CASE],
      ],
    ],
    [
      'before も',
      'ナニ',
      [
        ['何', '代名詞', 'ナン'],
        ['も', '助詞,係助詞'],
      ],
    ],
    [
      'before だ',
      'ナン',
      [
        ['何', '代名詞', 'ナン'],
        ['だ', '助動詞'],
      ],
    ],
  ] as Array<[string, string, Spec[]]>)('reads 何 %s as %s', (_label, reading, specs) => {
    expect(ambiguity(...specs)[0]?.r).toBe(reading);
  });

  it.each([
    [
      'after a particle (声に張り)',
      'ハリ',
      [
        ['声', NOUN],
        ['に', CASE],
        ['張り', NOUN, 'バリ'],
      ],
    ],
    ['at the start', 'ハリ', [['張り', NOUN, 'バリ']]],
    [
      'after a noun (漱石張り)',
      'バリ',
      [
        ['漱石', '名詞,固有名詞,人名'],
        ['張り', SUFFIX, 'バリ'],
      ],
    ],
    [
      'after a quoted noun (「漱石」張り)',
      'バリ',
      [
        ['漱石', '名詞,固有名詞,人名'],
        ['」', '補助記号,括弧閉'],
        ['張り', SUFFIX, 'バリ'],
      ],
    ],
    [
      'after a blank and a noun',
      'バリ',
      [
        ['漱石', '名詞,固有名詞,人名'],
        ['　', '空白'],
        ['張り', SUFFIX, 'バリ'],
      ],
    ],
    [
      'after punctuation',
      'ハリ',
      [
        ['漱石', '名詞,固有名詞,人名'],
        ['、', '補助記号,読点'],
        ['張り', SUFFIX, 'バリ'],
      ],
    ],
  ] as Array<[string, string, Spec[]]>)('reads 張り %s as %s', (_label, reading, specs) => {
    expect(ambiguity(...specs).at(-1)?.r).toBe(reading);
  });

  it.each([
    [
      '寒気|が|する',
      'サムケ',
      [
        ['が', CASE],
        ['する', VERB, 'スル', 'する'],
      ],
    ],
    [
      '寒気|を|覚える',
      'サムケ',
      [
        ['を', CASE],
        ['覚える', VERB, 'オボエル', '覚える'],
      ],
    ],
    [
      '寒気|が|南下する',
      'カンキ',
      [
        ['が', CASE],
        ['南下', '名詞,普通名詞,サ変可能'],
      ],
    ],
    [
      '寒気|を|運ぶ',
      'カンキ',
      [
        ['を', CASE],
        ['運ぶ', VERB, 'ハコブ', '運ぶ'],
      ],
    ],
    ['寒気|が (end)', 'カンキ', [['が', CASE]]],
  ] as Array<[string, string, Spec[]]>)('reads %s as %s', (_label, reading, after) => {
    expect(ambiguity(['寒気', NOUN, 'カンキ'], ...after)[0]?.r).toBe(reading);
  });
});

describe('FixReadingAmbiguity: numerals', () => {
  it.each([
    ['後|もう少し', 'もう少し', '副詞'],
    ['後|少し', '少し', '副詞'],
    ['後|ちょっと', 'ちょっと', '副詞'],
  ])('reads %s with 後 as アト', (_label, next, pos) => {
    expect(ambiguity(['後', NOUN, 'ゴ'], [next, pos])[0]?.r).toBe('アト');
  });

  it('keeps 後 ゴ before a word that is no quantity (後|で)', () => {
    expect(ambiguity(['後', NOUN, 'ゴ'], ['で', CASE])[0]?.r).toBe('ゴ');
  });

  it('pins 項 after a numeral to the counter こう (第|２|項)', () => {
    const out = ambiguity(['第', '接頭辞', 'ダイ'], ['２', NUMERAL, 'ニ'], ['項', NOUN, 'コウ']);
    expect(out[2]).toMatchObject({ r: 'コウ', flags: { pin: PIN.kou } });
  });

  it('keeps 項 after a word that is no numeral', () => {
    expect(ambiguity(['条', NOUN, 'ジョウ'], ['項', NOUN, 'コウ'])[1]?.flags.pin).toBeUndefined();
  });

  it.each([
    ['何', '代名詞'],
    ['三', NUMERAL],
  ])('pins 体 between %s and 目 to the counter たい', (before, pos) => {
    const out = ambiguity([before, pos], ['体', NOUN, 'タイ'], ['目', SUFFIX, 'メ']);
    expect(out[1]).toMatchObject({ r: 'タイ', flags: { pin: PIN.tai } });
  });

  it.each([
    [
      'without 目 after it',
      [
        ['三', NUMERAL],
        ['体', NOUN, 'タイ'],
        ['の', CASE],
      ],
    ],
    [
      'after a word that is no numeral',
      [
        ['人', NOUN],
        ['体', NOUN, 'タイ'],
        ['目', SUFFIX, 'メ'],
      ],
    ],
  ] as Array<[string, Spec[]]>)('keeps 体 %s', (_label, specs) => {
    expect(ambiguity(...specs)[1]?.flags.pin).toBeUndefined();
  });

  it('pins a one-token duration before a time anchor (五分|後 is ごふん)', () => {
    const out = ambiguity(['五分', '名詞,普通名詞,一般', 'ゴブ'], ['後', NOUN, 'ゴ']);
    expect(out[0]).toMatchObject({ r: 'ゴフン', flags: { pin: 2039350 } });
  });

  it('skips blanks to find the anchor and reads 待っ as one (五分　待って)', () => {
    const out = ambiguity(['五分', NOUN, 'ゴブ'], ['　', '空白'], ['待っ', VERB, 'マッ', '待つ']);
    expect(out[0]?.r).toBe('ゴフン');
  });

  it('keeps the duration reading when the lexicon has not the pinned word (三分|ほど)', () => {
    const out = ambiguity(['三分', NOUN, 'サンブ'], ['ほど', '助詞,副助詞']);
    expect(out[0]).toMatchObject({ r: 'サンブ', flags: { pin: 1814040 } });
  });

  it('does not take punctuation as an anchor (五分、)', () => {
    expect(ambiguity(['五分', NOUN, 'ゴブ'], ['、', '補助記号,読点'])[0]?.flags.pin).toBeUndefined();
  });

  it('absorbs the numeral before 分 when the pair is a duration, reading it from its parts when unknown', () => {
    const out = ambiguity(['七', NUMERAL, 'ナナ'], ['分', SUFFIX, 'フン'], ['経っ', VERB, 'タッ', '経つ']);
    expect(read(out)).toEqual(['七分:ナナフン', '経っ:タッ']);
    expect(out[0]?.flags.pin).toBe(2864067);
  });

  it('leaves 分 alone before an anchor when the pair is no duration (八|分|前)', () => {
    expect(read(ambiguity(['八', NUMERAL, 'ハチ'], ['分', SUFFIX, 'フン'], ['前', NOUN, 'マエ']))).toEqual([
      '八:ハチ',
      '分:フン',
      '前:マエ',
    ]);
  });

  it('merges a numeral and 時 into the clock hour (九|時 is くじ)', () => {
    const out = ambiguity(['九', NUMERAL, 'キュウ'], ['時', SUFFIX, 'ジ']);
    expect(read(out)).toEqual(['九時:クジ']);
  });

  it('cuts 分 off a one-token N分 in N分のN (四分|の|一 → 四 + 分 ぶん)', () => {
    const out = ambiguity(['四分', NOUN, 'ヨンブン'], ['の', CASE], ['一', NUMERAL, 'イチ']);
    expect(out.map((group) => [group.s, group.r, group.cls])).toEqual([
      ['四', 'ヨン', 'Noun'],
      ['分', 'ブン', 'Noun'],
      ['の', 'の', 'Particle'],
      ['一', 'イチ', 'Noun'],
    ]);
    expect(out[1]?.flags).toMatchObject({ pin: PIN.bun, hardPin: true });
  });

  it('leaves the numeral reading to lookup when 分 is read otherwise (四分 read シブ)', () => {
    const out = ambiguity(['四分', NOUN, 'シブ'], ['の', CASE], ['一', NUMERAL, 'イチ']);
    expect(out.map((group) => group.s)).toEqual(['四', '分', 'の', '一']);
    expect(out[1]?.r).toBe('ブン');
  });

  it('keeps an N分のN that is an entry whole (三分の一)', () => {
    expect(ambiguity(['三分', NOUN, 'サンブン'], ['の', CASE], ['一', NUMERAL, 'イチ'])[0]?.s).toBe('三分');
  });

  it('keeps N分 before の and a word that is no numeral (四分の時間)', () => {
    expect(ambiguity(['四分', NOUN, 'ヨンプン'], ['の', CASE], ['時間', NOUN, 'ジカン'])[0]?.s).toBe('四分');
  });

  it('pins a split 分 in N|分|のN however Sudachi read it (七|分|の|一)', () => {
    const out = ambiguity(['七', NUMERAL, 'ナナ'], ['分', SUFFIX, 'フン'], ['の', CASE], ['一', NUMERAL, 'イチ']);
    expect(out[1]).toMatchObject({ r: 'ブン', flags: { pin: PIN.bun, hardPin: true } });
  });

  it('leaves a split 分 alone when N分のN is an entry (三|分|の|一)', () => {
    const out = ambiguity(['三', NUMERAL, 'サン'], ['分', SUFFIX, 'ブン'], ['の', CASE], ['一', NUMERAL, 'イチ']);
    expect(out[1]?.flags.pin).toBeUndefined();
  });
});

describe('FixReadingAmbiguity: homographs read from context', () => {
  it.each([
    [
      '竹刀 nearby',
      [
        ['竹刀', NOUN, 'シナイ'],
        ['で', CASE],
      ],
    ],
    [
      'a バット word nearby',
      [
        ['バット', NOUN, 'バット'],
        ['で', CASE],
      ],
    ],
    [
      'a バッター word nearby',
      [
        ['バッター', NOUN, 'バッター'],
        ['の', CASE],
      ],
    ],
    [
      'a ラケット word nearby',
      [
        ['ラケット', NOUN, 'ラケット'],
        ['で', CASE],
      ],
    ],
    [
      'a スイング word nearby',
      [
        ['スイング', NOUN, 'スイング'],
        ['の', CASE],
      ],
    ],
  ] as Array<[string, Spec[]]>)('pins 素振り to すぶり with %s', (_label, before) => {
    const out = ambiguity(...before, ['素振り', NOUN, 'スブリ']);
    expect(out.at(-1)).toMatchObject({ r: 'スブリ', flags: { pin: PIN.suburi } });
  });

  it('reads 素振り そぶり without a swing word (怪しい素振り)', () => {
    expect(ambiguity(['怪しい', '形容詞,一般'], ['素振り', NOUN, 'スブリ']).at(-1)?.r).toBe('ソブリ');
  });

  it('reads 札 ふだ with a card game and a card verb (麻雀|で|札|を|切る)', () => {
    const out = ambiguity(
      ['麻雀', NOUN],
      ['で', CASE],
      ['札', NOUN, 'サツ'],
      ['を', CASE],
      ['切る', VERB, 'キル', '切る'],
    );
    expect(out[2]?.r).toBe('フダ');
  });

  it.each([
    [
      'money changing hands in a game scene (麻雀|で|札|を|渡す)',
      [
        ['麻雀', NOUN],
        ['で', CASE],
        ['札', NOUN, 'サツ'],
        ['を', CASE],
        ['渡す', VERB, 'ワタス', '渡す'],
      ],
    ],
    [
      'a card verb with no game (札|を|見る)',
      [
        ['店', NOUN],
        ['で', CASE],
        ['札', NOUN, 'サツ'],
        ['を', CASE],
        ['見る', VERB, 'ミル', '見る'],
      ],
    ],
    [
      '札 before が',
      [
        ['麻雀', NOUN],
        ['で', CASE],
        ['札', NOUN, 'サツ'],
        ['が', CASE],
        ['切る', VERB, 'キル', '切る'],
      ],
    ],
  ] as Array<[string, Spec[]]>)('keeps 札 さつ for %s', (_label, specs) => {
    expect(ambiguity(...specs)[2]?.r).toBe('サツ');
  });

  it.each([
    [
      '額|に|キス',
      [
        ['に', CASE],
        ['キス', '名詞,普通名詞,サ変可能'],
      ],
    ],
    [
      '額|を|押さえる',
      [
        ['を', CASE],
        ['押さえる', VERB, 'オサエル', '押さえる'],
      ],
    ],
    [
      '額|の|汗',
      [
        ['の', CASE],
        ['汗', NOUN, 'アセ'],
      ],
    ],
  ] as Array<[string, Spec[]]>)('reads %s with 額 ひたい', (_label, after) => {
    expect(ambiguity(['額', NOUN, 'ガク'], ...after)[0]?.r).toBe('ヒタイ');
  });

  it.each([
    [
      '額|が|大きい',
      [
        ['が', CASE],
        ['大きい', '形容詞,一般'],
      ],
    ],
    [
      '額|の|金',
      [
        ['の', CASE],
        ['金', NOUN, 'カネ'],
      ],
    ],
    ['額|に (end)', [['に', CASE]]],
  ] as Array<[string, Spec[]]>)('keeps %s with 額 がく', (_label, after) => {
    expect(ambiguity(['額', NOUN, 'ガク'], ...after)[0]?.r).toBe('ガク');
  });

  it('reads 露 before になる as あらわ (露|に|なっ)', () => {
    const out = ambiguity(['露', NOUN, 'ロ'], ['に', CASE], ['なっ', VERB, 'ナッ', 'なる']);
    expect(out[0]).toMatchObject({ r: 'アラワ', n: '露わ' });
  });

  it('keeps 露 before に and another verb', () => {
    expect(ambiguity(['露', NOUN, 'ロ'], ['に', CASE], ['濡れる', VERB, 'ヌレル', '濡れる'])[0]?.r).toBe('ロ');
  });

  it.each([
    ['来る', 'キタル', 'クル'],
    ['来', 'キタ', 'ク'],
  ])('reads %s, which Sudachi lemmatised to 来たる, as くる', (surface, reading, expected) => {
    const out = ambiguity([surface, VERB, reading, '来たる', '来たる']);
    expect(out[0]).toMatchObject({ r: expected, d: '来る', n: '来る' });
  });

  it('keeps 来たる itself', () => {
    expect(ambiguity(['来たる', VERB, 'キタル', '来たる', '来たる'])[0]?.r).toBe('キタル');
  });

  it('reads 抱く だく and 捩る ねじる', () => {
    expect(ambiguity(['抱い', VERB, 'イダイ', '抱く'])[0]?.r).toBe('ダイ');
    expect(ambiguity(['捩っ', VERB, 'モジッ', '捩る'])[0]?.r).toBe('ネジッ');
  });

  it('reads an orphaned 事 こと once a suffix was reclassified', () => {
    const input = line(['事', NOUN, 'ジ']);
    input[0] = { ...(input[0] as Group), flags: { reclassifiedSuffix: true } };
    expect(fixReadingAmbiguity(input, ctx)[0]?.r).toBe('コト');
  });

  it('returns the input when nothing needs a fix', () => {
    const input = line(['猫', NOUN, 'ネコ'], ['が', CASE]);
    expect(fixReadingAmbiguity(input, ctx)).toBe(input);
  });
});
