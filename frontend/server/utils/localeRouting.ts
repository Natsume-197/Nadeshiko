import { SUPPORTED_LOCALES, type SupportedLocale } from '~/utils/i18n';

// Reserved paths are shared with HTML limiting so application endpoints are not treated as localized pages.
export const RESERVED_PREFIXES = [
  '/_nuxt/',
  '/_i18n/',
  '/api/',
  '/v1/',
  '/__sitemap__',
  '/sitemap',
  '/docs/',
  '/.well-known/',
  '/media/',
  // Share images (`/og/kanji/es/食.png`): files, not pages, and outside /api/ so preview bots may fetch them.
  '/og/',
];

export const RESERVED_EXACT = new Set(['/__nuxt_error', '/up', '/robots.txt', '/opensearch.xml', '/favicon.ico']);

export function isReservedLocalePath(path: string): boolean {
  if (RESERVED_EXACT.has(path)) return true;
  if (RESERVED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // Files at root: /github-xxx.png, /logo-xxx.webp, /sitemap-en.xml, etc.
  if (/^\/[^/]+\.[a-zA-Z0-9]+$/.test(path)) return true;
  return false;
}

// Known unprefixed top-level routes that should redirect to the localized equivalent.
// Unknown root paths (such as legacy spam URLs) skip the locale redirect and fall through to a direct 404.
export const KNOWN_LOCALIZED_ROOTS = new Set([
  'about',
  'admin',
  'auth',
  'blog',
  'changelog',
  'collection',
  'dmca',
  'kanji',
  'link',
  'media',
  'privacy',
  'reports',
  'requests',
  's',
  'search',
  'sentence',
  'settings',
  'sources',
  'stats',
  'supporters',
  'terms-and-conditions',
  'unsubscribe',
  'user',
  'verify',
]);

export function isKnownLocalizedPath(path: string): boolean {
  if (path === '/') return true;
  const firstSegment = path.slice(1).split('/')[0];
  return firstSegment !== undefined && firstSegment.length > 0 && KNOWN_LOCALIZED_ROOTS.has(firstSegment);
}

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return value !== null && value !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocalePrefix(path: string): SupportedLocale | null {
  for (const locale of SUPPORTED_LOCALES) {
    if (path === `/${locale}` || path.startsWith(`/${locale}/`)) return locale;
  }
  return null;
}

// Cookie-only locale selection keeps edge and origin redirects equivalent. Do not add inputs requiring origin
// work or language negotiation; a first visit defaults to English until the reader chooses a locale.
export function resolveRootLocale(cookieValue: string | null | undefined): SupportedLocale {
  return isSupportedLocale(cookieValue) ? cookieValue : 'en';
}
