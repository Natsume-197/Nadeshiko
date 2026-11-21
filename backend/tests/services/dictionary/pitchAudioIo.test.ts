import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foldOctaves } from '@app/services/dictionary/pitchAudio/check';
import { ffmpegOpus, readManifest } from '@app/services/dictionary/pitchAudio/generate';
import { type AudioQuery, httpVoicevox } from '@app/services/dictionary/pitchAudio/voicevox';

/** The engine and file side of the pitch-audio clips (task 40): no database here. */

describe('httpVoicevox', () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/audio_query')) return Response.json({ accent_phrases: [], speedScale: 1 });
    if (url.includes('/synthesis')) return new Response(new Uint8Array([82, 73, 70, 70]));
    return new Response('nope', { status: 500 });
  }) as typeof fetch;

  beforeEach(() => {
    calls.length = 0;
  });

  it('asks for the query of the text and the speaker, then posts it back to synthesise', async () => {
    const client = httpVoicevox('http://127.0.0.1:50021/', 2, fetchImpl);

    const query = await client.audioQuery('はし');
    const wav = await client.synthesis(query as AudioQuery);

    expect(calls[0]?.url).toBe(`http://127.0.0.1:50021/audio_query?text=${encodeURIComponent('はし')}&speaker=2`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[1]?.url).toBe('http://127.0.0.1:50021/synthesis?speaker=2');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual(query);
    expect(wav.toString('ascii')).toBe('RIFF');
  });

  it('fails on an engine error', async () => {
    const broken = httpVoicevox(
      'http://127.0.0.1:50021',
      2,
      (async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
    );

    await expect(broken.audioQuery('はし')).rejects.toThrow('VOICEVOX /audio_query: HTTP 503');
  });
});

describe('ffmpegOpus', () => {
  it('reports an ffmpeg that cannot run', async () => {
    await expect(ffmpegOpus('no-such-ffmpeg-binary')(Buffer.from('RIFF'))).rejects.toThrow();
  });

  it('reports what ffmpeg says when it fails', async () => {
    // Node in ffmpeg's place rejects ffmpeg's options and exits non-zero.
    await expect(ffmpegOpus(process.execPath)(Buffer.from('RIFF'))).rejects.toThrow(/exited/);
  });
});

describe('readManifest', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pitch-manifest-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a manifest and refuses any other JSON', async () => {
    const good = join(dir, 'manifest.json');
    const bad = join(dir, 'report.json');
    await writeFile(good, JSON.stringify({ voice: 'metan-v1', generatedAt: 'x', clips: [] }));
    await writeFile(bad, JSON.stringify({ checked: 1 }));

    expect((await readManifest(good)).voice).toBe('metan-v1');
    await expect(readManifest(bad)).rejects.toThrow(/not a pitch-audio manifest/);
  });
});

describe('foldOctaves', () => {
  it('compares with the mora before when no intended pitch is given', () => {
    expect(foldOctaves([20, 8.5, null, 31])).toEqual([20, 20.5, null, 19]);
  });
});
