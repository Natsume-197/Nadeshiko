import { describe, expect, it, vi } from 'vitest';
import { JOYO_KANJI } from '#shared/data/joyoKanji';

vi.stubGlobal('defineSitemapEventHandler', (fn: unknown) => fn);
vi.stubGlobal('getQuery', (event: { query: Record<string, string> }) => event.query);

const handler = (await import('./kanji')).default as (event: { query: Record<string, string> }) => Array<{
  loc: string;
}>;

describe('the kanji sitemap', () => {
  it('lists the 2,136 jōyō kanji pages, in the requested language', () => {
    const urls = handler({ query: { locale: 'es' } });

    expect([...JOYO_KANJI]).toHaveLength(2136);
    expect(urls).toHaveLength(2136);
    expect(urls[0]?.loc).toBe(`/es/kanji/${[...JOYO_KANJI][0]}`);
  });
});
