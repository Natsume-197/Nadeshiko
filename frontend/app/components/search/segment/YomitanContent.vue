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

function renderNodes(content: YomitanNode | YomitanNode[]): VNodeChild[] {
  const nodes = Array.isArray(content) ? content : [content];
  return nodes.map((node): VNodeChild => {
    if (typeof node === 'string') return node;
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

    return h(tag, attrs, node.content !== undefined ? renderNodes(node.content) : undefined);
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
    return () => h('span', { class: 'yomitan-content' }, renderNodes(props.content));
  },
});
</script>

<style scoped>
.yomitan-content {
  white-space: pre-line;
  word-break: break-word;
  line-height: 1.5;
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
