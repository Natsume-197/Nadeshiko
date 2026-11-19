// @vitest-environment happy-dom
import { mount, RouterLinkStub } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

const locale = ref('en');
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale }));
vi.stubGlobal('useLocalePath', () => (path: string) => path);

import SearchWordEntry from './SearchWordEntry.vue';
import type { ShirabeWord } from '~/utils/wordCard';

const sense = (en: string, es: string | null, pos = 'v1') => ({
  position: 0,
  definitions: [{ lang: 'en', text: en }, ...(es ? [{ lang: 'es', text: es }] : [])],
  tags: [{ category: 'partOfSpeech', code: pos, label: 'Ichidan verb' }],
});

const TABERU: ShirabeWord = {
  id: 'jmdict:1358280',
  headword: '食べる',
  reading: 'タベル',
  common: true,
  jlpt: 'N5',
  frequency: 195,
  frequencyByCategory: [
    { category: 'ANIME', rank: 180, perMillion: 900 },
    { category: 'AUDIOBOOK', rank: 1200, perMillion: 90 },
  ],
  pitch: [{ downstep: 2 }],
  furigana: [{ text: '食', ruby: 'た' }, { text: 'べる' }],
  forms: [
    { text: '食べる', script: 'kanji', common: true },
    { text: 'たべる', script: 'kana', common: true },
    { text: '喰べる', script: 'kanji', common: false },
  ],
  entries: [
    {
      dictionary: 'jmdict',
      dictionaryName: 'JMdict',
      senses: Array.from({ length: 8 }, (_, i) => sense(`to eat ${i}`, i === 0 ? 'comer' : null)),
    },
  ],
} as ShirabeWord;

function render(entry: ShirabeWord = TABERU) {
  return mount(SearchWordEntry, {
    props: { entry },
    global: {
      mocks: { $t: (key: string, args?: object) => (args ? `${key}${JSON.stringify(args)}` : key) },
      stubs: { NuxtLink: RouterLinkStub },
    },
  });
}

describe('the word entry above a word search', () => {
  test('furigana over the word, a smaller pitch graph on its line, the reading beside the word only without furigana', () => {
    const wrapper = render();
    expect(wrapper.find('ruby').text()).toBe('食た');
    const graph = wrapper.find('[data-testid="word-entry-pitch"] [data-testid="pitch-graph"]');
    expect(graph.attributes('aria-label')).toBe('タベル [2]');
    // The card's graph, drawn smaller on the word's line.
    expect(Number(graph.attributes('height'))).toBe(40);
    expect(wrapper.find('.word-entry__reading').exists()).toBe(false);

    expect(
      render({ ...TABERU, furigana: [] })
        .find('.word-entry__reading')
        .text(),
    ).toBe('たべる');
  });

  test('the "#N ▾" badge opens the rank in each kind of media, as on the card', async () => {
    const wrapper = render();
    const rank = wrapper.get('[data-testid="word-entry-rank"]');
    expect(rank.text()).toBe('#195 ▾');
    expect(wrapper.find('[data-testid="word-entry-ranks"]').exists()).toBe(false);

    await rank.trigger('click');
    expect(wrapper.findAll('[data-testid="word-entry-ranks"] li').map((li) => li.text())).toEqual([
      'searchContainer.categoryAnime #180',
      'searchContainer.categoryAudiobook #1,200',
    ]);
  });

  test('the words the search can be, as chips on top: links when only named', () => {
    const wrapper = mount(SearchWordEntry, {
      props: {
        entry: { ...TABERU, headword: '橋' } as ShirabeWord,
        others: [
          { headword: '箸', reading: 'ハシ', gloss: 'chopsticks' },
          { headword: '端', reading: 'ハシ', gloss: null },
        ],
      },
      global: { mocks: { $t: (key: string) => key }, stubs: { NuxtLink: RouterLinkStub } },
    });

    const chips = wrapper.findAll('[data-testid="word-entry-other"]');
    expect(chips.map((chip) => chip.find('.word-entry__choice-word').text())).toEqual(['橋', '箸', '端']);
    expect(chips[0]?.attributes('aria-pressed')).toBe('true');
    expect(chips[1]?.findComponent(RouterLinkStub).props('to')).toBe(`/search/${encodeURIComponent('箸')}`);
    expect(render().find('[data-testid="word-entry-others"]').exists()).toBe(false);
  });

  test('a chip with its entry opens that word in place, glossed in English', async () => {
    const hashi = {
      ...TABERU,
      headword: '箸',
      reading: 'ハシ',
      furigana: [],
      entries: [{ dictionary: 'jmdict', dictionaryName: 'JMdict', senses: [sense('chopsticks', null, 'n')] }],
    } as ShirabeWord;
    locale.value = 'es';
    try {
      const wrapper = mount(SearchWordEntry, {
        props: { entry: TABERU, others: [{ headword: '箸', reading: 'ハシ', gloss: 'chopsticks', entry: hashi }] },
        global: {
          mocks: { $t: (key: string) => key },
          stubs: { NuxtLink: RouterLinkStub },
        },
      });
      const chips = wrapper.findAll('[data-testid="word-entry-other"]');
      expect(chips[0]?.find('.word-entry__choice-gloss').text()).toBe('to eat 0');
      expect(chips[1]?.find('.word-entry__choice-gloss').text()).toBe('chopsticks');

      await chips[1]?.trigger('click');
      expect(wrapper.find('.word-entry__word').text()).toBe('箸');
      expect(wrapper.find('[data-testid="word-entry-search"]').exists()).toBe(true);
    } finally {
      locale.value = 'en';
    }
  });

  test('a conjugated search shows what the conjugation does, as the card does ("past")', () => {
    const wrapper = mount(SearchWordEntry, {
      props: { entry: { ...TABERU, inflection: ['negative', 'past'] } as ShirabeWord, inflectedFrom: '食べなかった' },
      global: { mocks: { $t: (key: string) => key }, stubs: { NuxtLink: RouterLinkStub } },
    });

    expect(wrapper.find('[data-testid="word-entry-inflected"]').text()).toBe('negative · past');
    expect(render().find('[data-testid="word-entry-inflected"]').exists()).toBe(false);
  });

  test('the pitch accent sits with the word, before the definitions', () => {
    const html = render().html();

    expect(html.indexOf('data-testid="word-entry-pitch"')).toBeLessThan(html.indexOf('word-entry__sense-body'));
    expect(render().find('[data-testid="word-entry-pitch"]').attributes('title')).toBe('tokenTooltip.pitchAccent');
  });

  test('each kanji with its reading and meaning, and a bare link for one without them', () => {
    const wrapper = mount(SearchWordEntry, {
      props: { entry: TABERU, kanjiInfo: { 食: { reading: 'ショク', meaning: 'eat' } } },
      global: { mocks: { $t: (key: string) => key }, stubs: { NuxtLink: RouterLinkStub } },
    });
    const rows = wrapper.findAll('.word-entry__kanji-row');
    expect(rows.map((row) => row.findAll('a, span').map((part) => part.text()))).toEqual([['食', 'ショク', 'eat']]);
    expect(render().find('.word-entry__kanji-reading').exists()).toBe(false);
    expect(render().find('[data-testid="word-entry-kanji"]').text()).toBe('食');
  });

  test('three senses, then all of them on request', async () => {
    const wrapper = render();
    expect(wrapper.findAll('.word-entry__sense')).toHaveLength(3);

    await wrapper.find('.word-entry__more').trigger('click');
    expect(wrapper.findAll('.word-entry__sense')).toHaveLength(8);
  });

  test('other spellings and the kanji link to their own pages, and no credit line', () => {
    const links = render()
      .findAllComponents(RouterLinkStub)
      .map((link) => link.props('to'));

    expect(links).toContain(`/search/${encodeURIComponent('たべる')}`);
    expect(links).toContain(`/kanji/${encodeURIComponent('食')}`);
    expect(links).not.toContain('/sources');
  });

  test('the words it is made of, as pills under the headword, each its own search', () => {
    const wrapper = render({
      ...TABERU,
      headword: '彼女',
      parts: [
        { text: '彼', lemma: '彼', reading: 'カレ', id: 'jmdict:1' },
        { text: '女', lemma: '女', reading: 'オンナ', id: 'jmdict:2' },
      ],
    } as ShirabeWord);

    const parts = wrapper.findAll('[data-testid="word-entry-part"]');
    expect(parts.map((part) => part.text())).toEqual(['彼', '女']);
    expect(wrapper.find('.word-entry__parts-label').text()).toBe('tokenTooltip.parts');
    // Its kanji, as on the card: boxes of their own, each to its kanji page.
    expect(wrapper.findAll('[data-testid="word-entry-kanji"]').map((link) => link.text())).toEqual(['彼', '女']);
  });

  test('no parts row for a word the dictionary does not split', () => {
    const wrapper = render({ ...TABERU, headword: '彼女', parts: undefined } as ShirabeWord);

    expect(wrapper.find('[data-testid="word-entry-part"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="word-entry-kanji"]').map((link) => link.text())).toEqual(['彼', '女']);
  });

  test('a Spanish page reads the English senses', () => {
    const spanish = (text: string) => ({ position: 0, definitions: [{ lang: 'es', text }], tags: [] });
    const english = (text: string) => ({ position: 0, definitions: [{ lang: 'en', text }], tags: [] });
    const entry = (senses: object[]) =>
      ({ ...TABERU, entries: [{ dictionary: 'jmdict', dictionaryName: 'JMdict', senses }] }) as ShirabeWord;
    const glosses = (word: ShirabeWord) =>
      render(word)
        .findAll('.word-entry__gloss')
        .map((gloss) => gloss.text());

    locale.value = 'es';
    try {
      expect(glosses(entry([spanish('comer'), english('to eat')]))).toEqual(['to eat']);
    } finally {
      locale.value = 'en';
    }
  });
});

describe("the word entry with a reader's own dictionaries", () => {
  const YABAI = {
    ...TABERU,
    id: 'jmdict:yabai',
    headword: 'やばい',
    reading: 'ヤバイ',
    furigana: [],
    forms: [],
    entries: [
      {
        dictionary: 'custom:11',
        dictionaryName: '実用日本語表現辞典',
        senses: [
          {
            position: 0,
            definitions: [
              {
                lang: 'ja',
                text: '危険または不都合な様子。',
                structuredContent: { tag: 'div', content: [{ tag: 'span', content: '危険' }, 'または不都合な様子。'] },
              },
            ],
            tags: [],
          },
        ],
      },
      { dictionary: 'jmdict', dictionaryName: 'JMdict', senses: [sense('dangerous; risky', null, 'adj-i')] },
    ],
  } as unknown as ShirabeWord;

  test('names each dictionary and renders structured content instead of its plain text', () => {
    const wrapper = render(YABAI);
    expect(wrapper.findAll('[data-testid="word-entry-source"]').map((label) => label.text())).toEqual([
      '実用日本語表現辞典',
      'JMdict',
    ]);
    expect(wrapper.find('.yomitan-content span').text()).toBe('危険');
  });

  test('shows one dictionary at a time, switched by its tab, so more dictionaries do not make the entry taller', async () => {
    const wrapper = render(YABAI);
    expect(wrapper.find('[data-testid="word-entry-senses"]').text()).toContain('危険');
    expect(wrapper.find('[data-testid="word-entry-senses"]').text()).not.toContain('dangerous');

    await wrapper.findAll('[data-testid="word-entry-source"]')[1]?.trigger('click');
    expect(wrapper.find('[data-testid="word-entry-senses"]').text()).toContain('dangerous');
    expect(wrapper.find('.yomitan-content').exists()).toBe(false);
  });

  test('cuts a long structured entry until "Show more", and opens it in place', async () => {
    const wrapper = render(YABAI);
    const senses = () => wrapper.find('[data-testid="word-entry-senses"]');
    expect(senses().classes()).toContain('is-clamped');
    expect(wrapper.find('[data-testid="word-entry-more"]').text()).toContain('wordEntry.showMore');

    await wrapper.find('[data-testid="word-entry-more"]').trigger('click');
    expect(senses().classes()).not.toContain('is-clamped');
    expect(wrapper.find('[data-testid="word-entry-more"]').text()).toContain('wordEntry.fewerSenses');
  });

  test('names no dictionary when JMdict answers alone', () => {
    expect(render().find('[data-testid="word-entry-source"]').exists()).toBe(false);
  });

  test("keeps JMdict's English meaning in a homograph chip", () => {
    const other = { ...TABERU, id: 'jmdict:ume', headword: '野梅', reading: 'ヤバイ' } as ShirabeWord;
    const wrapper = mount(SearchWordEntry, {
      props: { entry: YABAI, others: [{ headword: '野梅', reading: 'ヤバイ', gloss: null, entry: other }] },
      global: {
        mocks: { $t: (key: string) => key },
        stubs: { NuxtLink: RouterLinkStub },
      },
    });
    expect(wrapper.find('[data-testid="word-entry-others"]').text()).toContain('dangerous');
  });
});
