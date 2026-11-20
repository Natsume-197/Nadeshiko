/**
 * Why a custom dictionary failed to import, as an i18n key under `accountSettings.dictionaries.importErrors`. The
 * backend stores its own English message on the shared artifact (`yomitanImport.ts`, `zipReader.ts`, `service.ts`);
 * the reader gets it in their language. Anything not recognised falls back to `generic`.
 */
export type DictionaryImportError =
  | 'tooLarge'
  | 'tooManyEntries'
  | 'notYomitan'
  | 'unsupportedFormat'
  | 'noEntries'
  | 'badZip'
  | 'interrupted'
  | 'generic';

const PATTERNS: ReadonlyArray<[RegExp, DictionaryImportError]> = [
  [/exceeds safety limit|central directory exceeds|too many entries/i, 'tooLarge'],
  [/maximum supported entry count/i, 'tooManyEntries'],
  [/index\.json/i, 'notYomitan'],
  [/unsupported yomitan dictionary format/i, 'unsupportedFormat'],
  [/no supported yomitan banks|no usable term/i, 'noEntries'],
  [/\bzip\b/i, 'badZip'],
  [/interrupted/i, 'interrupted'],
];

export function dictionaryImportError(message: string | null | undefined): DictionaryImportError {
  if (!message) return 'generic';
  for (const [pattern, key] of PATTERNS) if (pattern.test(message)) return key;
  return 'generic';
}
