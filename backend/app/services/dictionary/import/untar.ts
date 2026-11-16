import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';

/**
 * Extract the regular files of a `.tgz` into `dir`, streaming, and return their paths. Enough for the upstream
 * dictionary releases, which hold one JSON file each; links, directories and pax/GNU metadata entries are skipped.
 * Entry names are reduced to their last path segment, so nothing can be written outside `dir`.
 */
export async function extractTgz(archive: string, dir: string): Promise<string[]> {
  const written: string[] = [];
  let pending = Buffer.alloc(0);
  let remaining = 0; // bytes of the current entry's body still to come
  let padding = 0; // zero bytes after it, up to the next 512 boundary
  let out: ReturnType<typeof createWriteStream> | null = null;
  let ended = false;

  const finish = () =>
    new Promise<void>((resolve, reject) => {
      if (!out) return resolve();
      const stream = out;
      out = null;
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });

  for await (const chunk of createReadStream(archive).pipe(createGunzip()) as AsyncIterable<Buffer>) {
    pending = Buffer.concat([pending, chunk]);

    while (!ended) {
      if (remaining > 0) {
        if (pending.length === 0) break;
        const take = Math.min(remaining, pending.length);
        if (out && !out.write(pending.subarray(0, take))) {
          await new Promise((resolve) => out?.once('drain', resolve));
        }
        pending = pending.subarray(take);
        remaining -= take;
        if (remaining === 0) await finish();
        continue;
      }
      if (padding > 0) {
        if (pending.length === 0) break;
        const take = Math.min(padding, pending.length);
        pending = pending.subarray(take);
        padding -= take;
        continue;
      }
      if (pending.length < 512) break;

      const header = pending.subarray(0, 512);
      pending = pending.subarray(512);
      if (header.every((byte) => byte === 0)) {
        ended = true;
        break;
      }

      const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
      const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
      const type = String.fromCharCode(header[156] ?? 0);
      remaining = size;
      padding = (512 - (size % 512)) % 512;

      if ((type === '0' || type === '\0') && size > 0) {
        const base = name.split('/').filter(Boolean).pop();
        if (base && base !== '.' && base !== '..') {
          const path = join(dir, base);
          out = createWriteStream(path);
          written.push(path);
        }
      }
      if (size === 0) remaining = 0;
    }
  }

  await finish();
  if (remaining > 0) throw new Error(`${archive} ended in the middle of an entry`);
  return written;
}
