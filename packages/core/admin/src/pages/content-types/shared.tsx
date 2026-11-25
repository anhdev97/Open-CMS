// Shared state and helpers of the content type setup pages (spec §8): list, new, detail, edit and groups.
import { localizedText } from '@opencloudcms/schema';
import { CheckIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '../../components/ui/skeleton';
import { getActiveLocale } from '../../i18n';
import { api } from '../../lib/api';
import { newId, type ApplyResponse, type ContentTypeDefinition, type FieldDefinition, type FieldKind, type Meta } from '../../lib/types';

/** Select value for "no group" / "no value" (Radix Select needs a non-empty value). */
export const NONE = '__none__';

/** Same rules as `@opencloudcms/schema` validate (kept here so the form can say so inline). */
export const API_ID_RE = /^[a-z][a-zA-Z0-9]{0,39}$/;
export const FIELD_NAME_RE = /^[a-z][a-zA-Z0-9]{0,49}$/;

export const ALL_KINDS: FieldKind[] = [
  'text', 'longText', 'richText', 'slug', 'email', 'url', 'number', 'boolean',
  'date', 'datetime', 'json', 'money', 'asset', 'reference', 'taxonomy',
];

export const typeName = (ty: { apiId: string; displayName: ContentTypeDefinition['displayName'] }) =>
  localizedText(ty.displayName, getActiveLocale(), ty.apiId);

export const emptyType = (): ContentTypeDefinition => ({ id: newId('ct'), apiId: '', displayName: '', fields: [] });
export const emptyField = (): FieldDefinition => ({
  id: newId('fld'), name: '', kind: 'text', required: false, localizable: false, indexed: false, unique: false, options: {},
});

/** Admin path under `/settings/content-types`. */
export const typesPath = (...rest: string[]) => ['/settings/content-types', ...rest].join('/');

/** Admin meta and every content type; reloads when the schema changes. */
export function useSchemaTypes() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [types, setTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const reload = useCallback(async () => {
    try {
      const [m, list] = await Promise.all([
        api<Meta>('/api/admin/meta'),
        api<{ data: ContentTypeDefinition[] }>('/api/admin/content-types'),
      ]);
      setMeta(m);
      setTypes(list.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);
  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener('opencloudcms:schema-changed', onChange);
    return () => window.removeEventListener('opencloudcms:schema-changed', onChange);
  }, [reload]);
  return { meta, types, error, reload };
}

export type EntryCount = { state: 'loading' } | { state: 'ok'; count: number } | { state: 'error' };

/** Number of entries of a type (content list `meta.total`); `null` for no type (a new one). */
export function useEntryCount(apiId: string | null): EntryCount | null {
  const [count, setCount] = useState<EntryCount>({ state: 'loading' });
  useEffect(() => {
    if (!apiId) return;
    let live = true;
    setCount({ state: 'loading' });
    api<{ meta: { total: number } }>(`/api/admin/content/${apiId}?limit=1&offset=0`).then(
      (r) => live && setCount({ state: 'ok', count: r.meta?.total ?? 0 }),
      () => live && setCount({ state: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [apiId]);
  return apiId ? count : null;
}

// The save response (files to commit) is shown once on the detail page the editor lands on.
const saveResults = new Map<string, ApplyResponse>();
export const rememberSaveResult = (apiId: string, r: ApplyResponse) => saveResults.set(apiId, r);
export const peekSaveResult = (apiId: string): ApplyResponse | null => saveResults.get(apiId) ?? null;
export const clearSaveResult = (apiId: string) => void saveResults.delete(apiId);

/** A check mark for `true`, an em dash otherwise (table cells). */
export function BoolMark({ value, label }: { value: boolean; label: string }) {
  return value ? (
    <CheckIcon className="size-4" aria-label={label} role="img" />
  ) : (
    <span className="text-muted-foreground" aria-hidden="true">
      —
    </span>
  );
}

export function TypesSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Dispatched after every schema write so the sidebar and other pages reload. */
export const announceSchemaChange = () => window.dispatchEvent(new Event('opencloudcms:schema-changed'));
