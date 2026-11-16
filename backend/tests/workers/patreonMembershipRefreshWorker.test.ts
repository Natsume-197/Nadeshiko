import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Pins the daily re-check: every linked membership is refreshed against Patreon, one at a time, and one failing
 * connection neither stops the rest nor fails the job. Patreon itself is mocked; the order and the tolerance are what
 * is under test. */

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  getPatreonConnection: vi.fn(),
  isPatreonConfigured: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@app/models', () => ({ PatreonConnection: { find: mocks.find } }));
vi.mock('@app/services/patreon/connection', () => ({
  getPatreonConnection: mocks.getPatreonConnection,
  isPatreonConfigured: mocks.isPatreonConfigured,
}));
vi.mock('@config/log', () => ({ logger: { warn: mocks.warn, info: mocks.info, error: vi.fn(), debug: vi.fn() } }));
vi.mock('@app/workers/workerInstrumentation', () => ({
  instrumentedHandler: (_queue: string, handler: unknown) => handler,
}));

import {
  refreshPatreonMemberships,
  registerPatreonMembershipRefreshWorker,
} from '@app/workers/patreonMembershipRefreshWorker';
import { PATREON_MEMBERSHIP_REFRESH_QUEUE } from '@app/workers/queueNames';

type JobHandler = (jobs: unknown[]) => Promise<void>;

function fakeBoss() {
  const handlers = new Map<string, JobHandler>();
  const work = vi.fn(async (queue: string, handler: JobHandler) => {
    handlers.set(queue, handler);
  });
  return {
    boss: { work } as never,
    work,
    run: (queue: string) => handlers.get(queue)?.([{ id: 'job-1', name: queue, data: {} }]),
  };
}

describe('patreonMembershipRefreshWorker', () => {
  beforeEach(() => {
    mocks.isPatreonConfigured.mockReturnValue(true);
    mocks.find.mockResolvedValue([
      { id: 1, userId: 11 },
      { id: 2, userId: 22 },
      { id: 3, userId: 33 },
    ]);
    mocks.getPatreonConnection.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers on the Patreon refresh queue', async () => {
    const { boss, work } = fakeBoss();
    await registerPatreonMembershipRefreshWorker(boss);

    expect(work).toHaveBeenCalledWith(PATREON_MEMBERSHIP_REFRESH_QUEUE, expect.any(Function));
  });

  it('forces a fresh check of every linked membership', async () => {
    const { boss, run } = fakeBoss();
    await registerPatreonMembershipRefreshWorker(boss);
    await run(PATREON_MEMBERSHIP_REFRESH_QUEUE);

    expect(mocks.getPatreonConnection.mock.calls).toEqual([
      [11, true],
      [22, true],
      [33, true],
    ]);
  });

  it('checks one connection at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    mocks.getPatreonConnection.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return {};
    });

    await refreshPatreonMemberships();

    expect(peak).toBe(1);
  });

  it('logs a failing connection and carries on with the rest', async () => {
    mocks.getPatreonConnection.mockImplementation(async (userId: number) => {
      if (userId === 22) throw new Error('grant revoked');
      return {};
    });

    await expect(refreshPatreonMemberships()).resolves.toEqual({ checked: 2, failed: 1 });

    expect(mocks.getPatreonConnection).toHaveBeenCalledWith(33, true);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 22, err: expect.any(Error) }),
      expect.any(String),
    );
  });

  it('does not fail the job when every connection fails', async () => {
    mocks.getPatreonConnection.mockRejectedValue(new Error('Patreon is down'));
    const { boss, run } = fakeBoss();
    await registerPatreonMembershipRefreshWorker(boss);

    await expect(run(PATREON_MEMBERSHIP_REFRESH_QUEUE)).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledTimes(3);
  });

  it('skips the whole run when Patreon is not configured', async () => {
    mocks.isPatreonConfigured.mockReturnValue(false);

    await expect(refreshPatreonMemberships()).resolves.toEqual({ checked: 0, failed: 0 });

    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.getPatreonConnection).not.toHaveBeenCalled();
  });
});
