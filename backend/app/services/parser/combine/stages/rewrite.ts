/*
 * The token rewrite-rule engine (`RunRewriteRules`, `FindFiringRule`, `MatchesRuleAt`, `MatchesPattern`,
 * `MatchesContext`, `IsClauseBoundary`, `MatchesWindow`, `EvaluateGuard`, `ExpandGuardPattern`, `BuildOutputs`,
 * `AssignOffsets`, the per-phase index and `ValidateRewriteRules`), ported from Apache-2.0 C# source (see
 * ../../NOTICE). The rows are in ../data/rewriteRules.ts.
 *
 * Modified: outputs are re-cut through ../recut.ts, so a split or merge keeps each piece's Sudachi morphemes (cut where
 * a boundary falls inside one), and an output whose reading is '' reads as its members. Lookup guards ask our JMdict
 * lexicon, which has no names, so NonNameCompoundExists is CompoundExists, and it has no frequency ranks, so
 * FrequencyRankUnder never holds (no row uses it). A pin without a reading on a kanji surface reads as the pinned
 * JMdict form (walked along the surface, so an inflected tail is kept), since our reading is the output; on a kana
 * surface the reading stays the surface's. RecoverConjugations stores the deconjugation from the surface to the
 * dictionary form, which AssignKinds keeps when it finds none itself.
 */

import type {
  ContextCond,
  LookupGuard,
  RewritePhase,
  RewriteRule,
  TokenPattern,
  TokenTemplate,
  WindowCond,
} from '../data/rewriteRules';
import { CONTEXT_SECTION_LABELS, REWRITE_RULES, SECTION_LABELS } from '../data/rewriteRules';
import { deconj, hasSection, known, SECTION } from '../group';
import { deconjugationKey, hasKanji, toKatakana } from '../kana';
import { type Piece, recut } from '../recut';
import type { CombineContext, Group } from '../types';
import { readAs } from './readings';

export interface RewriteIndex {
  byFirstText: Map<string, RewriteRule[]>;
  /** First pattern has no exact surface, so these are tried at every token. */
  residual: RewriteRule[];
}

/** `ValidateRewriteRules`: unique ids, 1-3 patterns, at least one output, all-literal re-cuts conserve the
 * text, and every output of a split or merge gives a reading. */
export function validateRewriteRules(rules: readonly RewriteRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`Duplicate rewrite rule id '${rule.id}'.`);
    seen.add(rule.id);
    if (rule.match.length < 1 || rule.match.length > 3)
      throw new Error(`Rewrite rule '${rule.id}' must match 1–3 tokens.`);
    if (rule.replace.length < 1) throw new Error(`Rewrite rule '${rule.id}' must produce at least one token.`);
    const literalMatch = rule.match.every((pattern) => pattern.text !== undefined);
    const literalReplace = rule.replace.every((template) => template.text.length > 0);
    if (literalMatch && literalReplace) {
      const matched = rule.match.map((pattern) => pattern.text).join('');
      const produced = rule.replace.map((template) => template.text).join('');
      if (matched !== produced)
        throw new Error(`Rewrite rule '${rule.id}' does not conserve surface text: '${matched}' -> '${produced}'.`);
    }
    const isRewrite = rule.replace.length !== 1 || (rule.replace[0] as TokenTemplate).text.length > 0;
    if (isRewrite)
      for (const template of rule.replace)
        if (template.text.length > 0 && template.reading === undefined)
          throw new Error(`Rewrite rule '${rule.id}' output '${template.text}' must specify a Reading.`);
  }
}

/** One phase's rules (all of `rules` when no phase is given) indexed by the first pattern's surface, in table
 * order. */
export function buildRewriteIndex(rules: readonly RewriteRule[], phase?: RewritePhase): RewriteIndex {
  validateRewriteRules(rules);
  const index: RewriteIndex = { byFirstText: new Map(), residual: [] };
  const add = (key: string, rule: RewriteRule) => {
    const list = index.byFirstText.get(key) ?? [];
    list.push(rule);
    index.byFirstText.set(key, list);
  };
  for (const rule of rules) {
    if (phase && rule.phase !== phase) continue;
    const first = rule.match[0] as TokenPattern;
    if (first.text !== undefined) add(first.text, rule);
    else if (first.textAnyOf && first.textAnyOf.length > 0) for (const text of first.textAnyOf) add(text, rule);
    else index.residual.push(rule);
  }
  return index;
}

/** `IsNumeralToken`. */
export const isNumeralToken = (group: Group) => group.cls === 'Numeral' || hasSection(group, SECTION.Numeral);

/** `IsClauseBoundary`: a symbol or blank neighbour, or the edge of the sentence. */
export const isClauseBoundary = (neighbour: Group | undefined) =>
  !neighbour || neighbour.cls === 'Symbol' || neighbour.cls === 'SupplementarySymbol' || neighbour.cls === 'BlankSpace';

function matchesPattern(group: Group, p: TokenPattern): boolean {
  if ((p.requireUnpinned ?? true) && group.flags.pin !== undefined) return false;
  if (p.text !== undefined && group.s !== p.text) return false;
  if (p.textAnyOf && !p.textAnyOf.includes(group.s)) return false;
  if (p.textStartsWith !== undefined && !group.s.startsWith(p.textStartsWith)) return false;
  if (p.textEndsWith !== undefined && !group.s.endsWith(p.textEndsWith)) return false;
  if (p.pos && !p.pos.includes(group.cls)) return false;
  if (p.dictFormAnyOf && !p.dictFormAnyOf.includes(group.d)) return false;
  if (p.normalizedFormAnyOf && !p.normalizedFormAnyOf.includes(group.n)) return false;
  if (p.readingPrefix !== undefined && !group.r.startsWith(p.readingPrefix)) return false;
  if (p.notReadingPrefix !== undefined && group.r.startsWith(p.notReadingPrefix)) return false;
  return true;
}

function matchesContext(neighbour: Group | undefined, cond: ContextCond): boolean {
  let ok = true;
  if (cond.textAnyOf) ok &&= !!neighbour && cond.textAnyOf.includes(neighbour.s);
  if (cond.textEndsWithAnyOf) ok &&= !!neighbour && cond.textEndsWithAnyOf.some((end) => neighbour.s.endsWith(end));
  if (cond.textStartsWithAnyOf)
    ok &&= !!neighbour && cond.textStartsWithAnyOf.some((start) => neighbour.s.startsWith(start));
  if (cond.pos) ok &&= !!neighbour && cond.pos.includes(neighbour.cls);
  if (cond.sectionAnyOf)
    ok &&= !!neighbour && cond.sectionAnyOf.some((section) => hasSection(neighbour, CONTEXT_SECTION_LABELS[section]));
  if (cond.numeral) ok &&= !!neighbour && isNumeralToken(neighbour);
  if (cond.clauseBoundary) ok &&= isClauseBoundary(neighbour);
  return cond.negate ? !ok : ok;
}

function matchesWindow(groups: readonly Group[], matchStart: number, cond: WindowCond): boolean {
  const from = Math.max(0, matchStart + cond.from);
  const to = Math.min(groups.length - 1, matchStart + cond.to);
  let found = false;
  for (let j = from; j <= to && !found; j++) {
    const group = groups[j] as Group;
    found = (!cond.textAnyOf || cond.textAnyOf.includes(group.s)) && (!cond.pos || cond.pos.includes(group.cls));
  }
  return cond.negate ? !found : found;
}

/** `ExpandGuardPattern`: "{k}" is the k-th matched surface, anything else is literal. */
export function expandGuardPattern(pattern: string, groups: readonly Group[], i: number, len: number): string {
  return pattern.replace(/\{(\d)\}/g, (_, k: string) => (Number(k) < len ? (groups[i + Number(k)] as Group).s : ''));
}

function evaluateGuard(guard: LookupGuard, groups: readonly Group[], i: number, len: number, ctx: CombineContext) {
  const expanded = expandGuardPattern(guard.pattern, groups, i, len);
  switch (guard.kind) {
    case 'CompoundExists':
    case 'NonNameCompoundExists':
      return known(ctx, expanded);
    case 'CompoundAbsent':
      return !known(ctx, expanded);
    case 'FrequencyRankUnder':
      return false;
  }
}

function matchesRuleAt(rule: RewriteRule, groups: readonly Group[], i: number, ctx: CombineContext): boolean {
  const len = rule.match.length;
  if (i + len > groups.length) return false;
  for (let k = 0; k < len; k++)
    if (!matchesPattern(groups[i + k] as Group, rule.match[k] as TokenPattern)) return false;
  if (rule.prev && !matchesContext(groups[i - 1], rule.prev)) return false;
  if (rule.next && !matchesContext(groups[i + len], rule.next)) return false;
  if (rule.window && !matchesWindow(groups, i, rule.window)) return false;
  if (rule.guard && !evaluateGuard(rule.guard, groups, i, len, ctx)) return false;
  return true;
}

function findFiringRule(
  groups: readonly Group[],
  i: number,
  index: RewriteIndex,
  ctx: CombineContext,
): RewriteRule | undefined {
  for (const rule of index.byFirstText.get((groups[i] as Group).s) ?? [])
    if (matchesRuleAt(rule, groups, i, ctx)) return rule;
  for (const rule of index.residual) if (matchesRuleAt(rule, groups, i, ctx)) return rule;
  return undefined;
}

const INFLECTING = new Set(['Verb', 'IAdjective', 'NaAdjective', 'Auxiliary', 'Expression']);

/** `PinnedConjugationProcess`: the deconjugation that leads from a pinned surface to its dictionary form. */
export function pinnedDeconjugation(ctx: CombineContext, surface: string, dictForm: string) {
  const target = deconjugationKey(dictForm);
  if (deconjugationKey(surface) === target) return null;
  return deconj(ctx, surface).find((form) => form.text === target) ?? null;
}

/** The reading of a pinned group whose template gives none: the pinned form, walked along a kanji surface. */
function pinnedReading(ctx: CombineContext, group: Group, template: TokenTemplate): string | undefined {
  if (template.pin === undefined || !hasKanji(group.s)) return undefined;
  const kana = ctx.lexicon.formReading(template.pin, template.pinReadingIndex);
  if (!kana) return undefined;
  const reading = readAs(group.s, group.d, kana);
  return reading ? toKatakana(reading) : undefined;
}

/** `BuildOutputs`: output k copies matched[min(k, len - 1)]; unset template fields keep the source's value,
 * or the new surface when the template changes it. */
function buildOutputs(rule: RewriteRule, groups: readonly Group[], i: number, ctx: CombineContext): Group[] {
  const len = rule.match.length;
  const pieces: Piece[] = rule.replace.map((template, k) => {
    const source = groups[i + Math.min(k, len - 1)] as Group;
    const s = template.text || source.s;
    const changed = template.text.length > 0;
    return {
      s,
      from: source,
      d: template.dictForm ?? (changed ? s : source.d),
      n: template.normalizedForm ?? (changed ? s : source.n),
      cls: template.pos ?? source.cls,
      r: template.reading ?? (changed ? '' : source.r),
      sec: template.posSection ? [SECTION_LABELS[template.posSection], source.sec[1], source.sec[2]] : source.sec,
      flags: {
        ...source.flags,
        // A class the rule settles on (ならば → Conjunction) is no longer a merged inflection.
        inflected: template.pos && !INFLECTING.has(template.pos) ? undefined : source.flags.inflected,
        pin: template.pin,
        hardPin: template.pin !== undefined && template.hardPin ? true : undefined,
      },
    };
  });
  return recut(groups, i, len, pieces).map((group, k) => {
    const template = rule.replace[k] as TokenTemplate;
    let out = group;
    if (template.reading === undefined) {
      const reading = pinnedReading(ctx, group, template);
      if (reading) out = { ...out, r: reading };
    }
    if (template.recoverConjugations && template.pin !== undefined)
      out = { ...out, deconjugation: pinnedDeconjugation(ctx, out.s, out.d) };
    return out;
  });
}

/** `RunRewriteRules`: left to right, the first firing rule (exact bucket, then residual, in table order)
 * rewrites its span and the scan continues after it. Returns the input when nothing fires. */
export function runRewriteRules(groups: Group[], index: RewriteIndex, ctx: CombineContext): Group[] {
  let result: Group[] | undefined;
  let i = 0;
  while (i < groups.length) {
    const rule = findFiringRule(groups, i, index, ctx);
    if (rule) {
      result ??= groups.slice(0, i);
      result.push(...buildOutputs(rule, groups, i, ctx));
      i += rule.match.length;
    } else {
      result?.push(groups[i] as Group);
      i++;
    }
  }
  return result ?? groups;
}

const INDEX: Record<RewritePhase, RewriteIndex> = {
  Early: buildRewriteIndex(REWRITE_RULES, 'Early'),
  Late: buildRewriteIndex(REWRITE_RULES, 'Late'),
  Cleanup: buildRewriteIndex(REWRITE_RULES, 'Cleanup'),
  Reading: buildRewriteIndex(REWRITE_RULES, 'Reading'),
};

/** `ApplyTokenRewriteRulesEarly`. */
export const applyTokenRewriteRulesEarly = (groups: Group[], ctx: CombineContext) =>
  runRewriteRules(groups, INDEX.Early, ctx);
/** `ApplyTokenRewriteRulesLate`. */
export const applyTokenRewriteRulesLate = (groups: Group[], ctx: CombineContext) =>
  runRewriteRules(groups, INDEX.Late, ctx);
/** `ApplyTokenRewriteRulesCleanup`. */
export const applyTokenRewriteRulesCleanup = (groups: Group[], ctx: CombineContext) =>
  runRewriteRules(groups, INDEX.Cleanup, ctx);
/** `ApplyTokenRewriteRulesReading`. */
export const applyTokenRewriteRulesReading = (groups: Group[], ctx: CombineContext) =>
  runRewriteRules(groups, INDEX.Reading, ctx);
