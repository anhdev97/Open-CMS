import type { StoredPageContent } from '@opencloudcms/schema';
import { PUCK_FORMAT_VERSION } from './puck-config';
import type { BlockField, BlockRegistry, PuckData } from './types';

export type PageContentStatus = 'ok' | 'empty' | 'needs-migration';
export type ReadPageContentResult = { status: PageContentStatus; data: PuckData };

export type Item = { type: string; props: Record<string, unknown> } & Record<string, unknown>;

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isItem = (v: unknown): v is Item => isObj(v) && typeof v.type === 'string' && isObj(v.props);
const emptyData = (): PuckData => ({ root: { props: {} }, content: [], zones: {} });

export type ItemFn = (item: unknown) => unknown;

/** Copy of `props` with `fn` applied to the items of every declared slot (also inside list rows). Keeps other props. */
export function mapSlots(fields: Record<string, BlockField>, props: Record<string, unknown>, fn: ItemFn): Record<string, unknown> {
  const out = { ...props };
  for (const [k, f] of Object.entries(fields)) {
    const v = props[k];
    if (!Array.isArray(v)) continue;
    if (f.kind === 'slot') out[k] = v.map(fn);
    else if (f.kind === 'list') out[k] = v.map((row) => (isObj(row) ? mapSlots(f.fields, row, fn) : row));
  }
  return out;
}

/** Only declared props (recursively for list rows); slot items go through `fn`. */
function pickDeclared(fields: Record<string, BlockField>, props: Record<string, unknown>, fn: ItemFn): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    const v = props[k];
    if (f.kind === 'slot' && Array.isArray(v)) out[k] = v.map(fn);
    else if (f.kind === 'list' && Array.isArray(v)) out[k] = v.map((row) => (isObj(row) ? pickDeclared(f.fields, row, fn) : row));
    else out[k] = v;
  }
  return out;
}

function readItem(r: BlockRegistry): ItemFn {
  const visit: ItemFn = (item) => {
    if (!isItem(item)) return item;
    const def = r.get(item.type);
    if (!def) return item;
    const version = def.version ?? 1;
    const { id, _v, ...rest } = item.props;
    let v = typeof _v === 'number' && Number.isInteger(_v) ? _v : 1;
    let props: Record<string, unknown> = rest;
    const migrating = v < version;
    while (v < version) {
      const step = def.migrate?.find((m) => m.from === v);
      if (step) props = step.up({ ...props });
      v++;
    }
    const stamp = migrating ? { _v: version } : _v !== undefined ? { _v } : {};
    return { ...item, props: { ...(id !== undefined ? { id } : {}), ...mapSlots(def.fields, props, visit), ...stamp } };
  };
  return visit;
}

function writeItem(r: BlockRegistry): ItemFn {
  const visit: ItemFn = (item) => {
    if (!isItem(item)) return item;
    const def = r.get(item.type);
    if (!def) return item;
    const { id } = item.props;
    return {
      ...item,
      props: { ...(id !== undefined ? { id } : {}), _v: def.version ?? 1, ...pickDeclared(def.fields, item.props, visit) },
    };
  };
  return visit;
}

export function mapData(d: Record<string, unknown>, fn: ItemFn): PuckData {
  const out: Record<string, unknown> = {
    root: isObj(d.root) ? d.root : { props: {} },
    content: Array.isArray(d.content) ? d.content.map(fn) : [],
  };
  if (isObj(d.zones)) {
    out.zones = Object.fromEntries(
      Object.entries(d.zones).map(([k, z]) => [k, Array.isArray(z) ? z.map(fn) : []]),
    );
  }
  return out as PuckData;
}

/**
 * Stored `content` → Puck data for editor/renderer.
 * - `null`, `{}` or a non-object → `empty` (blank canvas).
 * - another `formatVersion` or an unrecognised shape → `needs-migration`; `data` is returned untouched
 *   (the stored `data` when present, else a blank canvas) and must not be saved back.
 * - otherwise `ok`, with item props migrated from their stored `_v` to the block's `version`.
 * Unknown blocks are kept as-is.
 */
export function readPageContent(raw: unknown, r: BlockRegistry): ReadPageContentResult {
  if (!isObj(raw) || Object.keys(raw).length === 0) return { status: 'empty', data: emptyData() };
  if (raw.format === 'puck' && raw.formatVersion === PUCK_FORMAT_VERSION && isObj(raw.data)) {
    return { status: 'ok', data: mapData(raw.data, readItem(r)) };
  }
  const data = raw.format === 'puck' && isObj(raw.data) ? (raw.data as PuckData) : emptyData();
  return { status: 'needs-migration', data };
}

/**
 * Puck data → stored `content`. Props not declared in the block's fields are dropped (except `id`), `_v` is set to
 * the block's `version`. Item-level keys (e.g. Puck's `readOnly`), root and unknown blocks are kept as-is.
 */
export function writePageContent(data: PuckData, r: BlockRegistry): StoredPageContent {
  return {
    format: 'puck',
    formatVersion: PUCK_FORMAT_VERSION,
    data: mapData(data as unknown as Record<string, unknown>, writeItem(r)) as StoredPageContent['data'],
  };
}
