import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';
import { type Candidate, type Dictionary, DictionaryError, type WordQuery } from '~~/server/utils/dictionary/types';

// Nadeshiko's own dictionary (JMdict in the backend's `dict` schema), behind the same interface as Shirabe. The
// backend answers in the card's shape already; this only carries the query there and classifies failures.

const TIMEOUT_MS = 3000;

export const nadeshikoDictionary: Dictionary = {
  name: 'nadeshiko',

  // A reader's Shirabe key means nothing here; their own dictionaries live on Shirabe.
  async identify(query: WordQuery) {
    const config = useRuntimeConfig();
    const params: Record<string, string> = { lemma: query.lemma, locale: query.locale };
    for (const key of ['surface', 'reading', 'pos'] as const) {
      const value = query[key];
      if (value) params[key] = value;
    }

    try {
      const answer = await $fetch<{ candidates: Candidate[] }>(internalBackendUrl(config, '/v1/dictionary/identify'), {
        query: params,
        headers: buildInternalBackendHeaders(config),
        timeout: TIMEOUT_MS,
      });
      return { candidates: answer?.candidates ?? [] };
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      // 403 means the internal secret is missing or wrong: our configuration, not the dictionary, is broken.
      throw new DictionaryError(status === 403 ? 'misconfigured' : 'unavailable', status, error);
    }
  },
};
