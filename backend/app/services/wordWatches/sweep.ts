import { In } from 'typeorm';
import { User, WordWatch, WordWatchMatchMode, WordWatchMode, WordWatchStatus } from '@app/models';
import { sendWordAlertEmail } from '@app/mailers/email';
import type { WordAlertItem } from '@app/mailers/emailTemplates';
import { wordSearchPath } from '@brigadasos/nadeshiko-shared/wordQuery';
import { notify } from '@app/services/notifications/notify';
import { getNotificationParams } from '@app/services/notifications/settings';
import { logger } from '@config/log';
import {
  GLOBAL_FILTERS,
  countKey,
  countWords,
  readerFilters,
  wordExamples,
  type NewEpisodesCache,
  type WordKey,
} from './counting';
import { NEW_SENTENCES_THRESHOLD } from './rules';

/**
 * The two word-alert sweeps (task 52). Both count in two steps so the cost follows distinct words, not readers:
 *
 * 1. One unfiltered count per distinct word, in `_msearch` batches. Compared with each alert's `lastGlobalCount`, it
 *    discards every word that did not grow; filters only remove sentences, so nobody's own count can have grown either.
 * 2. Only for the alerts left, the reader's own search (their NSFW, hidden categories and hidden titles), one batch per
 *    reader, which is what a notice is decided on. A reader with default preferences gets the step-1 count.
 */

type Reader = Pick<User, 'id' | 'username' | 'email' | 'preferences'>;

/** One word in a notice: the bell's payload as stored, and what the email shows (plus its examples). */
export interface WordNotice {
  query: string;
  matchMode: WordWatchMatchMode;
  titles: string[];
  /** First appearance: sentences in the reader's search now. */
  sentences?: number;
  /** Digest: new sentences since the last notice. */
  newSentences?: number;
}

function dayCampaign(now: Date): string {
  return `word-available-${now.toISOString().slice(0, 10)}`;
}

/** ISO 8601 week, e.g. `word-digest-2026-W48`: one digest per reader per week, whatever day the sweep runs. */
export function weekCampaign(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `word-digest-${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface SweepSummary {
  alerts: number;
  words: number;
  /** Alerts that passed step 1 and had the reader's own count taken. */
  checked: number;
  notifiedAlerts: number;
  readers: number;
}

/** What one mode does with the counts; the driver below is shared. */
interface SweepRules {
  mode: WordWatchMode;
  kind: 'word-available' | 'word-digest';
  campaign: (now: Date) => string;
  /** Step 1: whether the global count is worth the reader's own count. */
  grew: (watch: WordWatch, global: number) => boolean;
  /** Step 2: the notice for this alert, or null to wait. */
  decide: (watch: WordWatch, count: number) => Pick<WordNotice, 'sentences' | 'newSentences'> | null;
  /** The columns written after a notice, beyond the two baselines. */
  after: Partial<WordWatch>;
}

const keyOf = (watch: WordWatch): WordKey => ({ query: watch.query, matchMode: watch.matchMode });

/** An alert that passed step 1, with its count key and global total worked out once. */
interface Grown {
  watch: WordWatch;
  key: string;
  global: number;
}

type Notice = WordNotice & { examples: WordAlertItem['examples'] };

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

async function runSweep(rules: SweepRules, now: Date): Promise<SweepSummary> {
  const watches = await WordWatch.findBy({ status: WordWatchStatus.ACTIVE, mode: rules.mode });
  const keys = new Map(watches.map((watch) => [countKey(keyOf(watch)), keyOf(watch)]));
  const summary: SweepSummary = { alerts: watches.length, words: keys.size, checked: 0, notifiedAlerts: 0, readers: 0 };
  if (watches.length === 0) return summary;

  // Step 1.
  const global = await countWords([...keys.values()], GLOBAL_FILTERS);
  const shrunkByTotal = new Map<number, number[]>();
  const grownByUser = new Map<number, Grown[]>();
  for (const watch of watches) {
    const key = countKey(keyOf(watch));
    const total = global.get(key);
    if (total === undefined) continue;
    // Sentences were taken down (a title removed, a reindex): start from the smaller number, or growth would first
    // have to make up the loss. One UPDATE per total.
    if (total < watch.lastGlobalCount) pushTo(shrunkByTotal, total, watch.id);
    else if (rules.grew(watch, total)) pushTo(grownByUser, watch.userId, { watch, key, global: total });
  }
  for (const [total, ids] of shrunkByTotal) await WordWatch.update({ id: In(ids) }, { lastGlobalCount: total });

  const readers = await User.find({
    where: { id: In([...grownByUser.keys()]), banned: false, isActive: true },
    select: { id: true, username: true, email: true, preferences: true },
  });
  const episodesCache: NewEpisodesCache = new Map();
  const notified: Array<{ reader: Reader; notices: Notice[] }> = [];

  // Step 2: the reader's own count, or the global one when their preferences narrow nothing.
  for (const reader of readers) {
    const own = grownByUser.get(reader.id) ?? [];
    summary.checked += own.length;
    const filters = await readerFilters(reader.preferences);
    const counts = filters
      ? await countWords(
          own.map(({ watch }) => keyOf(watch)),
          filters,
        )
      : global;

    const notices: Notice[] = [];
    for (const { watch, key, global: globalNow } of own) {
      const count = counts.get(key);
      if (count === undefined) continue;
      if (count < watch.lastCount) {
        await WordWatch.update(watch.id, { lastCount: count, lastGlobalCount: globalNow });
        continue;
      }
      // Below the threshold both baselines stay, so the growth can add up with what comes later.
      const decided = rules.decide(watch, count);
      if (!decided) continue;

      const { examples, titles } = await wordExamples(keyOf(watch), filters ?? GLOBAL_FILTERS, {
        since: rules.mode === WordWatchMode.NEW_SENTENCES ? (watch.lastNotifiedAt ?? watch.createdAt) : null,
        episodesCache,
      });
      await WordWatch.update(watch.id, {
        ...rules.after,
        lastCount: count,
        lastGlobalCount: globalNow,
        lastNotifiedAt: now,
      });
      notices.push({ query: watch.query, matchMode: watch.matchMode, ...decided, titles, examples });
    }
    if (notices.length > 0) notified.push({ reader, notices });
    summary.notifiedAlerts += notices.length;
  }

  summary.readers = notified.length;
  const campaign = rules.campaign(now);
  for (const { reader, notices } of notified) {
    await notify(reader, rules.kind, { words: notices.map(({ examples: _examples, ...notice }) => notice) }, () =>
      sendWordAlertEmail({
        kind: rules.kind,
        userId: reader.id,
        username: reader.username,
        email: reader.email,
        campaign,
        items: notices.map((notice) => ({
          ...notice,
          word: notice.query,
          path: wordSearchPath(notice.query, notice.matchMode),
        })),
      }),
    );
  }

  logger.info({ ...summary, mode: rules.mode }, 'Word alert sweep complete');
  return summary;
}

/** Daily: tell readers whose `FIRST` alerts started returning sentences, and close those alerts. */
export function runFirstAppearanceSweep(now: Date = new Date()): Promise<SweepSummary> {
  return runSweep(
    {
      mode: WordWatchMode.FIRST,
      kind: 'word-available',
      campaign: dayCampaign,
      grew: (_watch, global) => global >= 1,
      decide: (_watch, count) => (count >= 1 ? { sentences: count } : null),
      after: { status: WordWatchStatus.FULFILLED },
    },
    now,
  );
}

/** Weekly: a digest of new sentences for each reader's followed words. */
export async function runNewSentencesSweep(now: Date = new Date()): Promise<SweepSummary> {
  const { minNewSentences } = await getNotificationParams<{ minNewSentences: number }>('word-digest');
  const threshold = minNewSentences ?? NEW_SENTENCES_THRESHOLD;
  return runSweep(
    {
      mode: WordWatchMode.NEW_SENTENCES,
      kind: 'word-digest',
      campaign: weekCampaign,
      grew: (watch, global) => global - watch.lastGlobalCount >= threshold,
      decide: (watch, count) =>
        count - watch.lastCount >= threshold ? { newSentences: count - watch.lastCount } : null,
      after: {},
    },
    now,
  );
}
