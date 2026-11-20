import { readFile } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { IMPORT_THREAD_HEAP_MB } from './importRunner';

/**
 * Admits dictionary imports by memory rather than by a fixed count (Shirabe lessons, phase 1).
 *
 * The queue hands this container up to `USER_DICTIONARY_IMPORT_CONCURRENCY` jobs. The first one always runs; each
 * further one starts only while the container's anonymous memory (heap, buffers: what the kernel cannot drop) plus one
 * import's worth stays under a share of the container's limit, and waits otherwise. The page cache is left out on
 * purpose: SQLite files and zips fill it, and the kernel frees it under pressure.
 */

/** What one import may add: its thread's heap cap plus SQLite, zlib and buffers outside the heap. */
export const IMPORT_MEMORY_BYTES = Math.round(IMPORT_THREAD_HEAP_MB * 1.25) * 1024 * 1024;
const MAX_SHARE = 0.85;
const RECHECK_MS = 3000;

export interface MemoryReading {
  /** Anonymous memory in use, bytes. */
  used: number;
  /** The container's limit, or the machine's memory when there is none. */
  limit: number;
}

/** cgroup v2 numbers for this container: `memory.max` and the `anon` line of `memory.stat`. */
export async function readContainerMemory(): Promise<MemoryReading> {
  try {
    const [max, stat] = await Promise.all([
      readFile('/sys/fs/cgroup/memory.max', 'utf8'),
      readFile('/sys/fs/cgroup/memory.stat', 'utf8'),
    ]);
    const anon = /^anon (\d+)$/m.exec(stat);
    const limit = max.trim() === 'max' ? totalmem() : Number(max.trim());
    if (anon && Number.isFinite(limit) && limit > 0) return { used: Number(anon[1]), limit };
  } catch {
    // Not in a cgroup v2 container (local development, tests): fall back to this process.
  }
  return { used: process.memoryUsage().rss, limit: totalmem() };
}

export function hasRoomForAnotherImport(reading: MemoryReading): boolean {
  return reading.used + IMPORT_MEMORY_BYTES <= reading.limit * MAX_SHARE;
}

let running = 0;

/** Number of imports running in this process right now. */
export function runningImports(): number {
  return running;
}

/**
 * Waits until this import may start, then counts it as running. Pair every call with `releaseImportSlot`.
 * `read` and `sleep` are injectable for tests.
 */
export async function acquireImportSlot(
  read: () => Promise<MemoryReading> = readContainerMemory,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (;;) {
    if (running === 0 || hasRoomForAnotherImport(await read())) {
      running += 1;
      return;
    }
    await sleep(RECHECK_MS);
  }
}

export function releaseImportSlot(): void {
  running = Math.max(0, running - 1);
}
