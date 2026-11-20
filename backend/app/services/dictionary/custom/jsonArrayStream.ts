import { StringDecoder } from 'node:string_decoder';

/**
 * Splits a JSON document whose top level is an array into its elements as the bytes arrive, so a Yomitan bank is
 * parsed one row at a time instead of whole: memory follows the largest row, not the bank (明鏡 第三版 ships a single
 * 106 MB bank, JPDB a 48 MB one).
 *
 * Only the top level is tracked (depth, strings, escapes); each element's text goes to `JSON.parse` on its own, which
 * does the real validation. A document that is not an array, or is cut short, throws.
 */
export class JsonArrayElementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonArrayElementError';
  }
}

export class JsonArrayStream {
  private readonly decoder = new StringDecoder('utf8');
  private started = false;
  private done = false;
  private depth = 0;
  private inString = false;
  private escape = false;
  /** Text of the element being read, from earlier chunks. */
  private parts: string[] = [];
  private partsLength = 0;
  /** True while inside an element (an array, object, string or bare scalar at the top level). */
  private inElement = false;
  /** A bare scalar (number, true, false, null) ends at a comma, the closing bracket or whitespace. */
  private inScalar = false;

  constructor(
    private readonly onElement: (value: unknown) => void,
    private readonly maxElementChars: number,
  ) {}

  write(chunk: Buffer): void {
    this.consume(this.decoder.write(chunk));
  }

  /** Call after the last chunk: throws unless the array was closed. */
  end(): void {
    this.consume(this.decoder.end());
    if (!this.done) throw new JsonArrayElementError(this.started ? 'Unterminated JSON array' : 'Empty JSON document');
  }

  private consume(text: string): void {
    let begin = this.inElement ? 0 : -1;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);

      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (c === 0x5c /* \ */) this.escape = true;
        else if (c === 0x22 /* " */) {
          this.inString = false;
          if (this.depth === 0) {
            this.emit(text, begin, i + 1);
            begin = -1;
          }
        }
        continue;
      }

      if (this.inScalar) {
        if (c === 0x2c /* , */ || c === 0x5d /* ] */ || isSpace(c)) {
          this.emit(text, begin, i);
          begin = -1;
        } else continue;
      }

      if (!this.started) {
        if (isSpace(c)) continue;
        if (c !== 0x5b /* [ */) throw new JsonArrayElementError('Bank is not a JSON array');
        this.started = true;
        continue;
      }

      if (this.done) {
        if (isSpace(c)) continue;
        throw new JsonArrayElementError('Unexpected data after the JSON array');
      }

      switch (c) {
        case 0x22: // "
          if (this.depth === 0) {
            begin = i;
            this.inElement = true;
          }
          this.inString = true;
          break;
        case 0x5b: // [
        case 0x7b: // {
          if (this.depth === 0) {
            begin = i;
            this.inElement = true;
          }
          this.depth++;
          break;
        case 0x5d: // ]
        case 0x7d: // }
          if (this.depth === 0) {
            if (c !== 0x5d) throw new JsonArrayElementError('Unbalanced JSON');
            this.done = true;
            break;
          }
          this.depth--;
          if (this.depth === 0) {
            this.emit(text, begin, i + 1);
            begin = -1;
          }
          break;
        default:
          if (this.depth === 0 && c !== 0x2c && !isSpace(c)) {
            begin = i;
            this.inElement = true;
            this.inScalar = true;
          }
      }
    }

    if (this.inElement && begin >= 0) {
      const tail = text.slice(begin);
      this.parts.push(tail);
      this.partsLength += tail.length;
      if (this.partsLength > this.maxElementChars) {
        throw new JsonArrayElementError('A dictionary entry exceeds the maximum allowed size');
      }
    }
  }

  private emit(text: string, begin: number, endExclusive: number): void {
    const piece = text.slice(Math.max(0, begin), endExclusive);
    const whole = this.parts.length > 0 ? this.parts.join('') + piece : piece;
    this.parts = [];
    this.partsLength = 0;
    this.inElement = false;
    this.inScalar = false;
    if (whole.length > this.maxElementChars) {
      throw new JsonArrayElementError('A dictionary entry exceeds the maximum allowed size');
    }
    let value: unknown;
    try {
      value = JSON.parse(whole);
    } catch {
      throw new JsonArrayElementError('Bank contains invalid JSON');
    }
    this.onElement(value);
  }
}

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
}
