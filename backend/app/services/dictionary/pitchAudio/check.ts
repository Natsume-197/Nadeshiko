import { type HaPlan, sameMora, splitMorae } from './kana';

/**
 * The automatic check every pitch-audio clip passes before it is uploaded (task 40): the morae VOICEVOX made must be
 * the reading's, and the pitch track of the audio must fall where the downstep says. Judging by ear is unreliable, so
 * a clip that fails is left out and listed with the reason.
 */

/** One mora as VOICEVOX describes it, enough to place it in time. */
export interface TimedMora {
  text: string;
  vowel: string;
  consonant_length: number | null;
  vowel_length: number;
}

/** Minimum fall, in semitones, between the mora before the downstep and the one after it. */
export const DROP_SEMITONES = 1.5;

/** Problems with the morae VOICEVOX made for `reading`, empty when they are the reading's. */
export function checkMorae(reading: string, made: TimedMora[], ha: HaPlan): string[] {
  const expected = splitMorae(reading);
  if (expected.length !== made.length) {
    return [`morae: expected ${expected.join('')} (${expected.length}), got ${texts(made)} (${made.length})`];
  }
  const problems: string[] = [];
  expected.forEach((mora, index) => {
    const previous = index > 0 ? (made[index - 1]?.vowel ?? null) : null;
    const got = made[index]?.text ?? '';
    if (!sameMora(mora, got, previous, ha.get(index))) {
      problems.push(`mora ${index + 1}: expected ${mora}, got ${got} (${texts(made)})`);
    }
  });
  return problems;
}

const texts = (morae: TimedMora[]) => morae.map((mora) => mora.text).join('');

/** 16-bit PCM WAV (what VOICEVOX's `synthesis` returns) as mono samples in [-1, 1]. */
export function decodeWav(wav: Buffer): { sampleRate: number; samples: Float32Array } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let offset = 12;
  let channels = 1;
  let sampleRate = 0;
  let bits = 16;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(body + 2);
      sampleRate = wav.readUInt32LE(body + 4);
      bits = wav.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`WAV with ${bits}-bit samples`);
      const frames = Math.floor(Math.min(size, wav.length - body) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = wav.readInt16LE(body + i * 2 * channels) / 32768;
      return { sampleRate, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV without data');
}

export interface PitchTrackOptions {
  /** Seconds between frames. */
  hop?: number;
  /** Seconds analysed per frame. */
  window?: number;
  minHz?: number;
  maxHz?: number;
}

/**
 * Fundamental frequency per frame (YIN, de Cheveigné & Kawahara 2002), `null` where the frame is unvoiced or silent.
 * Frame i covers [i·hop, i·hop + window).
 */
export function pitchTrack(
  samples: Float32Array,
  sampleRate: number,
  { hop = 0.01, window = 0.025, minHz = 100, maxHz = 700 }: PitchTrackOptions = {},
): Array<number | null> {
  const size = Math.round(window * sampleRate);
  const step = Math.round(hop * sampleRate);
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.ceil(sampleRate / minHz);
  const diff = new Float64Array(maxLag + 2);
  const out: Array<number | null> = [];
  for (let start = 0; start + size + maxLag + 1 <= samples.length; start += step) {
    let energy = 0;
    for (let i = 0; i < size; i++) energy += (samples[start + i] ?? 0) ** 2;
    if (Math.sqrt(energy / size) < 0.01) {
      out.push(null);
      continue;
    }
    for (let lag = 1; lag <= maxLag + 1; lag++) {
      let sum = 0;
      for (let i = 0; i < size; i++) {
        const delta = (samples[start + i] ?? 0) - (samples[start + i + lag] ?? 0);
        sum += delta * delta;
      }
      diff[lag] = sum;
    }
    // Cumulative mean normalised difference, then the first dip under the threshold.
    let running = 0;
    let found = -1;
    const normalised = new Float64Array(maxLag + 2);
    normalised[0] = 1;
    for (let lag = 1; lag <= maxLag + 1; lag++) {
      running += diff[lag] ?? 0;
      normalised[lag] = running === 0 ? 1 : ((diff[lag] ?? 0) * lag) / running;
    }
    let lowest = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if ((normalised[lag] ?? 1) < (normalised[lowest] ?? 1)) lowest = lag;
      if ((normalised[lag] ?? 1) < 0.15) {
        while (lag + 1 <= maxLag && (normalised[lag + 1] ?? 1) < (normalised[lag] ?? 1)) lag++;
        found = lag;
        break;
      }
    }
    // A breathy vowel onset stays above the threshold: its deepest dip still gives the period when it is clear enough.
    if (found < 0 && (normalised[lowest] ?? 1) < 0.35) found = lowest;
    if (found < 0) {
      out.push(null);
      continue;
    }
    const before = normalised[found - 1] ?? 1;
    const at = normalised[found] ?? 1;
    const after = normalised[found + 1] ?? 1;
    const curve = before + after - 2 * at;
    const shift = curve === 0 ? 0 : (before - after) / (2 * curve);
    out.push(sampleRate / (found + shift));
  }
  return out;
}

/**
 * Median pitch of each mora's vowel, in semitones above 100 Hz, `null` where it has none (っ, a devoiced vowel).
 * Morae start after `lead` seconds of silence and follow each other with no gap, as VOICEVOX lays them out.
 */
export function moraPitches(
  track: Array<number | null>,
  morae: TimedMora[],
  lead: number,
  { hop = 0.01, window = 0.025 }: Pick<PitchTrackOptions, 'hop' | 'window'> = {},
): Array<number | null> {
  let at = lead;
  return morae.map((mora) => {
    const vowelStart = at + (mora.consonant_length ?? 0);
    const end = vowelStart + mora.vowel_length;
    at = end;
    const values: number[] = [];
    track.forEach((hz, frame) => {
      const centre = frame * hop + window / 2;
      if (hz !== null && centre >= vowelStart && centre < end) values.push(12 * Math.log2(hz / 100));
    });
    if (values.length < 2) return null;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? null;
  });
}

/** Our accent moves the pitch by about 5 semitones, so a mora measured 9 or more away from the pitch it was given is
 * the tracker locking onto half or twice the frequency (it does on ん): it is folded back by octaves. Without
 * `intended`, each mora is compared with the voiced one before it. */
export function foldOctaves(pitches: Array<number | null>, intended: Array<number | null> = []): Array<number | null> {
  let previous: number | null = null;
  return pitches.map((value, index) => {
    if (value === null) return null;
    const reference = intended[index] ?? previous;
    let folded = value;
    while (reference !== null && folded - reference <= -9) folded += 12;
    while (reference !== null && folded - reference >= 9) folded -= 12;
    previous = folded;
    return folded;
  });
}

/** A word-final ん fades as the voice stops, by up to about 3 semitones on a flat word; a fall onto it only counts
 * as the drop from this much. */
export const FINAL_N_DROP_SEMITONES = 3.5;

/** A fall before the downstep counts as the drop coming early only from this share of the drop itself. */
export const EARLY_SHARE = 0.6;

/**
 * Whether the pitch per mora follows the downstep: with a drop after mora d (1 ≤ d < n) the pitch falls across d by at
 * least {@link DROP_SEMITONES} and not before it; flat (0) and a drop after the last mora (which sounds flat said
 * alone) have no such fall. `morae` (katakana) marks a final ん, held to {@link FINAL_N_DROP_SEMITONES}; `intended` is
 * the pitch each mora was given, to undo octave errors. Returns the problem, or null when it follows.
 */
export function checkAccent(
  measured: Array<number | null>,
  downstep: number,
  morae: string[] = [],
  intended: Array<number | null> = [],
): string | null {
  const n = measured.length;
  const pitches = foldOctaves(measured, intended);
  const contour = pitches.map((value) => (value === null ? '–' : value.toFixed(1))).join(' ');
  const voiced = pitches.flatMap((value, index) => (value === null ? [] : [{ index, value }]));
  if (n >= 2 && voiced.length === 0) return `accent: no mora could be measured [${contour}]`;

  const finalN = morae[n - 1] === 'ン' ? n - 1 : -1;
  const falls: Array<{ after: number; before: number; size: number; needed: number }> = [];
  for (let i = 1; i < voiced.length; i++) {
    const a = voiced[i - 1];
    const b = voiced[i];
    if (a && b) {
      const needed = b.index === finalN ? FINAL_N_DROP_SEMITONES : DROP_SEMITONES;
      falls.push({ after: a.index, before: b.index, size: a.value - b.value, needed });
    }
  }
  const drops = falls.filter((fall) => fall.size >= fall.needed);

  if (downstep <= 0 || downstep >= n) {
    const [first] = drops;
    if (first)
      return `accent: expected no drop, fell ${first.size.toFixed(1)} st after mora ${first.after + 1} [${contour}]`;
    return null;
  }
  // The fall that spans the downstep: from the last voiced mora up to d to the first voiced one after it.
  // It starts from a HIGH mora: the first for a drop after it, else the second up to the downstep. With those all
  // voiceless (やすひと², す devoiced), the mora before is the low first one and the drop cannot be measured.
  const highStart = downstep === 1 ? 0 : 1;
  const across = falls.find((fall) => fall.after >= highStart && fall.after <= downstep - 1 && fall.before >= downstep);
  if (!across) return null; // no voiced mora on one side (a devoiced or っ mora at the edge): nothing to measure
  if (across.size < across.needed) {
    const elsewhere = drops.find((fall) => fall !== across);
    const where = elsewhere ? `, fell after mora ${elsewhere.after + 1} instead` : '';
    return `accent: expected a drop after mora ${downstep}, fell ${across.size.toFixed(1)} st${where} [${contour}]`;
  }
  // A fall that keeps going after the drop is fine (よう|に glides down through the long vowel); one before it is not,
  // unless it is small next to the drop: the pitch starts down late in the accented mora itself (いきのびる⁴: 2.1 st
  // into the び, then 7.8 st after it), which the median of that mora catches.
  const early = drops.find((fall) => fall.before <= downstep - 1 && fall.size >= EARLY_SHARE * across.size);
  if (early) {
    return `accent: expected the drop after mora ${downstep}, fell already after mora ${early.after + 1} [${contour}]`;
  }
  return null;
}
