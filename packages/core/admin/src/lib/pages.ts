import { PAGE_API_ID } from '@opencloudcms/schema';
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
  [k: string]: unknown;
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

export async function createPage(input: { title: string; path: string; locale: string }): Promise<PageEntry> {
  const r = await api<{ data: PageEntry }>(`${base}?locale=${encodeURIComponent(input.locale)}`, {
    method: 'POST',
    json: { title: input.title, path: input.path },
  });
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

export async function unpublishPage(id: string): Promise<void> {
  await api(`${base}/${id}/unpublish`, { method: 'POST' });
}

/** Website preview of the draft (draft mode, admin session only). */
export function pagePreviewUrl(id: string, locale: string): string {
  return `/__opencloudcms/preview?page=${encodeURIComponent(id)}&locale=${encodeURIComponent(locale)}`;
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
