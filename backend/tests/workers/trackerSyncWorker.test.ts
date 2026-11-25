import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findConnections: vi.fn(),
  findUser: vi.fn(),
  canUseCustomTheme: vi.fn(),
  listConfiguredTrackerProviders: vi.fn(),
  syncTrackerConnection: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@app/models', () => ({
  TrackerConnection: { find: mocks.findConnections },
  User: { findOne: mocks.findUser },
}));
vi.mock('@app/services/themes/customTheme', () => ({
  canUseCustomTheme: mocks.canUseCustomTheme,
}));
vi.mock('@app/services/tracker/registry', () => ({
  listConfiguredTrackerProviders: mocks.listConfiguredTrackerProviders,
}));
vi.mock('@app/services/tracker/service', () => ({
  syncTrackerConnection: mocks.syncTrackerConnection,
}));
vi.mock('@config/log', () => ({
  logger: { warn: mocks.warn, info: mocks.info, error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@app/workers/workerInstrumentation', () => ({
  instrumentedHandler: (_queue: string, handler: unknown) => handler,
}));

import { TRACKER_SYNC_QUEUE } from '@app/workers/queueNames';
import { registerTrackerSyncWorker, runAutomaticTrackerSync } from '@app/workers/trackerSyncWorker';

describe('trackerSyncWorker', () => {
  beforeEach(() => {
    mocks.listConfiguredTrackerProviders.mockReturnValue(['ANILIST']);
    mocks.findConnections.mockResolvedValue([
      { id: 1, userId: 10, provider: 'ANILIST', autoSyncEnabled: true },
      { id: 2, userId: 20, provider: 'ANILIST', autoSyncEnabled: true },
      { id: 3, userId: 30, provider: 'ANILIST', autoSyncEnabled: true },
    ]);
    mocks.findUser.mockImplementation(async ({ where }: { where: { id: number } }) => ({
      id: where.id,
      role: 'USER',
    }));
    mocks.canUseCustomTheme.mockImplementation(async (user: { id: number }) => user.id !== 20);
    mocks.syncTrackerConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers on the tracker sync queue', async () => {
    const work = vi.fn(async () => undefined);
    await registerTrackerSyncWorker({ work } as never);
    expect(work).toHaveBeenCalledWith(TRACKER_SYNC_QUEUE, expect.any(Function));
  });

  it('syncs only active patrons and continues past individual failures', async () => {
    mocks.syncTrackerConnection.mockRejectedValueOnce(new Error('AniList 429')).mockResolvedValueOnce(undefined);

    const summary = await runAutomaticTrackerSync({ delayMs: 0 });

    expect(summary).toEqual({ synced: 1, skipped: 1, failed: 1 });
    expect(mocks.syncTrackerConnection).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it('skips cleanly when no providers are configured', async () => {
    mocks.listConfiguredTrackerProviders.mockReturnValue([]);
    const summary = await runAutomaticTrackerSync({ delayMs: 0 });
    expect(summary).toEqual({ synced: 0, skipped: 0, failed: 0 });
    expect(mocks.findConnections).not.toHaveBeenCalled();
  });
});
