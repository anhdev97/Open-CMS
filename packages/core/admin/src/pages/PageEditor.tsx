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
  normalizePageRichText,
  readPageContent,
  type BlockDefinition,
  type BlockRegistry,
  type DetailPaths,
  type Entry,
  type PuckData,
} from '@opencloudcms/core/blocks';
import type { Locale, PageKind, PageLayout, ThemeDefinition } from '@opencloudcms/schema';
import { DeviceMemory, ViewportBreakpoint, deviceUi, deviceViewports } from '../block-builder/style/DeviceToggle';
import { CanvasFrame, ThemeProvider, loadTheme } from '../block-builder/style/theme-context';
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
import {
  baseErrorMessage,
  getBaseUsage,
  getPage,
  getShadowedPaths,
  listBases,
  pageErrorMessageKey,
  pagePreviewUrl,
  previewDetailUrl,
  publishPage,
  savePage,
  type PageEntry,
} from '../lib/pages';
import type { Meta } from '../lib/types';
import { BasePublishDialog, baseRegionNames, structureViolation, type BaseOption } from '../page-editor/base-fields';
import { BaseFrame } from '../page-editor/BaseFrame';
import { BlocksContext } from '../page-editor/blocks-context';
import { ContentTypeField } from '../page-editor/ContentTypeField';
import { PAGE_CUSTOM_FIELDS } from '../page-editor/custom-fields';
import { entryLabel, invalidate, loadBase, loadContentType } from '../page-editor/data';
import type { ContentTypeDefinition } from '../lib/types';
import { buildEditorConfig, pageBuilderPalette } from '../page-editor/editor-config';
import { PaletteContext, PaletteDrawer } from '../components/PaletteSearch';
import { BaseContext, EditorInfoContext, ResolvedContext, type EditorInfo } from '../page-editor/editor-context';
import { EditorHeader, HeaderContext, type HeaderModel } from '../page-editor/EditorHeader';
import {
  canvasProps,
  fromEditorData,
  readRootRegions,
  rootPropsToLayout,
  slotOverflows,
  toEditorData,
  unknownBlockTypes,
  type PageSeo,
} from '../page-editor/field-logic';
import { UNSAVED_STATES, useAutosave, useBasePage, usePreviewResolution } from '../page-editor/hooks';
import { fieldTypes } from '../page-editor/puck-fields';
import { TokenField } from '../page-editor/TokenField';
import { UnknownBlock } from '../page-editor/UnknownBlock';

const EMPTY: PuckData = { root: { props: {} }, content: [], zones: {} } as PuckData;
const READ_ONLY = { drag: false, duplicate: false, delete: false, edit: false, insert: false };
const RESOLVE_DEBOUNCE_MS = 300;
const fetcher = adminFetcher('');
/** Entries offered by a detail template's "Preview entry" select. */
const PREVIEW_ENTRIES = 20;

/** Published entries first (newest first), then drafts: the default preview entry is the latest published one. */
function previewOrder(rows: Entry[]): Entry[] {
  const at = (e: Entry) => (typeof e.publishedAt === 'string' ? Date.parse(e.publishedAt) : NaN);
  return [...rows].sort((a, b) => {
    const pa = at(a);
    const pb = at(b);
    if (Number.isNaN(pa) !== Number.isNaN(pb)) return Number.isNaN(pa) ? 1 : -1;
    return Number.isNaN(pa) ? 0 : pb - pa;
  });
}

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
  const base = baseErrorMessage(e);
  if (base) return base;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Canvas render of one block: data fields come from the latest preview resolution; composed (and `usesLocale`)
 * blocks render in the page's content `locale`, like the website (see `canvasProps`).
 */
function PreviewBlock({
  def,
  render,
  props,
  locale,
}: {
  def: BlockDefinition<any>;
  render: (p: Record<string, unknown>) => ReactElement;
  props: Record<string, unknown>;
  locale: Locale;
}) {
  const resolved = useContext(ResolvedContext);
  return render(canvasProps(def, props, resolved.get(String(props.id)), locale));
}

interface EditorProps {
  documentId: string;
  locale: Locale;
  defaultLocale: Locale;
  locales: Locale[];
  entry: PageEntry;
  theme: ThemeDefinition | null;
  /** Base pages offered by the `Base page` root field (pages only). */
  bases: readonly BaseOption[];
}

function Editor({ documentId, locale, defaultLocale, locales, entry, theme, bases }: EditorProps) {
  const registry = useBlocks();
  const adminLocale = useLocale();
  const can = useCan();
  const navigate = useAdminNavigate();
  const kind: PageKind = entry.kind === 'base' ? 'base' : entry.kind === 'detail' ? 'detail' : 'page';
  const detailApiId = kind === 'detail' && typeof entry.detailApiId === 'string' ? entry.detailApiId : null;

  // The server falls back to the default locale: then this locale has no translation yet.
  const missing = (entry.locale ?? locale) !== locale;
  // Rich text reaches Puck only normalized (its loading fallbacks write the HTML they get unsanitized):
  // `readPageContent` does it for `ok`; a page that needs migration is shown read-only and never saved back.
  const stored = useMemo(() => {
    const s = readPageContent(entry.content, registry);
    // Replaced base page regions (root `region__<name>`) are read like the content.
    return s.status === 'needs-migration' ? { ...s, data: normalizePageRichText(s.data, registry) } : { ...s, data: readRootRegions(s.data, registry) };
  }, [entry, registry]);
  const migration = !missing && stored.status === 'needs-migration';
  const readOnly = migration || !can('content.update');
  const canPublish = !migration && (can('content.update') || can('content.publish'));

  const [initial, setInitial] = useState<PuckData>(() =>
    toEditorData({ title: entry.title, path: entry.path, seo: entry.seo as PageSeo | null, layout: entry.layout ?? null }, missing ? EMPTY : stored.data, kind),
  );
  const [puckKey, setPuckKey] = useState(0);
  const [offerCopy, setOfferCopy] = useState(missing && stored.status === 'ok');
  const [publishing, setPublishing] = useState(false);
  const latest = useRef<PuckData>(initial);
  const storedSeo = entry.seo as PageSeo | null | undefined;
  const lastBody = useRef(JSON.stringify(fromEditorData(initial, registry, storedSeo, kind)));
  // The page's base choice (document-level, saved with every locale), followed live for the canvas frame.
  const [layout, setLayout] = useState<PageLayout>(kind !== 'base' ? (entry.layout ?? null) : null);
  const lastLayout = useRef(JSON.stringify(layout));
  const base = useBasePage({ kind, layout, registry, fetcher, locale, defaultLocale, load: loadBase });
  // Region modes saved are those of the current base page once it is known (modes left from another base are dropped).
  const knownRegions = useRef<readonly string[] | null>(null);
  knownRegions.current = base.status === 'ok' ? base.regions : null;
  const [confirmPublish, setConfirmPublish] = useState(false);
  const getPuck = useRef<ReturnType<typeof useGetPuck> | null>(null);

  const [shadowedPaths, setShadowedPaths] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void getShadowedPaths().then((l) => live && setShadowedPaths(l));
    return () => {
      live = false;
    };
  }, []);

  // Detail paths: the template's URL pattern, and the warning on pages that hide a detail URL (spec §3 routing 4).
  const [detailPaths, setDetailPaths] = useState<DetailPaths>({});
  useEffect(() => {
    let live = true;
    void fetcher.detailPaths?.().then((p) => live && setDetailPaths(p), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Detail templates: the entry the canvas renders (default: the latest published one).
  const [previewType, setPreviewType] = useState<ContentTypeDefinition | null>(null);
  const [previewEntries, setPreviewEntries] = useState<Entry[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  useEffect(() => {
    if (!detailApiId) return;
    let live = true;
    void loadContentType(detailApiId).then((ct) => live && setPreviewType(ct), () => undefined);
    void fetcher.query(detailApiId, { limit: PREVIEW_ENTRIES, sort: 'publishedAt:desc', filter: {} }, locale).then(
      (rows) => live && setPreviewEntries(previewOrder(rows)),
      () => live && setPreviewEntries([]),
    );
    return () => {
      live = false;
    };
  }, [detailApiId, locale]);
  const previewEntry = previewEntries.find((e) => e.documentId === previewId) ?? previewEntries[0] ?? null;
  const routeEntry = useMemo(() => (detailApiId && previewEntry ? { apiId: detailApiId, entry: previewEntry } : null), [detailApiId, previewEntry]);

  const unknownTypes = useMemo(() => unknownBlockTypes(initial, registry), [initial, registry]);

  const { autosave, state: saveState } = useAutosave<PuckData>({
    save: (data, ifMatch) => savePage(documentId, locale, { ...fromEditorData(data, registry, storedSeo, kind, knownRegions.current) }, ifMatch),
    debounceMs: 1500,
    ifMatch: entry.updatedAt,
  });

  // Preview: resolve data fields through the admin API, 300 ms after the last data-field change.
  const { resolved, schedule: scheduleResolve } = usePreviewResolution(registry, initial, fetcher, { locale, defaultLocale, routeEntry }, RESOLVE_DEBOUNCE_MS);

  const onChange = useCallback(
    (data: Data) => {
      const d = data as PuckData;
      latest.current = d;
      scheduleResolve(d);
      if (kind !== 'base') {
        const next = rootPropsToLayout((d.root?.props ?? {}) as Record<string, unknown>);
        const key = JSON.stringify(next);
        if (key !== lastLayout.current) {
          lastLayout.current = key;
          setLayout(next);
        }
      }
      if (readOnly) return;
      const body = JSON.stringify(fromEditorData(d, registry, storedSeo, kind, knownRegions.current));
      if (body === lastBody.current) return; // Puck also reports loads and selection-only updates
      lastBody.current = body;
      autosave.change(d);
    },
    [autosave, readOnly, registry, scheduleResolve, storedSeo, kind],
  );

  // Puck 0.24 slots have no `max` and drop zones cannot count: undo a drop that overfills a `b.slot({ max })` or
  // breaks the page structure (a base page holds one layout block at its root; pages hold none).
  const onAction = useCallback(
    (_action: unknown, next: { data: Data }, prev: { data: Data }) => {
      const nextData = next.data as PuckData;
      const prevData = prev.data as PuckData;
      let message: string | null = null;
      const over = slotOverflows(nextData, registry);
      if (over.length) {
        const before = new Set(slotOverflows(prevData, registry).map((o) => `${o.id}:${o.slot}`));
        const fresh = over.find((o) => !before.has(`${o.id}:${o.slot}`));
        if (fresh) message = t('pageEditor.slotFull', { max: fresh.max });
      }
      if (!message) {
        const broken = structureViolation(kind, nextData, registry);
        if (broken && broken !== structureViolation(kind, prevData, registry)) message = t(broken);
      }
      if (!message) return;
      toast.error(message);
      setTimeout(() => {
        const puck = getPuck.current?.();
        if (!puck) return;
        const { history } = puck;
        if (history.histories[history.index]?.state?.data === next.data) history.back();
        else puck.dispatch({ type: 'setData', data: prev.data, recordHistory: false });
      }, 0);
    },
    [registry, kind],
  );

  // A base page the page points at that is no longer listed still shows in the select (the server refuses it on save).
  const baseOptions = useMemo(() => {
    const id = kind !== 'base' ? entry.layout?.baseId : null;
    return id && !bases.some((b) => b.documentId === id) ? [...bases, { documentId: id, title: t('pageEditor.root.baseUnknown') }] : bases;
  }, [bases, entry, kind]);

  const regionsOf = useCallback(
    async (baseId: string) => {
      // null: no such base page (Default: none set); a base that cannot frame pages has no regions to choose.
      const b = await loadBase(baseId, locale);
      return b ? (baseRegionNames(b.content, registry) ?? []) : null;
    },
    [locale, registry],
  );

  const config = useMemo(() => {
    const wrapRender = (name: string, render: (p: Record<string, unknown>) => ReactElement) => {
      const def = registry.get(name)!;
      return (props: Record<string, unknown>) => createElement(PreviewBlock, { def, render, props, locale });
    };
    const c = buildEditorConfig(
      registry,
      {
        locale: adminLocale,
        customFields: PAGE_CUSTOM_FIELDS,
        token: TokenField,
        contentType: ContentTypeField,
        unknown: ({ name }) => createElement(UnknownBlock, { name }),
        wrapRender,
        kind,
        bases: baseOptions,
        regionsOf,
        baseFrame: BaseFrame,
      },
      unknownTypes,
    );
    for (const [key, cat] of Object.entries(c.categories ?? {})) {
      const title = t(`pageEditor.categories.${key}`);
      if (title !== `pageEditor.categories.${key}`) cat.title = title;
    }
    return c;
  }, [registry, adminLocale, locale, unknownTypes, kind, baseOptions, regionsOf]);

  // Palette search above the block list (spec §3).
  const palette = useMemo(() => pageBuilderPalette(config, registry, kind), [config, registry, kind]);
  const overrides = useMemo(
    () => ({ header: () => createElement(EditorHeader), puck: ViewportBreakpoint, iframe: CanvasFrame, fieldTypes, drawer: PaletteDrawer }),
    [],
  );
  const dictionary = useMemo(() => puckDictionary(), [adminLocale]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewports = useMemo(() => deviceViewports(), [adminLocale]); // eslint-disable-line react-hooks/exhaustive-deps
  // The device chosen last, so a remount ("copy from default") keeps the canvas width.
  const device = useRef<{ current?: number }>({}).current;
  const ui = useMemo(() => deviceUi(device.current), [puckKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      toast.success(t(kind === 'base' ? 'pageEditor.base.published' : 'pageEditor.published'));
      if (kind === 'base') invalidate('base:');
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
  }, [autosave, documentId, locale, kind]);

  const copyFromDefault = () => {
    const { title, path, seo, layout: own } = fromEditorData(latest.current, registry, storedSeo, kind);
    const next = toEditorData({ title, path, seo, layout: own ?? null }, stored.data, kind);
    setOfferCopy(false);
    setInitial(next);
    setPuckKey((k) => k + 1);
    latest.current = next;
    lastBody.current = JSON.stringify(fromEditorData(next, registry, storedSeo, kind));
    autosave.change(next);
  };

  const header: HeaderModel = {
    kind,
    locale,
    locales,
    saveState,
    saveError: saveState === 'error' && autosave.error ? errorMessage(autosave.error) : null,
    readOnly,
    shadowedPaths,
    canPublish,
    publishing,
    detail: detailApiId
      ? {
          apiId: detailApiId,
          pattern: detailPaths[detailApiId]?.path ?? null,
          entries: previewEntries.map((e) => ({ id: String(e.documentId), label: entryLabel(e as never, previewType) })),
          entryId: previewEntry ? String(previewEntry.documentId) : null,
          onEntry: setPreviewId,
        }
      : null,
    detailPaths,
    onBack: () => void leave(kind === 'base' ? '/pages?tab=base' : kind === 'detail' ? '/pages?tab=detail' : '/pages'),
    onLocaleChange: (l) => void leave(`/pages/${documentId}?locale=${encodeURIComponent(l)}`),
    onSave: () => void autosave.flush(),
    onPublish: () => (kind === 'base' ? setConfirmPublish(true) : void publish()),
    onViewOnWebsite: () => {
      const tab = window.open('', '_blank');
      void autosave.flush().then(() => {
        if (autosave.state === 'error' || autosave.state === 'conflict') toast.warning(t('pageEditor.previewNotSaved'));
        if (!tab) return;
        tab.opener = null;
        // A detail template previews the chosen entry's detail URL.
        const at = detailApiId && previewEntry ? previewDetailUrl(detailPaths[detailApiId], previewEntry) : null;
        tab.location.href = pagePreviewUrl(documentId, locale, at ?? undefined);
      });
    },
    onPuck: useCallback((get: ReturnType<typeof useGetPuck>) => {
      getPuck.current = get;
    }, []),
  };
  const info: EditorInfo = useMemo(
    () => ({ documentId, locale, defaultLocale, readOnly, ...(detailApiId ? { routeApiId: detailApiId } : {}) }),
    [documentId, locale, defaultLocale, readOnly, detailApiId],
  );

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
      {kind === 'base' && (
        <BasePublishDialog
          documentId={documentId}
          open={confirmPublish}
          loadUsage={getBaseUsage}
          onOpenChange={setConfirmPublish}
          onConfirm={() => void publish()}
        />
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
        <ThemeProvider theme={theme}>
          <DeviceMemory.Provider value={device}>
            <EditorInfoContext.Provider value={info}>
              <BaseContext.Provider value={base}>
                <ResolvedContext.Provider value={resolved}>
                  <HeaderContext.Provider value={header}>
                    <PaletteContext.Provider value={palette}>
                      <Puck
                        key={puckKey}
                        config={config}
                        data={initial}
                        onChange={onChange}
                        onAction={onAction as never}
                        overrides={overrides as never}
                        permissions={readOnly ? READ_ONLY : undefined}
                        iframe={{ enabled: true, syncHostStyles: true, waitForStyles: true }}
                        viewports={viewports}
                        ui={ui}
                        dictionary={dictionary}
                        height="100%"
                      />
                    </PaletteContext.Provider>
                  </HeaderContext.Provider>
                </ResolvedContext.Provider>
              </BaseContext.Provider>
            </EditorInfoContext.Provider>
          </DeviceMemory.Provider>
        </ThemeProvider>
      </div>
    </div>
  );
}

type Loaded = { meta: Meta; entry: PageEntry; locale: Locale; theme: ThemeDefinition | null; bases: BaseOption[] };

function EditorLoader({ documentId, requested }: { documentId: string; requested: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const navigate = useAdminNavigate();

  useEffect(() => {
    let live = true;
    // The theme only adds canvas colours and brand swatches: the editor opens without it.
    const theme = loadTheme();
    // Base pages may have changed since the editor was last open.
    invalidate('base:');
    (async () => {
      const meta = await api<Meta>('/api/admin/meta');
      const locale = pickEditorLocale(requested, meta.locales, meta.defaultLocale) as Locale;
      const entry = await getPage(documentId, locale);
      // The `Base page` select of a page; without the list it still offers Default and None.
      const bases = entry.kind === 'base' ? [] : await listBases().catch(() => []);
      const projectTheme = await theme;
      if (live) setLoaded({ meta, entry, locale, theme: projectTheme, bases });
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
      theme={loaded.theme}
      bases={loaded.bases}
    />
  );
}

/** `/pages/:documentId?locale=`: full-screen Puck editor for one locale of a page. */
export function PageEditor() {
  const { documentId = '' } = useAdminParams();
  const requested = useSearchParams().get('locale');
  return <EditorLoader key={`${documentId}:${requested ?? ''}`} documentId={documentId} requested={requested} />;
}

