import { PAGE_API_ID, SLUG_RE, type PageKind, type PageLayout } from '@opencloudcms/schema';
import { t } from '../i18n';
import { api } from './api';
import { ApiError } from './api-error';

export type PageStatus = 'draft' | 'published' | 'changed';

export interface PageEntry {
  documentId: string;
  title?: string | null;
  path?: string | null;
  locale?: string;
  updatedAt: string;
  publishedAt: string | null;
  hasUnpublishedChanges?: boolean;
  /** `base` = a base page (frames pages, has no path); absent on rows written before base pages. */
  kind?: PageKind | null;
  /** Base pages: the default base page. */
  isDefault?: boolean | null;
  /** Detail templates: the content type whose entries they render. */
  detailApiId?: string | null;
  /** Pages: the base page choice (`null` = the default base page). */
  layout?: PageLayout;
  [k: string]: unknown;
}

/** Pages tab of `/pages` (`?tab=base` = base pages, `?tab=detail` = detail templates). */
export type PagesTab = 'pages' | 'base' | 'detail';
export const pagesTab = (tab: string | null | undefined): PagesTab => (tab === 'base' ? 'base' : tab === 'detail' ? 'detail' : 'pages');

/**
 * Rows of the admin page list that are pages (the list also holds base pages and detail templates, which have their
 * own tabs).
 */
export const splitPagesList = <T extends { kind?: unknown }>(rows: readonly T[]): T[] => rows.filter((p) => p.kind !== 'base' && p.kind !== 'detail');

/** Detail templates of the admin page list (spec §3: listed in admin, never in public page lists). */
export const detailTemplatesOf = <T extends { kind?: unknown }>(rows: readonly T[]): T[] => rows.filter((p) => p.kind === 'detail');

/** Content types offered by "New detail template": a usable detail page and no template yet. */
export function typesWithoutTemplate<T extends { apiId: string; private?: boolean; detailPage?: { path: string } }>(
  types: readonly T[],
  templates: readonly { detailApiId?: unknown }[],
): T[] {
  const taken = new Set(templates.map((p) => p.detailApiId).filter((x): x is string => typeof x === 'string'));
  return types.filter((ty) => !ty.private && !!ty.detailPage && !taken.has(ty.apiId));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The detail pattern an ordinary page's path matches (spec §3 routing 4: the page wins and hides that entry's detail
 * page), or null. `paths`: the usable detail pages by apiId (`GET …/detail-paths`).
 */
export function pageHidesDetail(paths: Record<string, { path: string; slugField?: string }>, pagePath: string | null | undefined): { apiId: string; pattern: string; value: string } | null {
  if (!pagePath) return null;
  for (const [apiId, d] of Object.entries(paths)) {
    const m = /^(\/.+)\/\{(slug|id)\}$/.exec(d.path);
    if (!m || !pagePath.startsWith(`${m[1]}/`)) continue;
    const value = pagePath.slice(m[1]!.length + 1);
    if (m[2] === 'id' ? UUID_RE.test(value) : SLUG_RE.test(value)) return { apiId, pattern: d.path, value };
  }
  return null;
}

const base = `/api/admin/content/${PAGE_API_ID}`;
const ts = (v: string | Date) => new Date(v).getTime();

/**
 * Status of a page from its draft row and published copy (`null` when never published):
 * draft = no published copy, changed = unpublished changes, published otherwise. The server's
 * `hasUnpublishedChanges` flag wins (same source as the content list); timestamps are the fallback.
 */
export function pageStatus(
  draft: { updatedAt: string | Date; hasUnpublishedChanges?: boolean },
  published: { publishedAt: string | Date } | null,
): PageStatus {
  if (!published) return 'draft';
  if (typeof draft.hasUnpublishedChanges === 'boolean') return draft.hasUnpublishedChanges ? 'changed' : 'published';
  return ts(draft.updatedAt) > ts(published.publishedAt) ? 'changed' : 'published';
}

/** The pages list shows at most this many pages (newest first). */
export const PAGES_LIST_LIMIT = 100;

export async function listPages(locale: string): Promise<{ data: PageEntry[]; total: number }> {
  const r = await api<{ data: PageEntry[]; meta: { total: number } }>(`${base}?locale=${encodeURIComponent(locale)}&limit=${PAGES_LIST_LIMIT}`);
  return { data: r.data, total: r.meta.total };
}

/** `{ shown, total }` for the "showing N of M" note when the list is cut short, else null. */
export function listTruncation(shown: number, total: number): { shown: number; total: number } | null {
  return total > shown ? { shown, total } : null;
}

/** Creates a page at `path`, a base page (`kind: 'base'`, no path) or a type's detail template (`kind: 'detail'`, no path). */
export async function createPage(
  input: { title: string; locale: string } & ({ path: string; kind?: 'page' } | { kind: 'base'; path?: undefined } | { kind: 'detail'; detailApiId: string; path?: undefined }),
): Promise<PageEntry> {
  const json =
    input.kind === 'base'
      ? { title: input.title, kind: 'base' }
      : input.kind === 'detail'
        ? { title: input.title, kind: 'detail', detailApiId: input.detailApiId }
        : { title: input.title, path: input.path };
  const r = await api<{ data: PageEntry }>(`${base}?locale=${encodeURIComponent(input.locale)}`, { method: 'POST', json });
  return r.data;
}

/** Copies the draft in `locale` as a new page titled "<title> (copy)" at "<path>-copy" ("/" becomes "/home-copy"). */
export async function duplicatePage(id: string, locale: string): Promise<PageEntry> {
  const loc = encodeURIComponent(locale);
  const src = (await api<{ data: PageEntry }>(`${base}/${id}?locale=${loc}`)).data;
  const path = `${src.path === '/' ? '/home' : (src.path ?? '')}-copy`;
  const json: Record<string, unknown> = { title: `${src.title ?? ''} (copy)`, path };
  if (src.seo != null) json.seo = src.seo;
  if (src.content != null) json.content = src.content;
  return (await api<{ data: PageEntry }>(`${base}?locale=${loc}`, { method: 'POST', json })).data;
}

export async function deletePage(id: string): Promise<void> {
  await api(`${base}/${id}`, { method: 'DELETE' });
}

/** i18n key for a path-related API failure (shown inline on the path field), or null for anything else. */
export function pageErrorMessageKey(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'invalid_path') return 'pages.errors.invalidPath';
  if (e.code === 'path_reserved') return 'pages.errors.pathReserved';
  if (e.code === 'unique_violation') return 'pages.errors.pathTaken';
  if (e.code === 'detail_template_exists') return 'pages.errors.detailTemplateExists';
  if (e.code === 'detail_not_enabled') return 'pages.errors.detailNotEnabled';
  return null;
}

/** Draft of the page in `locale` (the server falls back to the default locale: compare `locale` to detect that). */
export async function getPage(id: string, locale: string): Promise<PageEntry> {
  return (await api<{ data: PageEntry }>(`${base}/${id}?locale=${encodeURIComponent(locale)}&status=draft`)).data;
}

/** Saves the draft of `locale`; `ifMatch` (the last seen `updatedAt`) makes a concurrent edit fail with 409 `stale_draft`. */
export async function savePage(id: string, locale: string, body: Record<string, unknown>, ifMatch: string | undefined): Promise<{ updatedAt: string }> {
  const init: { method: string; json: unknown; headers?: Record<string, string> } = { method: 'PATCH', json: body };
  if (ifMatch) init.headers = { 'If-Match': `"${ifMatch}"` };
  const r = await api<{ data: PageEntry }>(`${base}/${id}?locale=${encodeURIComponent(locale)}`, init);
  return { updatedAt: r.data.updatedAt };
}

export async function publishPage(id: string): Promise<void> {
  await api(`${base}/${id}/publish`, { method: 'POST' });
}

/** `force` unpublishes a base page that pages still use (they are then shown without it). */
export async function unpublishPage(id: string, opts: { force?: boolean } = {}): Promise<void> {
  await api(`${base}/${id}/unpublish${opts.force ? '?force=true' : ''}`, { method: 'POST' });
}

/** Base pages (drafts, default locale), the default first. */
export async function listBases(): Promise<PageEntry[]> {
  return (await api<{ data: PageEntry[] }>('/api/admin/pages/bases')).data;
}

export interface BaseUsage {
  count: number;
  pages: { documentId: string; title: string | null; path: string | null }[];
}

/** Pages a base page frames (explicitly, or as the default). */
export async function getBaseUsage(id: string): Promise<BaseUsage> {
  return api<BaseUsage>(`/api/admin/pages/bases/${encodeURIComponent(id)}/usage`);
}

/** Makes a published base page the default; `null` clears the default. */
export async function setDefaultBase(id: string | null): Promise<void> {
  await api('/api/admin/pages/bases/default', { method: 'PUT', json: { documentId: id } });
}

/**
 * Draft of the base page `id` (a document id or `default`) in `locale` (the server falls back to the default locale).
 * `null` when there is no such base page (or no default).
 */
export async function getBasePage(id: string, locale: string): Promise<PageEntry | null> {
  try {
    return (await api<{ data: PageEntry }>(`${base}/base?id=${encodeURIComponent(id)}&locale=${encodeURIComponent(locale)}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

const BASE_ERRORS: Record<string, string> = {
  base_is_default: 'pages.errors.baseIsDefault',
  base_not_published: 'pages.errors.baseNotPublished',
  invalid_base_root: 'pages.errors.invalidBaseRoot',
  layout_block_misplaced: 'pages.errors.layoutMisplaced',
  base_has_path: 'pages.errors.baseHasPath',
  unknown_base: 'pages.errors.unknownBase',
  invalid_layout: 'pages.errors.invalidLayout',
};

/** Message of a base page API failure (409 `base_in_use` lists the pages), or null for anything else. */
export function baseErrorMessage(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'base_in_use') {
    const pages = e.issues.map((i) => (i as { message?: unknown }).message).filter((m): m is string => typeof m === 'string' && !!m);
    return t(pages.length === 1 ? 'pages.errors.baseInUseOne' : 'pages.errors.baseInUse', { count: pages.length, pages: pages.join(', ') });
  }
  const key = BASE_ERRORS[e.code];
  return key ? t(key) : null;
}

/**
 * Website preview of the draft (draft mode, admin session only). `path`: for a detail template, the entry URL to open
 * (a template has no path of its own).
 */
export function pagePreviewUrl(id: string, locale: string, path?: string): string {
  const at = path ? `&path=${encodeURIComponent(path)}` : '';
  return `/__opencloudcms/preview?page=${encodeURIComponent(id)}&locale=${encodeURIComponent(locale)}${at}`;
}

/** Detail URL of `entry` (`/products/{slug}` filled from its slug field, `{id}` from its documentId), or null. */
export function previewDetailUrl(d: { path: string; slugField?: string } | undefined, entry: Record<string, unknown>): string | null {
  const m = d ? /^(\/.+)\/\{(slug|id)\}$/.exec(d.path) : null;
  if (!m) return null;
  const value = m[2] === 'id' ? entry.documentId : d!.slugField ? entry[d!.slugField] : undefined;
  return typeof value === 'string' && value ? `${m[1]}/${value}` : null;
}

let shadowed: Promise<string[]> | null = null;

/**
 * Paths served by a file route of the website (`app/(site)/**\/page.tsx`), which wins over a page built here.
 * Fixed for the server's lifetime, so read once per admin load; a failure yields `[]` (no warning) and is retried next call.
 */
export function getShadowedPaths(): Promise<string[]> {
  shadowed ??= api<{ data: string[] }>('/api/admin/pages/shadowed').then(
    (r) => r.data,
    () => {
      shadowed = null;
      return [];
    },
  );
  return shadowed;
}

export const isShadowedPath = (path: string | null | undefined, list: readonly string[]): boolean => !!path && list.includes(path);
