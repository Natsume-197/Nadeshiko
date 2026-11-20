import type { SlimToken } from '@app/models/Segment';
import { AppDataSource } from '@config/database';
import { NADESHIKO_PARSER_REVISION, parseWithNadeshiko } from './nadeshiko';

/** Turns sentences into stored tokens. Every writer of `Segment.tokens` goes through this. */
export interface SegmentParser {
  /** Stored as `Segment.parserVersion` next to the tokens it produced, so rows from different revisions can be told
   * apart and reparsed incrementally with `--stale`. */
  readonly version: string;
  /** One token array per input, in input order; a sentence with no Japanese is an empty array. */
  parse(texts: string[]): Promise<SlimToken[][]>;
}

/** Nadeshiko's own morphological parser backed by the Sudachi sidecar and the `dict` schema. */
export const nadeshikoParser: SegmentParser = {
  version: `nadeshiko-${NADESHIKO_PARSER_REVISION}`,
  parse: (texts) => parseWithNadeshiko(AppDataSource, texts),
};

/** The parser every writer uses. */
export const segmentParser: SegmentParser = nadeshikoParser;
