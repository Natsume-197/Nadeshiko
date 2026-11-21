/** Code-point string helpers the combine stages share. Offsets and lengths are in code points, not UTF-16 units. */

export const chars = (text: string) => [...text];
export const cpLength = (text: string) => chars(text).length;
/** The first `n` characters. */
export const head = (text: string, n: number) => chars(text).slice(0, n).join('');
/** Everything from character `n` on. */
export const tail = (text: string, n: number) => chars(text).slice(n).join('');
/** The text without its last `n` characters. */
export const dropLast = (text: string, n = 1) => chars(text).slice(0, -n).join('');
/** The last `n` characters. */
export const lastChars = (text: string, n = 1) => chars(text).slice(-n).join('');
/** The first character, or undefined for an empty text. */
export const firstChar = (text: string): string | undefined => chars(text)[0];
/** The last character, or '' for an empty text. */
export const lastChar = (text: string) => chars(text).at(-1) ?? '';

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
