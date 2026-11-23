// Helpers shared by the composed block renderer and by blocks ejected to TSX (`composedHelpers`): value readers,
// reserved props, the missing-field warning and the single/collection wrappers. Ejected blocks import them from
// `@opencloudcms/core/blocks` so they render exactly like the composed block they came from.
// Isomorphic: no hooks, no browser or Node globals.
import { Fragment, type ReactNode } from 'react';
import { localizedText, type Locale, type LocalizedText } from '@opencloudcms/schema';
import { Grid, Stack } from '../ui/layout';
import { Text } from '../ui/content';
import { entryUrl, isPresent, readDate, readEntryImage, readEntryMoney, readHref, readText } from './values';

type Entry = Record<string, unknown>;
type Block = { name: string; label: LocalizedText };

const DEFAULT_LOCALE = 'en-US';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const SELECT_ENTRY: Record<string, string> = {
  'en-US': 'Select an entry',
  'vi-VN': 'Chọn một mục nội dung',
  'fr-FR': 'Sélectionnez une entrée',
  'id-ID': 'Pilih satu entri',
};
const NO_ENTRIES: Record<string, string> = {
  'en-US': 'No entries match',
  'vi-VN': 'Không có mục nội dung phù hợp',
  'fr-FR': 'Aucune entrée ne correspond',
  'id-ID': 'Tidak ada entri yang cocok',
};

/** Reserved `_locale` prop (stamped by `resolvePage`/the editor for `usesLocale` blocks), default `en-US`. */
function locale(props: object): string {
  const l = (props as { _locale?: unknown })._locale;
  return typeof l === 'string' && l ? l : DEFAULT_LOCALE;
}

/** Reserved `_editor` prop: true on the editor canvas. */
function editor(props: object): boolean {
  return (props as { _editor?: unknown })._editor === true;
}

/**
 * `get(entry, path)` for one block: the entry field, or `undefined` (with one console warning per path) when the
 * entry has no such field (removed from the content type).
 */
function entryReader(blockName: string): (entry: object | null | undefined, path: string) => unknown {
  const warned = new Set<string>();
  return (entry, path) => {
    if (!entry) return undefined;
    if (!has(entry, path)) {
      if (!warned.has(path)) {
        warned.add(path);
        console.warn(`[opencloudcms] Block "${blockName}": entry field "${path}" does not exist (removed from the content type?); rendering it empty.`);
      }
      return undefined;
    }
    return (entry as Entry)[path];
  };
}

/**
 * Image `{ src, alt }` from an entry/field value (URL, resolved asset or image), or null. `alt` (an explicit alt:
 * text, or an object with `alt`) wins when non-empty, else the image's own alt.
 */
function image(src: unknown, alt?: unknown): { src: string; alt: string } | null {
  const img = readEntryImage(src);
  if (!img) return null;
  return { src: img.src, alt: readText(isObj(alt) ? alt.alt : alt) || img.alt };
}

/** `fn(v)` when `v` is not null/undefined, else null. */
function when<T>(v: T | null | undefined, fn: (v: T) => ReactNode): ReactNode {
  return v === null || v === undefined ? null : fn(v);
}

function Placeholder({ text }: { text: string }) {
  return (
    <div data-composed-placeholder="" className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

const blockLabel = (block: Block, loc: string) => localizedText(block.label, loc as Locale, block.name);

/** Single-entry block: `fn(entry)`, or (no entry) an editor placeholder / nothing. */
function single(props: object, block: Block, fn: (entry: Entry) => ReactNode): ReactNode {
  const e = (props as { entry?: unknown }).entry;
  if (isObj(e)) return fn(e);
  if (!editor(props)) return null;
  const loc = locale(props);
  return <Placeholder text={`${blockLabel(block, loc)} · ${SELECT_ENTRY[loc] ?? SELECT_ENTRY[DEFAULT_LOCALE]}`} />;
}

type Layout = { kind: 'grid'; columns: 2 | 3 | 4 | 5 | 6 } | { kind: 'list' };

function parseLayout(v: unknown): Layout | null {
  if (v === 'list') return { kind: 'list' };
  const m = typeof v === 'string' ? /^grid-([2-6])$/.exec(v) : null;
  return m ? { kind: 'grid', columns: Number(m[1]) as 2 } : null;
}

/**
 * Collection block: `fn(entry)` per entry in a grid or list. `layout` is `'list'` or `'grid-<2..6>'`; with
 * `editorLayout` the page builder's `layout` prop wins. No entries → `emptyText` (in `_locale`), else an editor
 * placeholder / nothing.
 */
function collection(
  props: object,
  block: Block & { layout: string; editorLayout?: boolean; emptyText?: LocalizedText },
  fn: (entry: Entry) => ReactNode,
): ReactNode {
  const raw = (props as { entries?: unknown }).entries;
  const entries = Array.isArray(raw) ? raw.filter(isObj) : [];
  const loc = locale(props);
  if (!entries.length) {
    const empty = block.emptyText ? localizedText(block.emptyText, loc as Locale) : '';
    if (empty) return <Text text={empty} size="sm" color="muted" />;
    return editor(props) ? <Placeholder text={`${blockLabel(block, loc)} · ${NO_ENTRIES[loc] ?? NO_ENTRIES[DEFAULT_LOCALE]}`} /> : null;
  }
  const layout =
    (block.editorLayout ? parseLayout((props as { layout?: unknown }).layout) : null) ?? parseLayout(block.layout) ?? { kind: 'grid', columns: 3 };
  const items = entries.map((e, i) => <Fragment key={typeof e.documentId === 'string' ? e.documentId : i}>{fn(e)}</Fragment>);
  return layout.kind === 'list' ? (
    <Stack direction="vertical" gap="6">{items}</Stack>
  ) : (
    <Grid columns={layout.columns} gap="6">{items}</Grid>
  );
}

/** Building blocks of composed block rendering, public for blocks ejected to TSX. */
export const composedHelpers = {
  locale,
  editor,
  entryReader,
  text: readText,
  href: readHref,
  money: readEntryMoney,
  date: readDate,
  present: isPresent,
  image,
  /** `urlPattern` with `{field}` placeholders filled from the entry (URL-encoded); null if any is missing. */
  entryUrl: (pattern: string, entry: object | null | undefined, get: (entry: object | null | undefined, path: string) => unknown): string | null =>
    entry ? entryUrl(pattern, (p) => get(entry, p)) : null,
  when,
  single,
  collection,
};
