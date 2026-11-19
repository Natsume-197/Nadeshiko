/**
 * Safe sanitization and plain-text extraction for Yomitan v3 glossary items and `structured-content` trees.
 *
 * Sanitization runs at import time (so stored SQLite entries are already clean) AND the frontend renders the AST via a
 * recursive Vue component without `v-html`.
 */

export type YomitanStyle = Partial<{
  fontStyle: string;
  fontWeight: string;
  fontSize: string;
  textDecorationLine: string;
  verticalAlign: string;
  textAlign: string;
  margin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  padding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  listStyleType: string;
  whiteSpace: string;
}>;

export interface YomitanElementNode {
  tag:
    | 'span'
    | 'div'
    | 'ol'
    | 'ul'
    | 'li'
    | 'table'
    | 'thead'
    | 'tbody'
    | 'tfoot'
    | 'tr'
    | 'td'
    | 'th'
    | 'ruby'
    | 'rt'
    | 'rp'
    | 'br'
    | 'a'
    | 'details'
    | 'summary'
    | 'p';
  content?: YomitanNode | YomitanNode[];
  style?: YomitanStyle;
  lang?: string;
  title?: string;
  href?: string;
  colSpan?: number;
  rowSpan?: number;
  open?: boolean;
  data?: Record<string, string>;
}

export type YomitanNode = string | YomitanElementNode;

export interface NormalizedGlossaryItem {
  /** Plain-text fallback used for Anki export, candidate summaries, and older renderers. */
  text: string;
  /** Present when the glossary entry carries Yomitan `structured-content`. */
  structuredContent?: YomitanNode | YomitanNode[];
}

const ALLOWED_TAGS = new Set<YomitanElementNode['tag']>([
  'span',
  'div',
  'ol',
  'ul',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'ruby',
  'rt',
  'rp',
  'br',
  'a',
  'details',
  'summary',
  'p',
]);

/** Skip embedded images (Phase 1 excludes bundled binary assets) and unknown tags safely. */
const SKIPPED_TAGS = new Set(['img', 'script', 'style', 'iframe', 'object', 'embed', 'svg', 'audio', 'video']);

const ALLOWED_STYLE_KEYS: ReadonlyArray<keyof YomitanStyle> = [
  'fontStyle',
  'fontWeight',
  'fontSize',
  'textDecorationLine',
  'verticalAlign',
  'textAlign',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'listStyleType',
  'whiteSpace',
];

const SAFE_CSS_VALUE = /^[a-zA-Z0-9.%+\-\s"']+$/;
const FORBIDDEN_CSS_TOKEN = /(?:url|expression|javascript|import|var)\s*\(/i;

const MAX_DEPTH = 24;
const MAX_NODES = 2_000;
const MAX_TEXT_LENGTH = 20_000;

function sanitizeStyle(raw: unknown): YomitanStyle | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: YomitanStyle = {};
  let count = 0;

  for (const key of ALLOWED_STYLE_KEYS) {
    const val = src[key];
    if (val === undefined || val === null) continue;
    let str = '';
    if (typeof val === 'string') {
      str = val.trim();
    } else if (typeof val === 'number' && Number.isFinite(val)) {
      str = String(val);
    } else if (key === 'textDecorationLine' && Array.isArray(val)) {
      str = val
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .trim();
    } else {
      continue;
    }
    if (!str || str.length > 64) continue;
    if (!SAFE_CSS_VALUE.test(str) || FORBIDDEN_CSS_TOKEN.test(str)) continue;
    out[key] = str;
    count += 1;
  }

  return count > 0 ? out : undefined;
}

function sanitizeHref(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return undefined;
  if (trimmed.startsWith('?query=')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitizeData(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= 8) break;
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(k)) continue;
    if (typeof v !== 'string' || v.length > 120) continue;
    out[k] = v;
    count += 1;
  }
  return count > 0 ? out : undefined;
}

interface Budget {
  remaining: number;
}

function sanitizeNode(raw: unknown, depth: number, budget: Budget): YomitanNode | YomitanNode[] | null {
  if (raw === null || raw === undefined || depth > MAX_DEPTH || budget.remaining <= 0) return null;

  if (typeof raw === 'string') {
    budget.remaining -= 1;
    return raw.length > MAX_TEXT_LENGTH ? raw.slice(0, MAX_TEXT_LENGTH) : raw;
  }

  if (typeof raw === 'number' || typeof raw === 'boolean') {
    budget.remaining -= 1;
    return String(raw);
  }

  if (Array.isArray(raw)) {
    const items: YomitanNode[] = [];
    for (const child of raw) {
      if (budget.remaining <= 0) break;
      const clean = sanitizeNode(child, depth + 1, budget);
      if (clean === null) continue;
      if (Array.isArray(clean)) items.push(...clean);
      else items.push(clean);
    }
    if (items.length === 0) return null;
    const [only] = items;
    return items.length === 1 && only !== undefined ? only : items;
  }

  if (typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const rawTag = typeof obj.tag === 'string' ? obj.tag.toLowerCase() : '';

  if (rawTag === 'img') {
    // Phase 1 skips bundled image binaries; preserve short textual titles (e.g. "文語形" icons in Meikyo) when present.
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    if (title && title.length <= 24) {
      budget.remaining -= 1;
      return { tag: 'span', data: { content: 'img-title' }, content: title };
    }
    return null;
  }

  if (SKIPPED_TAGS.has(rawTag)) return null;

  if (!ALLOWED_TAGS.has(rawTag as YomitanElementNode['tag'])) {
    // Unknown container tag: unwrap its content if any, rather than dropping text silently.
    if (obj.content !== undefined) {
      return sanitizeNode(obj.content, depth + 1, budget);
    }
    return null;
  }

  const tag = rawTag as YomitanElementNode['tag'];
  budget.remaining -= 1;

  const node: YomitanElementNode = { tag };

  if (tag !== 'br' && obj.content !== undefined) {
    const content = sanitizeNode(obj.content, depth + 1, budget);
    if (content !== null) {
      node.content = content;
    } else if (tag === 'span' || tag === 'div' || tag === 'p') {
      // Drop empty wrappers left behind when an embedded image was stripped.
      return null;
    }
  }

  const style = sanitizeStyle(obj.style);
  if (style) node.style = style;

  if (typeof obj.lang === 'string' && /^[a-zA-Z0-9-]{1,16}$/.test(obj.lang)) {
    node.lang = obj.lang;
  }
  if (typeof obj.title === 'string' && obj.title.trim()) {
    node.title = obj.title.trim().slice(0, 300);
  }
  if (tag === 'a') {
    const href = sanitizeHref(obj.href);
    if (href) node.href = href;
  }
  if (
    (tag === 'td' || tag === 'th') &&
    typeof obj.colSpan === 'number' &&
    Number.isInteger(obj.colSpan) &&
    obj.colSpan > 1 &&
    obj.colSpan <= 20
  ) {
    node.colSpan = obj.colSpan;
  }
  if (
    (tag === 'td' || tag === 'th') &&
    typeof obj.rowSpan === 'number' &&
    Number.isInteger(obj.rowSpan) &&
    obj.rowSpan > 1 &&
    obj.rowSpan <= 50
  ) {
    node.rowSpan = obj.rowSpan;
  }
  if (tag === 'details' && typeof obj.open === 'boolean') {
    node.open = obj.open;
  }
  const data = sanitizeData(obj.data);
  if (data) node.data = data;

  return node;
}

export function sanitizeStructuredContent(raw: unknown): YomitanNode | YomitanNode[] | null {
  return sanitizeNode(raw, 0, { remaining: MAX_NODES });
}

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'tr', 'br', 'details', 'summary']);

/**
 * Flattens a sanitized `YomitanNode` tree into readable plain text (skipping `<rt>` / `<rp>` furigana so kanji text
 * reads naturally without interleaved kana noise).
 */
export function structuredContentToText(node: YomitanNode | YomitanNode[] | null | undefined): string {
  if (node === null || node === undefined) return '';
  const parts: string[] = [];

  const walk = (current: YomitanNode | YomitanNode[]) => {
    if (typeof current === 'string') {
      parts.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }
    if (current.tag === 'rt' || current.tag === 'rp') return;
    if (current.tag === 'br') {
      parts.push('\n');
      return;
    }
    const isBlock = BLOCK_TAGS.has(current.tag);
    if (isBlock && parts.length > 0 && !parts[parts.length - 1]?.endsWith('\n')) {
      parts.push('\n');
    }
    if (current.content !== undefined) walk(current.content);
    if (isBlock && parts.length > 0 && !parts[parts.length - 1]?.endsWith('\n')) {
      parts.push('\n');
    }
  };

  walk(node);

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Normalizes a raw Yomitan v3 `glossary` array into renderable items (plain text + optional sanitized AST).
 */
export function normalizeGlossary(rawGlossary: unknown): NormalizedGlossaryItem[] {
  if (!Array.isArray(rawGlossary)) return [];
  const items: NormalizedGlossaryItem[] = [];

  for (const entry of rawGlossary) {
    if (typeof entry === 'string') {
      const text = entry.trim();
      if (text) items.push({ text });
      continue;
    }

    if (!entry || typeof entry !== 'object') continue;

    // Deinflection / form-of tuple `[uninflectedTerm, [rules...]]` used by some legacy dictionaries.
    if (Array.isArray(entry)) {
      const target = typeof entry[0] === 'string' ? entry[0].trim() : '';
      const rules = Array.isArray(entry[1])
        ? entry[1].filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        : [];
      if (target) {
        const text = rules.length > 0 ? `${target} (${rules.join(', ')})` : target;
        items.push({ text });
      }
      continue;
    }

    const obj = entry as Record<string, unknown>;
    if (obj.type === 'text' && typeof obj.text === 'string') {
      const text = obj.text.trim();
      if (text) items.push({ text });
      continue;
    }

    if (obj.type === 'structured-content') {
      const clean = sanitizeStructuredContent(obj.content);
      if (!clean) continue;
      const text = structuredContentToText(clean);
      if (!text) continue;
      items.push({ text, structuredContent: clean });
    }
    // `type === 'image'` is intentionally skipped in Phase 1.
  }

  return items;
}

/** Heuristic language detection for a custom dictionary definition: Japanese if it contains kana or kanji, else English. */
export function detectDefinitionLang(text: string): 'ja' | 'en' {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text) ? 'ja' : 'en';
}
