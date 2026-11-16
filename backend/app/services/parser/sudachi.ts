import { config } from '@config/config';

/** Client for the Sudachi sidecar (`backend/sudachi/`), the morphological analysis our own parser starts from. */

export type SplitMode = 'A' | 'B' | 'C';

/** One Sudachi morpheme, with character offsets into the text it came from. */
export interface Morpheme {
  /** Surface. */
  s: string;
  b: number;
  e: number;
  /** The six UniDic part-of-speech fields. */
  pos: [string, string, string, string, string, string];
  /** Dictionary form. */
  d: string;
  /** Normalised form (Sudachi's spelling normalisation). */
  n: string;
  /** Reading of the surface, katakana. */
  r: string;
  /** Its A-unit pieces when it has more than one (B and C only). */
  a: Array<{ s: string; b: number; e: number }>;
  /** Set by the combine stages on a piece cut out of a morpheme (see combine/recut.ts); never by the sidecar. */
  synthetic?: true;
}

const BATCH = 500;
const TIMEOUT_MS = 30_000;

/** Morphemes of each text, in input order. Batches requests so one call can take a whole page of segments. */
export async function analyse(texts: string[], mode: SplitMode = 'B'): Promise<Morpheme[][]> {
  const base = config.SUDACHI_URL;
  if (!base) throw new Error('SUDACHI_URL is not set: the Sudachi sidecar is needed to parse');

  const out: Morpheme[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const response = await fetch(`${base.replace(/\/$/, '')}/tokenize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: texts.slice(i, i + BATCH), mode }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Sudachi sidecar answered ${response.status}: ${await response.text()}`);
    const { sentences } = (await response.json()) as { sentences: Morpheme[][] };
    out.push(...sentences);
  }
  return out;
}
