import { CopyIcon, FileTextIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { slugToPath, validatePagePath } from '@opencloudcms/schema';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useCan } from '../lib/can';
import { t } from '../i18n';
import { useFormat } from '../i18n/hooks';
import { api } from '../lib/api';
import { Link, useAdminNavigate } from '../lib/nav';
import { pickEditorLocale } from '../lib/locales';
import {
  createPage,
  deletePage,
  duplicatePage,
  getShadowedPaths,
  isShadowedPath,
  listPages,
  listTruncation,
  pageErrorMessageKey,
  pageStatus,
  type PageEntry,
} from '../lib/pages';
import type { Meta } from '../lib/types';

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

  useEffect(() => {
    const loadMeta = () =>
      api<Meta>('/api/admin/meta')
        .then((m) => {
          setMeta(m);
          setLocale((l) => pickEditorLocale(l, m.locales, m.defaultLocale));
        })
        .catch(setError);
    loadMeta();
    window.addEventListener('opencloudcms:schema-changed', loadMeta);
    return () => window.removeEventListener('opencloudcms:schema-changed', loadMeta);
  }, []);

  const reload = useCallback(() => {
    if (!locale) return;
    listPages(locale).then((r) => {
      setPages(r.data);
      setTotal(r.total);
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
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const editorHref = (id: string) => `/pages/${id}?locale=${locale}`;

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
                {t('pages.new')}
              </Button>
            )}
          </>
        }
      />
      <ErrorAlert error={error} />
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
      {pages && listTruncation(pages.length, total) && (
        <p className="text-sm text-muted-foreground">{t('pages.showing', { shown: pages.length, total })}</p>
      )}

      {creating && (
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
    </div>
  );
}
