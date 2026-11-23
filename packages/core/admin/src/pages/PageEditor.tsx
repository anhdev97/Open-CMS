// Puck's stylesheet without its external font @import (rsms.me): the admin CSP allows only same-origin styles.
import '@puckeditor/core/no-external.css';
import { TriangleAlertIcon, XIcon } from 'lucide-react';
import { createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Puck, type Data, type Dictionary, type useGetPuck } from '@puckeditor/core';
import {
  adminFetcher,
  coreBlocks,
  defineBlocks,
  readPageContent,
  type BlockDefinition,
  type BlockField,
  type BlockRegistry,
  type PuckData,
} from '@opencloudcms/core/blocks';
import type { Locale } from '@opencloudcms/schema';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorAlert } from '../components/ErrorAlert';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { t } from '../i18n';
import { useLocale } from '../i18n/hooks';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import { useCan } from '../lib/can';
import { pickEditorLocale } from '../lib/locales';
import { useAdminNavigate, useAdminParams } from '../lib/nav';
import { getPage, getShadowedPaths, pageErrorMessageKey, pagePreviewUrl, publishPage, savePage, type PageEntry } from '../lib/pages';
import type { Meta } from '../lib/types';
import { BlocksContext } from '../page-editor/blocks-context';
import { ContentTypeField } from '../page-editor/ContentTypeField';
import { buildEditorConfig } from '../page-editor/editor-config';
import { EditorInfoContext, ResolvedContext, type EditorInfo } from '../page-editor/editor-context';
import { EditorHeader, HeaderContext, type HeaderModel } from '../page-editor/EditorHeader';
import { EntriesField } from '../page-editor/EntriesField';
import { EntryField } from '../page-editor/EntryPicker';
import { fromEditorData, previewProps, slotOverflows, toEditorData, unknownBlockTypes, type PageSeo } from '../page-editor/field-logic';
import { UNSAVED_STATES, useAutosave, usePreviewResolution } from '../page-editor/hooks';
import { ImageField } from '../page-editor/ImageField';
import { LinkField } from '../page-editor/LinkField';
import { fieldTypes } from '../page-editor/puck-fields';
import { TokenField } from '../page-editor/TokenField';
import { UnknownBlock } from '../page-editor/UnknownBlock';

const EMPTY: PuckData = { root: { props: {} }, content: [], zones: {} } as PuckData;
const READ_ONLY = { drag: false, duplicate: false, delete: false, edit: false, insert: false };
const RESOLVE_DEBOUNCE_MS = 300;
const fetcher = adminFetcher('');

let coreRegistry: BlockRegistry | null = null;
/** The project's blocks from `AdminApp`, else `defineBlocks(coreBlocks)` (built once). */
function useBlocks(): BlockRegistry {
  return useContext(BlocksContext) ?? (coreRegistry ??= defineBlocks(coreBlocks));
}

// Puck's own UI strings that the editor shows (the rest stay English).
const PUCK_KEYS = [
  'action-selectparent', 'action-drag', 'action-duplicate', 'action-delete', 'label-page', 'label-component',
  'outline-empty', 'outline-item-collapse', 'outline-item-expand', 'outline-header-title', 'outline-header-collapseall',
  'outline-item-duplicate', 'outline-item-delete', 'drawer-category-collapse', 'drawer-category-expand', 'drawer-category-other',
  'field-readonly', 'field-arrayitem-summary', 'field-arrayitem-duplicate', 'field-arrayitem-delete',
  'viewport-zoom-in', 'viewport-zoom-out', 'viewport-zoom-auto', 'viewport-toggle-menu', 'viewport-switch', 'viewport-switch-default',
  'plugin-blocks', 'plugin-outline', 'plugin-fields', 'plugin-components', 'loader-loading',
] as const;

/** Puck `dictionary` (`t` without vars leaves `{placeholders}` for Puck to fill). */
function puckDictionary(): Dictionary {
  const out: Record<string, string> = {};
  for (const k of PUCK_KEYS) {
    const msg = t(`pageEditor.puck.${k}`);
    if (msg !== `pageEditor.puck.${k}`) out[k] = msg;
  }
  return out as Dictionary;
}

function errorMessage(e: unknown): string {
  const key = pageErrorMessageKey(e);
  if (key) return t(key);
  return e instanceof Error ? e.message : String(e);
}

/** Canvas render of one block: data fields come from the latest preview resolution (see `previewProps`). */
function PreviewBlock({ def, render, props }: { def: BlockDefinition<any>; render: (p: Record<string, unknown>) => ReactElement; props: Record<string, unknown> }) {
  const resolved = useContext(ResolvedContext);
  return render(previewProps(def.fields as Record<string, BlockField>, props, resolved.get(String(props.id))));
}

interface EditorProps {
  documentId: string;
  locale: Locale;
  defaultLocale: Locale;
  locales: Locale[];
  entry: PageEntry;
}

function Editor({ documentId, locale, defaultLocale, locales, entry }: EditorProps) {
  const registry = useBlocks();
  const adminLocale = useLocale();
  const can = useCan();
  const navigate = useAdminNavigate();

  // The server falls back to the default locale: then this locale has no translation yet.
  const missing = (entry.locale ?? locale) !== locale;
  const stored = useMemo(() => readPageContent(entry.content, registry), [entry, registry]);
  const migration = !missing && stored.status === 'needs-migration';
  const readOnly = migration || !can('content.update');
  const canPublish = !migration && (can('content.update') || can('content.publish'));

  const [initial, setInitial] = useState<PuckData>(() =>
    toEditorData({ title: entry.title, path: entry.path, seo: entry.seo as PageSeo | null }, missing ? EMPTY : stored.data),
  );
  const [puckKey, setPuckKey] = useState(0);
  const [offerCopy, setOfferCopy] = useState(missing && stored.status === 'ok');
  const [publishing, setPublishing] = useState(false);
  const latest = useRef<PuckData>(initial);
  const storedSeo = entry.seo as PageSeo | null | undefined;
  const lastBody = useRef(JSON.stringify(fromEditorData(initial, registry, storedSeo)));
  const getPuck = useRef<ReturnType<typeof useGetPuck> | null>(null);

  const [shadowedPaths, setShadowedPaths] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void getShadowedPaths().then((l) => live && setShadowedPaths(l));
    return () => {
      live = false;
    };
  }, []);

  const unknownTypes = useMemo(() => unknownBlockTypes(initial, registry), [initial, registry]);

  const { autosave, state: saveState } = useAutosave<PuckData>({
    save: (data, ifMatch) => savePage(documentId, locale, fromEditorData(data, registry, storedSeo), ifMatch),
    debounceMs: 1500,
    ifMatch: entry.updatedAt,
  });

  // Preview: resolve data fields through the admin API, 300 ms after the last data-field change.
  const { resolved, schedule: scheduleResolve } = usePreviewResolution(registry, initial, fetcher, { locale, defaultLocale }, RESOLVE_DEBOUNCE_MS);

  const onChange = useCallback(
    (data: Data) => {
      const d = data as PuckData;
      latest.current = d;
      scheduleResolve(d);
      if (readOnly) return;
      const body = JSON.stringify(fromEditorData(d, registry, storedSeo));
      if (body === lastBody.current) return; // Puck also reports loads and selection-only updates
      lastBody.current = body;
      autosave.change(d);
    },
    [autosave, readOnly, registry, scheduleResolve, storedSeo],
  );

  // Puck 0.24 slots have no `max`: undo a drop that overfills a `b.slot({ max })`.
  const onAction = useCallback(
    (_action: unknown, next: { data: Data }, prev: { data: Data }) => {
      const over = slotOverflows(next.data as PuckData, registry);
      if (!over.length) return;
      const before = new Set(slotOverflows(prev.data as PuckData, registry).map((o) => `${o.id}:${o.slot}`));
      const fresh = over.find((o) => !before.has(`${o.id}:${o.slot}`));
      if (!fresh) return;
      toast.error(t('pageEditor.slotFull', { max: fresh.max }));
      setTimeout(() => {
        const puck = getPuck.current?.();
        if (!puck) return;
        const { history } = puck;
        if (history.histories[history.index]?.state?.data === next.data) history.back();
        else puck.dispatch({ type: 'setData', data: prev.data, recordHistory: false });
      }, 0);
    },
    [registry],
  );

  const config = useMemo(() => {
    const wrapRender = (name: string, render: (p: Record<string, unknown>) => ReactElement) => {
      const def = registry.get(name)!;
      return (props: Record<string, unknown>) => createElement(PreviewBlock, { def, render, props });
    };
    const c = buildEditorConfig(
      registry,
      {
        locale: adminLocale,
        customFields: { entry: EntryField, entries: EntriesField, link: LinkField, image: ImageField } as never,
        token: TokenField,
        contentType: ContentTypeField,
        unknown: ({ name }) => createElement(UnknownBlock, { name }),
        wrapRender,
      },
      unknownTypes,
    );
    for (const [key, cat] of Object.entries(c.categories ?? {})) {
      const title = t(`pageEditor.categories.${key}`);
      if (title !== `pageEditor.categories.${key}`) cat.title = title;
    }
    return c;
  }, [registry, adminLocale, unknownTypes]);

  const overrides = useMemo(() => ({ header: () => createElement(EditorHeader), fieldTypes }), []);
  const dictionary = useMemo(() => puckDictionary(), [adminLocale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving saves first; if edits are still not saved (error, conflict) the user must confirm losing them.
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const leave = useCallback(
    async (to: string) => {
      await autosave.flush();
      if (UNSAVED_STATES.includes(autosave.state)) setLeaveTo(to);
      else navigate(to);
    },
    [autosave, navigate],
  );

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      await autosave.flush();
      if (autosave.state === 'conflict' || autosave.state === 'error') {
        toast.error(t('pageEditor.publishNeedsSave'));
        return;
      }
      await publishPage(documentId);
      toast.success(t('pageEditor.published'));
      // Publishing leaves the draft's updatedAt alone; re-read it anyway so the next autosave's If-Match matches
      // the server (only when no save is in flight: that save's response carries the version).
      try {
        autosave.rebase((await getPage(documentId, locale)).updatedAt);
      } catch {
        // keep the current If-Match; a stale one surfaces as a conflict on the next save
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'unknown_block') {
        const names = e.issues.map((i) => (i as { path?: unknown[] }).path?.[0]).filter(Boolean).join(', ');
        toast.error(t('pageEditor.publishUnknownBlocks', { names }));
      } else toast.error(errorMessage(e));
    } finally {
      setPublishing(false);
    }
  }, [autosave, documentId, locale]);

  const copyFromDefault = () => {
    const { title, path, seo } = fromEditorData(latest.current, registry, storedSeo);
    const next = toEditorData({ title, path, seo }, stored.data);
    setOfferCopy(false);
    setInitial(next);
    setPuckKey((k) => k + 1);
    latest.current = next;
    lastBody.current = JSON.stringify(fromEditorData(next, registry, storedSeo));
    autosave.change(next);
  };

  const header: HeaderModel = {
    locale,
    locales,
    saveState,
    saveError: saveState === 'error' && autosave.error ? errorMessage(autosave.error) : null,
    readOnly,
    shadowedPaths,
    canPublish,
    publishing,
    onBack: () => void leave('/pages'),
    onLocaleChange: (l) => void leave(`/pages/${documentId}?locale=${encodeURIComponent(l)}`),
    onSave: () => void autosave.flush(),
    onPublish: () => void publish(),
    onViewOnWebsite: () => {
      const tab = window.open('', '_blank');
      void autosave.flush().then(() => {
        if (autosave.state === 'error' || autosave.state === 'conflict') toast.warning(t('pageEditor.previewNotSaved'));
        if (!tab) return;
        tab.opener = null;
        tab.location.href = pagePreviewUrl(documentId, locale);
      });
    },
    onPuck: useCallback((get: ReturnType<typeof useGetPuck>) => {
      getPuck.current = get;
    }, []),
  };
  const info: EditorInfo = useMemo(() => ({ documentId, locale, defaultLocale, readOnly }), [documentId, locale, defaultLocale, readOnly]);

  return (
    <div className="flex h-svh flex-col">
      {saveState === 'conflict' && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t('pageEditor.conflictTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('pageEditor.conflictDescription')}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => window.location.reload()}>
              {t('pageEditor.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {migration && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t('pageEditor.readOnlyTitle')}</AlertTitle>
          <AlertDescription>{t('pageEditor.readOnlyDescription')}</AlertDescription>
        </Alert>
      )}
      {!migration && readOnly && (
        <Alert className="rounded-none border-x-0 border-t-0">
          <AlertTitle>{t('pageEditor.viewOnly')}</AlertTitle>
        </Alert>
      )}
      {offerCopy && !readOnly && (
        <Alert className="rounded-none border-x-0 border-t-0">
          <AlertTitle>{t('pageEditor.missingTitle', { locale })}</AlertTitle>
          <AlertDescription>
            <p>{t('pageEditor.missingDescription', { locale, defaultLocale })}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={copyFromDefault}>
                {t('pageEditor.copyFrom', { defaultLocale })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOfferCopy(false)}>
                <XIcon aria-hidden="true" />
                {t('pageEditor.startEmpty')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      <ConfirmDialog
        open={leaveTo !== null}
        onOpenChange={(o) => !o && setLeaveTo(null)}
        title={t('pageEditor.leaveTitle')}
        description={t('pageEditor.leaveDescription')}
        confirmLabel={t('pageEditor.leaveConfirm')}
        destructive
        onConfirm={() => leaveTo !== null && navigate(leaveTo)}
      />
      <div className="min-h-0 flex-1">
        <EditorInfoContext.Provider value={info}>
          <ResolvedContext.Provider value={resolved}>
            <HeaderContext.Provider value={header}>
              <Puck
                key={puckKey}
                config={config}
                data={initial}
                onChange={onChange}
                onAction={onAction as never}
                overrides={overrides as never}
                permissions={readOnly ? READ_ONLY : undefined}
                iframe={{ enabled: true, syncHostStyles: true, waitForStyles: true }}
                dictionary={dictionary}
                height="100%"
              />
            </HeaderContext.Provider>
          </ResolvedContext.Provider>
        </EditorInfoContext.Provider>
      </div>
    </div>
  );
}

type Loaded = { meta: Meta; entry: PageEntry; locale: Locale };

function EditorLoader({ documentId, requested }: { documentId: string; requested: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const navigate = useAdminNavigate();

  useEffect(() => {
    let live = true;
    (async () => {
      const meta = await api<Meta>('/api/admin/meta');
      const locale = pickEditorLocale(requested, meta.locales, meta.defaultLocale) as Locale;
      const entry = await getPage(documentId, locale);
      if (live) setLoaded({ meta, entry, locale });
    })().catch((e) => live && setError(e instanceof ApiError && e.status === 404 ? new Error(t('pageEditor.notFound')) : (e as Error)));
    return () => {
      live = false;
    };
  }, [documentId, requested]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <ErrorAlert error={error} />
        <Button variant="outline" onClick={() => navigate('/pages')}>
          {t('pageEditor.backAria')}
        </Button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        <span className="sr-only">{t('pageEditor.loading')}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  return (
    <Editor
      documentId={documentId}
      locale={loaded.locale}
      defaultLocale={loaded.meta.defaultLocale as Locale}
      locales={loaded.meta.locales as Locale[]}
      entry={loaded.entry}
    />
  );
}

/** `/pages/:documentId?locale=`: full-screen Puck editor for one locale of a page. */
export function PageEditor() {
  const { documentId = '' } = useAdminParams();
  const requested = useSearchParams().get('locale');
  return <EditorLoader key={`${documentId}:${requested ?? ''}`} documentId={documentId} requested={requested} />;
}

