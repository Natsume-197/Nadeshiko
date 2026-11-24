import type { WordWatch } from '@brigadasos/nadeshiko-sdk';

/**
 * Word alerts (task 52): tell me when a word first appears (`FIRST`), or follow its new sentences (`NEW_SENTENCES`).
 * The search page asks for the reader's alert on its word; the notification settings list them all. Thin wrappers over
 * the generated SDK, kept for the names the components read.
 */

export type { WordWatch };
export type WordWatchMode = WordWatch['mode'];
export type WordWatchMatchMode = WordWatch['matchMode'];

/** The translation key for a refused alert, by the status the API answered with. */
export function wordWatchErrorKey(status: number | undefined, mode: WordWatchMode): string {
  if (status === 403) return 'notifications.watch.limit';
  if (status === 400 && mode === 'FIRST') return 'notifications.watch.alreadyThere';
  if (status === 503) return 'notifications.watch.busy';
  return 'notifications.watch.error';
}

export function useWordWatches() {
  const sdk = useNadeshikoSdk();

  return {
    check: async (query: string, matchMode: WordWatchMatchMode = 'WORD') =>
      (await sdk.checkWordWatch({ query, matchMode })).watch,
    set: (query: string, mode: WordWatchMode, matchMode: WordWatchMatchMode = 'WORD') =>
      sdk.setWordWatch({ query, mode, matchMode }),
    list: () => sdk.listWordWatches(),
    update: (id: string, patch: { mode?: WordWatchMode; paused?: boolean }) =>
      sdk.updateWordWatch({ watchId: id, ...patch }),
    remove: async (id: string) => {
      await sdk.deleteWordWatch({ watchId: id });
    },
  };
}
