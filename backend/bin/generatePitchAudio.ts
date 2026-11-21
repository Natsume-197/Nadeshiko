import '@config/boot';
import { parseArgs } from 'node:util';
import { AppDataSource } from '@config/database';
import { config } from '@config/config';
import { logger } from '@config/log';
import { selectClips } from '@app/services/dictionary/pitchAudio/select';
import {
  ffmpegOpus,
  generateClips,
  readManifest,
  registerManifest,
} from '@app/services/dictionary/pitchAudio/generate';
import { httpVoicevox } from '@app/services/dictionary/pitchAudio/voicevox';
import { runWithDatabase } from './lib/runWithDatabase';

/**
 * Pitch-audio clips for the word card's ▶ (task 40). Two modes:
 *
 * Generate, on the operator's PC (needs a VOICEVOX engine and ffmpeg; reads the dictionary and `dict.frequency`):
 *   node --import tsx bin/generatePitchAudio.ts --out <folder> [--top N] \
 *     [--voicevox http://127.0.0.1:50021] [--speaker 2] [--voice metan-v1] [--concurrency 3] [--dry-run]
 * Every dictionary word with a pitch, most frequent first (about 90,000 clips, ~4 h), or only the N most frequent
 * with --top. Makes the missing clips, checks each one (morae and accent), keeps those that pass, and writes manifest.json and
 * report.json into the folder. Upload the folder's .opus files to R2 under pitch-audio/<voice>/ afterwards.
 *
 * Register, wherever the database is (production: inside the web container):
 *   node --import tsx bin/generatePitchAudio.ts --register <folder>/manifest.json [--sample 20]
 * Checks a sample of the clips answers 200 under R2_BASE_URL, then replaces dict.pitch_audio with the manifest.
 */
const { values } = parseArgs({
  options: {
    top: { type: 'string', default: 'all' },
    out: { type: 'string' },
    voicevox: { type: 'string', default: 'http://127.0.0.1:50021' },
    speaker: { type: 'string', default: '2' },
    voice: { type: 'string', default: 'metan-v1' },
    concurrency: { type: 'string', default: '3' },
    ffmpeg: { type: 'string', default: 'ffmpeg' },
    register: { type: 'string' },
    sample: { type: 'string', default: '20' },
    'dry-run': { type: 'boolean', default: false },
  },
});

async function generate(): Promise<void> {
  const top = values.top === 'all' ? 'all' : Number(values.top);
  if (top !== 'all' && !(Number.isInteger(top) && top > 0)) throw new Error('--top takes a positive number or all');
  const clips = await selectClips(AppDataSource, top);
  logger.info({ top, clips: clips.length }, 'pitch audio: clips selected');
  if (values['dry-run']) return;
  if (!values.out) throw new Error('--out <folder> is required');

  const startedAt = Date.now();
  const { report, made, kept } = await generateClips(clips, {
    outDir: values.out,
    voice: values.voice,
    client: httpVoicevox(values.voicevox, Number(values.speaker)),
    encode: ffmpegOpus(values.ffmpeg),
    concurrency: Number(values.concurrency),
    onProgress: (done, total) => {
      if (done % 500 === 0 || done === total) logger.info({ done, total }, 'pitch audio: progress');
    },
  });
  logger.info(
    {
      made,
      kept,
      checked: report.checked,
      passed: report.passed,
      failed: report.failed.length,
      passRate: report.checked ? `${((100 * report.passed) / report.checked).toFixed(1)}%` : null,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    },
    'pitch audio: generated (failures in report.json)',
  );
}

async function register(path: string): Promise<void> {
  const manifest = await readManifest(path);
  const result = await registerManifest(AppDataSource, manifest, {
    baseUrl: config.R2_BASE_URL,
    sample: Number(values.sample),
  });
  logger.info({ voice: manifest.voice, ...result }, 'pitch audio: registered');
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  if (values.register) await register(values.register);
  else await generate();
}

runWithDatabase('pitch audio', main);
