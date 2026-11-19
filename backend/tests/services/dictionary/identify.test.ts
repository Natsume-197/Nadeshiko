import { describe, it, expect, beforeEach } from 'vitest';
import type { JMdictDictionaryMetadata } from '@scriptin/jmdict-simplified-types';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import type { FormInput, ImportEntry, SenseInput } from '@app/services/dictionary/import/entries';
import { importDictionary, importFurigana } from '@app/services/dictionary/import/importDictionary';
import type { Morpheme } from '@app/services/parser/sudachi';
import {
  __testing,
  asciiVariants,
  groupKanjiRuns,
  identifyWord,
  type IdentifyQuery,
  partsOf,
  rowFilter,
  scoreWord,
  stemReading,
  type StoredWord,
  surfaceWord,
} from '@app/services/dictionary/identify';

setupTestSuite();

describe('groupKanjiRuns', () => {
  it('puts one ruby over each run of kanji and leaves kana apart', () => {
    expect(
      groupKanjiRuns([
        { text: '自', ruby: 'じ' },
        { text: '分', ruby: 'ぶん' },
      ]),
    ).toEqual([{ text: '自分', ruby: 'じぶん' }]);
    expect(groupKanjiRuns([{ text: 'お' }, { text: '前', ruby: 'まえ' }])).toEqual([
      { text: 'お' },
      { text: '前', ruby: 'まえ' },
    ]);
    expect(groupKanjiRuns([{ text: '開', ruby: 'ひら' }, { text: 'く' }])).toEqual([
      { text: '開', ruby: 'ひら' },
      { text: 'く' },
    ]);
  });
});

describe('asciiVariants', () => {
  it('spells ASCII full-width and digits as kanji numerals', () => {
    expect(asciiVariants('2人')).toEqual(['２人', '二人']);
    expect(asciiVariants('L')).toEqual(['Ｌ']);
    expect(asciiVariants('人')).toEqual([]);
  });
});

describe('rowFilter', () => {
  it('drops names under a word, keeps homographs of any part of speech, and keeps a name first', () => {
    const word = stored(1, [form(0, 'のか', true)], [sense(['prt'], 'question')]);
    const homograph = stored(2, [form(0, '野', false), form(1, 'の', true)], [sense(['n'], 'field')]);
    const name = stored(5000000, [form(0, '温夏', false)], [sense(['fem'], 'Nonka')], { source: 'jmnedict' });

    expect(rowFilter([word, name, homograph]).map((w) => w.id)).toEqual([1, 2]);
    expect(rowFilter([name, word]).map((w) => w.id)).toEqual([5000000, 1]);
  });
});

describe('stemReading', () => {
  it('reads the kanji stem of a dictionary form and of an inflected surface alike', () => {
    expect(stemReading('開く', 'ひらく')).toBe('ひら');
    expect(stemReading('開いた', 'ヒライタ')).toBe('ひら');
    expect(stemReading('開いて', 'アイテ')).toBe('あ');
  });

  it('gives nothing for a spelling with no kanji', () => {
    expect(stemReading('たべる', 'たべる')).toBe('');
  });
});

// Shapes as `dict.*` stores them, trimmed from JMdict 2026-11-02 (EDRDG, CC BY-SA 4.0).
const form = (idx: number, text: string, kana: boolean, tags: string[] = []) => ({
  idx,
  text,
  kana,
  common: true,
  tags,
  applies_to_kanji: kana ? ['*'] : [],
  active: true,
});
const sense = (pos: string[], gloss: string, misc: string[] = []) => ({
  idx: 0,
  lang: 'eng' as const,
  pos,
  misc,
  field: [],
  dialect: [],
  info: [],
  applies_to_kanji: ['*'],
  applies_to_kana: ['*'],
  glosses: [{ text: gloss, type: null }],
});
const stored = (id: number, forms: StoredWord['forms'], senses: StoredWord['senses'], over: Partial<StoredWord> = {}) =>
  ({ id, source: 'jmdict', common: true, active: true, jlpt: null, forms, senses, ...over }) as StoredWord;

const HIRAKU = stored(1202440, [form(0, '開く', false), form(1, 'ひらく', true)], [sense(['v5k', 'vi'], 'to open')]);
const AKU = stored(1586270, [form(0, '開く', false), form(1, 'あく', true)], [sense(['v5k', 'vi'], 'to open (doors)')]);
const KOTO = stored(1313580, [form(0, '事', false), form(1, 'こと', true)], [sense(['n'], 'thing', ['uk'])]);
const KOTO_HARP = stored(
  1243190,
  [form(0, '琴', false), { ...form(1, 'こと', true), common: false }],
  [sense(['n'], 'koto')],
);

const query = (over: Partial<IdentifyQuery>): IdentifyQuery => ({ lemma: '開く', locale: 'en', ...over });

describe('scoreWord', () => {
  it('tells 開く read ひらく from 開く read あく by the surface reading', () => {
    const asHiraita = query({ surface: '開いた', reading: 'ヒライタ', pos: 'verb' });
    const asAita = query({ surface: '開いた', reading: 'アイタ', pos: 'verb' });

    expect(scoreWord(HIRAKU, asHiraita)).toBeGreaterThan(scoreWord(AKU, asHiraita));
    expect(scoreWord(AKU, asAita)).toBeGreaterThan(scoreWord(HIRAKU, asAita));
  });

  it('prefers a word usually written in kana when the reader met it in kana', () => {
    const kana = query({ lemma: 'こと', surface: 'こと', reading: 'コト', pos: 'noun' });

    expect(scoreWord(KOTO, kana)).toBeGreaterThan(scoreWord(KOTO_HARP, kana));
  });

  it('takes a common kana reading as a sign the kana means that word (うそ is 嘘, not the bullfinch)', () => {
    const lie = stored(1172400, [form(0, '嘘', false), form(1, 'うそ', true)], [sense(['n'], 'lie')]);
    const bird = stored(
      2035960,
      [
        { ...form(0, '鷽', false), common: false },
        { ...form(1, 'うそ', true), common: false },
      ],
      [sense(['n'], 'bullfinch', ['uk'])],
      { common: false },
    );
    const kana = query({ lemma: 'うそ', surface: 'うそ', pos: 'noun' });

    expect(scoreWord(lie, kana)).toBeGreaterThan(scoreWord(bird, kana));
  });

  it('lets corpus frequency decide between homographs nothing else separates', () => {
    const be = stored(1577980, [form(0, '居る', false), form(1, 'いる', true)], [sense(['v1'], 'to be', ['uk'])], {
      frequency: { rank: 19, perMillion: 8000 },
    });
    const need = stored(1546640, [form(0, '要る', false), form(1, 'いる', true)], [sense(['v5r'], 'to need', ['uk'])], {
      frequency: { rank: 1141, perMillion: 60 },
    });
    const kana = query({ lemma: 'いる', surface: 'いる', pos: 'verb' });

    expect(scoreWord(be, kana)).toBeGreaterThan(scoreWord(need, kana));
    // Capped: frequency alone does not outweigh a part of speech that does not fit.
    const noun = stored(9, [form(0, 'いる', true)], [sense(['n'], 'x')], { frequency: { rank: 1, perMillion: 1e6 } });
    expect(scoreWord(need, kana)).toBeGreaterThan(scoreWord(noun, kana));
  });

  it('ranks down a word of the wrong part of speech', () => {
    const verb = stored(1, [form(0, 'はし', true)], [sense(['v5s'], 'to run')]);
    const noun = stored(2, [form(0, 'はし', true)], [sense(['n'], 'bridge')]);

    expect(scoreWord(noun, query({ lemma: 'はし', pos: 'noun' }))).toBeGreaterThan(
      scoreWord(verb, query({ lemma: 'はし', pos: 'noun' })),
    );
  });

  it('ranks down names and search-only spellings', () => {
    const name = stored(5000000, [form(0, '開く', false)], [sense(['given'], 'Hiraku')], { source: 'jmnedict' });
    const searchOnly = stored(3, [form(0, '開く', false, ['sK']), form(1, 'ひらく', true)], [sense(['v5k'], 'x')]);

    expect(scoreWord(HIRAKU, query({}))).toBeGreaterThan(scoreWord(name, query({})));
    expect(scoreWord(HIRAKU, query({}))).toBeGreaterThan(scoreWord(searchOnly, query({})));
  });

  it('knows every short POS tag the stored tokens use', () => {
    const tags = ['noun', 'verb', 'adj', 'adv', 'prt', 'aux', 'pron', 'det', 'conj', 'intj', 'pref', 'suf', 'exp'];
    expect(Object.keys(__testing.POS_FAMILIES).sort()).toEqual(tags.sort());
  });
});

describe('identifyWord', () => {
  const META: JMdictDictionaryMetadata = {
    version: '3.6.2',
    languages: ['all'],
    commonOnly: false,
    dictDate: '2026-11-02',
    dictRevisions: ['1.09'],
    tags: {
      v5k: 'Godan verb with ‘ku’ ending',
      n: 'noun (common) (futsuumeishi)',
      uk: 'usually written using kana alone',
      vs: 'suru verb',
    },
  };
  const kanji = (text: string, tags: string[] = []): FormInput => ({
    text,
    kana: false,
    common: true,
    tags,
    appliesToKanji: [],
  });
  const kana = (text: string): FormInput => ({ text, kana: true, common: true, tags: [], appliesToKanji: ['*'] });
  const meaning = (lang: 'eng', text: string, pos: string[], misc: string[] = []): SenseInput => ({
    lang,
    pos,
    misc,
    field: [],
    dialect: [],
    info: [],
    appliesToKanji: ['*'],
    appliesToKana: ['*'],
    related: [],
    antonym: [],
    glosses: [{ text, type: null }],
  });
  const entry = (id: number, forms: FormInput[], senses: SenseInput[]): ImportEntry => ({
    id,
    source: 'jmdict',
    common: true,
    forms,
    senses,
  });

  async function* iterate<T>(items: T[]): AsyncGenerator<T> {
    yield* items;
  }

  beforeEach(async () => {
    __testing.resetTagCache();
    await importDictionary(
      TestDataSource,
      'jmdict',
      iterate([
        entry(1202440, [kanji('開く'), kana('ひらく')], [meaning('eng', 'to open', ['v5k'])]),
        entry(1586270, [kanji('開く'), kanji('空く'), kana('あく')], [meaning('eng', 'to open (doors)', ['v5k'])]),
        entry(1313580, [kanji('事'), kana('こと')], [meaning('eng', 'thing', ['n'], ['uk'])]),
      ]),
      () => META,
    );
    await importFurigana(
      TestDataSource,
      'jmdict-furigana',
      '2.3.1',
      iterate([{ text: '開く', reading: 'ひらく', furigana: [{ ruby: '開', rt: 'ひら' }, { ruby: 'く' }] }]),
    );
  });

  it('answers in the word card’s shape, best candidate first', async () => {
    const [best, next] = await identifyWord(TestDataSource, {
      lemma: '開く',
      surface: '開いた',
      reading: 'ヒライタ',
      pos: 'verb',
      locale: 'en',
    });

    expect(best).toEqual({
      id: 'jmdict:1202440',
      headword: '開く',
      reading: 'ヒラク',
      common: true,
      name: false,
      sourceId: '1202440',
      dictionary: 'jmdict',
      jlpt: null,
      frequency: null,
      furigana: [{ text: '開', ruby: 'ひら' }, { text: 'く' }],
      forms: [
        { text: 'ひらく', script: 'kana', common: true },
        { text: '開く', script: 'kanji', common: true },
      ],
      entries: [
        {
          dictionary: 'jmdict',
          dictionaryName: 'JMdict',
          senses: [
            {
              position: 0,
              definitions: [{ lang: 'en', text: 'to open' }],
              tags: [{ category: 'partOfSpeech', code: 'v5k', label: 'Godan verb with ‘ku’ ending' }],
            },
          ],
        },
      ],
    });
    expect(next?.reading).toBe('アク');
  });

  it('finds the dictionary form of an inflected form nothing is filed under, and says so', async () => {
    const found = await identifyWord(TestDataSource, { lemma: '開いた', locale: 'en' });

    expect(found.map((candidate) => candidate.headword)).toContain('開く');
    expect(found.every((candidate) => candidate.baseForm === true)).toBe(true);
    // With the card's inflection labels for what the conjugation does.
    expect(found.find((candidate) => candidate.headword === '開く')?.inflection).toEqual(['past']);
    // A word found directly is never marked.
    const [direct] = await identifyWord(TestDataSource, { lemma: '開く', locale: 'en' });
    expect(direct?.baseForm).toBeUndefined();
  });

  it('puts the reader’s language first', async () => {
    const [best] = await identifyWord(TestDataSource, { lemma: '開く', reading: 'ヒラク', locale: 'es' });

    expect(best?.entries[0]?.senses.map((s) => s.definitions[0]?.lang)).toEqual(['es', 'en']);
  });

  it('shows a word usually written in kana in kana when met in kana', async () => {
    const [best] = await identifyWord(TestDataSource, { lemma: '事', surface: 'こと', reading: 'コト', locale: 'en' });

    expect(best).toMatchObject({ headword: 'こと', reading: 'コト', furigana: [{ text: 'こと' }] });
  });

  it('shows a word usually written in kana in kana even when met in kanji, as Shirabe does', async () => {
    const [best] = await identifyWord(TestDataSource, { lemma: '事', surface: '事', reading: 'コト', locale: 'en' });

    expect(best).toMatchObject({ headword: 'こと', reading: 'コト' });
  });

  it('shows first a common word spelled like the whole surface', async () => {
    await importDictionary(
      TestDataSource,
      'jmdict',
      iterate([
        entry(2089020, [kana('だ')], [meaning('eng', 'be', ['cop'])]),
        entry(2819970, [kana('だった')], [meaning('eng', 'was', ['exp'])]),
        { ...entry(2424740, [kana('して')], [meaning('eng', 'by means of', ['prt'])]), common: false },
        entry(1157170, [kanji('為る'), kana('する')], [meaning('eng', 'to do', ['vs-i'], ['uk'])]),
      ]),
      () => META,
    );

    const [was] = await identifyWord(TestDataSource, {
      lemma: 'だ',
      surface: 'だった',
      reading: 'ダッタ',
      pos: 'aux',
      locale: 'en',
    });
    expect(was?.sourceId).toBe('2819970');
    // A rare entry spelled like an inflection does not take the card from the verb.
    const [doing] = await identifyWord(TestDataSource, {
      lemma: 'する',
      surface: 'して',
      reading: 'シテ',
      pos: 'verb',
      locale: 'en',
    });
    expect(doing?.sourceId).toBe('1157170');
  });

  it('never lets a particle take an inflection, common or not (で of だ, し of する)', () => {
    const particle = stored(
      2028980,
      [form(0, 'で', true)],
      [sense(['prt'], 'at'), { ...sense(['conj'], 'so'), idx: 1 }],
    );
    expect(
      surfaceWord([particle], { lemma: 'だ', surface: 'で', reading: 'デ', pos: 'aux', locale: 'en' }),
    ).toBeUndefined();
    const was = stored(2819970, [form(0, 'だった', true)], [sense(['exp'], 'was')]);
    expect(surfaceWord([was], { lemma: 'だ', surface: 'だった', reading: 'ダッタ', pos: 'aux', locale: 'en' })).toBe(
      was,
    );
  });

  it('lists the words a compound is made of, content words only, each resolved to one of ours', async () => {
    await importDictionary(
      TestDataSource,
      'jmdict',
      iterate([
        entry(1300000, [kanji('捜査'), kana('そうさ')], [meaning('eng', 'investigation', ['n'])]),
        entry(1300001, [kanji('本部'), kana('ほんぶ')], [meaning('eng', 'headquarters', ['n'])]),
      ]),
      () => META,
    );
    const m = (s: string, b: number, pos: string[]) => ({
      s,
      b,
      e: b + s.length,
      pos: [...pos, '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'],
      d: s,
      n: s,
      r: s === '捜査' ? 'ソウサ' : s === '本部' ? 'ホンブ' : 'カ',
      a: [],
    });
    const split = async (texts: string[]) =>
      texts.map((text) =>
        text === '捜査本部'
          ? [m('捜査', 0, ['名詞', '普通名詞']), m('本部', 2, ['名詞', '普通名詞'])]
          : text === '捜査か'
            ? [m('捜査', 0, ['名詞', '普通名詞']), m('か', 2, ['助詞', '終助詞'])]
            : [],
      );

    const [compound, withParticle, single] = await partsOf(TestDataSource, ['捜査本部', '捜査か', '開く'], split);

    expect(compound).toEqual([
      { text: '捜査', lemma: '捜査', reading: 'ソウサ', id: 'jmdict:1300000' },
      { text: '本部', lemma: '本部', reading: 'ホンブ', id: 'jmdict:1300001' },
    ]);
    // Grammar is not a part, and one content word is no compound.
    expect(withParticle).toBeNull();
    expect(single).toBeNull();
  });

  it('offers the other words the surface may inflect, after its own (分かった: 分かつ)', async () => {
    await importDictionary(
      TestDataSource,
      'jmdict',
      iterate([
        entry(1606560, [kanji('分かる'), kana('わかる')], [meaning('eng', 'to understand', ['v5r'], ['uk'])]),
        entry(1606570, [kanji('分かつ'), kana('わかつ')], [meaning('eng', 'to divide', ['v5t'])]),
        entry(1500000, [kanji('分かう'), kana('わかう')], [meaning('eng', 'not a verb', ['n'])]),
      ]),
      () => META,
    );

    const found = await identifyWord(TestDataSource, {
      lemma: '分かる',
      surface: '分かった',
      reading: 'ワカッタ',
      pos: 'verb',
      locale: 'en',
    });

    // 分かう is a form the deconjugator reaches, but the dictionary's 分かう is not a v5u verb.
    expect(found.map((candidate) => candidate.sourceId)).toEqual(['1606560', '1606570']);
  });

  it('does not deconjugate a word that does not inflect into a slang chain (そんな is not 剃る)', async () => {
    await importDictionary(
      TestDataSource,
      'jmdict',
      iterate([
        entry(1007130, [kana('そんな')], [meaning('eng', 'such', ['adj-pn'])]),
        entry(1398880, [kanji('剃る'), kana('そる')], [meaning('eng', 'to shave', ['v5r'])]),
      ]),
      () => META,
    );

    const found = await identifyWord(TestDataSource, { lemma: 'そんな', surface: 'そんな', pos: 'det', locale: 'en' });

    expect(found.map((candidate) => candidate.sourceId)).toEqual(['1007130']);
  });

  it('goes without parts when the sidecar cannot be reached', async () => {
    const failing = async () => {
      throw new Error('ECONNREFUSED');
    };

    expect(await partsOf(TestDataSource, ['捜査本部'], failing)).toEqual([null]);
  });

  it('finds a word by its surface when Sudachi’s lemma is unknown', async () => {
    const [best] = await identifyWord(TestDataSource, { lemma: '開くぅ', surface: 'あく', locale: 'en' });

    expect(best?.sourceId).toBe('1586270');
  });

  it('answers nothing for a word it does not have', async () => {
    expect(await identifyWord(TestDataSource, { lemma: 'ドラミちゃん', locale: 'en' })).toEqual([]);
  });

  it('carries the pitch of its headword and reading', async () => {
    await TestDataSource.query(
      `INSERT INTO dict.pitch (text, reading, downsteps) VALUES ('開く', 'ひらく', '{2}'), ('開く', 'あく', '{0}')`,
    );

    const [best, next] = await identifyWord(TestDataSource, { lemma: '開く', reading: 'ヒラク', locale: 'en' });

    expect(best?.pitch).toEqual([{ downstep: 2 }]);
    expect(next?.pitch).toEqual([{ downstep: 0 }]);
  });

  it('takes UniDic’s pitch where Kanjium has the same spelling and reading, and Kanjium’s where UniDic has none', async () => {
    await TestDataSource.query(
      `INSERT INTO dict.pitch (text, reading, downsteps, source) VALUES
         ('開く', 'ひらく', '{2}', 'unidic'), ('開く', 'ひらく', '{0}', 'kanjium'), ('開く', 'あく', '{1}', 'kanjium')`,
    );

    const [best, next] = await identifyWord(TestDataSource, { lemma: '開く', reading: 'ヒラク', locale: 'en' });

    expect(best?.pitch).toEqual([{ downstep: 2 }]);
    expect(next?.pitch).toEqual([{ downstep: 1 }]);
  });

  it('finds the pitch of a kana headword under its kanji spelling', async () => {
    await TestDataSource.query(`INSERT INTO dict.pitch (text, reading, downsteps) VALUES ('事', 'こと', '{2}')`);

    const [best] = await identifyWord(TestDataSource, { lemma: 'こと', surface: 'こと', locale: 'en' });

    expect(best).toMatchObject({ headword: 'こと', pitch: [{ downstep: 2 }] });
  });
});
