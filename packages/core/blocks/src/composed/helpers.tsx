// Helpers shared by the composed block renderer and by blocks ejected to TSX (`composedHelpers`): value readers,
// reserved props, the missing-field warning, detail links and the single/collection/list wrappers. Ejected blocks import them from
// `@opencloudcms/core/blocks` so they render exactly like the composed block they came from.
// Isomorphic: no hooks, no browser or Node globals.
import { Fragment, type ReactNode } from 'react';
import { localizedText, OVERLAY_NAME_RE, parseDetailPath, SLUG_RE, type Locale, type LocalizedText, type NodeStyle } from '@opencloudcms/schema';
import { Grid, Stack } from '../ui/layout';
import { Text } from '../ui/content';
import { Carousel } from '../client/Carousel';
import { safeHref } from '../ui/href';
import type { DetailPaths } from '../types';
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

/** Block label in the locale, falling back to the block name (accessible name of carousels and clickable images). */
const labelOf = (label: LocalizedText, name: string, loc: string): string => localizedText(label, loc as Locale, name) || name;

/** Static select/radio/combobox options of a spec (`{ value, label }[]`) with the label in the locale. */
function options(v: unknown, loc: string): { value: string; label: string }[] {
  return Array.isArray(v) ? (v as { value: string; label: string | LocalizedText }[]).map((o) => ({ value: o.value, label: localizedText(o.label, loc as Locale) })) : [];
}

/** Single-entry block: `fn(entry)`, or (no entry) an editor placeholder / nothing. */
function single(props: object, block: Block, fn: (entry: Entry) => ReactNode): ReactNode {
  const e = (props as { entry?: unknown }).entry;
  if (isObj(e)) return fn(e);
  if (!editor(props)) return null;
  const loc = locale(props);
  return <Placeholder text={`${blockLabel(block, loc)} · ${SELECT_ENTRY[loc] ?? SELECT_ENTRY[DEFAULT_LOCALE]}`} />;
}

type Layout = { kind: 'grid'; columns: 2 | 3 | 4 | 5 | 6 } | { kind: 'list' } | { kind: 'carousel'; columns: number };

function parseLayout(v: unknown): Layout | null {
  if (v === 'list') return { kind: 'list' };
  const m = typeof v === 'string' ? /^(grid-([2-6])|carousel-([1-6]))$/.exec(v) : null;
  if (!m) return null;
  return m[2] ? { kind: 'grid', columns: Number(m[2]) as 2 } : { kind: 'carousel', columns: Number(m[3]) };
}

/**
 * Slides in view of a collection carousel: `columns` on desktop, like the grid on tablet (2, or 3 from 5 columns),
 * 1.25 on mobile (a peek of the next card); never more than `columns`.
 */
export function collectionPerView(columns: number): { base: number; md: number; lg: number } {
  return { base: Math.min(1.25, columns), md: Math.min(columns, columns >= 5 ? 3 : 2), lg: columns };
}

type EntriesBlock = Block & { layout: string; emptyText?: LocalizedText };

/**
 * `fn(entry)` per entry in a grid, list or carousel (`layout` already chosen); no entries → `emptyText` (in the
 * locale), else an editor placeholder / nothing. `id`/`style` go on the container (CollectionList elements).
 */
function entriesIn(
  props: object,
  raw: unknown,
  block: EntriesBlock,
  layout: Layout,
  fn: (entry: Entry) => ReactNode,
  el: { id?: string; style?: NodeStyle } = {},
): ReactNode {
  const entries = Array.isArray(raw) ? raw.filter(isObj) : [];
  const loc = locale(props);
  if (!entries.length) {
    const empty = block.emptyText ? localizedText(block.emptyText, loc as Locale) : '';
    if (empty) return <Text id={el.id} text={empty} size="sm" color="muted" style={el.style} />;
    return editor(props) ? <Placeholder text={`${blockLabel(block, loc)} · ${NO_ENTRIES[loc] ?? NO_ENTRIES[DEFAULT_LOCALE]}`} /> : null;
  }
  const items = entries.map((e, i) => <Fragment key={typeof e.documentId === 'string' ? e.documentId : i}>{fn(e)}</Fragment>);
  if (layout.kind === 'carousel') {
    return (
      <Carousel id={el.id} perView={collectionPerView(layout.columns)} gap="6" dots={false} label={blockLabel(block, loc)} locale={loc} style={el.style}>
        {items}
      </Carousel>
    );
  }
  return layout.kind === 'list' ? (
    <Stack id={el.id} direction="vertical" gap="6" style={el.style}>{items}</Stack>
  ) : (
    <Grid id={el.id} columns={layout.columns} gap="6" style={el.style}>{items}</Grid>
  );
}

/**
 * Collection block: `fn(entry)` per entry in a grid, list or carousel. `layout` is `'list'`, `'grid-<2..6>'` or
 * `'carousel-<1..6>'`; with
 * `editorLayout` the page builder's `layout` prop wins. No entries → `emptyText` (in `_locale`), else an editor
 * placeholder / nothing.
 */
function collection(
  props: object,
  block: Block & { layout: string; editorLayout?: boolean; emptyText?: LocalizedText },
  fn: (entry: Entry) => ReactNode,
): ReactNode {
  const layout =
    (block.editorLayout ? parseLayout((props as { layout?: unknown }).layout) : null) ?? parseLayout(block.layout) ?? { kind: 'grid', columns: 3 };
  return entriesIn(props, (props as { entries?: unknown }).entries, block, layout, fn);
}

/**
 * A `CollectionList` element: `fn(entry)` per entry of the block field `key`, laid out like a collection block
 * (`layout`: `'list'`, `'grid-<2..6>'` or `'carousel-<1..6>'`; with `editorLayout` the page builder's `<key>__layout`
 * prop wins). `id`/`style` go on the list's container (or its empty text).
 */
function list(
  props: object,
  block: EntriesBlock & { key: string; editorLayout?: boolean; id?: string; style?: NodeStyle },
  fn: (entry: Entry) => ReactNode,
): ReactNode {
  const p = props as Record<string, unknown>;
  const layout =
    (block.editorLayout ? parseLayout(p[`${block.key}__layout`]) : null) ?? parseLayout(block.layout) ?? { kind: 'grid', columns: 3 };
  return entriesIn(props, p[block.key], block, layout, fn, { id: block.id, style: block.style });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reserved `_detailPaths` prop (stamped by `resolvePage`): the usable detail pages by apiId, or none. */
function detailPaths(props: object): DetailPaths | undefined {
  const d = (props as { _detailPaths?: unknown })._detailPaths;
  return isObj(d) ? (d as DetailPaths) : undefined;
}

/**
 * URL of `entry`'s detail page (spec §4 step 2): the `apiId` detail path of `_detailPaths` with `{slug}` filled from its
 * slug field or `{id}` from `documentId`. Null when the type has no detail page, the entry is missing, or the value is
 * not one detail routing matches (a slug outside `^[a-z0-9]+(-[a-z0-9]+)*$`, a non-uuid id): no dead links.
 */
function detailUrl(props: object, apiId: string, entry: object | null | undefined): string | null {
  const d = entry ? detailPaths(props)?.[apiId] : undefined;
  if (!d || typeof d.path !== 'string') return null;
  const parsed = parseDetailPath(d.path);
  if (!parsed) return null;
  const e = entry as Entry;
  const value = parsed.param === 'id' ? e.documentId : typeof d.slugField === 'string' ? e[d.slugField] : undefined;
  if (typeof value !== 'string' || !(parsed.param === 'id' ? UUID_RE.test(value) : SLUG_RE.test(value))) return null;
  return safeHref(`${parsed.prefix}/${value}`);
}

/** Overlay block `name` prop when it is a valid overlay name, else `fallback` (the block's default name). */
function overlayName(v: unknown, fallback: string): string {
  return typeof v === 'string' && OVERLAY_NAME_RE.test(v) ? v : fallback;
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
  /** The entry's detail page URL from the reserved `_detailPaths` prop (no `urlPattern`); null if it has none. */
  detailUrl,
  when,
  blockLabel: labelOf,
  options,
  single,
  collection,
  list,
  overlayName,
};
