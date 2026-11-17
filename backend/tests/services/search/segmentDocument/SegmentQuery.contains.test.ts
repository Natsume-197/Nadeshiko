import { describe, expect, it } from 'vitest';
import { SegmentQuery, resolveMatchMode } from '@app/services/search/segmentDocument/SegmentQuery';
import type { SearchFiltersOutput } from 'generated/outputTypes';

const filters = { status: ['ACTIVE'], category: ['ANIME'] } as unknown as SearchFiltersOutput;

const LENGTH_GAUSS = [{ gauss: { characterCount: { origin: 27, offset: 10, scale: 15, decay: 0.5 } } }];

function mustFor(query: Record<string, unknown>, extraFilters: Partial<SearchFiltersOutput> = {}) {
  return SegmentQuery.buildSearchMust({ query, filters: { ...filters, ...extraFilters } } as never, 'strict').must;
}

describe('resolveMatchMode', () => {
  it('defaults to word search', () => {
    expect(resolveMatchMode(undefined)).toBe('WORD');
    expect(resolveMatchMode({})).toBe('WORD');
  });

  it('maps the legacy exactMatch flag', () => {
    expect(resolveMatchMode({ exactMatch: true })).toBe('EXACT');
    expect(resolveMatchMode({ exactMatch: false })).toBe('WORD');
  });

  it('lets matchMode win over exactMatch', () => {
    expect(resolveMatchMode({ exactMatch: true, matchMode: 'CONTAINS' })).toBe('CONTAINS');
    expect(resolveMatchMode({ exactMatch: true, matchMode: 'WORD' })).toBe('WORD');
  });
});

describe('SegmentQuery.buildSearchMust in CONTAINS mode', () => {
  it('wraps a single wildcard on the Japanese surface field in the length scoring', () => {
    expect(mustFor({ search: '糊', matchMode: 'CONTAINS' })).toEqual([
      {
        function_score: {
          query: { wildcard: { textJa: { value: '*糊*' } } },
          functions: LENGTH_GAUSS,
          score_mode: 'sum',
          boost_mode: 'multiply',
        },
      },
    ]);
  });

  it('skips the length scoring when the reader set a length range', () => {
    expect(mustFor({ search: '糊', matchMode: 'CONTAINS' }, { segmentLengthChars: { min: 5 } } as never)).toEqual([
      { wildcard: { textJa: { value: '*糊*' } } },
    ]);
  });

  it('requires every space-separated term, dropping quotes', () => {
    expect(
      mustFor({ search: '"糊"  血 ', matchMode: 'CONTAINS' }, { segmentLengthChars: { min: 1 } } as never),
    ).toEqual([
      {
        bool: {
          must: [{ wildcard: { textJa: { value: '*糊*' } } }, { wildcard: { textJa: { value: '*血*' } } }],
        },
      },
    ]);
  });

  it('escapes the reader wildcard characters and backslash', () => {
    expect(mustFor({ search: 'a*b?c\\d', matchMode: 'CONTAINS' }, { segmentLengthChars: { min: 1 } } as never)).toEqual(
      [{ wildcard: { textJa: { value: '*a\\*b\\?c\\\\d*' } } }],
    );
  });

  it('applies NFKC like the index analyzer (half-width katakana, full-width digits)', () => {
    expect(mustFor({ search: 'ﾉﾘ１', matchMode: 'CONTAINS' }, { segmentLengthChars: { min: 1 } } as never)).toEqual([
      { wildcard: { textJa: { value: '*ノリ1*' } } },
    ]);
  });

  it('keeps leading-minus exclusions as word searches ahead of the contains clause', () => {
    const must = mustFor({ search: '糊 -血糊', matchMode: 'CONTAINS' }, { segmentLengthChars: { min: 1 } } as never);
    expect(must).toHaveLength(2);
    expect(JSON.stringify(must[0])).toContain('must_not');
    expect(JSON.stringify(must[0])).toContain('血糊');
    expect(must[1]).toEqual({ wildcard: { textJa: { value: '*糊*' } } });
  });

  it('matches nothing when only quotes are left', () => {
    expect(mustFor({ search: '""', matchMode: 'CONTAINS' }, { segmentLengthChars: { min: 1 } } as never)).toEqual([
      { match_none: {} },
    ]);
  });

  it('does not change word search', () => {
    const word = mustFor({ search: '糊' });
    expect(mustFor({ search: '糊', matchMode: 'WORD' })).toEqual(word);
    expect(JSON.stringify(word)).not.toContain('"wildcard":');
  });
});

describe('a leading-wildcard Japanese query (`*憬*`)', () => {
  const ranged = { segmentLengthChars: { min: 1 } } as never;

  it.each([
    ['*憬*', ['*憬*']],
    ['*憬', ['*憬*']],
    ['**憬**', ['*憬*']],
    ['＊憬＊', ['*憬*']],
    ['*憬* *血*', ['*憬*', '*血*']],
  ])('reads %s in word search as contains', (search, values) => {
    const wildcards = values.map((value) => ({ wildcard: { textJa: { value } } }));
    expect(mustFor({ search }, ranged)).toEqual([
      wildcards.length === 1 ? wildcards[0] : { bool: { must: wildcards } },
    ]);
  });

  it('drops the end stars in contains mode too, but keeps inner ones literal', () => {
    expect(mustFor({ search: '*憬*', matchMode: 'CONTAINS' }, ranged)).toEqual([
      { wildcard: { textJa: { value: '*憬*' } } },
    ]);
    expect(mustFor({ search: '*憧*憬*', matchMode: 'CONTAINS' }, ranged)).toEqual([
      { wildcard: { textJa: { value: '*憧\\*憬*' } } },
    ]);
  });

  it.each([
    ['憬*', 'a trailing wildcard, which word search already supports'],
    ['*cat*', 'no Japanese text'],
    ['*憬* 好き', 'a plain word next to it'],
    ['*憬?', 'a `?` wildcard'],
  ])('leaves %s to word search (%s)', (search) => {
    expect(JSON.stringify(mustFor({ search }, ranged))).not.toContain('"wildcard":');
  });

  it('keeps it a word search in exact mode', () => {
    expect(JSON.stringify(mustFor({ search: '*憬*', exactMatch: true }, ranged))).not.toContain('"wildcard":');
  });

  it('keeps exclusions next to it', () => {
    const must = mustFor({ search: '*憬* -憧憬' }, ranged);
    expect(must).toHaveLength(2);
    expect(JSON.stringify(must[0])).toContain('must_not');
    expect(must[1]).toEqual({ wildcard: { textJa: { value: '*憬*' } } });
  });
});

describe('SegmentQuery.buildSearchStatsCacheKey match mode', () => {
  const key = (query: Record<string, unknown>) =>
    SegmentQuery.buildSearchStatsCacheKey({ query, filters } as never, 'strict');

  it('separates contains from word and exact', () => {
    const contains = key({ search: '糊', matchMode: 'CONTAINS' });
    expect(contains).not.toBe(key({ search: '糊' }));
    expect(contains).not.toBe(key({ search: '糊', exactMatch: true }));
  });

  it('shares a key between exactMatch and matchMode EXACT', () => {
    expect(key({ search: '糊', exactMatch: true })).toBe(key({ search: '糊', matchMode: 'EXACT' }));
    expect(key({ search: '糊' })).toBe(key({ search: '糊', matchMode: 'WORD' }));
  });
});

describe('SegmentQuery.buildTermQuery (batch word search)', () => {
  it('counts inside words in contains mode and for a leading-wildcard word', () => {
    expect(SegmentQuery.buildTermQuery('憬', 'CONTAINS', 'strict')).toEqual({
      wildcard: { textJa: { value: '*憬*' } },
    });
    expect(SegmentQuery.buildTermQuery('*憬*', 'WORD', 'strict')).toEqual({ wildcard: { textJa: { value: '*憬*' } } });
  });

  it('keeps the multi-language word and exact queries otherwise', () => {
    expect(SegmentQuery.buildTermQuery('憬', 'WORD', 'strict')).toEqual(
      SegmentQuery.buildMultiLanguage('憬', false, 'strict'),
    );
    expect(SegmentQuery.buildTermQuery('憬', 'EXACT', 'strict')).toEqual(
      SegmentQuery.buildMultiLanguage('憬', true, 'strict'),
    );
  });
});
