import type { SlimToken } from '@app/models/Segment';
import { parseSegments } from '@app/services/shirabe/parseSegments';
import { config } from '@config/config';
import { AppDataSource } from '@config/database';
import { NADESHIKO_PARSER_REVISION, parseWithNadeshiko } from './nadeshiko';

/** Turns sentences into stored tokens. Every writer of `Segment.tokens` goes through this, so a second parser can be
 * shadowed and then swapped in one place. */
export interface SegmentParser {
  /** Stored as `Segment.parserVersion` next to the tokens it produced, so rows from different parsers can be told
   * apart, compared and reparsed. */
  readonly version: string;
  /** One token array per input, in input order; a sentence with no Japanese is an empty array. */
  parse(texts: string[]): Promise<SlimToken[][]>;
}

export const SHIRABE_PARSER_VERSION = 'shirabe';

export const shirabeParser: SegmentParser = {
  version: SHIRABE_PARSER_VERSION,
  parse: (texts) => parseSegments(texts),
};

/** Ours (task 40, phase 3). Writes only when SEGMENT_PARSER=nadeshiko (the switch runbook). */
export const nadeshikoParser: SegmentParser = {
  version: `nadeshiko-${NADESHIKO_PARSER_REVISION}`,
  parse: (texts) => parseWithNadeshiko(AppDataSource, texts),
};

export function parserFor(name: 'shirabe' | 'nadeshiko'): SegmentParser {
  return name === 'nadeshiko' ? nadeshikoParser : shirabeParser;
}

/** The parser every writer uses, chosen once at boot by SEGMENT_PARSER (Shirabe unless the operator switched). */
export const segmentParser: SegmentParser = parserFor(config.SEGMENT_PARSER);
