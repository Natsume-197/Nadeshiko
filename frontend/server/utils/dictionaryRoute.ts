import { createError, type H3Error, type H3Event, setResponseHeader } from 'h3';

/** How long the dictionary routes cache an answer, in Nitro and in the `cache-control` they send. */
export const DICTIONARY_CACHE_SECONDS = 60 * 60 * 24;

const RETRY_AFTER_SECONDS = 5;

/** A 503 the browser must not cache and may retry shortly: the backend or search behind a dictionary route failed. */
export function dictionaryUnavailable(event: H3Event, message: string): H3Error {
  setResponseHeader(event, 'cache-control', 'no-store');
  setResponseHeader(event, 'retry-after', RETRY_AFTER_SECONDS);
  return createError({ statusCode: 503, statusMessage: message });
}
