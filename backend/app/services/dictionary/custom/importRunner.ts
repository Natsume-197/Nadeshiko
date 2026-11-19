import { Worker } from 'node:worker_threads';
import type { YomitanImportResult } from './yomitanImport';

/**
 * Runs a Yomitan import in its own worker thread (task 48).
 *
 * The backend runs its pg-boss workers in the web process, so an import on the main thread would block every request
 * for the seconds `JSON.parse` and the synchronous SQLite inserts take. The thread also gets its own heap cap: a bank
 * that needs more memory than that fails this one import (`ERR_WORKER_OUT_OF_MEMORY`) instead of the whole server.
 */

/** Heap for one import thread. The largest bank allowed is 32 MB of JSON (`MAX_BANK_BYTES`), which parses well inside
 * this; raise both together, and mind the container limit (768 MB on staging) shared with the web process. */
export const IMPORT_THREAD_HEAP_MB = 320;

/** Generous cap for one import: large monolingual dictionaries finish in well under a minute. Kept under the queue's
 * 30-minute expiry so the job never outlives its own timeout. */
export const IMPORT_THREAD_TIMEOUT_MS = 20 * 60 * 1000;

export class ImportThreadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportThreadError';
  }
}

/** Tags the thread's answer. The port also carries Node's own messages (`node --watch` reports every file a thread
 * imports through it), and none of those may be read as the import's result. */
export const IMPORT_THREAD_MESSAGE = 'nadeshiko:yomitan-import';

type ThreadMessage = { type: typeof IMPORT_THREAD_MESSAGE } & (
  | { ok: true; result: YomitanImportResult }
  | { ok: false; name: string; message: string; stack?: string }
);

function isThreadMessage(message: unknown): message is ThreadMessage {
  return (message as { type?: unknown } | null)?.type === IMPORT_THREAD_MESSAGE;
}

export function runYomitanImportInThread(
  zipPath: string,
  targetPath: string,
  options: { heapMb?: number; timeoutMs?: number } = {},
): Promise<YomitanImportResult> {
  return new Promise((resolve, reject) => {
    // The runtime loads TypeScript through tsx (`node --import tsx main.ts`); the thread needs the same loader, and
    // only that one, so instrumentation and other startup imports stay on the main thread.
    const worker = new Worker(new URL('./importThread.ts', import.meta.url), {
      workerData: { zipPath, targetPath },
      execArgv: ['--import', 'tsx'],
      resourceLimits: { maxOldGenerationSizeMb: options.heapMb ?? IMPORT_THREAD_HEAP_MB },
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new ImportThreadError('Dictionary import took too long and was stopped')));
      void worker.terminate();
    }, options.timeoutMs ?? IMPORT_THREAD_TIMEOUT_MS);

    worker.on('message', (message: unknown) => {
      if (!isThreadMessage(message)) return;
      finish(() => {
        if (message.ok) {
          resolve(message.result);
        } else {
          const error = new Error(message.message || message.name);
          error.name = message.name;
          // The thread's stack, which is where it failed, rather than this message handler's.
          if (message.stack) error.stack = message.stack;
          reject(error);
        }
      });
      void worker.terminate();
    });

    worker.on('error', (error: Error & { code?: string }) => {
      finish(() =>
        reject(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new ImportThreadError('Dictionary is too large to index (a bank file needs too much memory)')
            : error,
        ),
      );
    });

    worker.on('exit', (code) => {
      finish(() => reject(new ImportThreadError(`Dictionary import stopped unexpectedly (exit code ${code})`)));
    });
  });
}
