import type { DataSource } from 'typeorm';
import { PINNED_WORD_IDS } from './data/pins';
import { toHiragana } from './kana';

/**
 * JMdict part-of-speech classes the stages ask about. They stand for the typed lookups (`HasExpressionLookup`,
 * `HasVerbOrAdjectiveLookup`, `IsFunctionClusterMatch`…), which test the `PartOfSpeech` of the entries under a key.
 * Two are not parts of speech: `kana` marks a kana spelling of a word that has no kanji spelling or is usually written
 * in kana (`HasKanaAppropriateCompoundLookup`), `common` a spelling of a JMdict common word (our stand-in for the
 * priority-score lookup, `HasPrioritizedNonNameCompoundLookup`).
 */
export type LexClass = 'exp' | 'verb' | 'adj-i' | 'adj-na' | 'adv' | 'prt' | 'conj' | 'aux' | 'kana' | 'common';

const CLASS_BITS: Record<LexClass, number> = {
  exp: 1,
  verb: 2,
  'adj-i': 4,
  'adj-na': 8,
  adv: 16,
  prt: 32,
  conj: 64,
  aux: 128,
  kana: 256,
  common: 512,
};

/** One JMdict word under a kanji spelling: the kana readings that apply to that spelling, in JMdict order. The
 * first is the one shown for the spelling (`RubyTextHelper.FormReading`). */
export interface WordReadings {
  id: number;
  common: boolean;
  /** Hiragana, in form order. */
  kana: readonly string[];
}

/** One JMdict word's forms in index order (`ReadingIndex` is this index), for resolving pins. */
export interface WordForm {
  text: string;
  kana: boolean;
  /** For a kana form: the kanji spellings it applies to, `*` for all. */
  appliesTo?: readonly string[];
}

/** The words the combine stages may form, keyed by spelling with katakana folded to hiragana. */
export interface Lexicon {
  /** Whether some word is spelled `key`. Kanji stay as they are; katakana match their hiragana. */
  has(key: string): boolean;
  /** Whether some word spelled `key` has a sense of this class. */
  hasClass(key: string, cls: LexClass): boolean;
  /** The JMdict words with the kanji spelling `key`, as written (no folding), with their readings of it. */
  readingsOf(key: string): readonly WordReadings[];
  /** The reading (hiragana) of a pinned word's form, resolving `PreMatchedWordId` +
   * `PreMatchedReadingIndex`: a kana form reads as itself, a kanji form as its first applicable kana form, no index
   * as the word's first kana form. Undefined for a word the lexicon was not given. */
  formReading(wordId: number, formIdx?: number): string | undefined;
}

/** {@link Lexicon.formReading} over one word's forms. */
export function readingOfForm(forms: readonly WordForm[], formIdx?: number): string | undefined {
  const form = formIdx === undefined ? undefined : forms[formIdx];
  if (form?.kana) return toHiragana(form.text);
  const applies = (kana: WordForm) =>
    !form || !kana.appliesTo || kana.appliesTo.includes('*') || kana.appliesTo.includes(form.text);
  const first = forms.find((candidate) => candidate.kana && applies(candidate));
  return first ? toHiragana(first.text) : undefined;
}

export class InMemoryLexicon implements Lexicon {
  private readonly masks = new Map<string, number>();
  private readonly readings = new Map<string, WordReadings[]>();
  private readonly words = new Map<number, readonly WordForm[]>();

  /** `classes` tags some keys with their classes; a key there need not also be in `keys`. */
  constructor(keys: Iterable<string>, classes: Partial<Record<LexClass, Iterable<string>>> = {}) {
    for (const key of keys) this.add(key, 0);
    for (const [cls, tagged] of Object.entries(classes) as Array<[LexClass, Iterable<string>]>) {
      for (const key of tagged) this.add(key, CLASS_BITS[cls]);
    }
  }

  /** Adds a key with a class bitmask (see {@link classMask}). */
  add(key: string, mask: number): void {
    const folded = toHiragana(key);
    this.masks.set(folded, (this.masks.get(folded) ?? 0) | mask);
  }

  get size(): number {
    return this.masks.size;
  }

  has(key: string): boolean {
    return this.masks.has(toHiragana(key));
  }

  hasClass(key: string, cls: LexClass): boolean {
    return ((this.masks.get(toHiragana(key)) ?? 0) & CLASS_BITS[cls]) !== 0;
  }

  /** Adds a word's readings under each of its kanji spellings; with `keepForms`, also its forms for
   * {@link formReading}. Kana forms without `appliesTo` apply to every kanji spelling. */
  addWord(id: number, forms: readonly WordForm[], { common = false, keepForms = false } = {}): void {
    for (const form of forms) {
      if (form.kana) continue;
      const kana = forms
        .filter(
          (other) =>
            other.kana && (!other.appliesTo || other.appliesTo.includes('*') || other.appliesTo.includes(form.text)),
        )
        .map((other) => toHiragana(other.text));
      if (kana.length === 0) continue;
      const list = this.readings.get(form.text) ?? [];
      if (!list.some((entry) => entry.id === id)) list.push({ id, common, kana });
      this.readings.set(form.text, list);
    }
    if (keepForms) this.words.set(id, forms);
  }

  readingsOf(key: string): readonly WordReadings[] {
    return this.readings.get(key) ?? [];
  }

  formReading(wordId: number, formIdx?: number): string | undefined {
    const forms = this.words.get(wordId);
    return forms ? readingOfForm(forms, formIdx) : undefined;
  }
}

/** The class bits of a list of JMdict POS tags, following `PosMapper.FromJmDict`. */
export function classMask(tags: readonly string[]): number {
  let mask = 0;
  for (const tag of tags) {
    if (tag === 'exp') mask |= CLASS_BITS.exp;
    else if (tag.startsWith('v') && tag !== 'vulg' && tag !== 'vet' && tag !== 'vidg') mask |= CLASS_BITS.verb;
    else if (tag === 'adj-i' || tag === 'adj-ix') mask |= CLASS_BITS['adj-i'];
    else if (tag === 'adj-na') mask |= CLASS_BITS['adj-na'];
    else if (tag === 'adv') mask |= CLASS_BITS.adv;
    else if (tag === 'prt') mask |= CLASS_BITS.prt;
    else if (tag === 'conj') mask |= CLASS_BITS.conj;
    else if (tag === 'aux' || tag === 'aux-v' || tag === 'aux-adj') mask |= CLASS_BITS.aux;
  }
  return mask;
}

const loaded = new WeakMap<DataSource, Promise<Lexicon>>();

/**
 * Every spelling of an active JMdict word (`dict.lookup` holds each form and its hiragana), with the POS classes of
 * the word's senses. Read once per data source; about 600k keys.
 */
export function loadLexicon(dataSource: DataSource): Promise<Lexicon> {
  let pending = loaded.get(dataSource);
  if (!pending) {
    pending = readLexicon(dataSource);
    loaded.set(dataSource, pending);
    pending.catch(() => loaded.delete(dataSource));
  }
  return pending;
}

async function readLexicon(dataSource: DataSource): Promise<Lexicon> {
  const [lexicon, words, flagged] = await Promise.all([
    readKeys(dataSource),
    readWords(dataSource),
    readFlags(dataSource),
  ]);
  for (const row of flagged)
    lexicon.add(row.key, (row.kana ? CLASS_BITS.kana : 0) | (row.common ? CLASS_BITS.common : 0));
  for (const word of words) {
    lexicon.addWord(
      word.id,
      word.forms.map(([text, kana, appliesTo]) => ({ text, kana, appliesTo: kana ? appliesTo : undefined })),
      { common: word.common, keepForms: PINNED_WORD_IDS.has(word.id) },
    );
  }
  return lexicon;
}

/** Every active JMdict word that has a kanji spelling, with its forms in index order (kana forms keep the spellings
 * they apply to; JMdict's no-kanji readings have none and so apply to no spelling). */
async function readWords(
  dataSource: DataSource,
): Promise<Array<{ id: number; common: boolean; forms: Array<[string, boolean, string[]]> }>> {
  return dataSource.query(
    `SELECT w.id, w.common, json_agg(json_build_array(f.text, f.kana, f.applies_to_kanji) ORDER BY f.idx) AS forms
       FROM dict.word w
       JOIN dict.form f ON f.word_id = w.id AND f.active
      WHERE w.source = 'jmdict' AND w.active
      GROUP BY w.id
     HAVING bool_or(NOT f.kana)`,
  );
}

/** Spellings of common words, and the kana spellings of words written in kana (no kanji spelling, or a `uk` sense).
 * Katakana spellings fold to the hiragana key when added. */
async function readFlags(dataSource: DataSource): Promise<Array<{ key: string; kana: boolean; common: boolean }>> {
  return dataSource.query(
    `SELECT f.text AS key,
            bool_or(f.kana AND (
              NOT EXISTS (SELECT 1 FROM dict.form k WHERE k.word_id = w.id AND k.active AND NOT k.kana)
              OR EXISTS (SELECT 1 FROM dict.sense s WHERE s.word_id = w.id AND 'uk' = ANY(s.misc)))) AS kana,
            bool_or(w.common) AS common
       FROM dict.form f
       JOIN dict.word w ON w.id = f.word_id AND w.source = 'jmdict' AND w.active
      WHERE f.active
      GROUP BY f.text
     HAVING bool_or(w.common) OR bool_or(f.kana AND (
              NOT EXISTS (SELECT 1 FROM dict.form k WHERE k.word_id = w.id AND k.active AND NOT k.kana)
              OR EXISTS (SELECT 1 FROM dict.sense s WHERE s.word_id = w.id AND 'uk' = ANY(s.misc))))`,
  );
}

async function readKeys(dataSource: DataSource): Promise<InMemoryLexicon> {
  const rows: Array<{ key: string; pos: string[] | null }> = await dataSource.query(
    `WITH word_pos AS (
       SELECT w.id, array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL) AS pos
         FROM dict.word w
         LEFT JOIN dict.sense s ON s.word_id = w.id AND s.lang = 'eng'
         LEFT JOIN LATERAL unnest(s.pos) AS p ON true
        WHERE w.source = 'jmdict' AND w.active
        GROUP BY w.id
     )
     SELECT l.key, array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL) AS pos
       FROM dict.lookup l
       JOIN word_pos wp ON wp.id = l.word_id
       LEFT JOIN LATERAL unnest(wp.pos) AS p ON true
      GROUP BY l.key`,
  );
  const lexicon = new InMemoryLexicon([]);
  for (const row of rows) lexicon.add(row.key, classMask(row.pos ?? []));
  return lexicon;
}
