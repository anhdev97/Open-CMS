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

export async function listPages(locale: string): Promise<{ data: PageEntry[]; total: number }> {
  const r = await api<{ data: PageEntry[]; meta: { total: number } }>(`${base}?locale=${encodeURIComponent(locale)}&limit=100`);
  return { data: r.data, total: r.meta.total };
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
