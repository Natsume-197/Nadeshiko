import type { ContentRating } from '@brigadasos/nadeshiko-sdk';
import { createError, type H3Error, type H3Event, setResponseHeader } from 'h3';

/** How long the dictionary routes cache an answer, in Nitro and in the `cache-control` they send. */
export const DICTIONARY_CACHE_SECONDS = 60 * 60 * 24;

const RETRY_AFTER_SECONDS = 5;

/** The label languages the dictionary routes serve; anything else is answered in English. */
export type DictionaryLocale = 'en' | 'es';

export function dictionaryLocale(value: unknown): DictionaryLocale {
  return value === 'es' ? 'es' : 'en';
}

/** The ratings a public dictionary page shows sentences from. */
export const PUBLIC_CONTENT_RATINGS: ContentRating[] = ['SAFE', 'SUGGESTIVE'];

/**
 * Marks an error as optional enrichment the page recovers from: the error handler keeps it in logs and metrics but
 * does not raise a PostHog issue for it.
 */
export const OPTIONAL_FAILURE = { optional: true } as const;

/** Whether `error` was raised with {@link OPTIONAL_FAILURE}. */
export function isOptionalFailure(error: unknown): boolean {
  const data = (error as { data?: unknown } | null)?.data;
  return typeof data === 'object' && data !== null && (data as { optional?: unknown }).optional === true;
}

/** A 503 the browser must not cache and may retry shortly: the backend or search behind a dictionary route failed. */
export function dictionaryUnavailable(event: H3Event, message: string): H3Error {
  setResponseHeader(event, 'cache-control', 'no-store');
  setResponseHeader(event, 'retry-after', RETRY_AFTER_SECONDS);
  return createError({ statusCode: 503, statusMessage: message, data: OPTIONAL_FAILURE });
}
