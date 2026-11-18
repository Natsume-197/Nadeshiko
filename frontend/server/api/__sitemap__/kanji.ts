import type { SitemapUrlInput } from '#sitemap/types';
import { JOYO_KANJI } from '#shared/data/joyoKanji';
import { getSitemapLocale, localizeSitemapPath } from './utils';

// The kanji pages worth indexing: the 2,136 jōyō kanji. Every other kanji has a page too, but it is noindex and
// left out here, so the sitemap does not invite a crawl of thousands of rare characters.
export default defineSitemapEventHandler((event) => {
  const locale = getSitemapLocale(event);
  const urls: SitemapUrlInput[] = [];
  for (const kanji of JOYO_KANJI) {
    // The raw character: @nuxtjs/sitemap applies encodeURI itself.
    urls.push({ loc: localizeSitemapPath(`/kanji/${kanji}`, locale), changefreq: 'monthly', _i18nTransform: false });
  }
  return urls;
});
