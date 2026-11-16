import type { IdentifyDictionaryWord } from 'generated/routes/search';
import { AppDataSource } from '@config/database';
import { AccessDeniedError } from '@app/errors';
import { isInternalProxyRequest } from '@lib/internalProxy';
import { identifyWord } from '@app/services/dictionary/identify';

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
