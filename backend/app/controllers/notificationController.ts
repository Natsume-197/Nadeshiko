import { In, IsNull, LessThan } from 'typeorm';
import type {
  CheckWordWatch,
  DeleteWordWatch,
  GetUnreadNotificationCount,
  ListNotifications,
  ListWordWatches,
  MarkNotificationsRead,
  SetWordWatch,
  UpdateWordWatch,
} from 'generated/routes/notifications';
import { Notification, WordWatch, WordWatchMatchMode, WordWatchMode, WordWatchStatus } from '@app/models';
import { assertUser } from '@app/middleware/authentication';
import { toNotificationJSON, unreadNotificationCount } from '@app/services/notifications/notify';
import { normalizeWordQuery } from '@app/services/wordWatches/rules';
import { deleteWatch, setWatch, toWordWatchJSON, updateWatch, wordWatchLimit } from '@app/services/wordWatches/service';

export const listNotifications: ListNotifications = async ({ query }, respond, req) => {
  const user = assertUser(req);
  const take = query.take;
  const before = query.before ? new Date(query.before) : null;

  const [rows, unreadCount] = await Promise.all([
    Notification.find({
      where: { userId: user.id, ...(before ? { createdAt: LessThan(before) } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: take + 1,
    }),
    unreadNotificationCount(user.id),
  ]);

  return respond.with200().body({
    items: rows.slice(0, take).map(toNotificationJSON),
    unreadCount,
    hasMore: rows.length > take,
  });
};

export const getUnreadNotificationCount: GetUnreadNotificationCount = async (_params, respond, req) => {
  const user = assertUser(req);
  return respond.with200().body({ count: await unreadNotificationCount(user.id) });
};

export const markNotificationsRead: MarkNotificationsRead = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const ids = body.ids;
  const some = ids && ids.length > 0;
  await Notification.update(
    { userId: user.id, readAt: IsNull(), ...(some ? { publicId: In(ids) } : {}) },
    { readAt: new Date() },
  );
  // Marking everything leaves nothing unread; only a partial mark needs the count.
  return respond.with200().body({ unreadCount: some ? await unreadNotificationCount(user.id) : 0 });
};

export const listWordWatches: ListWordWatches = async (_params, respond, req) => {
  const user = assertUser(req);
  const [items, { limit }] = await Promise.all([
    WordWatch.find({ where: { userId: user.id }, order: { createdAt: 'DESC', id: 'DESC' } }),
    wordWatchLimit(user),
  ]);
  return respond.with200().body({
    items: items.map(toWordWatchJSON),
    activeCount: items.filter((watch) => watch.status === WordWatchStatus.ACTIVE).length,
    limit,
  });
};

export const setWordWatch: SetWordWatch = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const { watch, outcome, sentenceCount, commonWord } = await setWatch(user, {
    query: body.query,
    matchMode: body.matchMode as WordWatchMatchMode,
    mode: body.mode as WordWatchMode,
  });
  const payload = { watch: toWordWatchJSON(watch), outcome, sentenceCount, commonWord };
  return outcome === 'created' ? respond.with201().body(payload) : respond.with200().body(payload);
};

export const checkWordWatch: CheckWordWatch = async ({ query }, respond, req) => {
  const user = assertUser(req);
  const watch = await WordWatch.findOneBy({
    userId: user.id,
    query: normalizeWordQuery(query.query),
    matchMode: query.matchMode as WordWatchMatchMode,
  });
  return respond.with200().body({ watch: watch ? toWordWatchJSON(watch) : null });
};

export const updateWordWatch: UpdateWordWatch = async ({ params, body }, respond, req) => {
  const user = assertUser(req);
  const watch = await updateWatch(user, params.watchId, {
    mode: body.mode as WordWatchMode | undefined,
    paused: body.paused,
  });
  return respond.with200().body(toWordWatchJSON(watch));
};

export const deleteWordWatch: DeleteWordWatch = async ({ params }, respond, req) => {
  const user = assertUser(req);
  await deleteWatch(user.id, params.watchId);
  return respond.with204();
};
