import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNadeshikoClient, NadeshikoError } from '@brigadasos/nadeshiko-sdk';
import { trackPlayActivity } from './playActivity';
import { reportError, reportEvent } from './reportError';

vi.mock('./reportError', () => ({ reportError: vi.fn(), reportEvent: vi.fn() }));

const activity = {
  activityType: 'SEGMENT_PLAY',
  segmentPublicId: 'seg123456789',
  mediaPublicId: 'abcdefghijkl',
  mediaName: 'Example',
  japaneseText: '猫がいる',
} as const;
const fetchMock = vi.fn<typeof fetch>();

function client() {
  return createNadeshikoClient({ baseURL: 'https://nadeshiko.test', sessionToken: () => undefined });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('trackPlayActivity', () => {
  it('sends the play payload with keepalive so it can finish after page unload', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await trackPlayActivity(client(), activity);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected the SDK to send a Request');
    expect(request.url).toBe('https://nadeshiko.test/v1/user/activity');
    expect(request.method).toBe('POST');
    expect(request.keepalive).toBe(true);
    expect(await request.json()).toEqual(activity);
    expect(reportError).not.toHaveBeenCalled();
    expect(reportEvent).not.toHaveBeenCalled();
  });

  it.each([new TypeError('Failed to fetch'), new DOMException('The operation was aborted.', 'AbortError')])(
    'counts transport failures without reporting an exception: %s',
    async (error) => {
      fetchMock.mockRejectedValue(error);

      await expect(trackPlayActivity(client(), activity)).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(reportError).not.toHaveBeenCalled();
      expect(reportEvent).toHaveBeenCalledWith('play_activity_failed', { reason: 'transport' });
    },
  );

  it.each([400, 401, 403, 429, 500, 502, 504])('keeps HTTP %i failures visible as exceptions', async (status) => {
    fetchMock.mockResolvedValue(new Response('Upstream failure', { status }));

    await expect(trackPlayActivity(client(), activity)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('player:track-play-activity-failed', expect.objectContaining({ status }));
    expect(vi.mocked(reportError).mock.calls[0]![1]).toBeInstanceOf(NadeshikoError);
    expect(reportEvent).not.toHaveBeenCalled();
  });
});
