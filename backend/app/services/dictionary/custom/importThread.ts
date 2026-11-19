import { parentPort, workerData } from 'node:worker_threads';
import { IMPORT_THREAD_MESSAGE } from './importRunner';
import { importYomitanZipToSqlite } from './yomitanImport';

/**
 * Worker-thread entry for one Yomitan import (task 48), started by `importRunner.ts`. Keep imports relative and free of
 * app config, database or logger modules: the thread loads only what the import needs.
 */

const { zipPath, targetPath } = workerData as { zipPath: string; targetPath: string };

const port = parentPort;
if (!port) throw new Error('importThread.ts runs only as a worker thread');

importYomitanZipToSqlite(zipPath, targetPath).then(
  (result) => port.postMessage({ type: IMPORT_THREAD_MESSAGE, ok: true, result }),
  (error: unknown) =>
    port.postMessage({
      type: IMPORT_THREAD_MESSAGE,
      ok: false,
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message || String(error) : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
);
