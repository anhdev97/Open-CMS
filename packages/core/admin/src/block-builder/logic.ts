// Pure logic of the block builder: which sources a property may use (spec §5.4), filter/sort fields, names,
// the save flow and change summaries. Relative imports only (root vitest).
import {
  COMPOSED_GENERATED_FIELD_RE,
  composedFieldNameIssue,
  composedKind,
  regionNames,
  isBreakingChange,
  slotsChanged,
  type ComposedBinding,
  type ComposedBlockSpec,
  type ComposedNode,
  type ComposedElement,
  type ComposedField,
  type ComposedFieldKind,
  type LocalizedText,
} from '@opencloudcms/schema';
import { ApiError } from '../lib/api-error';
import type { ContentTypeDefinition, FieldDefinition, FieldKind } from '../lib/types';

const TEXT: readonly FieldKind[] = ['text', 'longText', 'slug', 'email'];

/**
 * Content field kinds each bindable element prop accepts (spec §5.4). Mirrors `ENTRY_PROP_KINDS` of the server
 * (`core/src/block-builder/blocks-checks.ts`); a test keeps them equal.
 */
export const ENTRY_PROP_KINDS: Partial<Record<ComposedElement, Record<string, readonly FieldKind[]>>> = {
  Heading: { text: TEXT },
  Text: { text: TEXT, html: ['richText'] },
  Image: { src: ['asset', 'url'], alt: [...TEXT, 'asset'] },
  Button: { label: TEXT, href: ['url'] },
  Badge: { text: TEXT },
  Price: { value: ['number', 'money'] },
  Date: { value: ['date', 'datetime'] },
};

/** Manual (block) field kinds each bindable element prop accepts. */
export const MANUAL_PROP_KINDS: Partial<Record<ComposedElement, Record<string, readonly ComposedFieldKind[]>>> = {
  Heading: { text: ['text', 'longText', 'select'] },
  Text: { text: ['text', 'longText', 'select'], html: ['richText'] },
  Image: { src: ['image'], alt: ['text', 'longText'] },
  Button: { label: ['text', 'select'], href: ['link'] },
  Badge: { text: ['text', 'select'] },
  Price: { value: ['number'] },
  Date: { value: [] },
};

/** The manual field kind a new field gets when created from a prop's source picker. */
export function manualKindFor(el: ComposedElement, prop: string): ComposedFieldKind | null {
  return MANUAL_PROP_KINDS[el]?.[prop]?.[0] ?? null;
}

/** Timestamps every entry carries (datetime; usable for Date and for sorting). */
export const META_TIMESTAMPS = ['createdAt', 'updatedAt', 'publishedAt'] as const;

/** A reference, taxonomy or `multiple` field: never offered (not populated for blocks). */
export function isListy(f: FieldDefinition): boolean {
  return !!f.options?.multiple || f.kind === 'reference' || f.kind === 'taxonomy';
}

export interface EntryFieldOption {
  name: string;
  kind: FieldKind;
  label: string;
  /** Meta timestamp, not a field of the type. */
  meta?: boolean;
}

export interface SourceOptions {
  /** Content type fields that fit the prop (empty without a binding). */
  entry: EntryFieldOption[];
  /** Manual fields of the block that fit the prop. */
  manual: string[];
  /** "Link to the entry page" (Button.href when the binding has a URL pattern). */
  entryUrl: boolean;
}

/**
 * Sources a bindable prop may use: kind-compatible content fields (no multiple/reference, except a multiple asset for
 * Image), manual fields, entry URL.
 */
export function sourceOptions(
  target: { el: ComposedElement; prop: string },
  ctx: { type: ContentTypeDefinition | null; fields: Record<string, ComposedField>; urlPattern?: string },
): SourceOptions {
  const kinds = ENTRY_PROP_KINDS[target.el]?.[target.prop] ?? [];
  const entry: EntryFieldOption[] = [];
  if (ctx.type) {
    for (const f of ctx.type.fields) {
      // Image src/alt may also read a multiple asset field (it shows the first asset).
      const firstAsset = target.el === 'Image' && f.kind === 'asset';
      if ((!isListy(f) || firstAsset) && kinds.includes(f.kind)) entry.push({ name: f.name, kind: f.kind, label: f.label || f.name });
    }
    if (kinds.includes('datetime')) for (const m of META_TIMESTAMPS) entry.push({ name: m, kind: 'datetime', label: m, meta: true });
  }
  const mk = MANUAL_PROP_KINDS[target.el]?.[target.prop] ?? [];
  const manual = Object.entries(ctx.fields)
    .filter(([, f]) => mk.includes(f.kind))
    .map(([n]) => n);
  const entryUrl = !!ctx.type && target.el === 'Button' && target.prop === 'href' && !!ctx.urlPattern;
  return { entry, manual, entryUrl };
}

/** Fields a fixed filter may use: `indexed` or `unique`, single value, not reference/taxonomy. */
export function filterableFields(ct: ContentTypeDefinition): FieldDefinition[] {
  return ct.fields.filter((f) => (f.indexed || f.unique) && !isListy(f));
}

/** Fields shown dimmed in the filter picker (not indexed yet) with the "turn on Indexed" hint. */
export function unindexedFields(ct: ContentTypeDefinition): FieldDefinition[] {
  return ct.fields.filter((f) => !(f.indexed || f.unique) && !isListy(f) && !['richText', 'json', 'asset'].includes(f.kind));
}

/** Sort fields: the filterable ones and the entry timestamps. */
export function sortableFields(ct: ContentTypeDefinition): string[] {
  return [...filterableFields(ct).map((f) => f.name), ...META_TIMESTAMPS];
}

/** Editor of a fixed filter value: switch, number input or text input (the server checks the same types). */
export function filterValueKind(f: Pick<FieldDefinition, 'kind'>): 'boolean' | 'number' | 'string' {
  if (f.kind === 'boolean') return 'boolean';
  if (f.kind === 'number' || f.kind === 'money') return 'number';
  return 'string';
}

/** Default value of a new filter row for `f`. */
export function defaultFilterValue(f: Pick<FieldDefinition, 'kind'>): unknown {
  const k = filterValueKind(f);
  return k === 'boolean' ? true : k === 'number' ? 0 : '';
}

/** `Price.showCurrency` for a bound money field: `fixed` → true, otherwise (market) → false; non-money → undefined. */
export function showCurrencyFor(f: Pick<FieldDefinition, 'kind' | 'options'>): boolean | undefined {
  if (f.kind !== 'money') return undefined;
  return f.options?.currencyMode === 'fixed';
}

const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

/** PascalCase block name from the en-US label (`Product card` → `ProductCard`); '' when the label is empty. */
export function suggestName(label: LocalizedText | Partial<LocalizedText>): string {
  const w = words(label['en-US'] ?? '');
  if (!w.length) return '';
  let name = w.map((x) => x[0]!.toUpperCase() + x.slice(1)).join('');
  if (/^[0-9]/.test(name)) name = `Block${name}`;
  return name.slice(0, 64);
}

/** Field names `defineComposedBlock` generates (manual fields must not use them). */
export const GENERATED_FIELD_NAMES = COMPOSED_GENERATED_FIELD_RE;

/** A free camelCase manual field name from a label (`Button label` → `buttonLabel`, then `buttonLabel2`, …). */
export function suggestFieldName(label: string, fields: Record<string, unknown>): string {
  const w = words(label);
  let stem = w.length ? w.map((x, i) => (i === 0 ? x[0]!.toLowerCase() + x.slice(1) : x[0]!.toUpperCase() + x.slice(1))).join('') : 'field';
  if (/^[0-9]/.test(stem)) stem = `field${stem}`;
  // `slot`, `slot2`, … stay generated whatever number follows: name it `slotField`, `slot2Field` instead.
  if (/^slot\d*$/.test(stem)) stem = `${stem}Field`;
  // Generated (`entry`, `slot2`, …), reserved (`id`, `puck`, `editMode`, …) and Object.prototype names are suffixed.
  const taken = (n: string) => Object.prototype.hasOwnProperty.call(fields, n) || composedFieldNameIssue(n) !== null;
  if (!taken(stem)) return stem;
  for (let i = 2; ; i++) if (!taken(`${stem}${i}`)) return `${stem}${i}`;
}

/** A random `blk_` id (8 base36 characters). */
export function newBlockId(): string {
  return `blk_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('')}`;
}

/** Starting spec of a new block: a card with one heading. */
export function emptySpec(id = newBlockId(), kind: 'block' | 'overlay' = 'block'): ComposedBlockSpec {
  if (kind === 'overlay') {
    return {
      id,
      name: '',
      label: { 'en-US': '' },
      category: 'basic',
      version: 1,
      fields: {},
      tree: {
        el: 'Overlay',
        props: { variant: 'modal', size: 'md', closeOnBackdrop: true, showClose: true },
        children: [
          { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'const', value: 'Heading' } } },
          { el: 'Text', bind: { text: { from: 'const', value: 'Text' } } },
        ],
      },
    };
  }
  return {
    id,
    name: '',
    label: { 'en-US': '' },
    category: 'basic',
    version: 1,
    fields: {},
    tree: { el: 'Card', children: [{ el: 'Heading', props: { level: 3 }, bind: { text: { from: 'const', value: 'Heading' } } }] },
  };
}

/** The block settings edited in the panels (everything but the tree). Labels may have empty locales. */
export interface BlockDraft {
  id: string;
  name: string;
  label: Partial<LocalizedText>;
  category: string;
  icon?: string;
  version: number;
  binding?: ComposedBinding;
  fields: Record<string, ComposedField>;
}

const nonEmpty = (t: Partial<LocalizedText> | undefined): Partial<LocalizedText> =>
  Object.fromEntries(Object.entries(t ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));

/** The binding as saved: only the keys its mode uses, only `true` switches, no empty URL pattern or empty text. */
export function cleanBinding(b: ComposedBinding): ComposedBinding {
  const out: ComposedBinding = { apiId: b.apiId, mode: b.mode };
  const url = b.urlPattern?.trim();
  if (url) out.urlPattern = url;
  if (b.mode !== 'collection') return out;
  if (b.filter?.length) out.filter = b.filter.map((f) => ({ field: f.field, value: f.value }));
  if (b.sort?.field) out.sort = { field: b.sort.field, direction: b.sort.direction };
  if (b.limit !== undefined) out.limit = b.limit;
  if (b.layout) out.layout = b.layout.kind === 'list' ? { kind: 'list' } : { kind: 'grid', ...(b.layout.columns ? { columns: b.layout.columns } : {}) };
  const o = b.options ?? {};
  const options: NonNullable<ComposedBinding['options']> = {};
  for (const k of ['editorFilter', 'editorSort', 'editorLimit', 'editorLayout'] as const) if (o[k] === true) options[k] = true;
  const empty = nonEmpty(o.emptyText);
  if (empty['en-US']) options.emptyText = empty as LocalizedText;
  if (Object.keys(options).length) out.options = options;
  return out;
}

/** The spec to save from the panel draft and the canvas tree. */
export function buildSpec(d: BlockDraft, tree: ComposedNode): ComposedBlockSpec {
  const ordered = { 'en-US': d.label['en-US'] ?? '', ...nonEmpty(d.label) } as LocalizedText;
  return {
    id: d.id,
    name: d.name,
    label: ordered,
    category: d.category,
    ...(d.icon?.trim() ? { icon: d.icon.trim() } : {}),
    version: d.version,
    ...(d.binding ? { binding: cleanBinding(d.binding) } : {}),
    fields: d.fields,
    tree,
  };
}

// ---- save flow -------------------------------------------------------------------------------------------------

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving'; confirmBreaking: boolean }
  | { status: 'confirm'; pages: number }
  | { status: 'saved'; files: string[] }
  | { status: 'error'; error: unknown };

export type SaveAction =
  | { type: 'save' }
  | { type: 'failed'; error: unknown }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'saved'; files: string[] };

export const initialSaveState: SaveState = { status: 'idle' };

/** Save: PUT; a 409 `block_in_use` asks to confirm (page count from the issue); confirming resends with `confirmBreaking`. */
export function saveReducer(s: SaveState, a: SaveAction): SaveState {
  switch (a.type) {
    case 'save':
      return { status: 'saving', confirmBreaking: false };
    case 'failed': {
      const e = a.error;
      if (e instanceof ApiError && e.code === 'block_in_use') {
        const msg = (e.issues[0] as { message?: unknown } | undefined)?.message;
        const pages = Number(msg);
        return { status: 'confirm', pages: Number.isFinite(pages) ? pages : 0 };
      }
      return { status: 'error', error: e };
    }
    case 'confirm':
      return s.status === 'confirm' ? { status: 'saving', confirmBreaking: true } : s;
    case 'cancel':
      return initialSaveState;
    case 'saved':
      return { status: 'saved', files: a.files };
  }
}

// ---- summaries -------------------------------------------------------------------------------------------------

/** A change; `from`/`to` (kind changes) are block kinds: `block`, `layout` or `overlay`. */
export type ChangeNote = { key: string; name?: string; from?: string; to?: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What a save changes compared with the stored spec (`null` = new block). */
export function changeSummary(prev: ComposedBlockSpec | null, next: ComposedBlockSpec): ChangeNote[] {
  if (!prev) return [{ key: 'created' }];
  const out: ChangeNote[] = [];
  if (!same(prev.label, next.label)) out.push({ key: 'label' });
  if (prev.category !== next.category || (prev.icon ?? '') !== (next.icon ?? '')) out.push({ key: 'details' });
  for (const n of Object.keys(next.fields)) if (!(n in prev.fields)) out.push({ key: 'fieldAdded', name: n });
  for (const n of Object.keys(prev.fields)) if (!(n in next.fields)) out.push({ key: 'fieldRemoved', name: n });
  for (const n of Object.keys(next.fields)) if (n in prev.fields && !same(prev.fields[n], next.fields[n])) out.push({ key: 'fieldChanged', name: n });
  if (!same(prev.binding, next.binding)) out.push({ key: 'binding' });
  if (!same(prev.tree, next.tree)) out.push({ key: 'design' });
  return out;
}

/** Why a save is breaking for pages that use the block (empty when it is not). */
export function breakingNotes(prev: ComposedBlockSpec | null, next: ComposedBlockSpec): ChangeNote[] {
  if (!prev || !isBreakingChange(prev, next)) return [];
  const out: ChangeNote[] = [];
  for (const [n, f] of Object.entries(prev.fields)) {
    const g = next.fields[n];
    if (!g) out.push({ key: 'fieldRemoved', name: n });
    else if (g.kind !== f.kind) out.push({ key: 'fieldKind', name: n });
    else if (f.kind === 'select' && (f.options ?? []).some((o) => !(g.options ?? []).includes(o))) out.push({ key: 'optionRemoved', name: n });
  }
  const a = prev.binding;
  const b = next.binding;
  if (!a !== !b || (a && b && (a.apiId !== b.apiId || a.mode !== b.mode))) out.push({ key: 'binding' });
  if (slotsChanged(prev, next)) out.push({ key: 'slots' });
  const [k0, k1] = [composedKind(prev), composedKind(next)];
  if (k0 !== k1) out.push({ key: 'kind', from: k0, to: k1 });
  else if (regionNames(prev).join('\n') !== regionNames(next).join('\n')) out.push({ key: 'regions' });
  return out;
}

/** Elements of `tree` that read manual field `name` (a bind source or the show-if condition). */
export function fieldUsage(tree: ComposedNode, name: string): number {
  const uses = (n: ComposedNode): number =>
    (Object.values(n.bind ?? {}).some((s) => s.from === 'field' && s.name === name) || (n.showIf?.from === 'field' && n.showIf.name === name) ? 1 : 0) +
    (n.children ?? []).reduce((a, c) => a + uses(c), 0);
  return uses(tree);
}

export type ResetNote = { key: string; count?: number };

/**
 * What changing or removing the content type resets: the binding's settings beyond `apiId`/`mode`, and the elements
 * that read the entry (`entry`/`entryUrl` sources or an `entry` show-if). Empty = nothing to confirm.
 */
export function bindingResetNotes(b: ComposedBinding | undefined, tree: ComposedNode): ResetNote[] {
  const out: ResetNote[] = [];
  if (b) {
    if (b.filter?.length) out.push({ key: 'filters', count: b.filter.length });
    if (b.sort) out.push({ key: 'sort' });
    if (b.limit !== undefined) out.push({ key: 'limit' });
    if (b.layout) out.push({ key: 'layout' });
    const o = b.options ?? {};
    if (o.editorFilter || o.editorSort || o.editorLimit || o.editorLayout) out.push({ key: 'editorOptions' });
    if (Object.values(o.emptyText ?? {}).some((v) => typeof v === 'string' && v.trim())) out.push({ key: 'emptyText' });
    if (b.urlPattern?.trim()) out.push({ key: 'urlPattern' });
  }
  const reads = (n: ComposedNode): number =>
    (Object.values(n.bind ?? {}).some((s) => s.from === 'entry' || s.from === 'entryUrl') || n.showIf?.from === 'entry' ? 1 : 0) +
    (n.children ?? []).reduce((a, c) => a + reads(c), 0);
  const count = reads(tree);
  if (count) out.push({ key: 'entryElements', count });
  return out;
}
