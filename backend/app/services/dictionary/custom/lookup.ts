import type { CandidateTag, DictionaryCandidate, IdentifyQuery } from '../identify';
import { toHiragana } from '../import/entries';
import { resolveArtifactsWithin } from './r2Storage';
import { type ActiveUserDictionaryStack, loadActiveUserDictionaryStack } from './service';
import {
  queryArtifactFrequencies,
  queryArtifactPitches,
  queryArtifactTerms,
  type CustomTagMeta,
  type CustomTermRow,
} from './sqlitePool';
import { detectDefinitionLang, type YomitanNode } from './structuredContent';

/**
 * Merges a signed-in reader's enabled custom Yomitan dictionaries (terms, frequency, pitch) into Nadeshiko's
 * `identifyWord` candidates in their configured stack order.
 */

export interface CustomDefinition {
  lang: 'en' | 'es' | 'ja';
  text: string;
  structuredContent?: YomitanNode | YomitanNode[];
}

export interface CustomFrequencyBadge {
  dictionary: string;
  dictionaryName: string;
  value: number | null;
  displayValue: string;
}

export interface CustomPitchPattern {
  downstep: number;
  source?: string;
  nasal?: number[];
  devoice?: number[];
  tags?: string[];
}

export interface EnrichedDictionaryCandidate extends Omit<DictionaryCandidate, 'dictionary' | 'pitch' | 'entries'> {
  dictionary: string;
  pitch?: CustomPitchPattern[];
  customFrequencies?: CustomFrequencyBadge[];
  entries: Array<{
    dictionary: string;
    dictionaryName: string;
    senses: Array<{
      position: number;
      definitions: CustomDefinition[];
      tags: CandidateTag[];
      notes?: string[];
    }>;
  }>;
}

type CardEntry = EnrichedDictionaryCandidate['entries'][number];

const MAX_SENSES_PER_CUSTOM_DICT = 8;

/** How long a lookup waits for a dictionary that is not in the local cache (a new one, or one evicted). Enough for a
 * small file to arrive; a large one keeps downloading after it, and the card answers without it, marked pending so
 * nothing caches the answer. With the cache on a volume this is rare, so a short wait keeps the card fast. */
export const COLD_ARTIFACT_WAIT_MS = 300;

/** The card shows two patterns; a few more leave room for every source. */
const MAX_PITCH_PATTERNS = 4;

function mapTagCategory(rawCategory: string): CandidateTag['category'] {
  const lower = rawCategory.toLowerCase();
  if (lower.includes('partofspeech') || lower === 'pos' || lower === 'part-of-speech') return 'partOfSpeech';
  if (lower.includes('field') || lower.includes('domain')) return 'field';
  if (lower.includes('dialect')) return 'dialect';
  return 'misc';
}

function buildTags(rawTags: string, tagMeta: Map<string, CustomTagMeta>): CandidateTag[] {
  if (!rawTags.trim()) return [];
  const seen = new Set<string>();
  const out: CandidateTag[] = [];
  for (const code of rawTags.split(/\s+/)) {
    const trimmed = code.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    const meta = tagMeta.get(trimmed);
    out.push({
      category: meta ? mapTagCategory(meta.category) : 'misc',
      code: trimmed,
      label: meta?.notes || trimmed,
    });
  }
  return out;
}

function buildCustomEntry(
  stackId: string,
  title: string,
  rows: CustomTermRow[],
  tagMeta: Map<string, CustomTagMeta>,
): CardEntry | null {
  const senses: CardEntry['senses'] = [];
  let position = 0;

  for (const row of rows) {
    if (senses.length >= MAX_SENSES_PER_CUSTOM_DICT) break;
    const tags = buildTags([row.definitionTags, row.termTags].filter(Boolean).join(' '), tagMeta);
    for (const item of row.glossary) {
      if (senses.length >= MAX_SENSES_PER_CUSTOM_DICT) break;
      senses.push({
        position,
        definitions: [
          {
            lang: detectDefinitionLang(item.text),
            text: item.text,
            ...(item.structuredContent !== undefined ? { structuredContent: item.structuredContent } : {}),
          },
        ],
        tags,
      });
      position += 1;
    }
  }

  if (senses.length === 0) return null;
  return { dictionary: stackId, dictionaryName: title, senses };
}

type ActiveDictionary = ActiveUserDictionaryStack['dictionaries'][number];

/** A dictionary whose file is on this container's disk. */
interface Located {
  dict: ActiveDictionary;
  path: string;
}

interface Lookup {
  headword: string;
  headwordHira: string;
  readingHira: string | null;
}

interface FoundEntry {
  order: number;
  entry: CardEntry;
  expression: string;
  reading: string;
}

function customEntriesFor(dicts: Located[], lookup: Lookup): FoundEntry[] {
  const out: FoundEntry[] = [];
  for (const { dict, path } of dicts) {
    const { rows, tags } = queryArtifactTerms(
      path,
      lookup.headword,
      lookup.headwordHira,
      lookup.readingHira,
      MAX_SENSES_PER_CUSTOM_DICT,
    );
    const [first] = rows;
    if (!first) continue;
    const entry = buildCustomEntry(dict.stackId, dict.title, rows, tags);
    if (entry) out.push({ order: dict.sortOrder, entry, expression: first.expression, reading: first.reading });
  }
  return out;
}

function customFrequenciesFor(dicts: Located[], lookup: Lookup): CustomFrequencyBadge[] {
  const out: CustomFrequencyBadge[] = [];
  for (const { dict, path } of dicts) {
    const [best] = queryArtifactFrequencies(path, lookup.headword, lookup.headwordHira, lookup.readingHira);
    if (!best) continue;
    out.push({
      dictionary: dict.stackId,
      dictionaryName: dict.title,
      value: best.value,
      displayValue: best.displayValue,
    });
  }
  return out;
}

/**
 * The reader's pitch dictionaries first, in stack order, then our own patterns they do not already give, so an
 * uploaded pitch dictionary adds to the card rather than hiding ours. Every row here has the candidate's reading
 * (`queryArtifactPitches` keeps no other), so one downstep is one pattern.
 */
function mergedPitchFor(
  dicts: Located[],
  lookup: Lookup,
  builtin: DictionaryCandidate['pitch'],
): CustomPitchPattern[] | undefined {
  const out: CustomPitchPattern[] = [];
  const seen = new Set<number>();
  for (const { dict, path } of dicts) {
    const matches = queryArtifactPitches(path, lookup.headword, lookup.headwordHira, lookup.readingHira);
    for (const match of matches) {
      for (const p of match.pitches) {
        if (seen.has(p.position)) continue;
        seen.add(p.position);
        out.push({
          downstep: p.position,
          source: dict.title,
          ...(p.nasal ? { nasal: p.nasal } : {}),
          ...(p.devoice ? { devoice: p.devoice } : {}),
          ...(p.tags ? { tags: p.tags } : {}),
        });
      }
    }
  }
  for (const pattern of builtin ?? []) {
    if (seen.has(pattern.downstep)) continue;
    seen.add(pattern.downstep);
    out.push({ downstep: pattern.downstep });
  }
  return out.length > 0 ? out.slice(0, MAX_PITCH_PATTERNS) : undefined;
}

/**
 * Enriches built-in `identifyWord` candidates with the authenticated user's custom dictionaries.
 *
 * `pending` is true when the answer is missing a dictionary the reader has switched on: one still indexing, or one
 * this container is still fetching from R2. Such an answer must not be cached anywhere, or the card would keep
 * showing it without that dictionary for a day.
 */
export async function enrichCandidatesWithCustomDictionaries(
  userId: number,
  query: IdentifyQuery,
  baseCandidates: DictionaryCandidate[],
): Promise<{ candidates: EnrichedDictionaryCandidate[]; stackFingerprint: string | null; pending: boolean }> {
  const stack = await loadActiveUserDictionaryStack(userId);
  if (!stack.stackFingerprint) {
    return { candidates: baseCandidates as EnrichedDictionaryCandidate[], stackFingerprint: null, pending: false };
  }

  const { paths, missing } = await resolveArtifactsWithin(
    stack.dictionaries.map((dict) => dict.storageKey),
    COLD_ARTIFACT_WAIT_MS,
  );
  const pending = stack.pendingCount > 0 || missing > 0;

  const located: Located[] = stack.dictionaries.flatMap((dict) => {
    const path = paths.get(dict.storageKey);
    return path ? [{ dict, path }] : [];
  });
  const termDicts = located.filter(({ dict }) => dict.hasTerms);
  const freqDicts = located.filter(({ dict }) => dict.hasFrequency);
  const pitchDicts = located.filter(({ dict }) => dict.hasPitch);

  const enriched: EnrichedDictionaryCandidate[] = baseCandidates.map((candidate) => {
    const lookup: Lookup = {
      headword: candidate.headword,
      headwordHira: toHiragana(candidate.headword),
      readingHira: candidate.reading ? toHiragana(candidate.reading) : null,
    };

    const ordered: Array<{ order: number; entry: CardEntry }> = [];
    if (stack.builtinEnabled) {
      for (const entry of candidate.entries) {
        ordered.push({ order: stack.builtinPosition, entry: entry as CardEntry });
      }
    }
    ordered.push(...customEntriesFor(termDicts, lookup));
    // Stable sort: JMdict's own entries keep their order at the built-in position.
    ordered.sort((a, b) => a.order - b.order);

    const customFrequencies = customFrequenciesFor(freqDicts, lookup);
    const pitch = mergedPitchFor(pitchDicts, lookup, candidate.pitch);
    const { pitch: _builtinPitch, ...rest } = candidate;
    return {
      ...rest,
      entries: ordered.map((item) => item.entry),
      ...(pitch ? { pitch } : {}),
      ...(customFrequencies.length > 0 ? { customFrequencies } : {}),
    };
  });

  // With JMdict off, a candidate only it answered has nothing left to show.
  let finalCandidates = stack.builtinEnabled ? enriched : enriched.filter((c) => c.entries.length > 0);

  // Custom-only fallback: JMdict has no such word (a grammar point in DoJG, an encyclopedia entry), so build the
  // candidate from the reader's own dictionaries, trying the lemma, then the surface form.
  if (finalCandidates.length === 0 && termDicts.length > 0) {
    const readingHira = query.reading ? toHiragana(query.reading) : null;
    const keys = [query.lemma, query.surface].filter((v): v is string => Boolean(v?.trim()));
    for (const key of keys) {
      const found = customEntriesFor(termDicts, { headword: key, headwordHira: toHiragana(key), readingHira });
      if (found.length === 0) continue;
      found.sort((a, b) => a.order - b.order);
      const [first] = found;
      if (!first) continue;
      const resolved: Lookup = {
        headword: first.expression,
        headwordHira: toHiragana(first.expression),
        readingHira: first.reading ? toHiragana(first.reading) : readingHira,
      };
      const customFrequencies = customFrequenciesFor(freqDicts, resolved);
      const pitch = mergedPitchFor(pitchDicts, resolved, undefined);
      finalCandidates = [
        {
          id: `${first.entry.dictionary}:${first.expression}`,
          headword: first.expression,
          reading: first.reading || query.reading || null,
          common: false,
          name: false,
          sourceId: first.expression,
          dictionary: first.entry.dictionary,
          jlpt: null,
          frequency: null,
          forms: [],
          entries: found.map((item) => item.entry),
          ...(pitch ? { pitch } : {}),
          ...(customFrequencies.length > 0 ? { customFrequencies } : {}),
        },
      ];
      break;
    }
  }

  return { candidates: finalCandidates, stackFingerprint: stack.stackFingerprint, pending };
}
