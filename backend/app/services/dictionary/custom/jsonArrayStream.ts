/**
 * Splits a JSON document whose top level is an array into its elements as the bytes arrive, the same way for every
 * size: a Yomitan bank of 2 MB and one of 106 MB (明鏡 第三版) go through the same code, and memory stays bounded by
 * the batch size plus the largest row.
 *
 * Two passes over each chunk, both cheap:
 * - a byte scan finds where each top-level element ends. Only ASCII bytes matter (`"`, `\`, brackets, braces, comma);
 *   UTF-8 continuation bytes are all ≥ 0x80, so Japanese text can be skipped without decoding it.
 * - complete elements are collected into a batch of about `batchBytes` and handed to the native `JSON.parse` as one
 *   array, which does the real validation; a small bank is a single batch.
 *
 * A document that is not an array, or is cut short, throws.
 */
export class JsonArrayElementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonArrayElementError';
  }
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const COMMA = 0x2c;
const COMMA_BUFFER = Buffer.of(COMMA);

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
}

export class JsonArrayStream {
  private started = false;
  private done = false;
  private depth = 0;
  private inString = false;
  private escape = false;
  private inScalar = false;
  /** Bytes of the element being read that arrived in earlier chunks. */
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  /** Complete elements waiting for the next `JSON.parse`. */
  private batch: Buffer[] = [];
  private batchBytes = 0;

  constructor(
    private readonly onElement: (value: unknown) => void,
    private readonly maxElementBytes: number,
    private readonly batchLimit = 4 * 1024 * 1024,
  ) {}

  write(chunk: Buffer): void {
    let begin = this.pendingBytes > 0 || this.inScalar || this.inString || this.depth > 0 ? 0 : -1;
    const n = chunk.length;
    // Next backslash at or after the scan position, found natively and reused until passed (-1: none left).
    let nextBackslash = -2;

    for (let i = 0; i < n; i++) {
      if (this.inString) {
        // Most of a dictionary is string content: jump to the next quote or backslash with the native search instead
        // of visiting every byte.
        if (this.escape) {
          this.escape = false;
          continue;
        }
        if (nextBackslash !== -1 && nextBackslash < i) nextBackslash = chunk.indexOf(BACKSLASH, i);
        const quote = chunk.indexOf(QUOTE, i);
        if (nextBackslash !== -1 && (quote === -1 || nextBackslash < quote)) {
          this.escape = true;
          i = nextBackslash;
          continue;
        }
        if (quote === -1) break;
        i = quote;
        this.inString = false;
        if (this.depth === 0) {
          this.finish(chunk, begin, i + 1);
          begin = -1;
        }
        continue;
      }

      const c = chunk[i] as number;

      if (this.inScalar) {
        if (c === COMMA || c === CLOSE_BRACKET || isSpace(c)) {
          this.finish(chunk, begin, i);
          begin = -1;
        } else continue;
      }

      if (!this.started) {
        if (isSpace(c)) continue;
        if (c !== OPEN_BRACKET) throw new JsonArrayElementError('Bank is not a JSON array');
        this.started = true;
        continue;
      }

      if (this.done) {
        if (isSpace(c)) continue;
        throw new JsonArrayElementError('Unexpected data after the JSON array');
      }

      if (c === QUOTE) {
        if (this.depth === 0) begin = i;
        this.inString = true;
      } else if (c === OPEN_BRACKET || c === OPEN_BRACE) {
        if (this.depth === 0) begin = i;
        this.depth++;
      } else if (c === CLOSE_BRACKET || c === CLOSE_BRACE) {
        if (this.depth === 0) {
          if (c !== CLOSE_BRACKET) throw new JsonArrayElementError('Unbalanced JSON');
          this.done = true;
        } else {
          this.depth--;
          if (this.depth === 0) {
            this.finish(chunk, begin, i + 1);
            begin = -1;
          }
        }
      } else if (this.depth === 0 && c !== COMMA && !isSpace(c)) {
        begin = i;
        this.inScalar = true;
      }
    }

    // An element still open at the end of the chunk: keep its bytes for the next one.
    if (begin >= 0) {
      const tail = chunk.subarray(begin);
      this.pending.push(Buffer.from(tail));
      this.pendingBytes += tail.length;
      if (this.pendingBytes > this.maxElementBytes) {
        throw new JsonArrayElementError('A dictionary entry exceeds the maximum allowed size');
      }
    }
    if (this.batchBytes >= this.batchLimit) this.parseBatch();
  }

  /** Call after the last chunk: parses what is left and throws unless the array was closed. */
  end(): void {
    if (!this.done) throw new JsonArrayElementError(this.started ? 'Unterminated JSON array' : 'Empty JSON document');
    this.parseBatch();
  }

  private finish(chunk: Buffer, begin: number, endExclusive: number): void {
    const piece = chunk.subarray(Math.max(0, begin), endExclusive);
    let element: Buffer;
    if (this.pendingBytes > 0) {
      this.pending.push(piece);
      element = Buffer.concat(this.pending, this.pendingBytes + piece.length);
      this.pending = [];
      this.pendingBytes = 0;
    } else {
      element = Buffer.from(piece);
    }
    this.inScalar = false;
    if (element.length > this.maxElementBytes) {
      throw new JsonArrayElementError('A dictionary entry exceeds the maximum allowed size');
    }
    if (this.batch.length > 0) {
      this.batch.push(COMMA_BUFFER);
      this.batchBytes += 1;
    }
    this.batch.push(element);
    this.batchBytes += element.length;
  }

  private parseBatch(): void {
    if (this.batch.length === 0) return;
    const text = `[${Buffer.concat(this.batch, this.batchBytes).toString('utf8')}]`;
    this.batch = [];
    this.batchBytes = 0;
    let values: unknown[];
    try {
      values = JSON.parse(text) as unknown[];
    } catch {
      throw new JsonArrayElementError('Bank contains invalid JSON');
    }
    for (const value of values) this.onElement(value);
  }
}
