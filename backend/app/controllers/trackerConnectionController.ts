import type {
  CompleteTrackerLink,
  GetTrackerConnection,
  StartTrackerLink,
  SyncTrackerConnection,
  UnlinkTracker,
  UpdateTrackerSettings,
} from 'generated/routes/user';
import { NotFoundError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import { TrackerProviderType } from '@app/models';
import {
  completeTrackerLink as complete,
  getTrackerState,
  startTrackerLink as start,
  syncTrackerForUser,
  unlinkTracker as unlink,
  updateTrackerSettings as updateSettings,
} from '@app/services/tracker/service';

export const getTrackerConnection: GetTrackerConnection = async (_params, respond, req) => {
  const user = assertUser(req);
  return respond.with200().body(await getTrackerState(user));
};

export const startTrackerLink: StartTrackerLink = async ({ body }, respond, req) => {
  const user = assertUser(req);
  return respond.with201().body(start(user.id, body.provider as TrackerProviderType));
};

export const completeTrackerLink: CompleteTrackerLink = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const state = await complete(user, body.provider as TrackerProviderType, body.code, body.state);
  return respond.with200().body(state);
};

export const syncTrackerConnection: SyncTrackerConnection = async (_params, respond, req) => {
  const user = assertUser(req);
  return respond.with200().body(await syncTrackerForUser(user));
};

export const updateTrackerSettings: UpdateTrackerSettings = async ({ body }, respond, req) => {
  const user = assertUser(req);
  return respond.with200().body(await updateSettings(user, body));
};

export const unlinkTracker: UnlinkTracker = async (_params, respond, req) => {
  const user = assertUser(req);
  if (!(await unlink(user.id))) {
    throw new NotFoundError('No anime tracker is linked');
  }
  return respond.with204();
};
