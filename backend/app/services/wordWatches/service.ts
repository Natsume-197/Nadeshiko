import { AccessDeniedError, InvalidRequestError, NotFoundError, ServiceOverloadedError } from '@app/errors';
import { WordWatch, WordWatchMatchMode, WordWatchMode, WordWatchStatus } from '@app/models';
import type { User } from '@app/models';
import { canUseCustomTheme } from '@app/services/themes/customTheme';
import { GLOBAL_FILTERS, countWord, readerFilters } from './counting';
import { MAX_WORD_LENGTH, isWordQuery } from '@brigadasos/nadeshiko-shared/wordQuery';
import { COMMON_WORD_SENTENCES, WORD_WATCH_LIMIT, normalizeWordQuery } from './rules';

type Reader = Pick<User, 'id' | 'role' | 'preferences'>;

/** Active alerts the reader may have: patrons (anyone custom themes call one, admins included) get more. */
export async function wordWatchLimit(user: Pick<User, 'id' | 'role'>): Promise<{ limit: number; isPatron: boolean }> {
  const isPatron = await canUseCustomTheme(user);
  return { limit: isPatron ? WORD_WATCH_LIMIT.patron : WORD_WATCH_LIMIT.free, isPatron };
}

async function assertRoomForOneMore(user: Reader): Promise<void> {
  const [{ limit, isPatron }, active] = await Promise.all([
    wordWatchLimit(user),
    WordWatch.countBy({ userId: user.id, status: WordWatchStatus.ACTIVE }),
  ]);
  if (active < limit) return;
  throw new AccessDeniedError(
    isPatron
      ? `You have ${limit} active word alerts, the most you can have at once. Remove one first.`
      : `You have ${limit} active word alerts, the most you can have at once. Patrons can have ${WORD_WATCH_LIMIT.patron}.`,
  );
}

/** Both baselines at this moment: the reader's own count and the global one (the same query, asked once, when the
 * reader filters nothing). Refuses rather than guess when search is down, since a zero baseline would make the first
 * sweep report the whole corpus as new. */
async function baselines(user: Reader, query: string, matchMode: WordWatchMatchMode) {
  const key = { query, matchMode };
  const filters = await readerFilters(user.preferences);
  const [global, reader] = await Promise.all([
    countWord(key, GLOBAL_FILTERS),
    filters ? countWord(key, filters) : null,
  ]);
  const own = filters ? reader : global;
  if (own === null || global === null) {
    throw new ServiceOverloadedError('Search is busy right now; try setting the alert again in a minute.');
  }
  return { lastCount: own, lastGlobalCount: global };
}

/**
 * Makes an alert active in `mode`, counting from now: the shared path of a new alert, a mode switch and a resume.
 * "Contains" matches inside every compound (task 43), so a weekly digest of it would be noise; and a first-appearance
 * alert on a word the reader can already see would fire at once.
 */
async function activate(user: Reader, watch: WordWatch, mode: WordWatchMode): Promise<number> {
  if (watch.matchMode === WordWatchMatchMode.CONTAINS && mode === WordWatchMode.NEW_SENTENCES) {
    throw new InvalidRequestError('New-sentence alerts work with word and exact searches, not "contains".');
  }
  // A new alert, or one that is paused or met, takes a slot it does not hold yet.
  if (!watch.hasId() || watch.status !== WordWatchStatus.ACTIVE) await assertRoomForOneMore(user);

  const counts = await baselines(user, watch.query, watch.matchMode);
  if (mode === WordWatchMode.FIRST && counts.lastCount > 0) {
    throw new InvalidRequestError('This word already has sentences. Follow its new sentences instead.');
  }
  Object.assign(watch, { mode, status: WordWatchStatus.ACTIVE, ...counts });
  await watch.save();
  return counts.lastCount;
}

export interface WatchInput {
  query: string;
  matchMode: WordWatchMatchMode;
  mode: WordWatchMode;
}

/**
 * Creates the reader's alert on a word, or switches the one they already have to the asked mode. `commonWord` tells
 * the site to warn before a weekly digest of a very common word.
 */
export async function setWatch(
  user: Reader,
  input: WatchInput,
): Promise<{ watch: WordWatch; outcome: 'created' | 'updated'; sentenceCount: number; commonWord: boolean }> {
  const query = normalizeWordQuery(input.query);
  if (!isWordQuery(query)) {
    throw new InvalidRequestError(`Word alerts take one Japanese word of up to ${MAX_WORD_LENGTH} characters.`);
  }

  const existing = await WordWatch.findOneBy({ userId: user.id, query, matchMode: input.matchMode });
  const watch = existing ?? WordWatch.create({ userId: user.id, query, matchMode: input.matchMode, mode: input.mode });
  const sentenceCount = await activate(user, watch, input.mode);
  return {
    watch,
    outcome: existing ? 'updated' : 'created',
    sentenceCount,
    commonWord: input.mode === WordWatchMode.NEW_SENTENCES && sentenceCount > COMMON_WORD_SENTENCES,
  };
}

/** Pause or resume, or switch the mode. Resuming or switching starts counting from now, so a long pause does not
 * arrive as one huge digest. */
export async function updateWatch(
  user: Reader,
  publicId: string,
  patch: { mode?: WordWatchMode; paused?: boolean },
): Promise<WordWatch> {
  const watch = await ownWatch(user.id, publicId);

  if (patch.paused === true) {
    watch.status = WordWatchStatus.PAUSED;
    await watch.save();
    return watch;
  }

  const mode = patch.mode ?? watch.mode;
  if (watch.status === WordWatchStatus.ACTIVE && mode === watch.mode) return watch;
  await activate(user, watch, mode);
  return watch;
}

async function ownWatch(userId: number, publicId: string): Promise<WordWatch> {
  const watch = await WordWatch.findOneBy({ userId, publicId });
  if (!watch) throw new NotFoundError('Word alert not found');
  return watch;
}

export async function deleteWatch(userId: number, publicId: string): Promise<void> {
  const watch = await ownWatch(userId, publicId);
  await watch.remove();
}

export function toWordWatchJSON(watch: WordWatch) {
  return {
    id: watch.publicId,
    query: watch.query,
    matchMode: watch.matchMode,
    mode: watch.mode,
    status: watch.status,
    lastNotifiedAt: watch.lastNotifiedAt ? watch.lastNotifiedAt.toISOString() : null,
    createdAt: watch.createdAt.toISOString(),
  };
}
