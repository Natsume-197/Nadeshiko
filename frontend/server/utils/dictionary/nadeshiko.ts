import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import {
  type Candidate,
  type Dictionary,
  DictionaryError,
  type DictionaryLookupOptions,
  type WordQuery,
} from '~~/server/utils/dictionary/types';

// Nadeshiko's own dictionary (JMdict in the backend's `dict` schema, plus the reader's uploaded Yomitan dictionaries
// when authenticated), behind the `Dictionary` interface. The backend answers in the card's shape already; this
// only carries the query (and optional reader cookie) there and classifies failures.

const TIMEOUT_MS = 3000;

export const nadeshikoDictionary: Dictionary = {
  name: 'nadeshiko',

  async identify(query: WordQuery, options?: DictionaryLookupOptions) {
    const config = useRuntimeConfig();
    const params: Record<string, string> = { lemma: query.lemma, locale: query.locale };
    for (const key of ['surface', 'reading', 'pos'] as const) {
      const value = query[key];
      if (value) params[key] = value;
    }

    const extraHeaders: Record<string, string> = {};
    if (options?.readerCookie) {
      extraHeaders.cookie = options.readerCookie;
    }

    try {
      const answer = await $fetch<{
        candidates: Candidate[];
        stackFingerprint?: string | null;
        customDictionariesPending?: boolean;
      }>(internalBackendUrl(config, '/v1/dictionary/identify'), {
        query: params,
        headers: buildInternalBackendHeaders(config, extraHeaders),
        timeout: TIMEOUT_MS,
      });
      return {
        candidates: answer?.candidates ?? [],
        ...(answer?.stackFingerprint ? { stackFingerprint: answer.stackFingerprint } : {}),
        ...(answer?.customDictionariesPending ? { pending: true } : {}),
      };
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      // 403 means the internal secret is missing or wrong: our configuration, not the dictionary, is broken.
      throw new DictionaryError(status === 403 ? 'misconfigured' : 'unavailable', status, error);
    }
  },
};
