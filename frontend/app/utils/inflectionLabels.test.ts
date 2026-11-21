import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inflectionLabel, inflectionLine } from './inflectionLabels';

/** Every label the backend's parser can emit, read from its source: the strings inside its array literals. */
function backendLabels(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL('../../../backend/app/services/parser/labels.ts', import.meta.url)),
    'utf8',
  );
  const labels = new Set<string>();
  for (const [, inside] of source.matchAll(/\[([^\]]*)\]/g)) {
    for (const [, label] of (inside ?? '').matchAll(/'([^']+)'/g)) if (label) labels.add(label);
  }
  for (const [, label] of source.matchAll(/const [A-Z_]+ = '([^']+)'/g)) if (label) labels.add(label);
  return [...labels];
}

describe('inflectionLabel', () => {
  it('has Spanish for every label the parser emits', () => {
    const labels = backendLabels();
    expect(labels.length).toBeGreaterThan(40);
    const missing = labels.filter(
      (label) => inflectionLabel(label, 'es') === label && !/^adverbial|^provisional/.test(label),
    );
    expect(missing).toEqual([]);
  });

  it('keeps English as it is, and an unknown label in English', () => {
    expect(inflectionLabel('past', 'en')).toBe('past');
    expect(inflectionLabel('something new', 'es')).toBe('something new');
  });

  it('joins a line outermost first', () => {
    expect(inflectionLine(['past', 'potential / passive', 'causative'], 'es')).toBe(
      'pasado · potencial / pasiva · causativa',
    );
    expect(inflectionLine(['past', 'polite'], 'en')).toBe('past · polite');
  });
});
