import type { DataSource } from 'typeorm';
import { toHiragana } from '../import/entries';

/**
 * Where a pitch-audio clip is served and which patterns of the word card have one (task 40). Clips are static files on
 * R2 under `pitch-audio/<voice>/`, made once on the operator's PC; `dict.pitch_audio` lists the ones uploaded, so
 * the card shows ▶ only for those.
 */

/** File name of the clip for one reading and downstep. */
export function pitchAudioFile(reading: string, downstep: number): string {
  return `${toHiragana(reading)}_${downstep}.opus`;
}

/** R2 key of a clip, under the bucket's root. */
export function pitchAudioKey(voice: string, reading: string, downstep: number): string {
  return `pitch-audio/${voice}/${pitchAudioFile(reading, downstep)}`;
}

export function pitchAudioUrl(baseUrl: string, voice: string, reading: string, downstep: number): string {
  return `${baseUrl.replace(/\/$/, '')}/pitch-audio/${encodeURIComponent(voice)}/${encodeURIComponent(
    pitchAudioFile(reading, downstep),
  )}`;
}

type WithPitch = { reading: string | null; pitch?: Array<{ downstep: number; audioUrl?: string | null }> };

/**
 * Sets `audioUrl` on every pitch pattern that has an uploaded clip, by the candidate's reading and the pattern's
 * downstep, whichever dictionary the pattern came from: a clip is how the reading sounds with that accent.
 */
export async function withPitchAudio<T extends WithPitch>(
  dataSource: DataSource,
  baseUrl: string,
  candidates: T[],
): Promise<T[]> {
  const wanted = candidates.flatMap((candidate) =>
    candidate.reading
      ? (candidate.pitch ?? []).map((pattern) => ({
          reading: toHiragana(candidate.reading ?? ''),
          downstep: pattern.downstep,
        }))
      : [],
  );
  if (wanted.length === 0) return candidates;

  const rows: Array<{ reading: string; downstep: number; voice: string }> = await dataSource.query(
    `SELECT a.reading, a.downstep, a.voice
       FROM dict.pitch_audio a
       JOIN jsonb_to_recordset($1::jsonb) AS x(reading varchar, downstep smallint)
         ON a.reading = x.reading AND a.downstep = x.downstep`,
    [JSON.stringify(wanted)],
  );
  if (rows.length === 0) return candidates;
  const voices = new Map(rows.map((row) => [`${row.reading}\u0000${row.downstep}`, row.voice]));

  return candidates.map((candidate) => {
    if (!candidate.reading || !candidate.pitch) return candidate;
    const reading = toHiragana(candidate.reading);
    return {
      ...candidate,
      pitch: candidate.pitch.map((pattern) => {
        const voice = voices.get(`${reading}\u0000${pattern.downstep}`);
        return voice ? { ...pattern, audioUrl: pitchAudioUrl(baseUrl, voice, reading, pattern.downstep) } : pattern;
      }),
    };
  });
}
