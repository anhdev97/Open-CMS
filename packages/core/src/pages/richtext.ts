// Server copy of blocks/src/richtext.ts (`src` cannot import the blocks sources): normalizes `b.richText` HTML of
// pages on save. `#tiptap-html` resolves to `@tiptap/html/server` (happy-dom) under CommonJS. Keep EXTENSIONS in sync
// (test/unit/richtext-server.test.ts compares both).
import { generateHTML, generateJSON } from '#tiptap-html';
import type { Extensions, JSONContent } from '@tiptap/core';
import type { BlockManifest } from '@opencloudcms/schema';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { Code } from '@tiptap/extension-code';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Strike } from '@tiptap/extension-strike';
import { Text } from '@tiptap/extension-text';
import { TextAlign } from '@tiptap/extension-text-align';
import { Underline } from '@tiptap/extension-underline';

/** The schema of Puck 0.24's default `richtext` field (`PuckRichText` with no options). */
const EXTENSIONS: Extensions = [
  Bold,
  Blockquote,
  Code,
  CodeBlock,
  Document,
  HardBreak,
  Heading,
  HorizontalRule,
  Italic,
  ListItem,
  BulletList,
  OrderedList,
  Link,
  Paragraph,
  Strike,
  Text,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Underline,
];

const HTML_RE = /<\/?[a-z][\s\S]*>/i;

/**
 * Parses `value` with the rich text schema and serializes it back: unknown tags and attributes (event handlers,
 * `style` other than text-align, `<script>`, `<img>`, …) are dropped and links keep only allowed URLs (no
 * `javascript:`). A string without tags becomes one paragraph of text (as Puck shows it). Not a string → `''`.
 * Idempotent.
 */
export function normalizeRichText(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  const doc: JSONContent = HTML_RE.test(value)
    ? generateJSON(value, EXTENSIONS)
    : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] };
  return generateHTML(doc, EXTENSIONS);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isItem = (v: unknown): v is { type: string; props: Record<string, unknown> } =>
  isObj(v) && typeof v.type === 'string' && isObj(v.props);

/** Normalizes the value at `segs` (`rows[]` = each row of a list) in a copy of `obj`. */
function applyPath(obj: Record<string, unknown>, segs: string[]): Record<string, unknown> {
  const [head, ...rest] = segs;
  const list = head.endsWith('[]');
  const key = list ? head.slice(0, -2) : head;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return obj;
  const v = obj[key];
  if (!rest.length) return list ? obj : { ...obj, [key]: normalizeRichText(v) };
  if (!list || !Array.isArray(v)) return obj;
  return { ...obj, [key]: v.map((row) => (isObj(row) ? applyPath(row, rest) : row)) };
}

/**
 * Copy of a stored page `content` with the `b.richText` props of the blocks in `manifest` (by their `richText`
 * paths) normalized, in `data.content`, `data.zones` and nested slots. Anything else is returned as is.
 */
export function normalizeStoredRichText(content: unknown, manifest: BlockManifest): unknown {
  const paths = new Map(manifest.filter((m) => m.richText?.length).map((m) => [m.name, m.richText!.map((p) => p.split('.'))]));
  if (!paths.size || !isObj(content) || !isObj(content.data)) return content;
  // Arrays hold slot items or list rows (whose values may again be slots); any other value is left alone.
  const walk = (v: unknown): unknown => {
    if (!Array.isArray(v)) return v;
    return v.map((el) => {
      if (isItem(el)) {
        let props = el.props;
        for (const segs of paths.get(el.type) ?? []) props = applyPath(props, segs);
        return { ...el, props: Object.fromEntries(Object.entries(props).map(([k, x]) => [k, walk(x)])) };
      }
      return isObj(el) ? Object.fromEntries(Object.entries(el).map(([k, x]) => [k, walk(x)])) : el;
    });
  };
  const data = { ...content.data };
  if (Array.isArray(data.content)) data.content = walk(data.content);
  if (isObj(data.zones)) data.zones = Object.fromEntries(Object.entries(data.zones).map(([k, z]) => [k, walk(z)]));
  return { ...content, data };
}
