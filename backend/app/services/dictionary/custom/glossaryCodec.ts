import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { type NormalizedGlossaryItem, structuredContentToText, type YomitanNode } from './structuredContent';

/**
 * How term glossaries are stored in an artifact.
 *
 * Importer version 3 (current): each row's glossary is JSON, and consecutive rows' JSON is packed into blocks of about
 * `BLOCK_BYTES`, each deflated once (`glossary_block`); a term row keeps its block id, offset and length. Neighbouring
 * definitions share most of their vocabulary and markup, so a block compresses 6–9× where a single row managed under
 * 2×, and one deflate per block instead of per row made imports several times faster (measured on PixivLight: 27 µs
 * of deflate per row before, ~5 µs now). A lookup inflates the few blocks its rows sit in (~25 µs each).
 *
 * In every version an item with structured content keeps only the structure; its plain text is derived on read
 * (`structuredContentToText`) instead of being stored twice.
 *
 * Version 2 stored one tagged, usually deflated BLOB per row (`decodeGlossary`); version 1 plain JSON text.
 */

const RAW = 0;
const DEFLATE = 1;

/** Target size of a block before compression: small enough that a lookup's inflate stays cheap. */
export const BLOCK_BYTES = 16 * 1024;

type StoredItem = { text: string } | { structuredContent: YomitanNode | YomitanNode[] };

/** One row's glossary as stored JSON (text left out where structured content gives it). */
export function glossaryJson(items: NormalizedGlossaryItem[]): Buffer {
  const stored: StoredItem[] = items.map((item) =>
    item.structuredContent !== undefined ? { structuredContent: item.structuredContent } : { text: item.text },
  );
  return Buffer.from(JSON.stringify(stored), 'utf8');
}

/** Reads one row's stored JSON back into glossary items, deriving the text of structured items. */
export function parseGlossaryJson(json: Uint8Array): NormalizedGlossaryItem[] {
  const text = Buffer.from(json.buffer, json.byteOffset, json.byteLength).toString('utf8');
  const stored = JSON.parse(text) as StoredItem[];
  if (!Array.isArray(stored)) return [];
  const out: NormalizedGlossaryItem[] = [];
  for (const item of stored) {
    if ('structuredContent' in item && item.structuredContent !== undefined) {
      const derived = structuredContentToText(item.structuredContent);
      if (derived) out.push({ text: derived, structuredContent: item.structuredContent });
    } else if ('text' in item && typeof item.text === 'string' && item.text) {
      out.push({ text: item.text });
    }
  }
  return out;
}

export interface GlossaryLocation {
  block: number;
  offset: number;
  length: number;
}

/**
 * Packs rows' glossary JSON into deflated blocks. `add` returns where the row will live; `writeBlock` is called with
 * each finished block (ids from 1, in order), and once more by `flush` for the last, partial one.
 */
export class GlossaryBlockWriter {
  private parts: Buffer[] = [];
  private size = 0;
  private blockId = 1;

  constructor(private readonly writeBlock: (id: number, data: Buffer) => void) {}

  add(json: Buffer): GlossaryLocation {
    const location = { block: this.blockId, offset: this.size, length: json.length };
    this.parts.push(json);
    this.size += json.length;
    if (this.size >= BLOCK_BYTES) this.flush();
    return location;
  }

  flush(): void {
    if (this.parts.length === 0) return;
    this.writeBlock(this.blockId, deflateRawSync(Buffer.concat(this.parts, this.size), { level: 6 }));
    this.blockId += 1;
    this.parts = [];
    this.size = 0;
  }
}

export function inflateBlock(data: Uint8Array): Buffer {
  return inflateRawSync(data);
}

/** Importer version 2: one tagged BLOB per row. Kept to read artifacts built before blocks. */
export function decodeGlossary(blob: Uint8Array): NormalizedGlossaryItem[] {
  if (blob.length < 2) return [];
  const body = Buffer.from(blob.buffer, blob.byteOffset + 1, blob.length - 1);
  const json = blob[0] === DEFLATE ? inflateRawSync(body) : blob[0] === RAW ? body : null;
  return json ? parseGlossaryJson(json) : [];
}
