import { CopyIcon, FileTextIcon, LayoutTemplateIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { localizedText, slugToPath, validatePagePath } from '@opencloudcms/schema';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useCan } from '../lib/can';
import { getActiveLocale, t } from '../i18n';
import { useFormat } from '../i18n/hooks';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import { Link, useAdminNavigate } from '../lib/nav';
import { pickEditorLocale } from '../lib/locales';
import {
  baseErrorMessage,
  createPage,
  deletePage,
  detailTemplatesOf,
  duplicatePage,
  getBaseUsage,
  getShadowedPaths,
  isShadowedPath,
  listBases,
  listPages,
  listTruncation,
  pageErrorMessageKey,
  pagesTab,
  pageStatus,
  setDefaultBase,
  splitPagesList,
  typesWithoutTemplate,
  unpublishPage,
  type PageEntry,
} from '../lib/pages';
import type { ContentTypeDefinition, Meta } from '../lib/types';

const typeLabel = (ct: ContentTypeDefinition) => localizedText(ct.displayName as never, getActiveLocale(), ct.apiId);

/**
 * "New detail template" (spec §3): one template page per content type with a detail page; the types offered are
 * those without one. `initial`: a type to preselect (`/pages?tab=detail&newDetail=<apiId>`).
 */
function CreateDetailDialog({ locale, types, initial, onOpenChange, onCreated }: {
  locale: string;
  types: ContentTypeDefinition[];
  initial: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (p: PageEntry) => void;
}) {
  const [apiId, setApiId] = useState(() => (initial && types.some((ty) => ty.apiId === initial) ? initial : (types[0]?.apiId ?? '')));
  const chosen = types.find((ty) => ty.apiId === apiId);
  const [title, setTitle] = useState(() => (chosen ? t('pages.detail.defaultTitle', { type: typeLabel(chosen) }) : ''));
  const [titleEdited, setTitleEdited] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiId) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createPage({ title: title.trim(), kind: 'detail', detailApiId: apiId, locale }));
    } catch (err) {
      const key = pageErrorMessageKey(err);
      setError(key ? new Error(t(key)) : err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('pages.detail.create.title')}</DialogTitle>
            <DialogDescription>{t('pages.detail.create.description')}</DialogDescription>
          </DialogHeader>
          <ErrorAlert error={error} />
          {types.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pages.detail.create.noTypes')}</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="detail-type">{t('pages.detail.typeColumn')}</Label>
                <Select
                  value={apiId}
                  onValueChange={(v) => {
                    setApiId(v);
                    const ct = types.find((ty) => ty.apiId === v);
                    if (!titleEdited && ct) setTitle(t('pages.detail.defaultTitle', { type: typeLabel(ct) }));
                  }}
                >
                  <SelectTrigger id="detail-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((ty) => (
                      <SelectItem key={ty.apiId} value={ty.apiId}>
                        {typeLabel(ty)} <span className="font-mono text-xs text-muted-foreground">{ty.detailPage?.path}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="detail-title">{t('pages.create.titleLabel')}</Label>
                <Input
                  id="detail-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleEdited(true);
                  }}
                  required
                />
              </div>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !apiId || !title.trim()}>
              {busy ? t('pages.create.submitting') : t('pages.detail.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreatePageDialog({ locale, onOpenChange, onCreated }: { locale: string; onOpenChange: (open: boolean) => void; onCreated: (p: PageEntry) => void }) {
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('/');
  const [pathEdited, setPathEdited] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [shadowed, setShadowed] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void getShadowedPaths().then((l) => live && setShadowed(l));
    return () => {
      live = false;
    };
  }, []);
  const shadowedWarning = !pathError && isShadowedPath(path, shadowed);

  const onTitle = (v: string) => {
    setTitle(v);
    if (!pathEdited) setPath(slugToPath(v));
    setPathError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validatePagePath(path);
    if (!check.ok) {
      setPathError(t(check.code === 'path_reserved' ? 'pages.errors.pathReserved' : 'pages.errors.invalidPath'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await createPage({ title: title.trim(), path, locale }));
    } catch (err) {
      const key = pageErrorMessageKey(err);
      if (key) setPathError(t(key));
      else setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('pages.create.title')}</DialogTitle>
            <DialogDescription>{t('pages.create.description', { locale })}</DialogDescription>
          </DialogHeader>
          <ErrorAlert error={error} />
          <div className="space-y-2">
            <Label htmlFor="page-title">{t('pages.create.titleLabel')}</Label>
            <Input id="page-title" value={title} onChange={(e) => onTitle(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="page-path">{t('pages.create.pathLabel')}</Label>
            <Input
              id="page-path"
              value={path}
              className="font-mono"
              aria-invalid={pathError ? true : undefined}
              aria-describedby="page-path-help"
              onChange={(e) => {
                setPath(e.target.value);
                setPathEdited(true);
                setPathError(null);
              }}
            />
            <p id="page-path-help" role={pathError ? 'alert' : undefined} className={pathError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {pathError ?? t('pages.create.pathHelp')}
            </p>
            {shadowedWarning && (
              <p role="status" className="text-sm text-warning">
                {t('pages.create.pathShadowed')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? t('pages.create.submitting') : t('pages.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "New base page": a title only (a base page has no path). */
function CreateBaseDialog({ locale, onOpenChange, onCreated }: { locale: string; onOpenChange: (open: boolean) => void; onCreated: (p: PageEntry) => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await createPage({ title: title.trim(), kind: 'base', locale }));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('pages.base.create.title')}</DialogTitle>
            <DialogDescription>{t('pages.base.create.description', { locale })}</DialogDescription>
          </DialogHeader>
          <ErrorAlert error={error} />
          <div className="space-y-2">
            <Label htmlFor="base-title">{t('pages.create.titleLabel')}</Label>
            <Input id="base-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? t('pages.create.submitting') : t('pages.base.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Message of a failed base page action: the base page rules (409 lists the pages using it), else the error. */
const failure = (e: unknown) => baseErrorMessage(e) ?? (e instanceof Error ? e.message : String(e));

export function Pages() {
  const { formatDateTime } = useFormat();
  const can = useCan();
  const navigate = useAdminNavigate();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [locale, setLocale] = useState('');
  const [pages, setPages] = useState<PageEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PageEntry | null>(null);
  const search = useSearchParams();
  const newDetail = search.get('newDetail');
  const tab = newDetail ? 'detail' : pagesTab(search.get('tab'));
  const [templates, setTemplates] = useState<PageEntry[] | null>(null);
  const [types, setTypes] = useState<ContentTypeDefinition[]>([]);
  const [bases, setBases] = useState<PageEntry[] | null>(null);
  const [usage, setUsage] = useState<Record<string, number | null>>({});
  const [forcing, setForcing] = useState<{ entry: PageEntry; message: string } | null>(null);

  useEffect(() => {
    const loadMeta = () =>
      api<Meta>('/api/admin/meta')
        .then((m) => {
          setMeta(m);
          setLocale((l) => pickEditorLocale(l, m.locales, m.defaultLocale));
        })
        .catch(setError);
    const loadTypes = () => api<{ data: ContentTypeDefinition[] }>('/api/admin/content-types').then((r) => setTypes(r.data), () => undefined);
    loadMeta();
    void loadTypes();
    window.addEventListener('opencloudcms:schema-changed', loadMeta);
    window.addEventListener('opencloudcms:schema-changed', loadTypes);
    return () => {
      window.removeEventListener('opencloudcms:schema-changed', loadMeta);
      window.removeEventListener('opencloudcms:schema-changed', loadTypes);
    };
  }, []);
  // `?newDetail=<apiId>` (from a content type page) opens "New detail template" with that type.
  useEffect(() => {
    if (newDetail && can('content.create')) setCreating(true);
  }, [newDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => {
    if (!locale) return;
    // The page list also holds base pages: they are listed on their own tab (from the bases endpoint).
    Promise.all([listPages(locale), listBases()]).then(([r, b]) => {
      const own = splitPagesList(r.data);
      const tpl = detailTemplatesOf(r.data);
      setPages(own);
      setTemplates(tpl);
      setTotal(Math.max(own.length, r.total - b.length - tpl.length));
      setBases(b);
      void Promise.all(b.map((x) => getBaseUsage(x.documentId).then((u) => u.count, () => null))).then((counts) =>
        setUsage(Object.fromEntries(b.map((x, i) => [x.documentId, counts[i] ?? null]))),
      );
    }, setError);
  }, [locale]);
  useEffect(reload, [reload]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    try {
      await fn();
      toast.success(ok);
      reload();
    } catch (e) {
      // Base page rules (in use, default, not published) as a toast listing the pages; anything else inline.
      if (e instanceof ApiError && baseErrorMessage(e)) toast.error(failure(e));
      else setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  /** Unpublish a base page; when pages use it, ask before forcing (they are then shown without it). */
  const unpublishBase = async (p: PageEntry) => {
    try {
      await unpublishPage(p.documentId);
      toast.success(t('pages.base.unpublished'));
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'base_in_use') setForcing({ entry: p, message: failure(e) });
      else toast.error(failure(e));
    }
  };

  const editorHref = (id: string) => `/pages/${id}?locale=${locale}`;
  const isBaseTab = tab === 'base';
  const isDetailTab = tab === 'detail';
  const typeOf = (apiId: unknown) => types.find((ty) => ty.apiId === apiId);
  const freeTypes = typesWithoutTemplate(types, templates ?? []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pages.title')}
        description={t('pages.description')}
        actions={
          <>
            <Select value={locale} onValueChange={(v) => { setPages(null); setLocale(v); }}>
              <SelectTrigger size="sm" aria-label={t('content.locale')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meta?.locales.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {can('content.create') && (
              <Button size="sm" onClick={() => setCreating(true)} disabled={!locale}>
                <PlusIcon aria-hidden="true" />
                {isBaseTab ? t('pages.base.new') : isDetailTab ? t('pages.detail.new') : t('pages.new')}
              </Button>
            )}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => navigate(v === 'base' ? '/pages?tab=base' : v === 'detail' ? '/pages?tab=detail' : '/pages')}>
        <TabsList>
          <TabsTrigger value="pages">{t('pages.tabPages')}</TabsTrigger>
          <TabsTrigger value="base">{t('pages.tabBases')}</TabsTrigger>
          <TabsTrigger value="detail">{t('pages.tabDetail')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <ErrorAlert error={error} />
      {isDetailTab ? (
        <>
          <p className="text-sm text-muted-foreground">{t('pages.detail.description')}</p>
          <Card className="py-0">
            <CardContent className="px-0">
              {templates === null ? (
                <div className="space-y-2 p-4" aria-hidden="true">
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : templates.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={LayoutTemplateIcon}
                    title={t('pages.detail.emptyTitle')}
                    description={t('pages.detail.emptyDescription')}
                    action={
                      can('content.create') && freeTypes.length ? (
                        <Button size="sm" onClick={() => setCreating(true)}>
                          {t('pages.detail.new')}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('pages.titleColumn')}</TableHead>
                      <TableHead>{t('pages.detail.typeColumn')}</TableHead>
                      <TableHead>{t('pages.detail.urlColumn')}</TableHead>
                      <TableHead>{t('content.statusColumn')}</TableHead>
                      <TableHead>{t('content.updatedColumn')}</TableHead>
                      <TableHead className="text-right">{t('pages.actionsColumn')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((p) => {
                      const status = pageStatus(p, p.publishedAt ? { publishedAt: p.publishedAt } : null);
                      const label = p.title || t('content.untitled');
                      const ct = typeOf(p.detailApiId);
                      return (
                        <TableRow key={p.documentId}>
                          <TableCell>
                            <Link to={editorHref(p.documentId)} className="font-medium underline-offset-4 hover:underline">
                              {label}
                            </Link>
                          </TableCell>
                          <TableCell>{ct ? typeLabel(ct) : <span className="font-mono">{String(p.detailApiId ?? '')}</span>}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {ct?.detailPage?.path ?? <span className="text-warning">{t('pages.detail.noDetailPage')}</span>}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatDateTime(p.updatedAt)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {can('content.delete') && (
                                <Button variant="ghost" size="icon" aria-label={t('pages.deleteAria', { title: label })} onClick={() => setDeleting(p)}>
                                  <Trash2Icon aria-hidden="true" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : isBaseTab ? (
        <>
          <p className="text-sm text-muted-foreground">{t('pages.base.description')}</p>
          <Card className="py-0">
            <CardContent className="px-0">
              {bases === null ? (
                <div className="space-y-2 p-4" aria-hidden="true">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : bases.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={LayoutTemplateIcon}
                    title={t('pages.base.emptyTitle')}
                    description={t('pages.base.emptyDescription')}
                    action={
                      can('content.create') ? (
                        <Button size="sm" onClick={() => setCreating(true)}>
                          {t('pages.base.new')}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('pages.titleColumn')}</TableHead>
                      <TableHead>{t('content.statusColumn')}</TableHead>
                      <TableHead>{t('pages.base.usageColumn')}</TableHead>
                      <TableHead>{t('content.updatedColumn')}</TableHead>
                      <TableHead className="text-right">{t('pages.actionsColumn')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bases.map((p) => {
                      const status = pageStatus(p, p.publishedAt ? { publishedAt: p.publishedAt } : null);
                      const label = p.title || t('content.untitled');
                      const count = usage[p.documentId];
                      return (
                        <TableRow key={p.documentId}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Link to={editorHref(p.documentId)} className="font-medium underline-offset-4 hover:underline">
                                {label}
                              </Link>
                              {p.isDefault && <Badge variant="secondary">{t('pages.base.defaultBadge')}</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={status} />
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{count ?? '–'}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDateTime(p.updatedAt)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {can('content.publish') &&
                                (p.isDefault ? (
                                  <Button variant="ghost" size="sm" onClick={() => void act(() => setDefaultBase(null), t('pages.base.defaultCleared'))}>
                                    {t('pages.base.clearDefault')}
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={!p.publishedAt}
                                    title={p.publishedAt ? undefined : t('pages.errors.baseNotPublished')}
                                    onClick={() => void act(() => setDefaultBase(p.documentId), t('pages.base.defaultSet'))}
                                  >
                                    {t('pages.base.setDefault')}
                                  </Button>
                                ))}
                              {can('content.publish') && p.publishedAt && (
                                <Button variant="ghost" size="sm" onClick={() => void unpublishBase(p)}>
                                  {t('pages.base.unpublish')}
                                </Button>
                              )}
                              {can('content.delete') && (
                                <Button variant="ghost" size="icon" aria-label={t('pages.deleteAria', { title: label })} onClick={() => setDeleting(p)}>
                                  <Trash2Icon aria-hidden="true" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            {pages === null ? (
              <div className="space-y-2 p-4" aria-hidden="true">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : pages.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={FileTextIcon}
                  title={t('pages.emptyTitle')}
                  description={t('pages.emptyDescription')}
                  action={
                    can('content.create') ? (
                      <Button size="sm" onClick={() => setCreating(true)}>
                        {t('pages.new')}
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('pages.titleColumn')}</TableHead>
                    <TableHead>{t('pages.pathColumn')}</TableHead>
                    <TableHead>{t('content.statusColumn')}</TableHead>
                    <TableHead>{t('content.updatedColumn')}</TableHead>
                    <TableHead>{t('content.localeColumn')}</TableHead>
                    <TableHead className="text-right">{t('pages.actionsColumn')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.map((p) => {
                    const status = pageStatus(p, p.publishedAt ? { publishedAt: p.publishedAt } : null);
                    const label = p.title || t('content.untitled');
                    return (
                      <TableRow key={p.documentId}>
                        <TableCell>
                          <Link to={editorHref(p.documentId)} className="font-medium underline-offset-4 hover:underline">
                            {label}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">{p.path}</TableCell>
                        <TableCell>
                          <StatusBadge status={status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDateTime(p.updatedAt)}</TableCell>
                        <TableCell className="font-mono">{p.locale ?? locale}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {can('content.create') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t('pages.duplicateAria', { title: label })}
                                onClick={() => void act(() => duplicatePage(p.documentId, locale), t('pages.duplicated'))}
                              >
                                <CopyIcon aria-hidden="true" />
                              </Button>
                            )}
                            {can('content.delete') && (
                              <Button variant="ghost" size="icon" aria-label={t('pages.deleteAria', { title: label })} onClick={() => setDeleting(p)}>
                                <Trash2Icon aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      {!isBaseTab && !isDetailTab && pages && listTruncation(pages.length, total) && (
        <p className="text-sm text-muted-foreground">{t('pages.showing', { shown: pages.length, total })}</p>
      )}

      {creating && isBaseTab && (
        <CreateBaseDialog
          locale={locale}
          onOpenChange={(o) => !o && setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            navigate(editorHref(p.documentId));
          }}
        />
      )}
      {creating && isDetailTab && (
        <CreateDetailDialog
          locale={locale}
          types={freeTypes}
          initial={newDetail}
          onOpenChange={(o) => {
            if (o) return;
            setCreating(false);
            if (newDetail) navigate('/pages?tab=detail', { replace: true });
          }}
          onCreated={(p) => {
            setCreating(false);
            navigate(editorHref(p.documentId));
          }}
        />
      )}
      {creating && !isBaseTab && !isDetailTab && (
        <CreatePageDialog
          locale={locale}
          onOpenChange={(o) => !o && setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            navigate(editorHref(p.documentId));
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('pages.deleteTitle')}
        description={t('pages.deleteDescription', { title: deleting?.title || t('content.untitled') })}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={() => deleting && void act(() => deletePage(deleting.documentId), t('content.deleted'))}
      />
      <ConfirmDialog
        open={!!forcing}
        onOpenChange={(o) => !o && setForcing(null)}
        title={t('pages.base.forceTitle')}
        description={t('pages.base.forceDescription', { message: forcing?.message ?? '' })}
        confirmLabel={t('pages.base.forceConfirm')}
        destructive
        onConfirm={() => forcing && void act(() => unpublishPage(forcing.entry.documentId, { force: true }), t('pages.base.unpublished'))}
      />
    </div>
  );
}
