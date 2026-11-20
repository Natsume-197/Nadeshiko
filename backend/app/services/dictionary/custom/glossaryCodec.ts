import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { type NormalizedGlossaryItem, structuredContentToText, type YomitanNode } from './structuredContent';

/**
 * How a term's glossary is stored in an artifact (importer version 2): JSON, deflated when that saves more than a
 * tenth, behind a one-byte tag. An item with structured content keeps only the structure; its plain text is derived
 * from it on read (`structuredContentToText`), as the importer derived it before, instead of being stored twice.
 *
 * SQLite does not compress, and monolingual dictionaries are 3–28× their zip as JSON; with this a file is a fraction
 * of that, so more of them fit in the local cache and in the container's page cache.
 */

const RAW = 0;
const DEFLATE = 1;

type StoredItem = { text: string } | { structuredContent: YomitanNode | YomitanNode[] };

export function encodeGlossary(items: NormalizedGlossaryItem[]): Buffer {
  const stored: StoredItem[] = items.map((item) =>
    item.structuredContent !== undefined ? { structuredContent: item.structuredContent } : { text: item.text },
  );
  const json = Buffer.from(JSON.stringify(stored), 'utf8');
  if (json.length >= 96) {
    const deflated = deflateRawSync(json, { level: 6 });
    if (deflated.length < json.length * 0.9) return Buffer.concat([Buffer.of(DEFLATE), deflated]);
  }
  return Buffer.concat([Buffer.of(RAW), json]);
}

export function decodeGlossary(blob: Uint8Array): NormalizedGlossaryItem[] {
  if (blob.length < 2) return [];
  const body = Buffer.from(blob.buffer, blob.byteOffset + 1, blob.length - 1);
  const json = blob[0] === DEFLATE ? inflateRawSync(body) : body;
  const stored = JSON.parse(json.toString('utf8')) as StoredItem[];
  if (!Array.isArray(stored)) return [];
  const out: NormalizedGlossaryItem[] = [];
  for (const item of stored) {
    if ('structuredContent' in item && item.structuredContent !== undefined) {
      const text = structuredContentToText(item.structuredContent);
      if (text) out.push({ text, structuredContent: item.structuredContent });
    } else if ('text' in item && typeof item.text === 'string' && item.text) {
      out.push({ text: item.text });
    }
  }
  return out;
}
