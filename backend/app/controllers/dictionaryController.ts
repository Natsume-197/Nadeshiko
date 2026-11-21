import type { GetDictionaryKanji, GetDictionaryKanjiIndex, IdentifyDictionaryWord } from 'generated/routes/search';
import { fromNodeHeaders } from 'better-auth/node';
import { AppDataSource } from '@config/database';
import { auth } from '@config/auth';
import { config } from '@config/config';
import { logger } from '@config/log';
import { AccessDeniedError, InvalidRequestError, NotFoundError } from '@app/errors';
import { isInternalProxyRequest } from '@lib/internalProxy';
import { identifyWord } from '@app/services/dictionary/identify';
import { enrichCandidatesWithCustomDictionaries } from '@app/services/dictionary/custom/lookup';
import { withPitchAudio } from '@app/services/dictionary/pitchAudio/audioUrl';
import { isSingleCharacter, kanjiCard, kanjiIndex } from '@app/services/dictionary/kanji';

/** Resolve the authenticated user ID when Nitro forwards a reader session cookie for custom dictionaries.
 *  Fails closed to `null` (anonymous JMdict-only answer) so an expired session never breaks word cards. */
async function resolveOptionalSessionUserId(req: Parameters<IdentifyDictionaryWord>[2]): Promise<number | null> {
  if (!config.USER_DICTIONARIES_ENABLED || !req.headers.cookie) return null;
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableRefresh: true },
    });
    const userId = Number(session?.user?.id);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch (error) {
    logger.warn({ err: error }, 'Could not resolve session for custom dictionary lookup; using built-in JMdict');
    return null;
  }
}

/** Our own dictionary's word lookup (task 40 + task 48). Only the frontend server calls it: it owns the shared cache
 * and the reader's provider choice, so a browser has no business here. */
export const identifyDictionaryWord: IdentifyDictionaryWord = async ({ query }, respond, req) => {
  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This route is only callable by the Nadeshiko frontend server');
  }

  const identifyQuery = {
    lemma: query.lemma,
    surface: query.surface,
    reading: query.reading,
    pos: query.pos,
    locale: query.locale ?? ('en' as const),
  };

  const [candidates, userId] = await Promise.all([
    identifyWord(AppDataSource, identifyQuery),
    resolveOptionalSessionUserId(req),
  ]);
  const enriched: Awaited<ReturnType<typeof enrichCandidatesWithCustomDictionaries>> = userId
    ? await enrichCandidatesWithCustomDictionaries(userId, identifyQuery, candidates)
    : { candidates, stackFingerprint: null, pending: false };

  return respond.with200().body({
    // After the merge, so a pattern from the reader's own pitch dictionary gets our clip too.
    candidates: await withPitchAudio(AppDataSource, config.R2_BASE_URL, enriched.candidates),
    ...(enriched.stackFingerprint ? { stackFingerprint: enriched.stackFingerprint } : {}),
    // Missing a dictionary that is indexing or still downloading: the frontend must not cache this answer.
    ...(enriched.pending ? { customDictionariesPending: true } : {}),
  });
};

/** One kanji's card (task 44), for the word card's kanji view. Server-only like the word lookup: the frontend server
 * caches it for every reader. */
export const getDictionaryKanji: GetDictionaryKanji = async ({ params, query }, respond, req) => {
  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This route is only callable by the Nadeshiko frontend server');
  }
  if (!isSingleCharacter(params.character)) {
    throw new InvalidRequestError('character must be a single kanji');
  }

  const card = await kanjiCard(AppDataSource, params.character, query.locale ?? 'en', {
    related: query.related ?? 'short',
  });
  if (!card) throw new NotFoundError(`No kanji card for ${params.character}`);

  return respond.with200().body(card);
};

/** Every jōyō and JLPT kanji with one reading and one meaning (task 44), for the kanji index page. Server-only: the
 * frontend server caches it for every reader. */
export const getDictionaryKanjiIndex: GetDictionaryKanjiIndex = async ({ query }, respond, req) => {
  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This route is only callable by the Nadeshiko frontend server');
  }

  return respond.with200().body({ kanji: await kanjiIndex(AppDataSource, query.locale ?? 'en') });
};
