import { createI18n } from 'vue-i18n';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import formats from '../i18n/i18n.config';

export const mediaMetaI18n = createI18n<
  { message: typeof en; number: typeof formats.numberFormats.en },
  'en' | 'es',
  false
>({
  legacy: false,
  locale: 'en',
  messages: { en, es },
  numberFormats: { en: formats.numberFormats.en, es: formats.numberFormats.es },
}).global;
export const formatMediaMetaNumber = (value: number) => mediaMetaI18n.n(value, 'decimal');

const episodeHits = [
  { episode: 1, hitCount: 1200 },
  { episode: 3, hitCount: 34 },
];

type Case = {
  label: string;
  totalResults: number;
  episodeHits?: typeof episodeHits;
  episode?: number | null;
  bannerUrl?: string | null;
  locale?: 'en' | 'es';
  description: string;
};

export const mediaMetaCases: Case[] = [
  {
    label: 'zero match count',
    totalResults: 0,
    description: '0 Japanese sentences from Bocchi with audio, English translations and Anki export.',
  },
  {
    label: 'match count without episode hits',
    totalResults: 12345,
    description: '12,345 Japanese sentences from Bocchi with audio, English translations and Anki export.',
  },
  {
    label: 'all episodes with a banner',
    totalResults: 1234,
    episodeHits,
    bannerUrl: 'https://images.test/banner.webp',
    description:
      '1,234 Japanese sentences from Bocchi across 2 episodes with audio, English translations and Anki export.',
  },
  {
    label: 'selected episode',
    totalResults: 1234,
    episodeHits,
    episode: 3,
    description: '34 Japanese sentences from Bocchi episode 3 with audio, English translations and Anki export.',
  },
  {
    label: 'selected episode absent from nonempty hits',
    totalResults: 1234,
    episodeHits,
    episode: 9,
    description: '0 Japanese sentences from Bocchi episode 9 with audio, English translations and Anki export.',
  },
  {
    label: 'selected episode with empty hits',
    totalResults: 1234,
    episodeHits: [],
    episode: 3,
    bannerUrl: '',
    description: '0 Japanese sentences from Bocchi with audio, English translations and Anki export.',
  },
  {
    label: 'selected episode with unavailable hits',
    totalResults: 1234,
    episode: 3,
    bannerUrl: null,
    description: '1,234 Japanese sentences from Bocchi with audio, English translations and Anki export.',
  },
  {
    label: 'duplicate episodes use the first hit even when zero; all entries count as episodes',
    totalResults: 1234,
    episodeHits: [
      { episode: 3, hitCount: 0 },
      { episode: 3, hitCount: 34 },
    ],
    episode: 3,
    description: '0 Japanese sentences from Bocchi episode 3 with audio, English translations and Anki export.',
  },
  {
    label: 'episode count includes duplicate and zero-hit entries',
    totalResults: 1234,
    episodeHits: [
      { episode: 3, hitCount: 0 },
      { episode: 3, hitCount: 34 },
    ],
    description:
      '1,234 Japanese sentences from Bocchi across 2 episodes with audio, English translations and Anki export.',
  },
  {
    label: 'zero episode retains truthy-filter behavior',
    totalResults: 1234,
    episodeHits,
    episode: 0,
    description:
      '1,234 Japanese sentences from Bocchi across 2 episodes with audio, English translations and Anki export.',
  },
  {
    label: 'localized title, description and number formatting',
    totalResults: 12345,
    episodeHits,
    locale: 'es',
    description:
      'Frases en japonés de «Bocchi»: 12.345 en 2 episodios, con audio, traducciones al español y exportación a Anki.',
  },
];

// Complete expected head payload, independent of the production metadata builders.
export function expectedMediaMeta(description: string, bannerUrl?: string | null, locale = 'en') {
  const image = bannerUrl || 'https://nadeshiko.test/logo-og-5bc76788.png';
  return {
    title:
      locale === 'es'
        ? 'Bocchi: frases en japonés, audio y tarjetas de Anki'
        : 'Bocchi: Japanese sentences, audio & Anki mining',
    meta: [
      { name: 'description', content: description },
      { property: 'og:title', content: 'Bocchi | Nadeshiko' },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: image },
      { name: 'twitter:image', content: image },
      ...(bannerUrl
        ? []
        : [
            { property: 'og:image:width', content: '1200' },
            { property: 'og:image:height', content: '630' },
          ]),
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Bocchi | Nadeshiko' },
      { name: 'twitter:description', content: description },
    ],
  };
}
