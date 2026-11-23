// Puck's stylesheet without its external font @import (rsms.me): the admin CSP allows only same-origin styles.
import '@puckeditor/core/no-external.css';
import { FileIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { createElement, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Puck, type Data, type Dictionary, type useGetPuck } from '@puckeditor/core';
import { adminFetcher, coreBlocks, defineBlocks, type Entry } from '@opencloudcms/core/blocks';
import { isCoreApiId, validateComposedSpec, type ComposedBlockSpec, type ComposedElement, type ComposedField, type ComposedNode } from '@opencloudcms/schema';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorAlert } from '../components/ErrorAlert';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Skeleton } from '../components/ui/skeleton';
import { t } from '../i18n';
import { useLocale } from '../i18n/hooks';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import { blockErrorMessageKey, getBlock, saveBlock, type BlockDetail } from '../lib/blocks';
import { formatIssue } from '../lib/format-issue';
import { adminHref, useAdminNavigate, useAdminParams } from '../lib/nav';
import type { ContentTypeDefinition, Meta } from '../lib/types';
import { BlocksContext } from '../page-editor/blocks-context';
import { entryLabel, invalidate, loadContentTypes } from '../page-editor/data';
import { fieldTypes } from '../page-editor/puck-fields';
import { TokenField } from '../page-editor/TokenField';
import { BlockPanel } from '../block-builder/BlockPanel';
import { BuilderHeader, BuilderHeaderContext, type BuilderHeaderModel } from '../block-builder/BuilderHeader';
import { elementRender, RootPreview } from '../block-builder/Canvas';
import { BuilderContext, CanvasContext, type BuilderModel, type CanvasModel } from '../block-builder/context';
import { buildBuilderConfig } from '../block-builder/element-config';
import { AllowField, ShowIfField, SourcesField } from '../block-builder/ElementPanel';
import {
  bindingResetNotes,
  breakingNotes,
  buildSpec,
  changeSummary,
  emptySpec,
  fieldUsage,
  initialSaveState,
  saveReducer,
  showCurrencyFor,
  type BlockDraft,
  type ChangeNote,
  type ResetNote,
} from '../block-builder/logic';
import { canvasFieldValues, imageEntryPaths, loadSamples, placeholderEntry } from '../block-builder/sample-data';
import { puckToTree, treeToPuck, type BuilderPuckData } from '../block-builder/tree-puck';

const READ_ONLY = { drag: false, duplicate: false, delete: false, edit: false, insert: false };
const SAMPLE_DEBOUNCE_MS = 300;
const fetcher = adminFetcher('');

// Puck's own UI strings shown by the builder (shared with the page editor's translations).
const PUCK_KEYS = [
  'action-selectparent', 'action-drag', 'action-duplicate', 'action-delete', 'label-component',
  'outline-empty', 'outline-item-collapse', 'outline-item-expand', 'outline-header-title', 'outline-header-collapseall',
  'outline-item-duplicate', 'outline-item-delete', 'drawer-category-collapse', 'drawer-category-expand',
  'field-readonly', 'viewport-zoom-in', 'viewport-zoom-out', 'viewport-zoom-auto', 'viewport-toggle-menu', 'viewport-switch',
  'viewport-switch-default', 'plugin-blocks', 'plugin-outline', 'plugin-fields', 'plugin-components', 'loader-loading',
] as const;

function puckDictionary(): Dictionary {
  const out: Record<string, string> = {};
  for (const k of PUCK_KEYS) {
    const msg = t(`pageEditor.puck.${k}`);
    if (msg !== `pageEditor.puck.${k}`) out[k] = msg;
  }
  out['label-page'] = t('blockBuilder.block.title'); // the root is the block, not a page
  return out as Dictionary;
}

function errorText(e: unknown): string {
  const key = blockErrorMessageKey(e);
  if (key) return t(key);
  return e instanceof Error ? e.message : String(e);
}

function draftOf(spec: ComposedBlockSpec): BlockDraft {
  const { tree: _tree, ...rest } = spec;
  return structuredClone(rest) as BlockDraft;
}

function noteText(n: ChangeNote): string {
  return t(`blockBuilder.changes.${n.key}`, n.name ? { name: n.name } : undefined);
}

let coreRegistryNames: string[] | null = null;

interface BuilderProps {
  meta: Meta;
  types: ContentTypeDefinition[];
  detail: BlockDetail | null;
}

function Builder({ meta, types: allTypes, detail }: BuilderProps) {
  const navigate = useAdminNavigate();
  const adminLocale = useLocale();
  const registry = useContext(BlocksContext);
  const readOnly = !meta.schemaEditable;
  const types = useMemo(() => allTypes.filter((ct) => !isCoreApiId(ct.apiId)), [allTypes]);

  const [initialSpec] = useState<ComposedBlockSpec>(() => detail?.spec ?? emptySpec());
  const [initialData] = useState<BuilderPuckData>(() => treeToPuck(initialSpec).data);
  const [stored, setStored] = useState<ComposedBlockSpec | null>(detail?.spec ?? null);
  const [draft, setDraftState] = useState<BlockDraft>(() => draftOf(initialSpec));
  const [tree, setTree] = useState<ComposedNode>(initialSpec.tree);
  const [locale, setLocale] = useState<string>(meta.defaultLocale);
  const getPuck = useRef<ReturnType<typeof useGetPuck> | null>(null);
  const setDraft = useCallback((u: (d: BlockDraft) => BlockDraft) => setDraftState(u), []);

  const type = draft.binding ? (types.find((ct) => ct.apiId === draft.binding!.apiId) ?? null) : null;
  const typeRef = useRef(type);
  typeRef.current = type;

  const pageBlocks = useMemo(() => {
    const names = registry ? registry.list.map((d) => d.name) : (coreRegistryNames ??= defineBlocks(coreBlocks).list.map((d) => d.name));
    return names.filter((n) => n !== draft.name);
  }, [registry, draft.name]);

  // ---- samples ----
  const [samples, setSamples] = useState<{ key: string; rows: Entry[] | null; error: unknown }>({ key: '', rows: null, error: null });
  const [sampleId, setSampleId] = useState<string | null>(null);
  const assetPaths = useMemo(() => [...imageEntryPaths(tree)].sort(), [tree]);
  const b = draft.binding;
  const sampleKey = b && type ? JSON.stringify([b.apiId, b.mode, b.filter ?? [], b.sort ?? null, b.limit ?? null, locale, assetPaths]) : '';
  useEffect(() => {
    if (!sampleKey || !b) return;
    let live = true;
    const binding = b;
    const timer = setTimeout(() => {
      loadSamples(fetcher, binding, locale, assetPaths).then(
        (rows) => live && setSamples({ key: sampleKey, rows, error: null }),
        (error) => live && setSamples({ key: sampleKey, rows: [], error }),
      );
    }, SAMPLE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sampleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = samples.key === sampleKey ? samples.rows : null;
  const placeholder = useMemo(() => (type ? placeholderEntry(type, locale) : null), [type, locale]);
  const real = rows && rows.length > 0;
  const entry: Entry | null = !b ? null : real ? (b.mode === 'single' ? (rows.find((r) => r.documentId === sampleId) ?? rows[0]!) : rows[0]!) : placeholder;
  const repeats = b?.mode === 'collection' && real ? rows.slice(1) : [];

  const canvas: CanvasModel = useMemo(
    () => ({ binding: draft.binding, fields: draft.fields, tree, entry, repeats, locale, fieldValues: canvasFieldValues(draft.fields, locale) }),
    [draft.binding, draft.fields, tree, entry, repeats, locale],
  );

  // ---- builder model ----
  const addField = useCallback((name: string, field: ComposedField) => setDraftState((d) => ({ ...d, fields: { ...d.fields, [name]: field } })), []);
  const model: BuilderModel = {
    draft,
    setDraft,
    types,
    type,
    readOnly,
    nameLocked: stored !== null,
    locales: meta.locales,
    pageBlocks,
    addField,
    fieldUsage: (name) => fieldUsage(tree, name),
  };

  // ---- Puck ----
  const collection = draft.binding?.mode === 'collection';
  const config = useMemo(
    () =>
      buildBuilderConfig({
        collection,
        token: TokenField,
        sources: SourcesField,
        showIf: ShowIfField,
        allow: AllowField,
        render: elementRender,
        root: RootPreview,
        onPropsChange: (el: ComposedElement, next, prev, trigger) => {
          // Binding a Price to a money field: show the currency for `fixed`, a plain number for `market` (overridable).
          if (el !== 'Price' || trigger === 'load') return null;
          const src = (next.bind as Record<string, { from: string; path?: string }> | undefined)?.value;
          const before = (prev?.bind as Record<string, unknown> | undefined)?.value;
          if (src?.from !== 'entry' || JSON.stringify(src) === JSON.stringify(before)) return null;
          const f = typeRef.current?.fields.find((x) => x.name === src.path);
          const show = f ? showCurrencyFor(f) : undefined;
          return show === undefined || show === next.showCurrency ? null : { showCurrency: show };
        },
      }),
    // labels follow the admin language
    [collection, adminLocale], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const overrides = useMemo(
    () => ({
      header: () => createElement(BuilderHeader),
      fieldTypes,
      fields: ({ children, itemSelector }: { children: ReactNode; itemSelector?: unknown }) => (itemSelector ? children : createElement(BlockPanel)),
    }),
    [],
  );
  const dictionary = useMemo(() => puckDictionary(), [adminLocale]); // eslint-disable-line react-hooks/exhaustive-deps
  // Puck reads the config's drawer and slot rules once: switching single ⇄ list remounts it with the current data
  // (undo history starts again).
  const latest = useRef<BuilderPuckData>(initialData);
  const [mount, setMount] = useState({ key: 0, data: initialData, collection });
  if (mount.collection !== collection) setMount({ key: mount.key + 1, data: latest.current, collection });
  const onChange = useCallback((data: Data) => {
    latest.current = data as unknown as BuilderPuckData;
    setTree(puckToTree(latest.current));
  }, []);

  // ---- save ----
  const spec = useMemo(() => buildSpec(draft, tree), [draft, tree]);
  const dirty = stored === null || JSON.stringify(buildSpec(draftOf(stored), stored.tree)) !== JSON.stringify(spec);
  const [save, dispatch] = useReducer(saveReducer, initialSaveState);
  const [review, setReview] = useState<{ issues: string[]; summary: ChangeNote[]; breaking: ChangeNote[] } | null>(null);
  const pending = useRef<ComposedBlockSpec | null>(null);

  const openSave = () => {
    const issues = validateComposedSpec(spec).map((i) => formatIssue(i));
    setReview({ issues, summary: changeSummary(stored, spec), breaking: breakingNotes(stored, spec) });
  };

  useEffect(() => {
    if (save.status !== 'saving' || !pending.current) return;
    let live = true;
    const body = pending.current;
    saveBlock(body.name, body, { confirmBreaking: save.confirmBreaking }).then(
      (res) => {
        if (!live) return;
        setStored(res.spec);
        setDraftState((d) => ({ ...d, version: res.spec.version }));
        // A new block gets its URL without a router navigation: that would remount the page and drop the
        // "commit these files" card (Next keeps `history.replaceState` in sync with its router).
        if (!stored) window.history.replaceState(window.history.state, '', adminHref(`/settings/blocks/${encodeURIComponent(res.spec.name)}`));
        toast.success(t('blockBuilder.saved'));
        dispatch({ type: 'saved', files: res.files });
      },
      (error) => live && dispatch({ type: 'failed', error }),
    );
    return () => {
      live = false;
    };
  }, [save]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSave = () => {
    pending.current = spec;
    setReview(null);
    dispatch({ type: 'save' });
  };

  // ---- content type change: resets the binding; confirm when that loses settings or entry bindings ----
  const [typeChange, setTypeChange] = useState<{ apiId: string | null; notes: ResetNote[] } | null>(null);
  const applyType = (apiId: string | null) =>
    setDraftState((d) => {
      if (!apiId) {
        const { binding: _b, ...rest } = d;
        return { ...rest, category: d.category === 'data' ? 'basic' : d.category };
      }
      return { ...d, binding: { apiId, mode: d.binding?.mode ?? 'single' }, category: d.category === 'basic' ? 'data' : d.category };
    });

  // ---- leaving ----
  const [leaving, setLeaving] = useState(false);
  const warnOnUnload = dirty && !readOnly;
  useEffect(() => {
    if (!warnOnUnload) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [warnOnUnload]);
  const back = () => (dirty && !readOnly ? setLeaving(true) : navigate('/settings/blocks'));

  const sampleChoices = b?.mode === 'single' && rows ? rows.map((r) => ({ id: r.documentId, label: entryLabel(r as never, type) })) : [];
  const header: BuilderHeaderModel = {
    title: draft.label['en-US'] ?? '',
    name: draft.name,
    readOnly,
    dirty,
    saving: save.status === 'saving',
    types,
    apiId: draft.binding?.apiId ?? null,
    mode: draft.binding?.mode ?? 'single',
    samples: sampleChoices,
    sampleId: entry && real ? entry.documentId : null,
    locale,
    locales: meta.locales,
    onBack: back,
    onType: (apiId) => {
      if (apiId === (draft.binding?.apiId ?? null)) return;
      const notes = bindingResetNotes(draft.binding, tree);
      if (notes.length) setTypeChange({ apiId, notes });
      else applyType(apiId);
    },
    onMode: (mode) => setDraftState((d) => (d.binding ? { ...d, binding: { ...d.binding, mode } } : d)),
    onSample: setSampleId,
    onLocale: setLocale,
    onSave: openSave,
    onPuck: useCallback((get: ReturnType<typeof useGetPuck>) => {
      getPuck.current = get;
    }, []),
  };

  const sampleStatus = !b
    ? null
    : !type
      ? null
      : rows === null
        ? t('blockBuilder.samples.loading')
        : samples.error
          ? t('blockBuilder.samples.error', { message: errorText(samples.error) })
          : rows.length === 0
            ? t('blockBuilder.samples.none', { type: b.apiId })
            : t('blockBuilder.samples.count', { count: rows.length, type: b.apiId });

  const saveError = save.status === 'error' ? save.error : null;
  const breakingNow = save.status === 'confirm' ? breakingNotes(stored, pending.current ?? spec) : [];

  return (
    <div className="flex h-svh flex-col">
      {readOnly && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>{t('blocks.readOnly')}</AlertDescription>
        </Alert>
      )}
      {detail && detail.problems.length > 0 && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t('blockBuilder.problemsTitle')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {detail.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {saveError !== null && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t('blockBuilder.saveFailed')}</AlertTitle>
          <AlertDescription>
            <p>{errorText(saveError)}</p>
            {saveError instanceof ApiError && saveError.issues.length > 0 && (
              <ul className="list-disc pl-4">
                {saveError.issues.map((i, n) => (
                  <li key={n}>{formatIssue(i)}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
      {save.status === 'saved' && (
        <Alert variant="success" className="rounded-none border-x-0 border-t-0">
          <FileIcon aria-hidden="true" />
          <AlertTitle>{t('blockBuilder.savedTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('blockBuilder.commitFiles')}</p>
            <ul className="font-mono text-xs">
              {save.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="mt-1">{t('blockBuilder.savedHint')}</p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => dispatch({ type: 'cancel' })}>
              <XIcon aria-hidden="true" />
              {t('blockBuilder.dismiss')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {sampleStatus && (
        <p role="status" className="border-b border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
          {sampleStatus}
        </p>
      )}

      <Dialog open={review !== null} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('blockBuilder.review.title', { name: spec.name || t('blockBuilder.untitled') })}</DialogTitle>
            <DialogDescription>{review?.issues.length ? t('blockBuilder.review.invalid') : t('blockBuilder.review.description')}</DialogDescription>
          </DialogHeader>
          {review && review.issues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {review.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3 text-sm">
              {review?.summary.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {review.summary.map((n, i) => (
                    <li key={i}>{noteText(n)}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('blockBuilder.review.noChanges')}</p>
              )}
              {review && review.breaking.length > 0 && (
                <Alert variant="warning">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertTitle>{t('blockBuilder.review.breakingTitle')}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {review.breaking.map((n, i) => (
                        <li key={i}>{noteText(n)}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)}>
              {t('common.cancel')}
            </Button>
            {review && review.issues.length === 0 && <Button onClick={startSave}>{t('blockBuilder.save')}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={save.status === 'confirm'}
        onOpenChange={(o) => !o && save.status === 'confirm' && dispatch({ type: 'cancel' })}
        title={t('blockBuilder.inUse.title')}
        description={[
          t('blockBuilder.inUse.description', { count: save.status === 'confirm' ? save.pages : 0 }),
          ...breakingNow.map(noteText),
        ].join(' ')}
        confirmLabel={t('blockBuilder.inUse.confirm')}
        destructive
        onConfirm={() => dispatch({ type: 'confirm' })}
      />
      <ConfirmDialog
        open={typeChange !== null}
        onOpenChange={(o) => !o && setTypeChange(null)}
        title={t(typeChange?.apiId ? 'blockBuilder.typeChange.title' : 'blockBuilder.typeChange.removeTitle')}
        description={`${t('blockBuilder.typeChange.description')} ${(typeChange?.notes ?? [])
          .map((n) => t(`blockBuilder.typeChange.${n.key}`, n.count === undefined ? undefined : { count: n.count }))
          .join('; ')}.`}
        confirmLabel={t('blockBuilder.typeChange.confirm')}
        destructive
        onConfirm={() => typeChange && applyType(typeChange.apiId)}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={(o) => !o && setLeaving(false)}
        title={t('blockBuilder.leave.title')}
        description={t('blockBuilder.leave.description')}
        confirmLabel={t('blockBuilder.leave.confirm')}
        destructive
        onConfirm={() => navigate('/settings/blocks')}
      />

      <div className="min-h-0 flex-1">
        <BuilderContext.Provider value={model}>
          <CanvasContext.Provider value={canvas}>
            <BuilderHeaderContext.Provider value={header}>
              <Puck
                key={mount.key}
                config={config}
                data={mount.data as unknown as Data}
                onChange={onChange}
                overrides={overrides as never}
                permissions={readOnly ? READ_ONLY : undefined}
                iframe={{ enabled: true, syncHostStyles: true, waitForStyles: true }}
                dictionary={dictionary}
                height="100%"
              />
            </BuilderHeaderContext.Provider>
          </CanvasContext.Provider>
        </BuilderContext.Provider>
      </div>
    </div>
  );
}

type Loaded = { meta: Meta; types: ContentTypeDefinition[]; detail: BlockDetail | null };

function BuilderLoader({ name }: { name: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const navigate = useAdminNavigate();

  useEffect(() => {
    let live = true;
    invalidate('types');
    Promise.all([api<Meta>('/api/admin/meta'), loadContentTypes(), name === 'new' ? Promise.resolve(null) : getBlock(name)])
      .then(([meta, types, detail]) => live && setLoaded({ meta, types, detail }))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [name]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <ErrorAlert error={error instanceof ApiError && blockErrorMessageKey(error) ? new Error(errorText(error)) : (error as Error)} />
        <Button variant="outline" onClick={() => navigate('/settings/blocks')}>
          {t('blocks.back')}
        </Button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        <span className="sr-only">{t('blockBuilder.loading')}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  return <Builder meta={loaded.meta} types={loaded.types} detail={loaded.detail} />;
}

/** `/settings/blocks/:name` (or `new`): the full-screen drag-and-drop block builder. */
export function BlockEditor() {
  const { name = 'new' } = useAdminParams();
  // Saving a new block replaces the URL with its name: keep the open builder (and its "commit these files" card).
  const [initial] = useState(name);
  return <BuilderLoader name={initial} />;
}

