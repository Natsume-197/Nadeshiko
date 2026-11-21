import { checkAccent, checkMorae, decodeWav, moraPitches, pitchTrack } from './check';
import { accentFor, type HaPlan, splitMorae, synthesisText } from './kana';

/**
 * Making one pitch-audio clip with a VOICEVOX engine (task 40). Runs on the operator's PC, never in production.
 * VOICEVOX's terms ask for the credit "VOICEVOX:<voice>" where users can see it; it is on the sources page.
 */

export interface VoicevoxMora {
  text: string;
  consonant: string | null;
  consonant_length: number | null;
  vowel: string;
  vowel_length: number;
  pitch: number;
}

export interface AccentPhrase {
  moras: VoicevoxMora[];
  accent: number;
  pause_mora: VoicevoxMora | null;
  is_interrogative: boolean;
}

/** VOICEVOX's `AudioQuery`; fields this code does not touch pass through. */
export interface AudioQuery {
  accent_phrases: AccentPhrase[];
  speedScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  outputSamplingRate: number;
  [field: string]: unknown;
}

/** The two engine calls a clip needs, behind an interface so tests need no engine. */
export interface VoicevoxClient {
  audioQuery(text: string): Promise<AudioQuery>;
  /** VOICEVOX's own intonation for accent phrases whose `accent` is set. */
  moraPitch(phrases: AccentPhrase[]): Promise<AccentPhrase[]>;
  synthesis(query: AudioQuery): Promise<Buffer>;
}

export interface RetryOptions {
  /** Attempts per call, the first included. */
  attempts?: number;
  /** Wait before the first retry, doubled for each one after. */
  firstWaitMs?: number;
}

/**
 * A run makes over 100,000 clips for hours: a dropped connection or an engine restarting must not end it. A call
 * that fails on the network or with a 5xx is retried with a doubling wait (1, 2, 4, 8, 16 s by default, about half a
 * minute in all); a 4xx is the request's fault and fails at once. Still failing after that, the run stops, and a rerun
 * makes only what is missing.
 */
export function httpVoicevox(
  baseUrl: string,
  speaker: number,
  fetchImpl: typeof fetch = fetch,
  { attempts = 6, firstWaitMs = 1000 }: RetryOptions = {},
): VoicevoxClient {
  const base = baseUrl.replace(/\/$/, '');
  const call = async (path: string, body?: unknown): Promise<Response> => {
    const name = path.split('?')[0];
    let failure: Error = new Error(`VOICEVOX ${name}: no attempt`);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await new Promise((wake) => setTimeout(wake, firstWaitMs * 2 ** (attempt - 2)));
      let response: Response;
      try {
        response = await fetchImpl(`${base}${path}${path.includes('?') ? '&' : '?'}speaker=${speaker}`, {
          method: 'POST',
          ...(body === undefined
            ? {}
            : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        });
      } catch (error) {
        failure = new Error(`VOICEVOX ${name}: ${(error as Error).message}`, { cause: error });
        continue;
      }
      if (response.ok) return response;
      failure = new Error(`VOICEVOX ${name}: HTTP ${response.status}`);
      if (response.status < 500) break;
    }
    throw failure;
  };
  return {
    audioQuery: async (text) =>
      (await (await call(`/audio_query?text=${encodeURIComponent(text)}`)).json()) as AudioQuery,
    moraPitch: async (phrases) => (await (await call('/mora_pitch', phrases)).json()) as AccentPhrase[],
    synthesis: async (query) => Buffer.from(await (await call('/synthesis', query)).arrayBuffer()),
  };
}

/** Sample rate and the silence around the word: enough that a player slow to start or quick to stop (a Bluetooth
 * headset, a short clip in a browser) keeps the first and last sound. */
export const CLIP_SETTINGS = { outputSamplingRate: 24000, prePhonemeLength: 0.1, postPhonemeLength: 0.15 } as const;

/**
 * Semitones the pitch must fall across the downstep. VOICEVOX's own contour for a word said alone often barely falls
 * (median 0.1 st over the top 300 words), so the accent is not heard. Measured on those words: asking for 5 st makes
 * 94% of clips pass the check with the fewest pitch dips, and more gains nothing. Real speech falls further (~9 st).
 */
export const ACCENT_DROP_SEMITONES = 5;

const toSemitones = (pitch: number) => 12 * Math.log2(Math.exp(pitch) / 100);
const fromSemitones = (semitones: number) => Math.log(100 * 2 ** (semitones / 12));

/**
 * VOICEVOX's own pitch per mora, moved only where it contradicts the downstep, so the word keeps the engine's
 * natural intonation: the high morae (the first for a drop after it, otherwise the second up to the downstep) no
 * more than 1 semitone under the highest of them, a first mora that must rise at least 1.5 under them, and every
 * mora after the downstep at least `drop` under the lowest high one. Flat (0) and a drop after the last mora (which
 * sounds flat said alone) have no drop. Replacing the whole contour with fixed levels sounded mechanical, with dips
 * and steps. Voiceless morae (pitch 0: っ, a devoiced vowel) stay voiceless.
 */
export function fitAccent(
  morae: VoicevoxMora[],
  downstep: number,
  drop: number = ACCENT_DROP_SEMITONES,
): VoicevoxMora[] {
  const n = morae.length;
  const d = downstep <= 0 || downstep >= n ? n : downstep;
  const pitch = morae.map((mora) => (mora.pitch > 0 ? toSemitones(mora.pitch) : null));
  const high = [...Array(n).keys()].filter((i) => (d === 1 ? i === 0 : i >= 1 && i < d) && pitch[i] !== null);
  if (high.length === 0) return morae;
  const top = Math.max(...high.map((i) => pitch[i] ?? -Infinity));
  for (const i of high) pitch[i] = Math.max(pitch[i] ?? top, top - 1);
  const floor = Math.min(...high.map((i) => pitch[i] ?? Infinity));
  const first = pitch[0];
  if (d !== 1 && first != null) pitch[0] = Math.min(first, floor - 1.5);
  for (let i = d; i < n; i++) {
    const value = pitch[i];
    if (value != null) pitch[i] = Math.min(value, floor - drop);
  }
  return morae.map((mora, i) => {
    const value = pitch[i];
    return mora.pitch > 0 && value != null ? { ...mora, pitch: fromSemitones(value) } : mora;
  });
}

/** Rewrites each は/へ mora to how the word says it ({@link HaPlan}); `either` keeps the engine's reading. */
export function applyHaPlan(morae: VoicevoxMora[], reading: string, plan: HaPlan): VoicevoxMora[] {
  const expected = splitMorae(reading);
  return morae.map((mora, index) => {
    const sound = plan.get(index);
    if (!sound || sound === 'either') return mora;
    const isHa = expected[index] === 'ハ';
    if (sound === 'literal') return { ...mora, text: isHa ? 'ハ' : 'ヘ', consonant: 'h', vowel: isHa ? 'a' : 'e' };
    return { ...mora, text: isHa ? 'ワ' : 'エ', consonant: isHa ? 'w' : null, vowel: isHa ? 'a' : 'e' };
  });
}

export interface ClipRequest {
  /** Hiragana reading, as `dict.pitch` keeps it. */
  reading: string;
  downstep: number;
  ha: HaPlan;
}

export interface ClipResult {
  wav: Buffer | null;
  /** Empty when the clip passed the check. */
  problems: string[];
  /** Measured pitch of each mora, in semitones above 100 Hz (`null` where voiceless), for the report. */
  pitches: Array<number | null>;
}

/**
 * One clip: the hiragana reading through `audio_query` (morae and their lengths), its accent phrases joined into one,
 * は/へ fixed, VOICEVOX's own intonation for our downstep (`mora_pitch`), fitted where it contradicts the accent, then
 * synthesised and checked.
 */
export async function makeClip(client: VoicevoxClient, clip: ClipRequest): Promise<ClipResult> {
  const query = await client.audioQuery(synthesisText(clip.reading));
  const raw = query.accent_phrases.flatMap((phrase) => phrase.moras);
  // Count first: with the wrong number of morae, the downstep cannot be placed.
  if (raw.length !== splitMorae(clip.reading).length) {
    return { wav: null, problems: checkMorae(clip.reading, raw, clip.ha), pitches: [] };
  }

  const morae = applyHaPlan(raw, clip.reading, clip.ha);
  const accent = accentFor(clip.downstep, morae.length);
  const [natural] = await client.moraPitch([{ moras: morae, accent, pause_mora: null, is_interrogative: false }]);
  if (!natural) return { wav: null, problems: ['VOICEVOX returned no accent phrase'], pitches: [] };
  const final: AccentPhrase = { ...natural, moras: fitAccent(natural.moras, clip.downstep) };

  const wav = await client.synthesis({ ...query, ...CLIP_SETTINGS, speedScale: 1, accent_phrases: [final] });
  const problems = checkMorae(clip.reading, final.moras, clip.ha);
  const { samples, sampleRate } = decodeWav(wav);
  const pitches = moraPitches(pitchTrack(samples, sampleRate), final.moras, CLIP_SETTINGS.prePhonemeLength);
  const intended = final.moras.map((mora) => (mora.pitch > 0 ? toSemitones(mora.pitch) : null));
  const accentProblem = checkAccent(pitches, clip.downstep, splitMorae(clip.reading), intended);
  if (accentProblem) problems.push(accentProblem);
  return { wav, problems, pitches };
}
