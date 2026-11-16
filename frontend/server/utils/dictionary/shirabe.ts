import { callShirabe, describeFailure } from '~~/server/utils/shirabeCall';
import { type Candidate, type Dictionary, DictionaryError, type WordQuery } from '~~/server/utils/dictionary/types';

// Shirabe's words/identify, behind the Dictionary interface.

interface IdentifyResponse {
  // Index-aligned with input tokens; null means no entry, not an upstream failure.
  words: Array<{ candidates: Candidate[] } | null>;
  // Echoed dictionary-stack digest lets clients detect stale cached answers.
  stackFingerprint?: string | null;
}

// Everything the card draws, in one call; parts keeps component words reachable from merged expressions.
const INCLUDE = ['pitch', 'frequency', 'furigana', 'jlpt', 'forms', 'notes', 'parts'];

export const shirabeDictionary: Dictionary = {
  name: 'shirabe',

  async identify(query: WordQuery, options = {}) {
    const { readerKey } = options;
    const token: Record<string, string> = { lemma: query.lemma };
    for (const key of ['surface', 'reading', 'pos'] as const) {
      const value = query[key];
      if (value) token[key] = value;
    }

    let answer: IdentifyResponse;
    try {
      answer = await callShirabe<IdentifyResponse>({
        path: '/words/identify',
        method: 'POST',
        // locale belongs in the query: the strict identify body schema accepts tokens, not locale. Without a reader
        // key, ask for the lexical default rather than reorder a mixed result.
        query: { locale: query.locale, ...(readerKey ? {} : { 'dictionaries[]': 'jmdict' }) },
        body: { tokens: [token], include: INCLUDE },
        subject: query.lemma,
        apiKey: readerKey,
      });
    } catch (error: unknown) {
      throw classify(error, Boolean(readerKey));
    }

    return {
      candidates: answer?.words?.[0]?.candidates ?? [],
      ...(answer?.stackFingerprint ? { stackFingerprint: answer.stackFingerprint } : {}),
    };
  },
};

function classify(error: unknown, withReaderKey: boolean): DictionaryError {
  const { kind, status } = describeFailure(error);
  // An HTML 404 is Rails' catch-all: our path is wrong, not the word missing.
  if (kind === 'bad-path') return new DictionaryError('misconfigured', status, error);
  // 401/403 describe a reader's link and 429 their usage; with the service key they are plain outages.
  if (withReaderKey && (status === 401 || status === 403 || status === 429)) {
    return new DictionaryError('refused', status, error);
  }
  // Identify reports missing tokens in a 200 body, so even a JSON 404 means the route failed.
  return new DictionaryError('unavailable', status, error);
}
