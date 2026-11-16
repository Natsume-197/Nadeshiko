import { createReadStream } from 'node:fs';
import { loadDictionary } from '@scriptin/jmdict-simplified-loader';
import type { JMdictDictionaryMetadata, JMdictWord, JMnedictWord } from '@scriptin/jmdict-simplified-types';

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

/**
 * The objects of a top-level JSON array, one at a time (JmdictFurigana ships a single array with a BOM). Tracks
 * strings and nesting by hand so only one object is held at once; each object is then handed to `JSON.parse`.
 */
export async function* readJsonArray<T>(path: string, options: { chunkSize?: number } = {}): AsyncGenerator<T> {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: options.chunkSize });
  let depth = 0;
  let inString = false;
  let escaped = false;
  let pending = '';
  let first = true;

  for await (const raw of stream as AsyncIterable<string>) {
    const chunk = first ? raw.replace(/^﻿/, '') : raw;
    first = false;
    // Inside an object carried over from the previous chunk, it continues from this chunk's start.
    let start = depth >= 2 ? 0 : -1;

    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '[' || char === '{') {
        depth += 1;
        if (depth === 2) start = i;
      } else if (char === ']' || char === '}') {
        depth -= 1;
        if (depth === 1 && start >= 0) {
          const text = pending + chunk.slice(start, i + 1);
          pending = '';
          start = -1;
          yield JSON.parse(text) as T;
        }
      }
    }

    if (start >= 0) pending += chunk.slice(start);
  }

  if (depth !== 0 || pending) throw new Error(`${path} ended in the middle of a JSON value`);
}
