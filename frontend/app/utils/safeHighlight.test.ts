import { describe, expect, it } from 'vitest';
import { escapeCorpusText, safeHighlight, segmentTextHtml } from './safeHighlight';

describe('safeHighlight', () => {
  it('escapes raw corpus HTML', () => {
    expect(escapeCorpusText('<em>not a highlight</em> & text')).toBe('&lt;em&gt;not a highlight&lt;/em&gt; &amp; text');
  });

  it('retains only the highlighter markup', () => {
    expect(safeHighlight('<em>match</em><span class="highlight-tail">tail</span>')).toBe(
      '<em>match</em><span class="highlight-tail">tail</span>',
    );
  });

  it('retains the expanded-context tint', () => {
    expect(safeHighlight("<span class='text-cyan-200'>before</span> <em>match</em>")).toBe(
      '<span class="text-cyan-200">before</span> <em>match</em>',
    );
  });

  it('does not retain attributes or other elements masquerading as highlights', () => {
    expect(safeHighlight('<em onclick="alert(1)">x</em><span class="other">y</span>')).toBe(
      '&lt;em onclick=&quot;alert(1)&quot;&gt;x</em>&lt;span class=&quot;other&quot;&gt;y</span>',
    );
  });
});

describe('segmentTextHtml', () => {
  it('prefers the highlight, sanitised', () => {
    expect(segmentTextHtml({ content: 'a match', highlight: 'a <em>match</em>' })).toBe('a <em>match</em>');
  });

  it('falls back to the escaped content', () => {
    expect(segmentTextHtml({ content: '<b>x</b>', highlight: null })).toBe('&lt;b&gt;x&lt;/b&gt;');
  });

  it('renders nothing for a missing text', () => {
    expect(segmentTextHtml(undefined)).toBe('');
  });
});
