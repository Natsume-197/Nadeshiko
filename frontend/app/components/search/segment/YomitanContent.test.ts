// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import YomitanContent from './YomitanContent.vue';
import { candidateSummary, cardSenses, glossPreference, type ShirabeWord } from '~/utils/wordCard';

describe('YomitanContent & custom dictionary card senses', () => {
  it('renders nested structured-content safely and drops unsafe hrefs', () => {
    const wrapper = mount(YomitanContent, {
      props: {
        content: [
          {
            tag: 'div',
            style: { fontWeight: 'bold' },
            content: [
              { tag: 'ruby', content: ['食', { tag: 'rt', content: 'た' }] },
              'べる',
              { tag: 'br' },
              { tag: 'a', href: 'https://example.com', content: 'ref' },
              { tag: 'a', href: 'javascript:alert(1)', content: 'blocked' },
            ],
          },
        ],
      },
    });

    expect(wrapper.find('ruby rt').text()).toBe('た');
    const links = wrapper.findAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]?.attributes('href')).toBe('https://example.com');
    expect(links[0]?.attributes('rel')).toBe('noopener noreferrer');
    expect(links[1]?.attributes('href')).toBeUndefined();
  });

  it("turns Yomitan's ?query= cross-references into searches on Nadeshiko", () => {
    const wrapper = mount(YomitanContent, {
      props: {
        content: [
          '→',
          { tag: 'a', href: '?query=%E8%A6%8B%E3%82%8B&wildcards=off', content: '見る' },
          { tag: 'a', href: '?query=', content: 'empty' },
        ],
      },
    });

    const links = wrapper.findAll('a');
    expect(links[0]?.attributes('href')).toBe(`/search/${encodeURIComponent('見る')}`);
    expect(links[0]?.attributes('target')).toBeUndefined();
    expect(links[1]?.attributes('href')).toBeUndefined();
  });

  it('keeps table structure, data attributes and a details element open', () => {
    const wrapper = mount(YomitanContent, {
      props: {
        content: {
          tag: 'div',
          data: { content: 'glossary' },
          content: [
            { tag: 'table', content: { tag: 'tr', content: [{ tag: 'td', colSpan: 2, content: '活用' }] } },
            { tag: 'details', open: true, content: [{ tag: 'summary', content: '用例' }, '食べよう'] },
            { tag: 'script', content: 'alert(1)' } as never,
          ],
        },
      },
    });

    expect(wrapper.find('[data-content="glossary"]').exists()).toBe(true);
    expect(wrapper.find('table > tr > td').attributes('colspan')).toBe('2');
    expect(wrapper.find('details').attributes('open')).toBeDefined();
    expect(wrapper.find('script').exists()).toBe(false);
  });

  it('preserves structuredContent on CardGlossRow while keeping plain text for summaries', () => {
    const word: ShirabeWord = {
      id: 'jmdict:1358280',
      headword: '食べる',
      reading: 'たべる',
      entries: [
        {
          dictionary: 'custom:1',
          dictionaryName: '明鏡国語辞典 第二版',
          senses: [
            {
              position: 0,
              definitions: [
                {
                  lang: 'ja',
                  text: '固形の食物をかんで飲み込む。',
                  structuredContent: { tag: 'div', content: '固形の食物をかんで飲み込む。' },
                },
              ],
              tags: [],
            },
          ],
        },
        {
          dictionary: 'jmdict',
          dictionaryName: 'JMdict',
          senses: [
            {
              position: 0,
              definitions: [{ lang: 'en', text: 'to eat' }],
              tags: [],
            },
          ],
        },
      ],
    };

    const pref = glossPreference('en', { en: 'show', es: 'show' }, ['en']);
    const senses = cardSenses(word, pref);

    expect(senses).toHaveLength(2);
    expect(senses[0]?.dictionary).toBe('明鏡国語辞典 第二版');
    expect(senses[0]?.glosses[0]?.structuredContent).toEqual({
      tag: 'div',
      content: '固形の食物をかんで飲み込む。',
    });
    expect(senses[1]?.dictionary).toBe('JMdict');
    expect(senses[1]?.glosses[0]?.text).toBe('to eat');
    expect(candidateSummary(word, pref)).toBe('固形の食物をかんで飲み込む。');
  });
});

describe("a monolingual entry's structure kept in its text", () => {
  const MEIKYO = [
    'か‐の‐じょ【彼女】',
    { tag: 'span', content: '(━ヂョ)', style: { fontSize: '65%' } },
    '\n 〘代〙\n❶ 〚三人称の人代名詞〛話し手・聞き手以外の女性を指し示す語。\n「それは━の本だ」\n❷ 〔俗〕相手の女性。\n⇔',
    { tag: 'a', content: '彼氏', href: '?query=彼氏&wildcards=off' },
  ];

  it('draws one line per part, each styled by what it is', () => {
    const wrapper = mount(YomitanContent, { props: { content: MEIKYO } });
    const lines = wrapper.findAll('.yc-line');
    expect(lines.map((line) => line.classes().filter((name) => name.startsWith('is-')))).toEqual([
      ['is-headline'],
      [],
      ['is-sense'],
      ['is-example'],
      ['is-sense'],
      ['is-ref'],
    ]);
    expect(wrapper.findAll('.yc-marker').map((marker) => marker.text())).toEqual(['❶', '❷']);
    expect(wrapper.findAll('.yc-label').map((label) => label.text())).toEqual([
      '〘代〙',
      '〚三人称の人代名詞〛',
      '〔俗〕',
    ]);
    // The cross-reference stays a search link on its line.
    expect(lines[5]?.find('a').attributes('href')).toBe(`/search/${encodeURIComponent('彼氏')}`);
  });

  it('leaves content that is already in blocks as the dictionary built it', () => {
    const wrapper = mount(YomitanContent, {
      props: { content: [{ tag: 'div', content: '危険な様子。' }, '\n', { tag: 'div', content: '「やばい」' }] },
    });
    expect(wrapper.find('.yc-line').exists()).toBe(false);
    expect(wrapper.findAll('.yomitan-content > div')).toHaveLength(2);
  });
});
