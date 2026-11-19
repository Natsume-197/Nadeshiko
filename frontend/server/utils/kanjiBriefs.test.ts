import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, logger } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('~~/server/utils/logger', () => ({ logger }));
vi.stubGlobal('useRuntimeConfig', () => ({ backendInternalUrl: 'http://backend', internalProxySecret: 'x' }));
vi.stubGlobal('$fetch', fetchMock);

const { kanjiBriefs, resetKanjiBriefs } = await import('./kanjiBriefs');

const LIST = {
  kanji: [
    { character: '商', grade: 3, jlpt: 3, frequency: 1, reading: 'ショウ', meaning: 'make a deal' },
    { character: '売', grade: 2, jlpt: 4, frequency: 2, reading: 'バイ', meaning: 'sell' },
  ],
};

describe('kanji briefs for the word entry', () => {
  beforeEach(() => {
    resetKanjiBriefs();
    fetchMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('gives each kanji of the words its reading and meaning, from one load of the list', async () => {
    fetchMock.mockResolvedValue(LIST);

    expect(await kanjiBriefs(['商売', '商売人'])).toEqual({
      商: { reading: 'ショウ', meaning: 'make a deal' },
      売: { reading: 'バイ', meaning: 'sell' },
    });
    await kanjiBriefs(['売る']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks nothing for a word without kanji, and gives up quietly when the list cannot load', async () => {
    expect(await kanjiBriefs(['たべる'])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRejectedValue(new Error('down'));
    expect(await kanjiBriefs(['商売'])).toEqual({});
    expect(logger.warn).toHaveBeenCalled();
  });
});
