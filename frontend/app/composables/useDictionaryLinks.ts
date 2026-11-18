import { DICT_LINKS_COOKIE } from '#shared/utils/preferenceCookies';
import { shirabeWordUrl, type GlossLanguage } from '~/utils/wordCard';

export type DictionaryId = 'jisho' | 'jpdb' | 'shirabe' | 'weblio' | 'takoboto' | 'jiten';

export type DictionaryPreset = {
  id: DictionaryId;
  label: string;
  /**
   * `slug` is Shirabe's own id for the word, present once the hover card has
   * loaded one. It beats the surface because it has already picked the
   * homograph, but it is an id Shirabe issued: no other dictionary can be
   * handed it, so every other preset builds its url from `word`.
   */
  /**
   * `locale` is the reader's gloss language, and only shirabe.org takes it: its
   * pages live under `/en/` and `/es/`, and a url without one answers 302 to
   * `/en/` whatever the reader is reading in. Every other dictionary here is
   * single-language or does its own negotiation, so they ignore it.
   */
  buildUrl: (word: string, reading: string, slug: string | undefined, locale: GlossLanguage) => string;
  defaultEnabled: boolean;
};

// Order here is the order readers see, both in settings and in the link row on
// the card. shirabe.org leads and is the one on by default. Since 3.0.0 it is an
// ordinary preset a reader can turn off (task 44): the card can be built from
// our own dictionary, so Shirabe is no longer "the dictionary you are reading".
export const DICTIONARY_PRESETS: DictionaryPreset[] = [
  {
    // Where a reader who wants more than the card holds lands by default. A web page rather than
    // the `shirabelookup://` app scheme this used to be: a scheme with no app
    // installed fails silently, and the card is already on the web.
    id: 'shirabe',
    label: 'shirabe.org',
    // Through `shirabeWordUrl` rather than spelled out again here. There were two
    // builders for this one destination and they disagreed: this one omitted the
    // locale, so a Spanish reader was redirected to the English page.
    buildUrl: (word, _reading, slug, locale) => shirabeWordUrl(slug ?? word, locale),
    defaultEnabled: true,
  },
  {
    id: 'jisho',
    label: 'Jisho',
    buildUrl: (word) => `https://jisho.org/search/${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    id: 'jpdb',
    label: 'JPDB',
    buildUrl: (word) => `https://jpdb.io/search?q=${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    id: 'weblio',
    label: 'Weblio',
    buildUrl: (word) => `https://www.weblio.jp/content/${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    id: 'takoboto',
    label: 'Takoboto',
    buildUrl: (word) => `https://takoboto.jp/?q=${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    // A parser rather than a word page: jiten.moe indexes media and has no
    // per-entry url to link at, so the word goes through `/parse` as the text to
    // analyse. That is the destination the site actually offers, and for a
    // single word it lands on that word.
    id: 'jiten',
    label: 'Jiten',
    buildUrl: (word) => `https://jiten.moe/parse?text=${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
];

// The cookie stores ids, and anything not in this set is dropped from it on the
// next read. So a preset is retired by leaving it here: delete one and every
// reader who had chosen it loses that choice the next time they change any
// other, silently. Turning one off by default only affects readers who have
// never set the preference at all, which is what `decodeEnabled` falls back to.
const VALID_IDS = new Set<string>(DICTIONARY_PRESETS.map((d) => d.id));
// See `shared/utils/preferenceCookies.ts`: read during SSR, so it is a cache key.
const COOKIE_NAME = DICT_LINKS_COOKIE;

const decodeEnabled = (raw: string | null | undefined): DictionaryId[] => {
  if (raw === null || raw === undefined) {
    return DICTIONARY_PRESETS.filter((d) => d.defaultEnabled).map((d) => d.id);
  }
  if (raw === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is DictionaryId => VALID_IDS.has(s));
};

export function useDictionaryLinks() {
  const { state: enabledDictionaries, set } = useCookiePreference<DictionaryId[]>(
    COOKIE_NAME,
    'dictionary-links-enabled',
    {
      parse: decodeEnabled,
      // An empty string, not `null`: "every dictionary off" has to be tellable
      // from "never chose", which is what `decodeEnabled` falls back on.
      serialize: (ids) => ids.join(','),
    },
  );

  const setDictionaryEnabled = (id: DictionaryId, enabled: boolean) => {
    const next = new Set(enabledDictionaries.value);
    if (enabled) next.add(id);
    else next.delete(id);
    set(DICTIONARY_PRESETS.filter((d) => next.has(d.id)).map((d) => d.id));
  };

  const isDictionaryEnabled = (id: DictionaryId) => enabledDictionaries.value.includes(id);

  return {
    presets: DICTIONARY_PRESETS,
    enabledDictionaries,
    isDictionaryEnabled,
    setDictionaryEnabled,
  };
}
