// Slug-only detection is a fallback for candidates without the `name` flag: JMdict can contain JMnedict rows.
// Prefer the flag.
const NAME_DICTIONARY = 'jmnedict';

// Filter names so ordinary words win; the caller decides how to present an all-name result.
export function withoutNameEntries<T extends { name?: boolean; dictionary?: string }>(candidates: readonly T[]): T[] {
  return candidates.filter((candidate) =>
    candidate.name === undefined ? candidate.dictionary !== NAME_DICTIONARY : !candidate.name,
  );
}

interface GlossCandidate {
  entries?: unknown;
}

interface GlossDefinition {
  lang?: unknown;
  text?: unknown;
}

// Use one language for signatures so translations do not count as distinct answers.
const SIGNATURE_LANGUAGE = 'en';

function definitionsOf(candidate: GlossCandidate): GlossDefinition[] {
  const entries = Array.isArray(candidate.entries) ? candidate.entries : [];
  return entries.flatMap((entry) => {
    const senses = Array.isArray((entry as { senses?: unknown })?.senses)
      ? (entry as { senses: unknown[] }).senses
      : [];
    return senses.flatMap((sense) => {
      const definitions = Array.isArray((sense as { definitions?: unknown })?.definitions)
        ? (sense as { definitions: unknown[] }).definitions
        : [];
      return definitions as GlossDefinition[];
    });
  });
}

// Count distinct glosses, not name candidates: repeated definitions should remain readable, while lists of
// different people collapse to the name-only state. Fall back to all definitions when English is absent.
export function distinctNameAnswers(candidates: readonly GlossCandidate[]): number {
  const signatures = new Set<string>();

  for (const candidate of candidates) {
    const definitions = definitionsOf(candidate);
    const preferred = definitions.filter((definition) => definition.lang === SIGNATURE_LANGUAGE);
    const chosen = preferred.length > 0 ? preferred : definitions;

    const texts = chosen
      .map((definition) => (typeof definition.text === 'string' ? definition.text.trim() : ''))
      .filter((text) => text.length > 0);

    // Unreadable candidates are unknown answers, never a single blank definition.
    if (texts.length === 0) return Number.POSITIVE_INFINITY;

    signatures.add([...new Set(texts)].sort().join('\u0000'));
  }

  return signatures.size;
}
