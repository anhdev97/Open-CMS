// Pure, runtime-agnostic page helpers. Must not import from `node:*` (bundled for the browser and shared with Nest).
import { OVERLAY_NAME_RE } from './actions';

/** apiId of the core-owned page content type. Projects may not define a type with this id. */
export const PAGE_API_ID = 'opencloudcmsPage';

/** apiIds owned by core: hidden from the Content Type Builder and rejected in project schema files. */
export const CORE_API_IDS: readonly string[] = [PAGE_API_ID];

export const isCoreApiId = (apiId: string): boolean => CORE_API_IDS.includes(apiId);

/**
 * apiIds a project may not use: the core-owned types plus `assets`, whose delivery path `/api/content/assets` is the
 * public asset lookup. Rejected in project schema files and by the Content Type Builder.
 */
export const RESERVED_API_IDS: readonly string[] = [...CORE_API_IDS, 'assets'];

export const isReservedApiId = (apiId: string): boolean => RESERVED_API_IDS.includes(apiId);

/** First path segments that belong to the CMS itself (compared case-insensitively). */
export const RESERVED_PATH_SEGMENTS: readonly string[] = ['admin', 'api', 'oauth2', '__opencloudcms', '_next'];

const SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type PagePathResult = { ok: true } | { ok: false; code: 'invalid_path' | 'path_reserved'; message: string };

export function validatePagePath(path: string): PagePathResult {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return { ok: false, code: 'invalid_path', message: 'Path must start with "/"' };
  }
  if (path === '/') return { ok: true };
  const segments = path.slice(1).split('/');
  if (RESERVED_PATH_SEGMENTS.includes(segments[0].toLowerCase())) {
    return { ok: false, code: 'path_reserved', message: `Path "/${segments[0]}" is reserved` };
  }
  if (!segments.every((s) => SEGMENT_RE.test(s))) {
    return {
      ok: false,
      code: 'invalid_path',
      message: 'Path segments must be lowercase letters, digits and single hyphens, separated by "/" with no trailing "/"',
    };
  }
  return { ok: true };
}

/** 'Giới thiệu' -> '/gioi-thieu'. */
export function slugToPath(title: string): string {
  const slug = String(title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `/${slug}` : '/';
}

export type StoredPageContent = {
  format: 'puck';
  formatVersion: number;
  data: { root: unknown; content: unknown[]; zones?: Record<string, unknown[]> };
};

/**
 * Names of the ready-made `coreBlocks` of `@opencloudcms/core/blocks` (kept here, React-free, so the server can
 * tell core blocks from project blocks; a blocks test checks it against `coreBlocks`).
 */
export const CORE_BLOCK_NAMES: readonly string[] = [
  'Section', 'Columns', 'Grid', 'Spacer', 'Divider', 'Heading', 'Text', 'Image', 'Button', 'ButtonGroup',
  'Card', 'Badge', 'Hero', 'FeatureList', 'CallToAction', 'FAQ', 'EntryList',
];

/**
 * The blocks a project defines (`blockManifest`). `richText`: prop paths of the block's `b.richText` fields
 * (`'body'`, `'rows[].note'` inside list rows), normalized by the server when a page is saved. `kind`: `layout` or
 * `overlay` for layout and overlay blocks; absent for ordinary blocks (`block`).
 */
export type BlockManifest = { name: string; version: number; richText?: string[]; kind?: 'block' | 'layout' | 'overlay' }[];

function isItem(v: unknown): v is { type: string; props?: unknown } {
  if (!v || typeof v !== 'object') return false;
  const o = v as { type?: unknown; props?: unknown };
  return typeof o.type === 'string' && !!o.props && typeof o.props === 'object' && !Array.isArray(o.props);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A prop value can hold slot content only as an array. Items in the array are counted (and their own props
 * visited); other plain objects in the array are array-field rows whose values may be slots. A bare object
 * value (not in an array) is plain JSON and is never counted.
 */
function visitValue(value: unknown, out: Map<string, number>): void {
  if (!Array.isArray(value)) return;
  for (const el of value) {
    if (isItem(el)) {
      out.set(el.type, (out.get(el.type) ?? 0) + 1);
      for (const v of Object.values(el.props as Record<string, unknown>)) visitValue(v, out);
    } else if (isPlainObject(el)) {
      for (const v of Object.values(el)) visitValue(v, out);
    }
  }
}

/**
 * Block name -> occurrences, over `content`, `zones` and slot fields (arrays of `{ type, props }` among the props
 * of items and of `root.props`). Limitation: without the block registry a slot cannot be told from an ordinary
 * array prop, so a JSON array prop whose elements look like `{ type: string, props: object }` counts as items.
 */
export function collectBlockNames(c: StoredPageContent | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const data = c?.data;
  if (!data) return out;
  visitValue(data.content, out);
  for (const zone of Object.values(data.zones ?? {})) visitValue(zone, out);
  const rootProps = (data.root as { props?: unknown } | null | undefined)?.props;
  if (isPlainObject(rootProps)) for (const v of Object.values(rootProps)) visitValue(v, out);
  return out;
}

/**
 * Kinds of page documents: `page` is served at its path; `base` frames pages (never served on its own); `detail` is
 * the template of a content type's entry detail pages (no path of its own; `detailApiId` names the type).
 */
export type PageKind = 'page' | 'base' | 'detail';
export const PAGE_KINDS: readonly PageKind[] = ['page', 'base', 'detail'];

export type RegionMode = 'default' | 'replace' | 'hide';
export const REGION_MODES: readonly RegionMode[] = ['default', 'replace', 'hide'];

/**
 * A page's base choice (page-level, same for every locale). `null`, `{}` or an absent `baseId` = framed by the default
 * base page (its region modes may still be set: `{ regions }`); `baseId: null` = no frame; a document id = that base
 * page. An absent region is `default`.
 */
export type PageLayout = { baseId?: string | null; regions?: Record<string, RegionMode> } | null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check of a stored `layout` value (whether `baseId` names a base page is checked by the server). */
export function validatePageLayout(value: unknown): { ok: true } | { ok: false; message: string } {
  if (value == null) return { ok: true };
  if (!isPlainObject(value)) return { ok: false, message: 'layout must be null or an object' };
  const extra = Object.keys(value).filter((k) => k !== 'baseId' && k !== 'regions');
  if (extra.length) return { ok: false, message: `layout has unknown keys: ${extra.join(', ')}` };
  // Absent `baseId` = the default base page; when present it is a document id or null (no base page).
  if ('baseId' in value && value.baseId !== null && (typeof value.baseId !== 'string' || !UUID_RE.test(value.baseId))) {
    return { ok: false, message: 'layout.baseId must be a document id or null' };
  }
  if (value.regions !== undefined) {
    if (!isPlainObject(value.regions)) return { ok: false, message: 'layout.regions must be an object' };
    for (const [name, mode] of Object.entries(value.regions)) {
      if (!OVERLAY_NAME_RE.test(name)) return { ok: false, message: `layout.regions: invalid region name "${name}"` };
      if (!REGION_MODES.includes(mode as RegionMode)) return { ok: false, message: `layout.regions.${name} must be default, replace or hide` };
    }
  }
  return { ok: true };
}
