import type { JMdictWord, JMnedictWord, Xref } from '@scriptin/jmdict-simplified-types';

/** Upstream entries reduced to what `dict.*` stores. Pure functions, so the import can be tested without a file
 * or a database. */

export type DictionarySource = 'jmdict' | 'jmnedict';

/** Glosses kept; everything else (Dutch, French, German, ...) is dropped at import. */
export const KEPT_LANGUAGES = ['eng', 'spa'] as const;
export type KeptLanguage = (typeof KEPT_LANGUAGES)[number];

export interface FormInput {
  text: string;
  kana: boolean;
  common: boolean;
  tags: string[];
  /** Kana forms only: the kanji spellings this reading belongs to; `['*']` means all of them. */
  appliesToKanji: string[];
}

export interface SenseInput {
  lang: KeptLanguage;
  pos: string[];
  misc: string[];
  field: string[];
  dialect: string[];
  info: string[];
  appliesToKanji: string[];
  appliesToKana: string[];
  related: Xref[];
  antonym: Xref[];
  glosses: Array<{ text: string; type: string | null }>;
}

export interface ImportEntry {
  id: number;
  source: DictionarySource;
  common: boolean;
  forms: FormInput[];
  senses: SenseInput[];
}

function isKept(lang: string): lang is KeptLanguage {
  return (KEPT_LANGUAGES as readonly string[]).includes(lang);
}

function entryId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Not an ent_seq: ${JSON.stringify(raw)}`);
  return id;
}

/** One output sense per upstream sense and kept language, in upstream order. A JMdict sense normally carries one
 * language, but nothing in the format promises it. */
function splitByLanguage<T extends { lang: string }>(glosses: T[]): Map<KeptLanguage, T[]> {
  const byLang = new Map<KeptLanguage, T[]>();
  for (const gloss of glosses) {
    if (!isKept(gloss.lang)) continue;
    const list = byLang.get(gloss.lang) ?? [];
    list.push(gloss);
    byLang.set(gloss.lang, list);
  }
  return byLang;
}

export function fromJmdict(word: JMdictWord): ImportEntry {
  const forms: FormInput[] = [
    ...word.kanji.map((k) => ({ text: k.text, kana: false, common: k.common, tags: k.tags, appliesToKanji: [] })),
    ...word.kana.map((k) => ({
      text: k.text,
      kana: true,
      common: k.common,
      tags: k.tags,
      appliesToKanji: k.appliesToKanji,
    })),
  ];

  const senses: SenseInput[] = [];
  for (const sense of word.sense) {
    for (const [lang, glosses] of splitByLanguage(sense.gloss)) {
      senses.push({
        lang,
        pos: sense.partOfSpeech,
        misc: sense.misc,
        field: sense.field,
        dialect: sense.dialect,
        info: sense.info,
        appliesToKanji: sense.appliesToKanji,
        appliesToKana: sense.appliesToKana,
        related: sense.related,
        antonym: sense.antonym,
        glosses: glosses.map((g) => ({ text: g.text, type: g.type })),
      });
    }
  }

  return { id: entryId(word.id), source: 'jmdict', common: forms.some((f) => f.common), forms, senses };
}

/** JMnedict has no common flags, and its name types (`surname`, `place`, ...) take the place of a part of speech. */
export function fromJmnedict(word: JMnedictWord): ImportEntry {
  const forms: FormInput[] = [
    ...word.kanji.map((k) => ({ text: k.text, kana: false, common: false, tags: k.tags, appliesToKanji: [] })),
    ...word.kana.map((k) => ({
      text: k.text,
      kana: true,
      common: false,
      tags: k.tags,
      appliesToKanji: k.appliesToKanji,
    })),
  ];

  const senses: SenseInput[] = [];
  for (const translation of word.translation) {
    for (const [lang, glosses] of splitByLanguage(translation.translation)) {
      senses.push({
        lang,
        pos: translation.type,
        misc: [],
        field: [],
        dialect: [],
        info: [],
        appliesToKanji: ['*'],
        appliesToKana: ['*'],
        related: translation.related,
        antonym: [],
        glosses: glosses.map((g) => ({ text: g.text, type: null })),
      });
    }
  }

  return { id: entryId(word.id), source: 'jmnedict', common: false, forms, senses };
}

/** Katakana to hiragana; everything else (kanji, ー, ASCII) unchanged. ヴ becomes ゔ, ヵ/ヶ become ゕ/ゖ. */
export function toHiragana(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
  }
  return out;
}

/** Hiragana to katakana, the inverse of {@link toHiragana}. */
export function toKatakana(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : char;
  }
  return out;
}

/** The keys a spelling is found under: itself and its hiragana, deduplicated. */
export function lookupKeys(text: string): string[] {
  const hiragana = toHiragana(text);
  return hiragana === text ? [text] : [text, hiragana];
}

export interface ExistingForm {
  idx: number;
  text: string;
  kana: boolean;
  active: boolean;
}

export interface AssignedForms {
  /** Every incoming form with its index; all active. */
  rows: Array<FormInput & { idx: number }>;
  /** Indexes of stored forms upstream no longer has; they stay, flagged inactive. */
  deactivate: number[];
  added: number;
  reactivated: number;
}

/** Give each incoming form its stored index, or the next free one. Indexes are never reused or renumbered, which is
 * what keeps a stored `(word_id, idx)` pointing at the same spelling across imports. */
export function assignFormIndexes(existing: ExistingForm[], incoming: FormInput[]): AssignedForms {
  const key = (kana: boolean, text: string) => `${kana ? 'k' : 'j'}\u0000${text}`;
  const stored = new Map(existing.map((form) => [key(form.kana, form.text), form]));
  let next = existing.reduce((max, form) => Math.max(max, form.idx), -1) + 1;

  const matched = new Set<number>();
  const rows: AssignedForms['rows'] = [];
  let added = 0;
  let reactivated = 0;

  for (const form of incoming) {
    const found = stored.get(key(form.kana, form.text));
    if (found && !matched.has(found.idx)) {
      matched.add(found.idx);
      if (!found.active) reactivated += 1;
      rows.push({ ...form, idx: found.idx });
    } else if (!found) {
      rows.push({ ...form, idx: next });
      next += 1;
      added += 1;
    }
    // A spelling repeated within one entry would break the (word_id, kana, text) key; the first one wins.
  }

  const deactivate = existing.filter((form) => form.active && !matched.has(form.idx)).map((form) => form.idx);
  return { rows, deactivate, added, reactivated };
}
