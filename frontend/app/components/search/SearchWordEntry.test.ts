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
  test('as on the word card: furigana over the word, the pitch row under the badges, the reading beside the word only without furigana', () => {
    const wrapper = render();
    expect(wrapper.find('ruby').text()).toBe('食た');
    expect(wrapper.find('.word-entry__pitch').text()).toBe('たべる[2]');
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

  test('lists the other words the search can be, each to its own page', () => {
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

    const others = wrapper.findAll('[data-testid="word-entry-other"]');
    expect(others.map((other) => other.text())).toEqual(['箸chopsticks', '端']);
    expect(others[0]?.findComponent(RouterLinkStub).props('to')).toBe(`/search/${encodeURIComponent('箸')}`);
    expect(render().find('[data-testid="word-entry-others"]').exists()).toBe(false);
  });

  test('a conjugated search shows what the conjugation does, as the card does ("past")', () => {
    const wrapper = mount(SearchWordEntry, {
      props: { entry: { ...TABERU, inflection: ['negative', 'past'] } as ShirabeWord, inflectedFrom: '食べなかった' },
      global: { mocks: { $t: (key: string) => key }, stubs: { NuxtLink: RouterLinkStub } },
    });

    expect(wrapper.find('[data-testid="word-entry-inflected"]').text()).toBe('negative · past');
    expect(render().find('[data-testid="word-entry-inflected"]').exists()).toBe(false);
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

  test('a Spanish page reads only the Spanish senses, and English when the word has none', () => {
    // Our dictionary files JMdict's Spanish senses apart from the English ones.
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
      expect(glosses(entry([spanish('comer'), english('to eat')]))).toEqual([expect.stringContaining('comer')]);
      expect(glosses(entry([english('to eat')]))).toEqual([expect.stringContaining('to eat')]);
    } finally {
      locale.value = 'en';
    }
  });
});
