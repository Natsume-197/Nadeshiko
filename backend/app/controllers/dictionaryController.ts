import type { GetDictionaryKanji, IdentifyDictionaryWord } from 'generated/routes/search';
import { AppDataSource } from '@config/database';
import { AccessDeniedError, InvalidRequestError, NotFoundError } from '@app/errors';
import { isInternalProxyRequest } from '@lib/internalProxy';
import { identifyWord } from '@app/services/dictionary/identify';
import { isSingleCharacter, kanjiCard } from '@app/services/dictionary/kanji';

/** Our own dictionary's word lookup (task 40). Only the frontend server calls it: it owns the shared cache and the
 * reader's provider choice, so a browser has no business here. */
export const identifyDictionaryWord: IdentifyDictionaryWord = async ({ query }, respond, req) => {
  if (!isInternalProxyRequest(req)) {
    throw new AccessDeniedError('This route is only callable by the Nadeshiko frontend server');
  }

  const candidates = await identifyWord(AppDataSource, {
    lemma: query.lemma,
    surface: query.surface,
    reading: query.reading,
    pos: query.pos,
    locale: query.locale ?? 'en',
  });

  return respond.with200().body({ candidates });
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

  const card = await kanjiCard(AppDataSource, params.character, query.locale ?? 'en');
  if (!card) throw new NotFoundError(`No kanji card for ${params.character}`);

  return respond.with200().body(card);
};
