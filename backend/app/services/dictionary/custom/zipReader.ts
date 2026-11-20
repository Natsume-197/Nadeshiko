import { open, type FileHandle } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';

/**
 * Low-memory random-access ZIP reader built on `node:fs` + `node:zlib`.
 *
 * Yomitan `.zip` archives can be up to 95 MB compressed and bundle thousands of images we skip in Phase 1. Reading the
 * Central Directory from the tail lets us inspect `index.json` first and stream only the JSON bank files we care about,
 * one at a time, with hard uncompressed-byte caps against zip bombs.
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_LOCAL_FILE = 0x04034b50;
const SIG_CENTRAL_DIR = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Maximum EOCD search window: 22-byte header + 65,535-byte max ZIP comment. */
const MAX_EOCD_SEARCH = 22 + 65_535;
/** Hard cap on Central Directory size so a malformed archive cannot exhaust memory before entry checks. */
const MAX_CD_BYTES = 32 * 1024 * 1024;
/** Hard cap on number of entries in one archive. */
const MAX_ENTRY_COUNT = 200_000;

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

async function readExact(handle: FileHandle, offset: number, length: number): Promise<Buffer> {
  if (offset < 0 || length < 0) throw new ZipFormatError('Negative ZIP offset or length');
  const buf = Buffer.allocUnsafe(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buf, filled, length - filled, offset + filled);
    if (bytesRead === 0) throw new ZipFormatError('Unexpected end of ZIP file');
    filled += bytesRead;
  }
  return buf;
}

function findEocdOffset(tail: Buffer): number {
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) !== SIG_EOCD) continue;
    const commentLen = tail.readUInt16LE(i + 20);
    if (i + 22 + commentLen === tail.length) return i;
  }
  return -1;
}

function parseZip64Extra(
  extra: Buffer,
  needUncompressed: boolean,
  needCompressed: boolean,
  needOffset: boolean,
): { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } {
  let pos = 0;
  while (pos + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(pos);
    const dataSize = extra.readUInt16LE(pos + 2);
    pos += 4;
    if (pos + dataSize > extra.length) break;
    if (headerId === 0x0001) {
      let cursor = pos;
      const out: { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } = {};
      if (needUncompressed && cursor + 8 <= pos + dataSize) {
        out.uncompressedSize = Number(extra.readBigUInt64LE(cursor));
        cursor += 8;
      }
      if (needCompressed && cursor + 8 <= pos + dataSize) {
        out.compressedSize = Number(extra.readBigUInt64LE(cursor));
        cursor += 8;
      }
      if (needOffset && cursor + 8 <= pos + dataSize) {
        out.localHeaderOffset = Number(extra.readBigUInt64LE(cursor));
      }
      return out;
    }
    pos += dataSize;
  }
  return {};
}

export class ZipReader {
  private readonly handle: FileHandle;
  private readonly fileSize: number;
  private readonly entries: ZipEntry[];
  private readonly byName: Map<string, ZipEntry>;
  private closed = false;

  private constructor(handle: FileHandle, fileSize: number, entries: ZipEntry[]) {
    this.handle = handle;
    this.fileSize = fileSize;
    this.entries = entries;
    this.byName = new Map(entries.map((entry) => [entry.name, entry]));
  }

  static async open(filePath: string): Promise<ZipReader> {
    const handle = await open(filePath, 'r');
    try {
      const stat = await handle.stat();
      const fileSize = stat.size;
      if (fileSize < 22) throw new ZipFormatError('File is too small to be a valid ZIP archive');

      const searchSize = Math.min(fileSize, MAX_EOCD_SEARCH);
      const tailStart = fileSize - searchSize;
      const tail = await readExact(handle, tailStart, searchSize);
      const eocdRel = findEocdOffset(tail);
      if (eocdRel < 0) throw new ZipFormatError('ZIP End of Central Directory record not found');

      const eocdAbs = tailStart + eocdRel;
      const diskNum = tail.readUInt16LE(eocdRel + 4);
      const cdDiskNum = tail.readUInt16LE(eocdRel + 6);
      if (diskNum !== 0 || cdDiskNum !== 0) {
        throw new ZipFormatError('Multi-disk ZIP archives are not supported');
      }

      let entryCount = tail.readUInt16LE(eocdRel + 10);
      let cdSize = tail.readUInt32LE(eocdRel + 12);
      let cdOffset = tail.readUInt32LE(eocdRel + 16);

      // Check for ZIP64 EOCD locator right before the standard EOCD record.
      if ((entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocdAbs >= 20) {
        const locator = await readExact(handle, eocdAbs - 20, 20);
        if (locator.readUInt32LE(0) === SIG_ZIP64_LOCATOR) {
          const zip64EocdOffset = Number(locator.readBigUInt64LE(8));
          if (zip64EocdOffset < 0 || zip64EocdOffset + 56 > fileSize) {
            throw new ZipFormatError('Invalid ZIP64 EOCD offset');
          }
          const zip64Eocd = await readExact(handle, zip64EocdOffset, 56);
          if (zip64Eocd.readUInt32LE(0) !== SIG_ZIP64_EOCD) {
            throw new ZipFormatError('Invalid ZIP64 EOCD signature');
          }
          entryCount = Number(zip64Eocd.readBigUInt64LE(32));
          cdSize = Number(zip64Eocd.readBigUInt64LE(40));
          cdOffset = Number(zip64Eocd.readBigUInt64LE(48));
        }
      }

      if (entryCount > MAX_ENTRY_COUNT) {
        throw new ZipLimitError(`ZIP contains too many entries (${entryCount})`);
      }
      if (cdSize > MAX_CD_BYTES) {
        throw new ZipLimitError('ZIP central directory exceeds allowed size');
      }
      if (cdOffset + cdSize > fileSize) {
        throw new ZipFormatError('ZIP central directory extends past end of file');
      }

      const cdBuf = await readExact(handle, cdOffset, cdSize);
      const entries: ZipEntry[] = [];
      let pos = 0;

      for (let i = 0; i < entryCount; i += 1) {
        if (pos + 46 > cdBuf.length) throw new ZipFormatError('Truncated ZIP central directory entry');
        if (cdBuf.readUInt32LE(pos) !== SIG_CENTRAL_DIR) {
          throw new ZipFormatError('Invalid ZIP central directory entry signature');
        }

        const flags = cdBuf.readUInt16LE(pos + 8);
        if ((flags & 0x01) !== 0) {
          throw new ZipFormatError('Encrypted ZIP archives are not supported');
        }
        const method = cdBuf.readUInt16LE(pos + 10);
        let compressedSize = cdBuf.readUInt32LE(pos + 20);
        let uncompressedSize = cdBuf.readUInt32LE(pos + 24);
        const nameLen = cdBuf.readUInt16LE(pos + 28);
        const extraLen = cdBuf.readUInt16LE(pos + 30);
        const commentLen = cdBuf.readUInt16LE(pos + 32);
        let localHeaderOffset = cdBuf.readUInt32LE(pos + 42);

        const nameStart = pos + 46;
        const extraStart = nameStart + nameLen;
        const nextPos = extraStart + extraLen + commentLen;
        if (nextPos > cdBuf.length) throw new ZipFormatError('Truncated ZIP central directory metadata');

        const rawName = cdBuf.subarray(nameStart, extraStart).toString('utf8');
        const name = rawName.replace(/^\/+/, '');

        const needUncompressed = uncompressedSize === 0xffffffff;
        const needCompressed = compressedSize === 0xffffffff;
        const needOffset = localHeaderOffset === 0xffffffff;
        if ((needUncompressed || needCompressed || needOffset) && extraLen > 0) {
          const z64 = parseZip64Extra(
            cdBuf.subarray(extraStart, extraStart + extraLen),
            needUncompressed,
            needCompressed,
            needOffset,
          );
          if (z64.uncompressedSize !== undefined) uncompressedSize = z64.uncompressedSize;
          if (z64.compressedSize !== undefined) compressedSize = z64.compressedSize;
          if (z64.localHeaderOffset !== undefined) localHeaderOffset = z64.localHeaderOffset;
        }

        if (name && !name.endsWith('/') && !name.includes('..')) {
          entries.push({
            name,
            method,
            compressedSize,
            uncompressedSize,
            localHeaderOffset,
          });
        }

        pos = nextPos;
      }

      return new ZipReader(handle, fileSize, entries);
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  }

  listEntries(): readonly ZipEntry[] {
    return this.entries;
  }

  getEntry(name: string): ZipEntry | undefined {
    return this.byName.get(name);
  }

  /**
   * Decompresses a single entry into a UTF-8 string while enforcing `maxUncompressedBytes`.
   * Streams raw compressed chunks into `zlib.createInflateRaw()` so a zip bomb aborts mid-stream.
   */
  async readEntryText(entry: ZipEntry, maxUncompressedBytes: number): Promise<string> {
    const chunks: Buffer[] = [];
    let total = 0;
    await this.readEntryChunks(entry, maxUncompressedBytes, (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    return Buffer.concat(chunks, total).toString('utf8');
  }

  /**
   * Decompresses a single entry chunk by chunk into `onChunk`, enforcing `maxUncompressedBytes` on what actually comes
   * out (the declared size can lie). `onChunk` runs synchronously before the next chunk is read, so a throw stops the
   * read and rejects. Returns the uncompressed byte count.
   */
  async readEntryChunks(
    entry: ZipEntry,
    maxUncompressedBytes: number,
    onChunk: (chunk: Buffer) => void,
  ): Promise<number> {
    if (this.closed) throw new Error('ZipReader is closed');
    if (entry.uncompressedSize > maxUncompressedBytes) {
      throw new ZipLimitError(`Entry "${entry.name}" exceeds maximum allowed uncompressed size`);
    }
    if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) {
      throw new ZipFormatError(`Unsupported compression method ${entry.method} for "${entry.name}"`);
    }

    const header = await readExact(this.handle, entry.localHeaderOffset, 30);
    if (header.readUInt32LE(0) !== SIG_LOCAL_FILE) {
      throw new ZipFormatError(`Invalid local file header for "${entry.name}"`);
    }
    const localNameLen = header.readUInt16LE(26);
    const localExtraLen = header.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
    if (dataOffset + entry.compressedSize > this.fileSize) {
      throw new ZipFormatError(`Entry "${entry.name}" extends past end of ZIP file`);
    }

    const CHUNK_SIZE = 64 * 1024;

    if (entry.method === METHOD_STORE) {
      if (entry.compressedSize > maxUncompressedBytes) {
        throw new ZipLimitError(`Entry "${entry.name}" exceeds maximum allowed uncompressed size`);
      }
      let remaining = entry.compressedSize;
      let cursor = dataOffset;
      while (remaining > 0) {
        const raw = await readExact(this.handle, cursor, Math.min(remaining, CHUNK_SIZE));
        onChunk(raw);
        remaining -= raw.length;
        cursor += raw.length;
      }
      return entry.compressedSize;
    }

    let totalOut = 0;
    await new Promise<void>((resolve, reject) => {
      const inflate = createInflateRaw();
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        inflate.destroy();
        reject(err);
      };

      inflate.on('data', (chunk: Buffer) => {
        if (settled) return;
        totalOut += chunk.length;
        if (totalOut > maxUncompressedBytes) {
          fail(new ZipLimitError(`Entry "${entry.name}" exceeded uncompressed size limit during inflation`));
          return;
        }
        try {
          onChunk(chunk);
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });
      inflate.on('error', (err) =>
        fail(new ZipFormatError(`Corrupt deflate stream in "${entry.name}": ${err.message}`)),
      );
      inflate.on('end', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      const pump = async () => {
        let remaining = entry.compressedSize;
        let cursor = dataOffset;
        const readBuf = Buffer.allocUnsafe(Math.min(CHUNK_SIZE, Math.max(remaining, 1)));
        while (remaining > 0 && !settled) {
          const toRead = Math.min(remaining, readBuf.length);
          const { bytesRead } = await this.handle.read(readBuf, 0, toRead, cursor);
          if (bytesRead === 0) {
            fail(new ZipFormatError(`Unexpected EOF reading "${entry.name}"`));
            return;
          }
          remaining -= bytesRead;
          cursor += bytesRead;
          const slice = Buffer.from(readBuf.subarray(0, bytesRead));
          if (!inflate.write(slice)) {
            await new Promise<void>((r) => inflate.once('drain', r));
          }
        }
        if (!settled) inflate.end();
      };

      pump().catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
    });

    return totalOut;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }
}
