// Shared state and helpers of the content pages (spec §8): list, new, detail and edit.
import { localizedText } from '@opencloudcms/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { EntryFile } from '../../components/FieldInput';
import { getActiveLocale, t } from '../../i18n';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import type { WorkflowState } from '../../lib/entry-actions';
import { pickEditorLocale } from '../../lib/locales';
import { useAdminNavigate, useAdminPathname, useAdminSearchParam } from '../../lib/nav';
import { registerNavigationGuard } from '../../lib/nav-guard';
import type { ContentTypeDefinition, FieldDefinition, Meta } from '../../lib/types';

export type WorkflowInfo = { state: WorkflowState; submittedBy: { id: string; name: string } | null; submittedAt: string | null; note: string | null };
export type Entry = Record<string, any> & {
  documentId: string;
  status: string;
  publishedAt: string | null;
  updatedAt?: string;
  locale?: string | null;
  hasUnpublishedChanges?: boolean;
  workflow?: WorkflowInfo | null;
};
export type Version = { id: string; createdAt: string };
export type Values = Record<string, any>;

const WORKFLOW_ERRORS = ['in_review_locked', 'invalid_transition', 'forbidden'];

/** Known workflow error codes get the active-locale message; anything else passes through. */
export function workflowError(e: unknown): ApiError | Error {
  if (e instanceof ApiError && WORKFLOW_ERRORS.includes(e.code)) {
    return new ApiError(e.status, e.code, t(`content.errors.${e.code}`), e.issues, e.retryAfterSec);
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** Admin create rejects readOnly values, so a type with a required readOnly field cannot be created here. */
export function canCreateEntries(def: ContentTypeDefinition): boolean {
  return !def.fields.some((f) => f.required && f.readOnly);
}

/** Request body for create / update: readOnly fields (server-written) and untouched `undefined`s are left out. */
export function writableBody(def: ContentTypeDefinition, values: Values): Values {
  const out: Values = {};
  for (const f of def.fields) {
    if (f.readOnly || values[f.name] === undefined) continue;
    out[f.name] = values[f.name];
  }
  return out;
}

/** Form values for an entry (or empty for a new one). */
export function formValues(def: ContentTypeDefinition, entry: Entry | null): Values {
  return Object.fromEntries(def.fields.map((f) => [f.name, entry ? (entry[f.name] ?? null) : null]));
}

export const titleFieldOf = (def: ContentTypeDefinition) => def.fields.find((f) => ['text', 'slug'].includes(f.kind))?.name;

export function entryTitle(def: ContentTypeDefinition, entry: Entry | null | undefined): string {
  const name = titleFieldOf(def);
  const v = name && entry ? entry[name] : null;
  return typeof v === 'string' && v.trim() ? v : t('content.untitled');
}

export const typeTitle = (def: ContentTypeDefinition) => localizedText(def.displayName, getActiveLocale(), def.apiId);

/** Admin path of a content page; `?locale=` only when it is not the default locale. */
export function contentPath(apiId: string, rest: string[] = [], locale?: string, defaultLocale?: string): string {
  const base = ['/content', apiId, ...rest].join('/');
  return locale && locale !== defaultLocale ? `${base}?locale=${encodeURIComponent(locale)}` : base;
}

export function entryStatus(def: ContentTypeDefinition, e: Entry): 'in_review' | 'published' | 'draft' {
  return e.workflow?.state === 'in_review' && def.review ? 'in_review' : e.publishedAt ? 'published' : 'draft';
}

const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Inline validation of the entry form; the server stays the authority (its 422 issues map onto the fields). */
export function entrySchema(def: ContentTypeDefinition) {
  return z.record(z.string(), z.any()).superRefine((v, ctx) => {
    for (const f of def.fields) {
      if (f.readOnly) continue;
      const value = v[f.name];
      if (f.required && f.kind !== 'boolean' && empty(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f.name], message: t('content.fieldRequired') });
      } else if (f.kind === 'email' && typeof value === 'string' && value && !EMAIL.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f.name], message: t('content.invalidEmail') });
      } else if (f.kind === 'url' && typeof value === 'string' && value && !/^(https?:\/\/|\/)/.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f.name], message: t('content.invalidUrl') });
      }
    }
  });
}

/** Server 422 issues (`{ path, message }`) that name a field of the type. */
export function fieldIssues(def: ContentTypeDefinition, e: unknown): { field: FieldDefinition; message: string }[] {
  if (!(e instanceof ApiError)) return [];
  const out: { field: FieldDefinition; message: string }[] = [];
  for (const raw of e.issues as { path?: unknown; message?: unknown }[]) {
    const head = String(Array.isArray(raw?.path) ? raw.path[0] : (raw?.path ?? '')).split('.')[0];
    const field = def.fields.find((f) => f.name === head);
    if (field) out.push({ field, message: typeof raw.message === 'string' && raw.message !== '' ? raw.message : e.message });
  }
  return out;
}

/** Type definition and admin meta; meta reloads when languages or the schema change. */
export function useContentType(apiId: string) {
  const [def, setDef] = useState<ContentTypeDefinition | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    const loadMeta = () =>
      api<Meta>('/api/admin/meta').then(
        (m) => live && setMeta(m),
        (e) => live && setError(e),
      );
    void loadMeta();
    window.addEventListener('opencloudcms:schema-changed', loadMeta);
    api<{ data: ContentTypeDefinition }>(`/api/admin/content-types/${apiId}`).then(
      (r) => live && setDef(r.data),
      (e) => live && setError(e),
    );
    return () => {
      live = false;
      window.removeEventListener('opencloudcms:schema-changed', loadMeta);
    };
  }, [apiId]);
  return { def, meta, error };
}

/**
 * Editor locale: `?locale=` when enabled, else the default. Private types are document-level and always use the
 * default locale (no locale select).
 */
export function useEditorLocale(meta: Meta | null, def: ContentTypeDefinition | null): [string, (l: string) => void] {
  const requested = useAdminSearchParam('locale');
  const pathname = useAdminPathname();
  const navigate = useAdminNavigate();
  const [chosen, setChosen] = useState<string | null>(requested);
  const defaultLocale = meta?.defaultLocale;
  // The choice is kept in `?locale=` (replace, so Back still leaves the page); the default locale has no parameter.
  const choose = useCallback(
    (l: string) => {
      setChosen(l);
      navigate(l === defaultLocale ? pathname : `${pathname}?locale=${encodeURIComponent(l)}`, { replace: true, skipGuard: true });
    },
    [navigate, pathname, defaultLocale],
  );
  if (!meta || !def) return ['', choose];
  return [pickEditorLocale(def.private ? null : chosen, meta.locales, meta.defaultLocale), choose];
}

/** The draft of one entry in a locale; `null` until the draft of the current locale has loaded. */
export function useEntry(apiId: string, documentId: string, locale: string) {
  const key = `${apiId}/${documentId}?${locale}`;
  const [loaded, setLoaded] = useState<{ key: string; entry: Entry } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const reload = useCallback(async () => {
    if (!locale) return;
    try {
      const r = await api<{ data: Entry }>(`/api/admin/content/${apiId}/${documentId}?locale=${locale}`);
      setLoaded({ key, entry: r.data });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [apiId, documentId, locale, key]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { entry: loaded?.key === key ? loaded.entry : null, error, reload };
}

/** File metadata of a private entry (`GET .../:documentId/files`); empty for public types. */
export function useEntryFiles(def: ContentTypeDefinition | null, documentId: string | null): EntryFile[] {
  const [files, setFiles] = useState<EntryFile[]>([]);
  const wanted = !!def?.private && !!documentId && def.fields.some((f) => f.kind === 'asset');
  const apiId = def?.apiId;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    api<{ data: EntryFile[] }>(`/api/admin/content/${apiId}/${documentId}/files`).then(
      (r) => live && setFiles(r.data),
      () => undefined, // names fall back to ids
    );
    return () => {
      live = false;
    };
  }, [wanted, apiId, documentId]);
  return files;
}

/** Published versions (newest first); private entries have none, so nothing is requested. */
export function useVersions(def: ContentTypeDefinition | null, documentId: string, refresh: unknown): Version[] | null {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const enabled = !!def && !def.private;
  const apiId = def?.apiId;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api<{ data: Version[] }>(`/api/admin/content/${apiId}/${documentId}/versions`).then(
      (r) => live && setVersions(r.data),
      () => live && setVersions([]),
    );
    return () => {
      live = false;
    };
  }, [enabled, apiId, documentId, refresh]);
  return versions;
}

/**
 * Unsaved-changes guard: `beforeunload` and in-app navigation (lib/nav-guard) ask while `dirty`. `release()` turns
 * it off synchronously, for the navigation that follows a successful save.
 */
export function useUnsavedChangesGuard(dirty: boolean): () => void {
  const blocking = useRef(dirty);
  blocking.current = dirty;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!blocking.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const off = registerNavigationGuard(() => blocking.current);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      off();
    };
  }, []);
  return useCallback(() => {
    blocking.current = false;
  }, []);
}
