import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { pitchAudioFile, pitchAudioUrl } from './audioUrl';
import type { SelectedClip } from './select';
import { makeClip, type PitchLevels, type VoicevoxClient } from './voicevox';

/**
 * Making, checking and registering the pitch-audio clips (task 40). `bin/generatePitchAudio.ts` drives it on the
 * operator's PC; production only receives the uploaded files and the manifest's rows.
 */

export interface ManifestClip {
  reading: string;
  downstep: number;
  file: string;
  bytes: number;
}

export interface Manifest {
  voice: string;
  generatedAt: string;
  clips: ManifestClip[];
}

export interface CheckReport {
  voice: string;
  checked: number;
  passed: number;
  failed: Array<{
    reading: string;
    downstep: number;
    rank: number | null;
    problems: string[];
    pitches: Array<number | null>;
  }>;
}

/** WAV to Opus 48 kbps mono in an Ogg file, through ffmpeg. */
export type Encoder = (wav: Buffer) => Promise<Buffer>;

export function ffmpegOpus(ffmpeg = 'ffmpeg'): Encoder {
  return (wav) =>
    new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, [
        ...['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0'],
        ...['-c:a', 'libopus', '-b:a', '48k', '-ac', '1', '-f', 'ogg', 'pipe:1'],
      ]);
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve(Buffer.concat(out))
          : reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString().trim()}`)),
      );
      child.stdin.end(wav);
    });
}

export interface GenerateOptions {
  outDir: string;
  voice: string;
  client: VoicevoxClient;
  encode: Encoder;
  levels?: PitchLevels;
  /** Clips made at once. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Makes every clip that is not already in `outDir`, checks it, and writes the ones that pass. A rerun makes only
 * what is missing; a clip that failed is tried again (the engine is deterministic, so it fails again unless something
 * changed). Writes `manifest.json` (every clip in the folder that belongs to the selection) and `report.json` (the
 * clips that failed and why).
 */
export async function generateClips(
  clips: SelectedClip[],
  { outDir, voice, client, encode, levels, concurrency = 3, onProgress }: GenerateOptions,
): Promise<{ manifest: Manifest; report: CheckReport; made: number; kept: number }> {
  await mkdir(outDir, { recursive: true });
  const manifest: Array<ManifestClip | undefined> = new Array(clips.length);
  const failed: CheckReport['failed'] = [];
  let made = 0;
  let kept = 0;
  let checked = 0;
  let done = 0;
  let next = 0;

  const work = async (): Promise<void> => {
    while (next < clips.length) {
      const index = next++;
      const clip = clips[index];
      if (!clip) continue;
      const file = pitchAudioFile(clip.reading, clip.downstep);
      const path = join(outDir, file);
      const existing = await stat(path).catch(() => null);
      if (existing && existing.size > 0) {
        manifest[index] = { reading: clip.reading, downstep: clip.downstep, file, bytes: existing.size };
        kept++;
      } else {
        const result = await makeClip(client, clip, levels);
        checked++;
        if (result.wav && result.problems.length === 0) {
          const opus = await encode(result.wav);
          await writeFile(path, opus);
          manifest[index] = { reading: clip.reading, downstep: clip.downstep, file, bytes: opus.length };
          made++;
        } else {
          failed.push({
            reading: clip.reading,
            downstep: clip.downstep,
            rank: clip.rank,
            problems: result.problems,
            pitches: result.pitches.map((value) => (value === null ? null : Math.round(value * 10) / 10)),
          });
        }
      }
      onProgress?.(++done, clips.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, work));

  const result = {
    manifest: {
      voice,
      generatedAt: new Date().toISOString(),
      clips: manifest.filter((clip): clip is ManifestClip => clip !== undefined),
    },
    report: {
      voice,
      checked,
      passed: checked - failed.length,
      failed: failed.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)),
    },
    made,
    kept,
  };
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(result.manifest, null, 1)}\n`);
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(result.report, null, 1)}\n`);
  return result;
}

export async function readManifest(path: string): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest;
  if (!manifest.voice || !Array.isArray(manifest.clips)) throw new Error(`${path} is not a pitch-audio manifest`);
  return manifest;
}

export interface RegisterOptions {
  baseUrl: string;
  /** Clips whose URL must answer 200 before anything is written. */
  sample?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Replaces the registered clips with the manifest's, after checking a sample of their URLs answers 200 (the upload
 * went where the card will look). One transaction: the card sees the old set or the new one.
 */
export async function registerManifest(
  dataSource: DataSource,
  manifest: Manifest,
  { baseUrl, sample = 20, fetchImpl = fetch }: RegisterOptions,
): Promise<{ registered: number; checkedUrls: string[] }> {
  const step = Math.max(1, Math.floor(manifest.clips.length / Math.max(1, sample)));
  const picked = manifest.clips.filter((_, index) => index % step === 0).slice(0, sample);
  const urls = picked.map((clip) => pitchAudioUrl(baseUrl, manifest.voice, clip.reading, clip.downstep));
  for (const url of urls) {
    const response = await fetchImpl(url, { method: 'HEAD' });
    if (response.status !== 200) throw new Error(`${url} answered ${response.status}; upload the clips first`);
  }

  await dataSource.transaction(async (manager) => {
    await manager.query(`DELETE FROM dict.pitch_audio`);
    const batch = 5000;
    for (let start = 0; start < manifest.clips.length; start += batch) {
      const rows = manifest.clips
        .slice(start, start + batch)
        .map((clip) => ({ reading: clip.reading, downstep: clip.downstep }));
      await manager.query(
        `INSERT INTO dict.pitch_audio (reading, downstep, voice, generated_at)
         SELECT x.reading, x.downstep, $2, $3
           FROM jsonb_to_recordset($1::jsonb) AS x(reading varchar, downstep smallint)
         ON CONFLICT (reading, downstep) DO NOTHING`,
        [JSON.stringify(rows), manifest.voice, manifest.generatedAt],
      );
    }
  });
  return { registered: manifest.clips.length, checkedUrls: urls };
}
