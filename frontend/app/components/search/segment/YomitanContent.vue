<script lang="ts">
import { defineComponent, h, type PropType, type VNodeChild } from 'vue';
import type { YomitanElementNode, YomitanNode } from '~/utils/wordCard';

/**
 * Renders a custom dictionary's Yomitan `structured-content` (task 48) as real elements, never `v-html`. The backend
 * sanitized the tree when it indexed the dictionary (tags, styles, attributes); this whitelists the tags again so a
 * bad node renders as a `span` rather than anything else.
 */

const ALLOWED_TAGS = new Set([
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

function isElement(node: YomitanNode): node is YomitanElementNode {
  return typeof node === 'object' && node !== null && typeof node.tag === 'string';
}

function safeTag(node: YomitanElementNode): string {
  const lower = node.tag.toLowerCase();
  return ALLOWED_TAGS.has(lower) ? lower : 'span';
}

/**
 * A web link opens in a new tab. Yomitan's own `?query=<word>` links, where one entry points at another (「→見る」),
 * search Nadeshiko for that word instead. Anything else gets no `href`.
 */
function linkAttrs(href: string | undefined): Record<string, string> {
  if (!href) return {};
  if (href.startsWith('?query=')) {
    const term = new URLSearchParams(href.slice(1)).get('query')?.trim();
    return term ? { href: `/search/${encodeURIComponent(term)}` } : {};
  }
  if (href.startsWith('https://') || href.startsWith('http://')) {
    return { href, target: '_blank', rel: 'noopener noreferrer' };
  }
  return {};
}

/**
 * Japanese monolingual dictionaries (明鏡, 大辞泉…) keep most of their structure in the text rather than in tags:
 * one line per part, ❶❷ for senses, 「…」 for examples, 〘名〙〔俗〕〚…〛 for labels, ⇔ ◆ for cross-references. Read
 * that, so a definition reads as one instead of as a single block of text.
 */
const BLOCK_TAGS = new Set(['div', 'p', 'ol', 'ul', 'li', 'table', 'tr', 'details']);
const SENSE_MARKER = /^[①-⑳⑴-⒇❶-❿➊-➓]/u;
const LABEL_SPLIT = /(〘[^〙]{1,24}〙|〔[^〕]{1,24}〕|〚[^〛]{1,24}〛)/u;
const LABEL_ONLY = /^(〘[^〙]{1,24}〙|〔[^〕]{1,24}〕|〚[^〛]{1,24}〛)$/u;

type LineKind = '' | 'is-headline' | 'is-sense' | 'is-example' | 'is-ref';

/** Splits a flat run of text and inline elements at its line breaks; null when the content is already in blocks. */
export function splitLines(nodes: YomitanNode[]): YomitanNode[][] | null {
  if (nodes.some((node) => isElement(node) && BLOCK_TAGS.has(safeTag(node)))) return null;
  if (!nodes.some((node) => typeof node === 'string' && node.includes('\n'))) return null;
  const lines: YomitanNode[][] = [[]];
  for (const node of nodes) {
    if (typeof node === 'string') {
      node.split('\n').forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part) lines[lines.length - 1]?.push(part);
      });
    } else if (isElement(node) && safeTag(node) === 'br') {
      lines.push([]);
    } else {
      lines[lines.length - 1]?.push(node);
    }
  }
  return lines.filter((line) => line.some((node) => typeof node !== 'string' || node.trim()));
}

export function lineKind(line: YomitanNode[], index: number): LineKind {
  const [first] = line;
  const text = typeof first === 'string' ? first.trimStart() : '';
  // The dictionary's own headline (か‐の‐じょ【彼女】) repeats the word the card is already about.
  if (index === 0 && line.some((node) => typeof node === 'string' && node.includes('【'))) return 'is-headline';
  if (SENSE_MARKER.test(text)) return 'is-sense';
  if (/^[「『]/u.test(text)) return 'is-example';
  if (/^[⇔◆→⇒▷☞]/u.test(text)) return 'is-ref';
  return '';
}

/** Text with its 〘labels〙 set apart, and a line's leading sense marker (❶) drawn as one. */
function renderText(text: string, senseMarker: boolean): VNodeChild[] {
  let rest = text;
  const out: VNodeChild[] = [];
  if (senseMarker) {
    const trimmed = rest.trimStart();
    const marker = [...trimmed][0] ?? '';
    out.push(h('span', { class: 'yc-marker' }, marker));
    rest = trimmed.slice(marker.length);
  }
  for (const part of rest.split(LABEL_SPLIT)) {
    if (!part) continue;
    out.push(LABEL_ONLY.test(part) ? h('span', { class: 'yc-label' }, part) : part);
  }
  return out;
}

function renderLines(lines: YomitanNode[][]): VNodeChild[] {
  return lines.map((line, index) => {
    const kind = lineKind(line, index);
    const children = line.flatMap((node, position): VNodeChild[] =>
      typeof node === 'string' ? renderText(node, kind === 'is-sense' && position === 0) : renderNodes(node),
    );
    return h('span', { class: ['yc-line', kind] }, children);
  });
}

function renderContent(content: YomitanNode | YomitanNode[]): VNodeChild[] {
  const nodes = Array.isArray(content) ? content : [content];
  const lines = splitLines(nodes);
  return lines ? renderLines(lines) : renderNodes(content);
}

function renderNodes(content: YomitanNode | YomitanNode[]): VNodeChild[] {
  const nodes = Array.isArray(content) ? content : [content];
  return nodes.map((node): VNodeChild => {
    if (typeof node === 'string') return renderText(node, false);
    if (!isElement(node)) return null;
    const tag = safeTag(node);
    if (tag === 'br') return h('br');

    const attrs: Record<string, unknown> = {
      style: node.style,
      lang: node.lang,
      title: node.title,
      colspan: node.colSpan,
      rowspan: node.rowSpan,
      ...(tag === 'a' ? linkAttrs(node.href) : {}),
      ...(tag === 'details' && node.open ? { open: true } : {}),
    };
    for (const [key, value] of Object.entries(node.data ?? {})) attrs[`data-${key}`] = value;

    return h(tag, attrs, node.content !== undefined ? renderContent(node.content) : undefined);
  });
}

export default defineComponent({
  name: 'YomitanContent',
  props: {
    content: {
      type: [String, Object, Array] as PropType<YomitanNode | YomitanNode[]>,
      required: true,
    },
  },
  setup(props) {
    return () => h('span', { class: 'yomitan-content' }, renderContent(props.content));
  },
});
</script>

<style scoped>
.yomitan-content {
  white-space: pre-line;
  word-break: break-word;
  line-height: 1.5;
}

/* Lines of a monolingual entry (see `splitLines`): each part of the definition styled by what it is. */
.yomitan-content :deep(.yc-line) {
  display: block;
}

.yomitan-content :deep(.yc-line.is-headline) {
  font-size: 0.85em;
  color: rgb(var(--c-white) / 0.5);
}

.yomitan-content :deep(.yc-line.is-sense) {
  margin-top: 0.45em;
}

.yomitan-content :deep(.yc-marker) {
  margin-right: 0.35em;
  font-weight: 700;
  color: rgb(var(--c-brand));
}

.yomitan-content :deep(.yc-line.is-example) {
  margin: 0.15em 0 0.15em 0.2em;
  padding-left: 0.6em;
  border-left: 2px solid rgb(var(--c-white) / 0.14);
  font-size: 0.92em;
  color: rgb(var(--c-white) / 0.68);
}

.yomitan-content :deep(.yc-line.is-ref) {
  font-size: 0.9em;
  color: rgb(var(--c-white) / 0.55);
}

.yomitan-content :deep(.yc-label) {
  margin: 0 0.15em;
  font-size: 0.82em;
  color: rgb(var(--c-white) / 0.5);
}

.yomitan-content :deep(ol),
.yomitan-content :deep(ul) {
  margin: 0.2rem 0;
  padding-left: 1.15rem;
}

.yomitan-content :deep(li) {
  margin: 0.12rem 0;
}

.yomitan-content :deep(table) {
  border-collapse: collapse;
  margin: 0.3rem 0;
  font-size: 0.92em;
  width: 100%;
}

.yomitan-content :deep(th),
.yomitan-content :deep(td) {
  border: 1px solid rgb(var(--c-white) / 0.16);
  padding: 0.18rem 0.4rem;
  text-align: left;
  vertical-align: top;
}

.yomitan-content :deep(th) {
  font-weight: 600;
  background: rgb(var(--c-white) / 0.06);
}

.yomitan-content :deep(ruby rt) {
  font-size: 0.65em;
  opacity: 0.85;
}

.yomitan-content :deep(details) {
  margin: 0.2rem 0;
}

.yomitan-content :deep(summary) {
  cursor: pointer;
  opacity: 0.85;
}

.yomitan-content :deep(a[href]) {
  color: rgb(var(--c-brand));
  text-decoration: underline;
}

.yomitan-content :deep([data-content='img-title']) {
  display: inline-block;
  margin-right: 0.25rem;
  padding: 0 0.3rem;
  border-radius: 0.25rem;
  border: 1px solid rgb(var(--c-white) / 0.2);
  font-size: 0.78em;
  font-weight: 600;
  line-height: 1.35;
  vertical-align: baseline;
}
</style>
