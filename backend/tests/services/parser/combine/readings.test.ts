import { describe, expect, it } from 'vitest';
import { combine, type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import type { RewriteRule } from '@app/services/parser/combine/data/rewriteRules';
import { REWRITE_RULES } from '@app/services/parser/combine/data/rewriteRules';
import { applyContextPins, fixReadingAmbiguity } from '@app/services/parser/combine/stages/disambiguation';
import {
  kanjiNumeral,
  linkReadings,
  numberReading,
  readAmounts,
  readAs,
} from '@app/services/parser/combine/stages/readings';
import {
  applyTokenRewriteRulesReading,
  buildRewriteIndex,
  runRewriteRules,
  validateRewriteRules,
} from '@app/services/parser/combine/stages/rewrite';
import { deconjugate } from '@app/services/parser/deconjugator';
import { toSlimToken } from '@app/services/parser/nadeshiko';
import type { Morpheme } from '@app/services/parser/sudachi';
import { morphemes } from './fixtures';
import { lexicon as baseLexicon } from './testLexicon';

/** JMdict words as `dict.form` lists them (ids are JMdict sequence numbers): [id, common, forms]. A form is
 * `kanji` or `kana:` + reading. */
const WORDS: Array<[number, boolean, string[]]> = [
  [1221740, true, ['気に入る', '気にいる', 'kana:きにいる']],
  [1188270, true, ['何か', 'kana:なにか', 'kana:なんか']],
  [1188490, true, ['何も', 'kana:なにも', 'kana:なんも']],
  [1547720, true, ['来る', 'kana:くる']],
  [2856600, false, ['遊びに来る', 'kana:あそびにくる']],
  [1432930, true, ['通り', 'kana:どおり', 'kana:どうり']],
  [2827190, false, ['予定通り', 'kana:よていどおり']],
  [1381310, true, ['選手', 'kana:せんしゅ']],
  [1720250, true, ['新田', 'kana:しんでん', 'kana:あらた']],
  [1461140, true, ['二日酔い', 'kana:ふつかよい']],
  [1307230, true, ['４時', '四時', 'kana:よじ']],
  [1335070, true, ['１０分', '十分', 'kana:じゅっぷん', 'kana:じっぷん']],
  [1335050, true, ['十分', 'kana:じゅうぶん']],
  [1307320, true, ['四日', 'kana:よっか']],
  [1629290, true, ['十四日', 'kana:じゅうよっか']],
  [1166600, true, ['一本', 'kana:いっぽん']],
  [2870890, false, ['三戦', 'kana:さんちん']],
  [1516925, true, ['方', 'kana:かた']],
];

function readingLexicon(): InMemoryLexicon {
  const lexicon = new InMemoryLexicon(['何', '理由', 'ある', '指示', 'イクラ', '方', '遊び', '予定'], {
    exp: ['気に入る', '何か', '何も', '遊びに来る', 'ちょっと'],
    verb: ['気に入る', '入る', '来る', '遊びに来る', '読む', '避ける'],
    adv: ['ちょっと'],
  });
  for (const [id, common, forms] of WORDS) {
    for (const form of forms) lexicon.add(form.replace('kana:', ''), 0);
    lexicon.addWord(
      id,
      forms.map((form) =>
        form.startsWith('kana:') ? { text: form.slice(5), kana: true, appliesTo: ['*'] } : { text: form, kana: false },
      ),
      { common, keepForms: true },
    );
  }
  return lexicon;
}

const lexicon = readingLexicon();
const ctx = { lexicon, deconjugate };
const run = (text: string) => combine(morphemes(text), ctx);
const read = (groups: readonly Group[]) => groups.map((group) => `${group.s}:${group.r}`);

/** A hand-made morpheme, for shapes the fixtures do not cover. */
function m(s: string, b: number, pos: string, r: string, d = s): Morpheme {
  const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
  return { s, b, e: b + [...s].length, pos: fields, d, n: d, r, a: [] };
}

describe('the rewrite-rule engine', () => {
  it('validates the copied rows', () => {
    expect(() => validateRewriteRules(REWRITE_RULES)).not.toThrow();
    const twice: RewriteRule = { id: 'x', phase: 'Reading', match: [{ text: '表' }], replace: [{ text: '' }] };
    expect(() => validateRewriteRules([twice, twice])).toThrow(/Duplicate/);
    expect(() => validateRewriteRules([{ ...twice, replace: [] }])).toThrow(/at least one/);
  });

  it('rewrites a reading only in context: 表へ is おもて, メニュー表 stays ひょう', () => {
    expect(read(applyTokenRewriteRulesReading(toGroups(morphemes('表へ出ろ')), ctx))[0]).toBe('表:オモテ');
    const chart = toGroups([
      m('メニュー', 0, '名詞,普通名詞', 'メニュー'),
      m('表', 4, '名詞,普通名詞', 'ヒョウ'),
      m('に', 5, '助詞,格助詞', 'ニ'),
    ]);
    expect(applyTokenRewriteRulesReading(chart, ctx)).toBe(chart);
  });

  it('honours negated neighbours: 糞が is くそ, 犬の糞 stays ふん', () => {
    expect(read(applyTokenRewriteRulesReading(toGroups(morphemes('糞が')), ctx))[0]).toBe('糞:クソ');
    const dung = toGroups(morphemes('犬の糞'));
    expect(applyTokenRewriteRulesReading(dung, ctx)).toBe(dung);
  });

  it('reads a pin without a reading as the pinned JMdict form (通り after a noun → どおり)', () => {
    const out = applyTokenRewriteRulesReading(toGroups(morphemes('予定通り')), ctx);
    expect(out[1]).toMatchObject({ s: '通り', r: 'ドオリ', flags: { pin: 1432930 } });
  });

  it('checks windows and leaves pinned groups alone', () => {
    const rules: RewriteRule[] = [
      {
        id: 'fuchi',
        phase: 'Reading',
        match: [{ text: '縁', readingPrefix: 'エン' }],
        replace: [{ text: '', reading: 'フチ' }],
        prev: { textAnyOf: ['の'] },
        window: { from: -2, to: -2, textAnyOf: ['浴槽'] },
      },
    ];
    const index = buildRewriteIndex(rules);
    const rim = toGroups([
      m('浴槽', 0, '名詞,普通名詞', 'ヨクソウ'),
      m('の', 2, '助詞,格助詞', 'ノ'),
      m('縁', 3, '名詞,普通名詞', 'エン'),
    ]);
    expect(runRewriteRules(rim, index, ctx)[2]?.r).toBe('フチ');
    const fate = toGroups([
      m('運命', 0, '名詞,普通名詞', 'ウンメイ'),
      m('の', 2, '助詞,格助詞', 'ノ'),
      m('縁', 3, '名詞,普通名詞', 'エン'),
    ]);
    expect(runRewriteRules(fate, index, ctx)).toBe(fate);
    const pinned = rim.map((group, i) => (i === 2 ? { ...group, flags: { pin: 1 } } : group));
    expect(runRewriteRules(pinned, index, ctx)).toBe(pinned);
  });
});

describe('FixReadingAmbiguity', () => {
  it('reads 何 before を/が/も or alone as なに, before か as なん', () => {
    expect(read(fixReadingAmbiguity(toGroups(morphemes('何を言う')), ctx))[0]).toBe('何:ナニ');
    expect(read(fixReadingAmbiguity(toGroups(morphemes('何か理由があるのか')), ctx))[0]).toBe('何:ナン');
  });

  it('reads 後 before a quantity as あと', () => {
    const groups = toGroups([
      m('後', 0, '名詞,普通名詞,副詞可能', 'ゴ'),
      m('三', 1, '名詞,数詞', 'サン'),
      m('日', 2, '接尾辞,名詞的,助数詞', 'ニチ'),
    ]);
    expect(fixReadingAmbiguity(groups, ctx)[0]?.r).toBe('アト');
  });

  it('reads 角 by what bears it: 鬼の角 is つの, 三角形の角 かく', () => {
    const horn = toGroups([
      m('鬼', 0, '名詞,普通名詞', 'オニ'),
      m('の', 1, '助詞,格助詞', 'ノ'),
      m('角', 2, '名詞,普通名詞', 'カド'),
    ]);
    expect(fixReadingAmbiguity(horn, ctx)[2]?.r).toBe('ツノ');
    const corner = toGroups([
      m('三角形', 0, '名詞,普通名詞', 'サンカクケイ'),
      m('の', 3, '助詞,格助詞', 'ノ'),
      m('角', 4, '名詞,普通名詞', 'カド'),
    ]);
    expect(fixReadingAmbiguity(corner, ctx)[2]?.r).toBe('カク');
  });

  it('reads 大勢 as おおぜい outside 大勢に影響', () => {
    const many = toGroups([m('大勢', 0, '名詞,普通名詞', 'タイセイ'), m('いる', 2, '動詞,非自立可能', 'イル')]);
    expect(fixReadingAmbiguity(many, ctx)[0]?.r).toBe('オオゼイ');
  });

  it('takes 弾ける read ヒケ as the potential of 弾く', () => {
    const groups = toGroups([m('弾け', 0, '動詞,一般', 'ヒケ', '弾ける')]);
    expect(fixReadingAmbiguity(groups, ctx)[0]?.d).toBe('弾く');
  });
});

describe('FixNumeralReadings', () => {
  it('merges numeral + 時 into the clock hour (四時 = よじ)', () => {
    const out = fixReadingAmbiguity(toGroups(morphemes('四時に')), ctx);
    expect(read(out)).toEqual(['四時:ヨジ', 'に:ニ']);
    expect(out[0]).toMatchObject({ d: '四時', b: 0, e: 2, flags: { pin: 1307230 } });
    expect(out[0]?.members.map((member) => member.s)).toEqual(['四', '時']);
  });

  it('reads numeral + 分 before a time anchor as a duration (十分後 = じゅっぷん)', () => {
    expect(read(fixReadingAmbiguity(toGroups(morphemes('十分後')), ctx))).toEqual(['十分:ジュップン', '後:ゴ']);
    expect(read(run('十分後'))).toEqual(['十分:ジュップン', '後:ゴ']);
  });
});

describe('ApplyContextPins', () => {
  it('reads 人 after a numeral as にん', () => {
    const groups = toGroups([m('五', 0, '名詞,数詞', 'ゴ'), m('人', 1, '接尾辞,名詞的,助数詞', 'ジン')]);
    expect(applyContextPins(groups, ctx)[1]?.r).toBe('ニン');
  });

  it('reads 方 after a 連用形 as かた, after a past form as ほう', () => {
    const way = toGroups([m('読み', 0, '動詞,一般', 'ヨミ', '読む'), m('方', 2, '名詞,普通名詞', 'ホウ')]);
    expect(applyContextPins(way, ctx)[1]).toMatchObject({ r: 'カタ', flags: { pin: 1516925 } });
    const groups = combine(morphemes('避けた方がいい'), ctx);
    expect(read(groups)).toContain('方:ホウ');
  });
});

describe('ReadAmounts (ours)', () => {
  it('reads digits as a number', () => {
    expect(numberReading('10')).toBe('ジュウ');
    expect(numberReading('1500')).toBe('センゴヒャク');
    expect(numberReading('1946')).toBe('センキュウヒャクヨンジュウロク');
    expect(numberReading('３００')).toBe('サンビャク');
    expect(numberReading('8000')).toBe('ハッセン');
    expect(numberReading('10000')).toBe('イチマン');
    expect(numberReading('10000000')).toBe('イッセンマン');
    expect(numberReading('0')).toBe('ゼロ');
    expect(numberReading('007')).toBe('ゼロゼロナナ');
    expect(kanjiNumeral(14n)).toBe('十四');
    expect(kanjiNumeral(1500n)).toBe('千五百');
    expect(kanjiNumeral(20000n)).toBe('二万');
  });

  it('reads a counted amount as JMdict reads it, with its tens before (14日 = じゅうよっか)', () => {
    expect(read(run('12月14日'))).toEqual(['12月:ジュウニガツ', '14日:ジュウヨッカ']);
    expect(read(run('4日前'))).toEqual(['4日:ヨッカ', '前:マエ']);
    expect(read(run('1本目は')).slice(0, 1)).toEqual(['1本:イッポン']);
    expect(read(run('4時に')).slice(0, 1)).toEqual(['4時:ヨジ']);
  });

  it('falls back to the number and Sudachi’s counter, and skips rare words the counter does not end', () => {
    expect(read(run('12人!'))[0]).toBe('12人:ジュウニニン');
    expect(read(run('1500円'))).toEqual(['1500:センゴヒャク', '円:エン']);
    // 三戦 is in JMdict only as the karate kata さんちん.
    expect(read(run('3戦'))[0]).toBe('3戦:サンセン');
    const ten = toGroups([m('10', 0, '名詞,数詞', 'イチレイ')]);
    expect(readAmounts(ten, ctx)[0]?.r).toBe('ジュウ');
  });
});

describe('LinkReadings (ours, after FormReading)', () => {
  it('reads a merged expression as its JMdict word, keeping the inflected tail (気に入った)', () => {
    const groups = run('イクラが気に入ったんだな');
    expect(read(groups)).toContain('気に入った:キニイッタ');
  });

  it('reads 何か and 何も as JMdict’s first reading', () => {
    expect(read(run('何か理由があるのか'))[0]).toBe('何か:ナニカ');
    expect(read(run('何も指示してこない'))[0]).toBe('何も:ナニモ');
  });

  it('reads 来 by what follows, not as くる (来そう, 遊びに来た)', () => {
    expect(read(run('来そう'))).toEqual(['来そう:キソウ']);
    expect(read(run('遊びに来た'))).toEqual(['遊びに来た:アソビニキタ']);
  });

  it('reads a compound Sudachi copied part of the surface into (選手 read セン手)', () => {
    expect(read(run('勝者 矢口選手ー!'))).toContain('選手:センシュ');
  });

  it('reads a kana group Sudachi could not read as itself (ちょっ|と)', () => {
    expect(read(run('ちょっとーっ!'))[0]).toBe('ちょっと:チョット');
  });

  it('leaves a single morpheme Sudachi read alone (新田 the place and 新田 the name)', () => {
    expect(read(run('新田? おい 新田')).filter((entry) => entry.startsWith('新田'))).toEqual([
      '新田:シンデン',
      '新田:ニッタ',
    ]);
  });

  it('keeps a compound out of JMdict, and leaves pinned groups alone', () => {
    const groups = run('二日酔い');
    expect(read(groups)).toEqual(['二日酔い:フツカヨイ']);
    const pinned = groups.map((group) => ({ ...group, r: 'フタカヨイ', flags: { ...group.flags, pin: 1 } }));
    expect(linkReadings(pinned, ctx)).toBe(pinned);
    const unknown = combine(morphemes('二日酔い'), { ...ctx, lexicon: baseLexicon });
    expect(unknown[0]?.r).not.toBe('フツカヨイ');
  });

  it('aligns dictionary ruby along an inflected surface', () => {
    expect(readAs('気に入らない', '気に入る', 'きにいる')).toBe('きにいらない');
    expect(readAs('来ない', '来る', 'くる')).toBe('こない');
    expect(readAs('気にいった', '気に入る', 'きにいる')).toBe('きにいった');
    expect(readAs('入った', '気に入る', 'きにいる')).toBeUndefined();
  });

  it('flows into furigana: the ruby that fits the settled reading comes first', () => {
    const rubies = new Map([
      [
        '何か',
        [
          { reading: 'なんか', segments: [{ text: '何', ruby: 'なん' }, { text: 'か' }] },
          { reading: 'なにか', segments: [{ text: '何', ruby: 'なに' }, { text: 'か' }] },
        ],
      ],
      [
        '気に入る',
        [
          {
            reading: 'きにいる',
            segments: [{ text: '気', ruby: 'き' }, { text: 'に' }, { text: '入', ruby: 'い' }, { text: 'る' }],
          },
        ],
      ],
    ]);
    const text = 'イクラが気に入ったんだな';
    const liked = run(text).find((group) => group.s === '気に入った') as Group;
    expect(toSlimToken(liked, text, rubies)).toMatchObject({
      r: 'キニイッタ',
      f: [{ t: '気', r: 'き' }, { t: 'に' }, { t: '入', r: 'い' }, { t: 'った' }],
    });
    const something = run('何か理由があるのか')[0] as Group;
    expect(toSlimToken(something, '何か理由があるのか', rubies).f).toEqual([{ t: '何', r: 'なに' }, { t: 'か' }]);
  });
});
