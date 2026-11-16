/*
 * Japanese deconjugator, ported from Apache-2.0 C# source.
 * The rules in ./rules.json come from JL (rampaa/JL), which took them from Nazeka (wareya/nazeka). This file is a
 * modified version of the C# original; see ./NOTICE for attribution.
 *
 * The algorithm is a breadth-first search: every rule whose conjugated ending (`con_end`) matches the end of a form,
 * and whose conjugated tag (`con_tag`) matches the form's last tag, replaces that ending with the dictionary ending
 * (`dec_end`) and pushes the dictionary tag (`dec_tag`). Every form reached is a candidate; callers check candidates
 * against the dictionary and the tags.
 */
import rulesJson from './rules.json';

/** One rule object as stored in rules.json. Every array field is parallel to `dec_end`. */
export interface DeconjugationRule {
  type: string;
  contextrule?: string;
  dec_end: string[];
  con_end: string[];
  dec_tag?: string[];
  con_tag?: string[];
  detail: string;
}

/** One column of a rule's parallel arrays. A shorter array reuses its element 0 (`ElementAtOrDefault(i) ??
 * array[0]`), which is how rules.json writes "same for every column". */
interface DeconjugationVirtualRule {
  decEnd: string;
  conEnd: string;
  decTag: string | undefined;
  conTag: string | undefined;
  detail: string;
}

/** A candidate reached by the deconjugator. Treat it as immutable: results are cached and shared between calls. */
export interface DeconjugatedForm {
  /** Candidate text after undoing `process`; a dictionary form when the chain is a real conjugation. */
  readonly text: string;
  /** The input this form was derived from. */
  readonly originalText: string;
  /** Grammatical tags, oldest first: the input's tag (e.g. `adj-i`) first, the dictionary form's tag (e.g. `v1`)
   * last. The initial form has none. */
  readonly tags: readonly string[];
  /** Rule `detail` labels in the order the rules were applied, which is outermost suffix first: 食べさせられたくなかった
   * starts with the label that removed た. A rule with an empty detail contributes an empty string (as upstream). */
  readonly process: readonly string[];
  /** Every text on the chain from the input to this form, input first, without duplicates. Empty on the initial
   * form. */
  readonly seenText: readonly string[];
}

/** Counters for the result cache, mirroring `DeconjugationCacheStats` (without its optional BFS timing). */
export interface DeconjugationCacheStats {
  hits: number;
  misses: number;
  stores: number;
  evictions: number;
  count: number;
  maxEntries: number;
  bfsCalls: number;
}

type RuleMode = 'standard' | 'onlyFinal' | 'neverFinal' | 'context' | 'rewrite';

interface RuleIndexEntry {
  rule: DeconjugationRule;
  virtualRule: DeconjugationVirtualRule;
  mode: RuleMode;
}

const DEFAULT_MAX_CACHE_ENTRIES = 50_000;
const MAX_CACHEABLE_INPUT_LENGTH = 40;
const MAX_CACHED_FORMS_BASE = 64;
const MAX_CACHED_FORMS_PER_CHAR = 12;
/** Deconjugation shortens text; a form more than this many characters longer than the input is not expanded. */
export const MAX_TEXT_GROWTH_FROM_ORIGINAL = 10;
/** A form with more tags than the input length plus this is not expanded (the deepest real chain is about 6 steps,
 * e.g. 食べさせられたくなかったらしい). */
export const MAX_CHAIN_DEPTH_ABOVE_INPUT_LENGTH = 6;

/** The deconjugator: BFS over the JL/Nazeka rules with a bounded two-generation result cache. */
export class Deconjugator {
  private readonly maxCacheEntries: number;
  private gen0 = new Map<string, readonly DeconjugatedForm[]>();
  private gen1: Map<string, readonly DeconjugatedForm[]> | null = null;
  private gen0Count = 0;
  private cacheHitCount = 0;
  private cacheMissCount = 0;
  private cacheStoreCount = 0;
  private cacheEvictionCount = 0;
  private bfsCallCount = 0;

  private readonly conEndIndex: Map<string, RuleIndexEntry[]>;
  private readonly maxConEndLength: number;

  /** `rules` defaults to the bundled rules.json; passing others is for tests. */
  constructor(options: { maxCacheEntries?: number; rules?: readonly DeconjugationRule[] } = {}) {
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES);
    const index = buildRuleIndex(options.rules ?? (rulesJson as DeconjugationRule[]));
    this.conEndIndex = index.index;
    this.maxConEndLength = index.maxConEndLength;
  }

  /** Every candidate for `text`, including `text` itself. Ordered by text length descending, then by code unit, then
   * by discovery order; callers must not re-sort. */
  deconjugate(text: string): readonly DeconjugatedForm[] {
    const cached = this.tryGetCached(text);
    if (cached) return cached;

    if (!text) return [];

    const result = this.runBfs(text);
    this.bfsCallCount++;
    this.storeCached(text, result);
    return result;
  }

  getCacheStats(): DeconjugationCacheStats {
    return {
      hits: this.cacheHitCount,
      misses: this.cacheMissCount,
      stores: this.cacheStoreCount,
      evictions: this.cacheEvictionCount,
      count: this.gen0.size + (this.gen1?.size ?? 0),
      maxEntries: this.maxCacheEntries,
      bfsCalls: this.bfsCallCount,
    };
  }

  private tryGetCached(text: string): readonly DeconjugatedForm[] | undefined {
    const hit = this.gen0.get(text);
    if (hit) {
      this.cacheHitCount++;
      return hit;
    }

    const old = this.gen1?.get(text);
    if (old) {
      // Promote without counting towards gen0's rotation threshold, as the original's TryAdd here does.
      if (!this.gen0.has(text)) this.gen0.set(text, old);
      this.cacheHitCount++;
      return old;
    }

    this.cacheMissCount++;
    return undefined;
  }

  private storeCached(text: string, forms: readonly DeconjugatedForm[]): void {
    if (
      text.length > MAX_CACHEABLE_INPUT_LENGTH ||
      forms.length >= MAX_CACHED_FORMS_BASE + MAX_CACHED_FORMS_PER_CHAR * text.length
    ) {
      return;
    }

    this.cacheStoreCount++;

    if (!this.gen0.has(text)) {
      this.gen0.set(text, forms);
      this.gen0Count++;
      if (this.gen0Count > this.maxCacheEntries) this.rotateGenerations();
    }
  }

  private rotateGenerations(): void {
    const evicted = this.gen1?.size ?? 0;
    this.gen1 = this.gen0;
    this.gen0 = new Map();
    this.gen0Count = 0;
    this.cacheEvictionCount += evicted;
  }

  private runBfs(text: string): readonly DeconjugatedForm[] {
    // `seen` doubles as the result set: every form reached is emitted, in discovery order.
    const seen = new Set<string>();
    const ordered: DeconjugatedForm[] = [];
    const initial: DeconjugatedForm = { text, originalText: text, tags: [], process: [], seenText: [] };
    seen.add(formKey(initial));
    ordered.push(initial);

    let novel: DeconjugatedForm[] = [initial];
    while (novel.length > 0) {
      const newNovel: DeconjugatedForm[] = [];
      for (const form of novel) {
        if (shouldSkipForm(form)) continue;
        this.applyIndexedRules(form, newNovel, seen, ordered);
      }
      novel = newNovel;
    }

    return sortForms(ordered);
  }

  private applyIndexedRules(
    form: DeconjugatedForm,
    newNovel: DeconjugatedForm[],
    seen: Set<string>,
    ordered: DeconjugatedForm[],
  ): void {
    const text = form.text;
    const maxSuffix = Math.min(this.maxConEndLength, text.length);
    const lastTag = form.tags.length > 0 ? form.tags[form.tags.length - 1] : undefined;

    for (let suffixLen = 0; suffixLen <= maxSuffix; suffixLen++) {
      const entries = this.conEndIndex.get(text.slice(text.length - suffixLen));
      if (!entries) continue;

      for (const { rule, virtualRule, mode } of entries) {
        if (mode === 'onlyFinal' && form.tags.length > 0) continue;
        if (mode === 'neverFinal' && form.tags.length === 0) continue;
        if (mode === 'rewrite' && text !== virtualRule.conEnd) continue;
        if (mode === 'context') {
          if (rule.contextrule === 'v1inftrap' && !v1InfTrapCheck(form)) continue;
          if (rule.contextrule === 'saspecial' && !saSpecialCheck(form, rule)) continue;
          if (rule.contextrule === 'temirurule' && !temiruCheck(form, rule)) continue;
        }

        if (!rule.detail && form.tags.length === 0) continue;

        if (form.tags.length > 0 && lastTag !== virtualRule.conTag) continue;

        const newText = text.slice(0, text.length - virtualRule.conEnd.length) + virtualRule.decEnd;
        if (newText === form.originalText) continue;

        const newForm = createNewForm(form, newText, virtualRule);
        const key = formKey(newForm);
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(newForm);
          newNovel.push(newForm);
        }
      }
    }
  }
}

function buildRuleIndex(rules: readonly DeconjugationRule[]): {
  index: Map<string, RuleIndexEntry[]>;
  maxConEndLength: number;
} {
  const index = new Map<string, RuleIndexEntry[]>();
  let maxConEndLength = 0;

  for (const rule of rules) {
    const mode: RuleMode =
      rule.type === 'onlyfinalrule'
        ? 'onlyFinal'
        : rule.type === 'neverfinalrule'
          ? 'neverFinal'
          : rule.type === 'contextrule'
            ? 'context'
            : rule.type === 'rewriterule'
              ? 'rewrite'
              : 'standard';

    for (let i = 0; i < rule.dec_end.length; i++) {
      const virtualRule: DeconjugationVirtualRule = {
        decEnd: rule.dec_end[i] as string,
        conEnd: (rule.con_end[i] ?? rule.con_end[0]) as string,
        decTag: rule.dec_tag?.[i] ?? rule.dec_tag?.[0],
        conTag: rule.con_tag?.[i] ?? rule.con_tag?.[0],
        detail: rule.detail,
      };

      maxConEndLength = Math.max(maxConEndLength, virtualRule.conEnd.length);

      let list = index.get(virtualRule.conEnd);
      if (!list) {
        list = [];
        index.set(virtualRule.conEnd, list);
      }
      list.push({ rule, virtualRule, mode });
    }
  }

  return { index, maxConEndLength };
}

/** Identity of a form for the BFS's seen-set: `DeconjugationForm.Equals`, which compares `seenText` as a set. */
function formKey(form: DeconjugatedForm): string {
  const seenSet = [...form.seenText].sort().join('\u0001');
  return [form.text, form.originalText, form.tags.join('\u0001'), form.process.join('\u0001'), seenSet].join('\u0000');
}

function shouldSkipForm(form: DeconjugatedForm): boolean {
  return (
    !form.text ||
    form.text.length > form.originalText.length + MAX_TEXT_GROWTH_FROM_ORIGINAL ||
    form.tags.length > form.originalText.length + MAX_CHAIN_DEPTH_ABOVE_INPUT_LENGTH
  );
}

function createNewForm(form: DeconjugatedForm, newText: string, rule: DeconjugationVirtualRule): DeconjugatedForm {
  const tags = [...form.tags];
  // The first step also records what the input itself is (the rule's con_tag); later steps only push dec_tag.
  if (form.tags.length === 0 && rule.conTag != null) tags.push(rule.conTag);
  if (rule.decTag != null) tags.push(rule.decTag);

  // The initial form has no chain yet, so the chain starts with its text. A text already on the chain keeps its
  // first position.
  const chain = form.seenText.length > 0 ? form.seenText : [form.text];
  const seenText = chain.includes(newText) ? chain : [...chain, newText];

  return { text: newText, originalText: form.originalText, tags, process: [...form.process, rule.detail], seenText };
}

// Stable sort: same-text forms with different chains keep BFS discovery order.
function sortForms(ordered: DeconjugatedForm[]): readonly DeconjugatedForm[] {
  return ordered
    .map((form, i) => ({ form, i }))
    .sort((a, b) => {
      const byLength = b.form.text.length - a.form.text.length;
      if (byLength !== 0) return byLength;
      if (a.form.text !== b.form.text) return a.form.text < b.form.text ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ form }) => form);
}

function temiruCheck(form: DeconjugatedForm, rule: DeconjugationRule): boolean {
  const conEnd = rule.con_end[0] as string;
  if (!form.text.endsWith(conEnd)) return false;
  const prefix = form.text.slice(0, form.text.length - conEnd.length);
  return prefix.endsWith('て') || prefix.endsWith('で');
}

function v1InfTrapCheck(form: DeconjugatedForm): boolean {
  return !(form.tags.length === 1 && form.tags[0] === 'stem-ren');
}

function saSpecialCheck(form: DeconjugatedForm, rule: DeconjugationRule): boolean {
  if (form.text.length === 0) return false;

  const conEnd = rule.con_end[0] as string;
  if (!form.text.endsWith(conEnd)) return false;

  const prefixLength = form.text.length - conEnd.length;
  return prefixLength <= 0 || form.text[prefixLength - 1] !== 'さ';
}

/** Process-wide instance, like `Deconjugator.Instance`. */
export const deconjugator = new Deconjugator();

/** Every deconjugation candidate for `text`, using the shared cached instance. See {@link Deconjugator.deconjugate}. */
export function deconjugate(text: string): readonly DeconjugatedForm[] {
  return deconjugator.deconjugate(text);
}
