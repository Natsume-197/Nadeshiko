import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { prepareAudioExport, sentenceAudioExportSource } from './audioExport';
import { encodeWav } from './wav';
import { normalizeExportPercent } from './exportMedia';
import { downloadAudioOrImage } from './media';
import type { SearchResult } from '~/types/search';

const pcm = {
  numberOfChannels: 2,
  length: 3,
  sampleRate: 48000,
  getChannelData: (channel: number) => new Float32Array(channel === 0 ? [1, -1, 0] : [0.5, -0.5, 0.25]),
};
const decoded = vi.fn().mockResolvedValue(pcm);
const close = vi.fn().mockResolvedValue(undefined);
const fetchMock = vi.fn();
const Context = vi.fn(
  class {
    decodeAudioData = decoded;
    close = close;
  },
);
const source = { kind: 'url' as const, url: 'https://cdn.test/clip.mp3', filename: 'clip.mp3' };

beforeEach(() => {
  vi.clearAllMocks();
  decoded.mockResolvedValue(pcm);
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => new Response('mp3-source'));
});
afterEach(() => vi.unstubAllGlobals());

describe('audio export', () => {
  test('keeps original URLs and blobs without fetching or decoding at 100%', async () => {
    expect(await prepareAudioExport(source, normalizeExportPercent(100))).toBe(source);
    const expanded = { kind: 'blob' as const, blob: new Blob(['original']), filename: 'expanded.wav' };
    expect(await prepareAudioExport(expanded, normalizeExportPercent(100))).toBe(expanded);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Context).not.toHaveBeenCalled();
  });

  test('writes an attenuated stereo PCM WAV with the same rate, duration, and channel order', async () => {
    const result = await prepareAudioExport(source, normalizeExportPercent(50));
    expect(result.filename).toBe('clip-volume-50.wav');
    expect(result.kind).toBe('blob');
    if (result.kind !== 'blob') throw new Error('expected converted audio');
    const view = new DataView(await result.blob.arrayBuffer());
    expect(result.blob.type).toBe('audio/wav');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(12);
    expect(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([
      16383, 8191, -16384, -8192, 0, 4095,
    ]);
    expect(pcm.getChannelData(0)[0]).toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });

  test('attenuates an expanded blob without a CDN fetch', async () => {
    const blob = new Blob(['expanded']);
    const result = await prepareAudioExport(
      { kind: 'blob', blob, filename: 'clip-expanded-0-4000.wav' },
      normalizeExportPercent(25),
    );
    expect(result.filename).toBe('clip-expanded-0-4000-volume-25.wav');
    expect(decoded).toHaveBeenCalledWith(await blob.arrayBuffer());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('keeps different volume variants distinct', async () => {
    const names = await Promise.all(
      [25, 50, 75, 100].map(
        async (volume) => (await prepareAudioExport(source, normalizeExportPercent(volume))).filename,
      ),
    );
    expect(new Set(names).size).toBe(4);
  });

  test('propagates fetch and decode errors without substituting the original', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(prepareAudioExport(source, normalizeExportPercent(50))).rejects.toMatchObject({ status: 403 });
    expect(Context).not.toHaveBeenCalled();
    decoded.mockRejectedValueOnce(new Error('unsupported audio'));
    await expect(prepareAudioExport(source, normalizeExportPercent(50))).rejects.toThrow('unsupported audio');
    expect(close).toHaveBeenCalledOnce();
  });

  test('invalid persisted preferences restore the original, never amplification or silence', () => {
    for (const value of [0, -1, 150, NaN, '50', null, undefined, {}]) {
      expect(normalizeExportPercent(value)).toBe(100);
    }
    expect(normalizeExportPercent(25)).toBe(25);
  });
});

test('expanded filenames identify the segment and clip window', () => {
  const sentence = {
    segment: { publicId: 'clip', urls: { audioUrl: source.url }, startTimeMs: 1000, endTimeMs: 2000 },
    blobAudioUrl: 'blob:expanded',
    blobAudio: new Blob(['expanded']),
    expandedWindow: { startMs: 1000, endMs: 4000 },
  } as SearchResult;
  expect(sentenceAudioExportSource(sentence).filename).toBe('clip-expanded-1000-4000.wav');
  sentence.expandedWindow = { startMs: 0, endMs: 4000 };
  expect(sentenceAudioExportSource(sentence).filename).toBe('clip-expanded-0-4000.wav');
  sentence.blobAudio = null;
  expect(sentenceAudioExportSource(sentence)).toEqual({ ...source, filename: 'clip.mp3' });
});

test('WAV encoding preserves mono audio and clamps samples outside PCM range', async () => {
  const blob = encodeWav({ ...pcm, numberOfChannels: 1, getChannelData: () => new Float32Array([2, -2, 0.5]) });
  const view = new DataView(await blob.arrayBuffer());
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getInt16(44, true)).toBe(32767);
  expect(view.getInt16(46, true)).toBe(-32768);
  expect(view.getInt16(48, true)).toBe(16383);
});

test('downloading a WAV does not replace mp3 inside the segment identifier', () => {
  const anchor = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('document', { createElement: () => anchor });
  vi.stubGlobal('usePostHog', () => null);
  vi.stubGlobal('useSignupNudge', () => ({ nudgeAfterDownload: vi.fn() }));
  downloadAudioOrImage('blob:converted', 'mp3-clip-volume-50.wav', true);
  expect(anchor.download).toBe('mp3-clip-volume-50.wav');
  expect(anchor.click).toHaveBeenCalledOnce();
});
