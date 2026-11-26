// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, test, expect, vi } from 'vitest';
import { ref } from 'vue';

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale: ref('en') }));
const $fetch = vi.fn();
vi.stubGlobal('$fetch', $fetch);

import WordCardKanji from './WordCardKanji.vue';
import { __kanjiLookupTesting, type KanjiCardData } from '~/utils/kanjiLookup';
import { setReaderStack } from '~/utils/wordLookup';

const word = (i: number) => ({ id: `jmdict:${i}`, headword: `食${i}`, reading: null, frequency: i, gloss: null });
const related = (character: string, grade: number | null) => ({ character, reading: null, meaning: null, grade });

const CARD: KanjiCardData = {
  character: '食',
  strokeCount: 9,
  grade: 2,
  frequency: 328,
  corpusRank: null,
  jlpt: 5,
  kanken: '9級',
  radical: { glyph: '⾷', number: 184, reading: 'しょく', meaning: 'food, to eat', character: '食' },
  readings: [],
  meanings: ['eat', 'food'],
  meaningsLanguage: 'en',
  components: [],
  strokes: [],
  strokeNumbers: [],
  words: Array.from({ length: 20 }, (_, i) => word(i)),
  sameRadical: [
    related('館', 3),
    related('飯', 4),
    related('餅', 8),
    related('飴', 9),
    ...Array.from({ length: 30 }, (_, i) => related(String.fromCodePoint(0x4e00 + i), null)),
  ],
  sameRadicalCount: 34,
  containedIn: [],
  containedInCount: 0,
};

function render(full: boolean) {
  return mount(WordCardKanji, {
    props: { kanji: '食', card: CARD, state: 'shown', locale: 'en', full },
    global: { mocks: { $t: (key: string) => key }, stubs: { UiBaseIcon: true } },
  });
}

describe('the kanji view', () => {
  test('shows the Kanken level as the exam writes it, beside JLPT', () => {
    const badges = render(false)
      .findAll('.kanji-view__badge')
      .map((badge) => badge.text());

    expect(badges.slice(0, 2)).toEqual(['N5', '漢検 9級']);
  });

  test('on the card: a few words and a short related row ending in a link to the page', async () => {
    const wrapper = render(false);

    expect(wrapper.findAll('[data-testid="kanji-word"]')).toHaveLength(6);
    expect(wrapper.findAll('[data-testid="kanji-same-radical"] .kanji-view__related-kanji')).toHaveLength(12);

    await wrapper.find('[data-testid="kanji-related-more"]').trigger('click');
    expect(wrapper.emitted('open-page')).toHaveLength(1);
  });

  test('on its own page: every word, and every related kanji split into jōyō, names and others', () => {
    const wrapper = render(true);

    expect(wrapper.findAll('[data-testid="kanji-word"]')).toHaveLength(20);
    expect(wrapper.find('[data-testid="kanji-more-words"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="kanji-related-more"]').exists()).toBe(false);
    expect(
      wrapper
        .findAll('[data-testid="kanji-same-radical"] .kanji-view__related-group > .kanji-view__note')
        .map((n) => n.text()),
    ).toEqual(['tokenTooltip.kanjiJoyo (3)', 'tokenTooltip.kanjiJinmeiyo (1)', 'tokenTooltip.kanjiOther (30)']);
  });

  test('on the page, the rare kanji show one row and open the rest', async () => {
    const wrapper = render(true);
    const others = () => wrapper.findAll('.kanji-view__related-group').at(2)!.findAll('.kanji-view__related-kanji');

    expect(others()).toHaveLength(12);
    const toggle = wrapper.find('[data-testid="kanji-group-toggle"]');
    expect(toggle.text()).toBe('+18');

    await toggle.trigger('click');
    expect(others()).toHaveLength(30);
  });

  test('the page draws the entry and the related kanji apart, around its own header and words', () => {
    const part = (which: 'entry' | 'related') =>
      mount(WordCardKanji, {
        props: { kanji: '食', card: CARD, state: 'shown', locale: 'en', full: true, part: which },
        global: { mocks: { $t: (key: string) => key }, stubs: { UiBaseIcon: true } },
      });

    const entry = part('entry');
    expect(entry.find('.kanji-view__hero').exists()).toBe(false);
    expect(entry.find('[data-testid="kanji-word"]').exists()).toBe(false);
    expect(entry.find('[data-testid="kanji-radical"]').exists()).toBe(true);
    expect(entry.find('[data-testid="kanji-same-radical"]').exists()).toBe(false);

    const related = part('related');
    expect(related.find('[data-testid="kanji-radical"]').exists()).toBe(false);
    expect(related.find('[data-testid="kanji-same-radical"]').exists()).toBe(true);
  });
});

describe("the reader's own kanji dictionaries", () => {
  const CUSTOM = {
    entries: [
      {
        dictionary: 'custom:1',
        dictionaryName: 'KANJIDIC',
        onyomi: ['ショク', 'ジキ'],
        kunyomi: ['く.う', 'た.べる'],
        meanings: ['eat', 'food'],
        tags: [{ category: 'misc', code: 'jouyou', label: 'Jōyō kanji' }],
        stats: [
          { code: 'strokes', label: 'Stroke count', category: 'misc', value: '9' },
          { code: 'heisig', label: 'Heisig index', category: 'index', value: '1472' },
        ],
      },
      {
        dictionary: 'custom:2',
        dictionaryName: '漢和',
        tags: [],
        senses: [{ position: 0, definitions: [{ lang: 'ja' as const, text: '【食】 ９画' }], tags: [] }],
      },
    ],
    frequencies: [{ dictionary: 'custom:3', dictionaryName: 'Aozora', value: 120, displayValue: '120' }],
  };

  async function renderWith(full: boolean) {
    setReaderStack('fp');
    $fetch.mockResolvedValue(CUSTOM);
    const wrapper = mount(WordCardKanji, {
      props: { kanji: '食', card: CARD, state: 'shown', locale: 'en', full },
      global: { mocks: { $t: (key: string) => key }, stubs: { UiBaseIcon: true } },
    });
    await flushPromises();
    setReaderStack(null);
    return wrapper;
  }

  beforeEach(() => {
    $fetch.mockReset();
    __kanjiLookupTesting.clear();
  });

  test('shows each dictionary under its name, its frequencies first, indexes behind a "+N"', async () => {
    const card = await renderWith(false);
    const section = card.find('[data-testid="kanji-custom"]');
    expect(section.exists()).toBe(true);
    expect(section.find('.kanji-view__custom-freq').text()).toBe('Aozora: 120');
    const entries = card.findAll('[data-testid="kanji-custom-entry"]');
    expect(entries.map((e) => e.find('.kanji-view__heading').text())).toEqual(['KANJIDIC', '漢和']);
    expect(entries[0]!.text()).toContain('ショク、ジキ');
    expect(entries[0]!.find('.kanji-view__custom-meanings.is-inline').text()).toBe('eat, food');
    expect(entries[0]!.text()).toContain('Stroke count: 9');
    expect(entries[0]!.text()).not.toContain('Heisig');

    const more = entries[0]!.find('[data-testid="kanji-custom-stats-more"]');
    expect(more.text()).toBe('+1');
    await more.trigger('click');
    expect(entries[0]!.text()).toContain('Heisig index: 1472');

    expect(entries[1]!.find('.kanji-view__article.is-clamped').exists()).toBe(true);
    await entries[1]!.find('.kanji-view__more').trigger('click');
    expect(entries[1]!.find('.kanji-view__article.is-clamped').exists()).toBe(false);

    const page = await renderWith(true);
    expect(page.find('.kanji-view__article.is-clamped').exists()).toBe(false);
  });

  test('draws nothing for a reader without custom dictionaries', async () => {
    const wrapper = render(false);
    await flushPromises();
    expect(wrapper.find('[data-testid="kanji-custom"]').exists()).toBe(false);
    expect($fetch).not.toHaveBeenCalled();
  });
});
