import { createReadStream } from 'node:fs';
import { loadDictionary } from '@scriptin/jmdict-simplified-loader';
import type { JMdictDictionaryMetadata, JMdictWord, JMnedictWord } from '@scriptin/jmdict-simplified-types';
import { JsonArrayElementError, JsonArrayStream } from '../custom/jsonArrayStream';

/** Streaming readers for the upstream files, so a 260 MB JMdict or a 170 MB JMnedict never sits in memory whole:
 * the server that runs the weekly refresh has little to spare. */

const HIGH_WATER = 2_000;
const LOW_WATER = 500;

type EntryOf<T extends 'jmdict' | 'jmnedict'> = T extends 'jmdict' ? JMdictWord : JMnedictWord;

/**
 * jmdict-simplified entries one at a time, with backpressure: the loader pushes entries as events, so the parser is
 * paused while the consumer (a database batch) catches up. `onMetadata` fires before the first entry.
 */
export async function* readDictionary<T extends 'jmdict' | 'jmnedict'>(
  type: T,
  path: string,
  onMetadata: (metadata: JMdictDictionaryMetadata) => void,
): AsyncGenerator<EntryOf<T>> {
  // The overloads take a literal type; both branches return the same loader shape.
  const loader = loadDictionary(type as 'jmdict', path);
  const queue: EntryOf<T>[] = [];
  let ended = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  loader
    .onMetadata(onMetadata)
    .onEntry((entry) => {
      queue.push(entry as EntryOf<T>);
      if (queue.length >= HIGH_WATER) loader.parser.pause();
      notify();
    })
    .onEnd(() => {
      ended = true;
      notify();
    });
  loader.parser.on('error', (error: unknown) => {
    failure = error;
    notify();
  });

  for (;;) {
    const entry = queue.shift();
    if (entry !== undefined) {
      if (queue.length <= LOW_WATER && loader.parser.isPaused()) loader.parser.resume();
      yield entry;
      continue;
    }
    if (failure) throw failure;
    if (ended) return;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}

/** One JmdictFurigana entry: a spelling, its reading, and the ruby over each piece. */
export interface FuriganaEntry {
  text: string;
  reading: string;
  furigana: Array<{ ruby: string; rt?: string }>;
}

/** Largest single element `readJsonArray` accepts; a JmdictFurigana entry is a few hundred bytes. */
const MAX_ELEMENT_BYTES = 16 * 1024 * 1024;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * The elements of a top-level JSON array, as the file is read (JmdictFurigana ships a single array with a BOM), so
 * the whole file is never one string. Split by `JsonArrayStream`; a malformed or truncated file throws with the path.
 */
export async function* readJsonArray<T>(path: string, options: { chunkSize?: number } = {}): AsyncGenerator<T> {
  const ready: T[] = [];
  // Entries are objects or arrays; a stray scalar in the array is skipped, as the old reader did.
  const splitter = new JsonArrayStream((value) => {
    if (value !== null && typeof value === 'object') ready.push(value as T);
  }, MAX_ELEMENT_BYTES);
  const withPath = (error: unknown) =>
    error instanceof JsonArrayElementError
      ? new Error(`${path}: ${error.message.replace(/^Bank /, 'File ')}`, { cause: error })
      : error;

  const feed = (chunk: Buffer) => {
    try {
      splitter.write(chunk);
    } catch (error) {
      throw withPath(error);
    }
  };
  const feedHead = (bytes: Buffer) =>
    feed(bytes.subarray(0, BOM.length).equals(BOM) ? bytes.subarray(BOM.length) : bytes);

  // The BOM can straddle chunks when they are tiny, so the first three bytes are gathered before deciding.
  let head: Buffer | null = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: options.chunkSize }) as AsyncIterable<Buffer>) {
    if (!head) feed(chunk);
    else {
      head = Buffer.concat([head, chunk]);
      if (head.length < BOM.length) continue;
      feedHead(head);
      head = null;
    }
    yield* ready.splice(0);
  }
  if (head) feedHead(head);

  try {
    splitter.end();
  } catch (error) {
    throw withPath(error);
  }
  yield* ready.splice(0);
}
