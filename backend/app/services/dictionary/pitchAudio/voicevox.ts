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
  synthesis(query: AudioQuery): Promise<Buffer>;
}

export function httpVoicevox(baseUrl: string, speaker: number, fetchImpl: typeof fetch = fetch): VoicevoxClient {
  const base = baseUrl.replace(/\/$/, '');
  const call = async (path: string, body?: unknown): Promise<Response> => {
    const response = await fetchImpl(`${base}${path}${path.includes('?') ? '&' : '?'}speaker=${speaker}`, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`VOICEVOX ${path.split('?')[0]}: HTTP ${response.status}`);
    return response;
  };
  return {
    audioQuery: async (text) =>
      (await (await call(`/audio_query?text=${encodeURIComponent(text)}`)).json()) as AudioQuery,
    synthesis: async (query) => Buffer.from(await (await call('/synthesis', query)).arrayBuffer()),
  };
}

/** Sample rate, padding and speed every clip is made with. */
export const CLIP_SETTINGS = { outputSamplingRate: 24000, prePhonemeLength: 0.05, postPhonemeLength: 0.05 } as const;

/**
 * Pitch levels of a voice, in semitones above 100 Hz: `high` for the morae before the drop, `low` for a first mora
 * that rises, `fallen` for the morae after the drop, and `slope` lost per mora so a long word does not sound flat
 * and mechanical.
 */
export interface PitchLevels {
  high: number;
  low: number;
  fallen: number;
  slope: number;
}

/** 四国めたん ノーマル, from the range VOICEVOX itself gives her (about 17 to 25 semitones above 100 Hz). */
export const METAN_LEVELS: PitchLevels = { high: 23.5, low: 19.5, fallen: 18.5, slope: 0.3 };

/**
 * Each mora's pitch from the downstep, Tokyo style: the first mora low and the rest high (flat, 0), the first high
 * and the rest fallen (1), or low, high up to mora d, then fallen. A drop after the last mora is flat said alone.
 * VOICEVOX's own intonation is not used: for words said alone it often misses the drop (雨 came out flat) or adds
 * one at the end (電車, flat, fell on its last mora). Morae VOICEVOX leaves voiceless (pitch 0: っ, a devoiced vowel)
 * stay voiceless.
 */
export function shapePitch(morae: VoicevoxMora[], downstep: number, levels: PitchLevels): VoicevoxMora[] {
  const n = morae.length;
  const drop = downstep <= 0 || downstep >= n ? n : downstep;
  return morae.map((mora, index) => {
    if (mora.pitch === 0) return mora;
    const position = index + 1;
    const semitones =
      position > drop
        ? levels.fallen - levels.slope * (position - drop - 1)
        : position === 1 && drop !== 1
          ? levels.low
          : levels.high - levels.slope * (position - (drop === 1 ? 1 : 2));
    return { ...mora, pitch: Math.log(100 * 2 ** (semitones / 12)) };
  });
}

/** Voiced consonants, lengthened so they are not swallowed in a short word. */
const VOICED = new Set(['b', 'd', 'g', 'z', 'j', 'dy', 'by', 'gy', 'zy']);
const VOICED_FACTOR = 2;
const VOICED_MIN_SECONDS = 0.1;

export function lengthenVoiced(morae: VoicevoxMora[]): VoicevoxMora[] {
  return morae.map((mora) =>
    mora.consonant && VOICED.has(mora.consonant)
      ? {
          ...mora,
          consonant_length: Math.max((mora.consonant_length ?? 0) * VOICED_FACTOR, VOICED_MIN_SECONDS),
        }
      : mora,
  );
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
 * One clip: the hiragana reading through `audio_query` (for its morae and their lengths), its accent phrases joined
 * into one, は/へ fixed, each mora's pitch set from our downstep, voiced consonants lengthened, then synthesised and
 * checked.
 */
export async function makeClip(
  client: VoicevoxClient,
  clip: ClipRequest,
  levels: PitchLevels = METAN_LEVELS,
): Promise<ClipResult> {
  const query = await client.audioQuery(synthesisText(clip.reading));
  const raw = query.accent_phrases.flatMap((phrase) => phrase.moras);
  // Count first: with the wrong number of morae, the downstep cannot be placed.
  if (raw.length !== splitMorae(clip.reading).length) {
    return { wav: null, problems: checkMorae(clip.reading, raw, clip.ha), pitches: [] };
  }

  const morae = applyHaPlan(raw, clip.reading, clip.ha);
  const final: AccentPhrase = {
    moras: lengthenVoiced(shapePitch(morae, clip.downstep, levels)),
    accent: accentFor(clip.downstep, morae.length),
    pause_mora: null,
    is_interrogative: false,
  };

  const wav = await client.synthesis({ ...query, ...CLIP_SETTINGS, speedScale: 1, accent_phrases: [final] });
  const problems = checkMorae(clip.reading, final.moras, clip.ha);
  const { samples, sampleRate } = decodeWav(wav);
  const pitches = moraPitches(pitchTrack(samples, sampleRate), final.moras, CLIP_SETTINGS.prePhonemeLength);
  const intended = final.moras.map((mora) => (mora.pitch > 0 ? 12 * Math.log2(Math.exp(mora.pitch) / 100) : null));
  const accent = checkAccent(pitches, clip.downstep, splitMorae(clip.reading), intended);
  if (accent) problems.push(accent);
  return { wav, problems, pitches };
}
