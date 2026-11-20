import { describe, expect, it } from 'vitest';
import { decodeGlossary, encodeGlossary } from '@app/services/dictionary/custom/glossaryCodec';
import { JsonArrayElementError, JsonArrayStream } from '@app/services/dictionary/custom/jsonArrayStream';
import type { NormalizedGlossaryItem } from '@app/services/dictionary/custom/structuredContent';

/** Feeds `text` to a stream in chunks of `size` bytes (so multi-byte characters get split) and returns the rows. */
function split(text: string, size: number, maxElementChars = 1_000_000): unknown[] {
  const rows: unknown[] = [];
  const stream = new JsonArrayStream((row) => rows.push(row), maxElementChars);
  const bytes = Buffer.from(text, 'utf8');
  for (let i = 0; i < bytes.length; i += size) stream.write(bytes.subarray(i, i + size));
  stream.end();
  return rows;
}

describe('JsonArrayStream', () => {
  const bank = [
    ['食べる', 'たべる', 'v1', 'v1', 10, ['to eat', { type: 'text', text: 'to live on "it"' }], 1, ''],
    ['見る', 'みる', '', 'v1', 0, [{ type: 'structured-content', content: { tag: 'span', content: ['[a]', '{b}'] } }]],
    'a bare string, with, commas ] and brackets [',
    42,
    -1.5e3,
    true,
    null,
    { reading: 'みる', frequency: 7 },
  ];
  const text = JSON.stringify(bank, null, 1);

  it.each([1, 2, 3, 7, 64, 1 << 20])('yields every row unchanged with %i-byte chunks', (size) => {
    expect(split(text, size)).toEqual(bank);
  });

  it('handles an empty array and surrounding whitespace', () => {
    expect(split('  [ \n ]  ', 1)).toEqual([]);
  });

  it('keeps escaped quotes and backslashes inside strings', () => {
    const rows = [['a\\"b', 'c\\\\', ' ', '😀']];
    expect(split(JSON.stringify(rows), 1)).toEqual(rows);
  });

  it('rejects a document that is not an array', () => {
    expect(() => split('{"a": 1}', 4)).toThrow(JsonArrayElementError);
  });

  it('rejects a truncated array', () => {
    expect(() => split('[[1, 2], [3', 2)).toThrow(/Unterminated/);
  });

  it('rejects data after the array', () => {
    expect(() => split('[1] [2]', 2)).toThrow(/after the JSON array/);
  });

  it('rejects an invalid row', () => {
    expect(() => split('[[1, 2,], [3]]', 3)).toThrow(/invalid JSON/);
  });

  it('rejects a row over the size limit, even split across chunks', () => {
    const big = JSON.stringify([['x'.repeat(500)]]);
    expect(() => split(big, 16, 100)).toThrow(/maximum allowed size/);
  });
});

describe('glossaryCodec', () => {
  const structured = {
    tag: 'div',
    content: [{ tag: 'span', content: 'ア' }, '　'.repeat(5), { tag: 'ul', content: [{ tag: 'li', content: '意味' }] }],
  } as NormalizedGlossaryItem['structuredContent'];

  it('round-trips plain items', () => {
    const items: NormalizedGlossaryItem[] = [{ text: 'to eat' }, { text: 'to live on' }];
    expect(decodeGlossary(encodeGlossary(items))).toEqual(items);
  });

  it('stores structured content without its text, and derives the text again on read', () => {
    const items: NormalizedGlossaryItem[] = [{ text: 'ア 意味', structuredContent: structured }];
    const blob = encodeGlossary(items);
    expect(blob.toString('utf8')).not.toContain('"text"');
    const [decoded] = decodeGlossary(blob);
    expect(decoded?.structuredContent).toEqual(structured);
    expect(decoded?.text).toContain('意味');
  });

  it('deflates long glossaries and leaves short ones raw', () => {
    const long: NormalizedGlossaryItem[] = [{ text: 'repetitive definition text '.repeat(40) }];
    const short: NormalizedGlossaryItem[] = [{ text: 'eat' }];
    const longBlob = encodeGlossary(long);
    expect(longBlob[0]).toBe(1);
    expect(longBlob.length).toBeLessThan(Buffer.byteLength(JSON.stringify(long)) / 4);
    expect(encodeGlossary(short)[0]).toBe(0);
    expect(decodeGlossary(longBlob)).toEqual(long);
    expect(decodeGlossary(encodeGlossary(short))).toEqual(short);
  });

  it('decodes nothing from an empty or tiny blob', () => {
    expect(decodeGlossary(new Uint8Array())).toEqual([]);
    expect(decodeGlossary(Uint8Array.of(0))).toEqual([]);
  });
});
