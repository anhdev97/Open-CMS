// Rich text normalizer: stored `b.richText` HTML -> HTML that only holds what Puck's rich text editor can produce.
// `#tiptap-html` (package.json "imports") is `@tiptap/html` (browser DOM, or happy-dom under the `node` condition)
// for ESM and `@tiptap/html/server` (happy-dom) for CommonJS. Keep EXTENSIONS in sync with src/pages/richtext.ts.
import { generateHTML, generateJSON } from '#tiptap-html';
import type { Extensions, JSONContent } from '@tiptap/core';
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
