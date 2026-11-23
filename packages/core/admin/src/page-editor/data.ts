// Cached admin API reads used by the page editor's fields.
import { api } from '../lib/api';
import { listPages, type PageEntry } from '../lib/pages';
import type { ContentTypeDefinition } from '../lib/types';

const cache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    cache.set(
      key,
      load().catch((e) => {
        cache.delete(key);
        throw e;
      }),
    );
  }
  return cache.get(key) as Promise<T>;
}

export const loadContentTypes = () =>
  cached('types', () => api<{ data: ContentTypeDefinition[] }>('/api/admin/content-types').then((r) => r.data));

export const loadContentType = async (apiId: string) => (await loadContentTypes()).find((t) => t.apiId === apiId) ?? null;

export type EntryRow = { documentId: string; [k: string]: unknown };

/** Drafts of `apiId` in `locale` (first 100), for the entry pickers. */
export const loadEntries = (apiId: string, locale: string) =>
  cached(`entries:${apiId}:${locale}`, () =>
    api<{ data: EntryRow[] }>(`/api/admin/content/${encodeURIComponent(apiId)}?locale=${encodeURIComponent(locale)}&limit=100`).then((r) => r.data),
  );

export const loadPages = (locale: string) => cached(`pages:${locale}`, () => listPages(locale).then((r) => r.data as PageEntry[]));

export type AssetRow = { id: string; filename: string; url: string; mimeType: string | null; alt: string | null };

export const loadAssets = () => cached('assets', () => api<{ data: AssetRow[] }>('/api/admin/assets?limit=200').then((r) => r.data));

/** Forget cached reads (after an upload, or when the editor opens again). */
export function invalidate(prefix?: string): void {
  for (const k of [...cache.keys()]) if (!prefix || k.startsWith(prefix)) cache.delete(k);
}

const META = new Set(['documentId', 'status', 'locale', 'createdAt', 'updatedAt', 'publishedAt', 'workflow', 'hasUnpublishedChanges']);

/** Label of an entry: `displayField`, else the first indexed text field, else the first string value, else its id. */
export function entryLabel(e: EntryRow, type: ContentTypeDefinition | null, displayField?: string): string {
  const str = (k: string | undefined) => (k && typeof e[k] === 'string' && (e[k] as string).trim() ? (e[k] as string) : null);
  const indexedText = type?.fields.find((f) => f.indexed && (f.kind === 'text' || f.kind === 'slug' || f.kind === 'email'))?.name;
  const anyString = Object.keys(e).find((k) => !META.has(k) && typeof e[k] === 'string' && (e[k] as string).trim());
  return str(displayField) ?? str(indexedText) ?? str(anyString) ?? e.documentId;
}
