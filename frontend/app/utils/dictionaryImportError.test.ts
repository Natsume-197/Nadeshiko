import { describe, expect, it } from 'vitest';
import { dictionaryImportError } from './dictionaryImportError';

describe('dictionaryImportError', () => {
  it.each([
    ['Uncompressed dictionary data exceeds safety limit', 'tooLarge'],
    ['ZIP contains too many entries (300000)', 'tooLarge'],
    ['ZIP central directory exceeds allowed size', 'tooLarge'],
    ['Dictionary exceeds maximum supported entry count', 'tooManyEntries'],
    ['Archive is missing index.json', 'notYomitan'],
    ['index.json is not valid JSON', 'notYomitan'],
    ['Unsupported Yomitan dictionary format (2); only format 3 is supported', 'unsupportedFormat'],
    ['Archive contains no supported Yomitan banks (term_bank_*.json or term_meta_bank_*.json)', 'noEntries'],
    ['No usable term, frequency, or pitch entries were found in the dictionary', 'noEntries'],
    ['ZIP End of Central Directory record not found', 'badZip'],
    ['Unexpected end of ZIP file', 'badZip'],
    ['Indexing was interrupted (the server restarted). Upload the file again.', 'interrupted'],
    ['Dictionary indexing failed', 'generic'],
    [null, 'generic'],
  ])('%s → %s', (message, key) => {
    expect(dictionaryImportError(message)).toBe(key);
  });
});
