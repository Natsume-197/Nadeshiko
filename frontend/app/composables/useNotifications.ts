import type { Notification } from '@brigadasos/nadeshiko-sdk';
import { wordSearchPath } from '@brigadasos/nadeshiko-shared/wordQuery';

/**
 * The reader's notification centre (task 52). The two header bells (phone and desktop) share this state, so reading
 * an entry in one clears the badge in the other, and they share one unread-count throttle.
 */

/** One word of a word notice, as the sweep stores it. */
export interface NotificationWord {
  query: string;
  matchMode?: 'WORD' | 'EXACT' | 'CONTAINS';
  titles?: string[];
  sentences?: number;
  newSentences?: number;
}

/** The SDK's `Notification`, with the payload of the kinds this site draws. */
export type NotificationEntry = Omit<Notification, 'payload'> & {
  payload: {
    words?: NotificationWord[];
    status?: 'IN_PROGRESS' | 'RELEASED' | 'DECLINED' | 'MERGED';
    title?: string;
    reason?: string;
    mergedIntoTitle?: string;
    path?: string;
    count?: number;
    message?: string;
    linkUrl?: string;
    linkLabel?: string;
  };
};

/** How long the unread count is trusted before the next navigation asks again. */
const UNREAD_REFRESH_MS = 60_000;

/** Entries the panel asks for at a time. */
const PAGE_SIZE = 10;

export function useNotifications() {
  const sdk = useNadeshikoSdk();
  const unreadCount = useState<number>('nd-notifications-unread', () => 0);
  const items = useState<NotificationEntry[]>('nd-notifications-items', () => []);
  const hasMore = useState<boolean>('nd-notifications-has-more', () => false);
  const loading = useState<boolean>('nd-notifications-loading', () => false);
  const lastCountAt = useState<number>('nd-notifications-count-at', () => 0);

  async function refreshUnread(): Promise<void> {
    if (Date.now() - lastCountAt.value < UNREAD_REFRESH_MS) return;
    lastCountAt.value = Date.now();
    try {
      unreadCount.value = (await sdk.getUnreadNotificationCount()).count;
    } catch {
      // The badge is a hint; a failed count leaves the last one rather than alarming the reader.
    }
  }

  /** The first page, or with `more` the next one after what is loaded. */
  async function load(more = false): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    try {
      const last = more ? items.value.at(-1) : undefined;
      const page = await sdk.listNotifications({
        take: PAGE_SIZE,
        ...(last ? { before: last.createdAt } : {}),
      });
      const fetched = page.items as NotificationEntry[];
      if (more) {
        const seen = new Set(items.value.map((i) => i.id));
        items.value = [...items.value, ...fetched.filter((i) => !seen.has(i.id))];
      } else {
        items.value = fetched;
      }
      hasMore.value = page.hasMore;
      unreadCount.value = page.unreadCount;
      lastCountAt.value = Date.now();
    } finally {
      loading.value = false;
    }
  }

  async function markRead(ids?: string[]): Promise<void> {
    const { unreadCount: left } = await sdk.markNotificationsRead(ids ? { ids } : {});
    const marked = ids ? new Set(ids) : null;
    items.value = items.value.map((item) => (!marked || marked.has(item.id) ? { ...item, read: true } : item));
    unreadCount.value = left;
  }

  function reset(): void {
    unreadCount.value = 0;
    items.value = [];
    hasMore.value = false;
    lastCountAt.value = 0;
  }

  return { unreadCount, items, hasMore, loading, refreshUnread, load, markRead, reset };
}

/** A word's search page, in the match mode its alert was made in. */
export function wordPath(word: NotificationWord): string {
  return wordSearchPath(word.query, word.matchMode);
}

export function isOfficialEntry(entry: NotificationEntry): boolean {
  return entry.kind === 'site-announcement' || entry.kind === 'admin-message';
}

/** Where an entry leads as a whole. Official notices expand inline instead of navigating on row click. */
export function notificationTarget(entry: NotificationEntry): string | null {
  if (isOfficialEntry(entry)) return null;
  if (entry.kind === 'report-resolved') return null;
  if (entry.kind === 'request-update') return entry.payload.path ?? '/requests';
  const words = entry.payload.words ?? [];
  if (words.length === 1 && words[0]) return wordPath(words[0]);
  return null;
}
