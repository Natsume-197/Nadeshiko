// The word card's dictionary, as the lookup route sees it. Shirabe is the only implementation until our own
// dictionary replaces it; a second one must return this same shape so the card, `wordCard.ts` and `ankiWord.ts`
// never change.

// The word to identify. Hints narrow homographs: 開いた read ヒライタ must not fall back to あく.
export interface WordQuery {
  lemma: string;
  surface?: string;
  reading?: string;
  // Shirabe's short POS tag (`SlimToken.pt`), not the UniDic category.
  pos?: string;
  // Label language; definitions come in every language and the card picks its own.
  locale: 'en' | 'es';
}

// One ranked answer. The fields the card draws are typed in `app/utils/wordCard.ts` (`ShirabeCandidate`); only
// what the route itself reads is spelled out here.
export interface Candidate {
  id: string;
  headword: string;
  // Display label for a matched kana form; identity remains id/headword.
  matchedHeadword?: string | null;
  reading?: string | null;
  common?: boolean;
  // Stable dictionary identity across reimports, paired with dictionary.
  sourceId?: string;
  dictionary?: string;
  // A proper-name entry; dictionary slugs alone cannot reliably identify names.
  name?: boolean;
  // Resolvable components of a multi-word expression; absent for ordinary words and grammar.
  parts?: unknown[];
  entries?: unknown[];
  pitch?: unknown[];
  furigana?: unknown[];
  forms?: unknown[];
  frequency?: number | null;
  jlpt?: string | null;
}

export interface DictionaryAnswer {
  // Ranked best first; empty means no entry, which is an answer, not a failure.
  candidates: Candidate[];
  // Digest of the dictionaries that answered: a linked Shirabe reader's stack, or a reader's uploaded dictionaries.
  stackFingerprint?: string | null;
  // The answer lacks one of the reader's uploaded dictionaries (still indexing, or still being fetched by the
  // backend). Nothing may cache it, or the card would keep it for a day.
  pending?: boolean;
}

export interface DictionaryLookupOptions {
  // A linked reader's own Shirabe key. Goes away with account linking.
  readerKey?: string;
  // Forwarded session cookie when looking up a reader's own custom Yomitan dictionaries on Nadeshiko's backend.
  readerCookie?: string;
}

export interface Dictionary {
  readonly name: string;
  identify(query: WordQuery, options?: DictionaryLookupOptions): Promise<DictionaryAnswer>;
}

// Why a lookup failed, in terms the route can act on whatever the implementation.
//  - refused: the reader's key was rejected (401/403) or rate limited (429); retry with the service dictionaries.
//  - misconfigured: we are calling the wrong address; an operator has to fix it.
//  - unavailable: anything else (5xx, timeout, unexpected 404); retryable.
export type DictionaryFailure = 'refused' | 'misconfigured' | 'unavailable';

export class DictionaryError extends Error {
  constructor(
    readonly kind: DictionaryFailure,
    readonly status: number | undefined,
    // The original error, kept for logs.
    readonly upstream: unknown,
  ) {
    super(`Dictionary lookup ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'DictionaryError';
  }
}
