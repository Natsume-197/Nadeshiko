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
    if (url.includes('/mora_pitch')) return Response.json(JSON.parse(String(init?.body)));
    if (url.includes('/synthesis')) return new Response(new Uint8Array([82, 73, 70, 70]));
    return new Response('nope', { status: 500 });
  }) as typeof fetch;

  beforeEach(() => {
    calls.length = 0;
  });

  it('asks for the query of the text, the intonation of its accent and the audio, as the speaker', async () => {
    const client = httpVoicevox('http://127.0.0.1:50021/', 2, fetchImpl);

    const query = await client.audioQuery('はし');
    const phrases = await client.moraPitch([{ moras: [], accent: 2, pause_mora: null, is_interrogative: false }]);
    const wav = await client.synthesis(query as AudioQuery);

    expect(calls[0]?.url).toBe(`http://127.0.0.1:50021/audio_query?text=${encodeURIComponent('はし')}&speaker=2`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[1]?.url).toBe('http://127.0.0.1:50021/mora_pitch?speaker=2');
    expect(phrases[0]?.accent).toBe(2);
    expect(calls[2]?.url).toBe('http://127.0.0.1:50021/synthesis?speaker=2');
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual(query);
    expect(wav.toString('ascii')).toBe('RIFF');
  });

  /** A fetch that answers each call with the next of `replies` (an Error is thrown), counting the calls. */
  const scripted = (replies: Array<Response | Error>) => {
    let count = 0;
    const fetchImpl = (async () => {
      const reply = replies[Math.min(count++, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return reply;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => count };
  };
  const quick = { attempts: 3, firstWaitMs: 1 };

  it('retries a dropped connection or an engine error, and goes on when it answers', async () => {
    const { fetchImpl, calls } = scripted([
      new Error('read ECONNRESET'),
      new Response('restarting', { status: 503 }),
      Response.json({ accent_phrases: [] }),
    ]);

    await expect(httpVoicevox('http://127.0.0.1:50021', 2, fetchImpl, quick).audioQuery('はし')).resolves.toEqual({
      accent_phrases: [],
    });
    expect(calls()).toBe(3);
  });

  it('gives up after the last attempt, saying why', async () => {
    const { fetchImpl, calls } = scripted([new Response('down', { status: 503 })]);

    await expect(httpVoicevox('http://127.0.0.1:50021', 2, fetchImpl, quick).audioQuery('はし')).rejects.toThrow(
      'VOICEVOX /audio_query: HTTP 503',
    );
    expect(calls()).toBe(3);
  });

  it('does not retry a request the engine rejects', async () => {
    const { fetchImpl, calls } = scripted([new Response('bad text', { status: 422 })]);

    await expect(httpVoicevox('http://127.0.0.1:50021', 2, fetchImpl, quick).audioQuery('はし')).rejects.toThrow(
      'HTTP 422',
    );
    expect(calls()).toBe(1);
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
