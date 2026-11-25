import { FileTextIcon, PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState } from '../../components/EmptyState';
import { ErrorAlert } from '../../components/ErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { PrivateLock } from '../../components/PrivateLock';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { t } from '../../i18n';
import { useFormat } from '../../i18n/hooks';
import { api } from '../../lib/api';
import { Link, useAdminNavigate } from '../../lib/nav';
import { canCreateEntries, contentPath, entryStatus, titleFieldOf, typeTitle, useContentType, useEditorLocale, type Entry } from './useEntry';

const PAGE_SIZE = 50;
type Filter = 'all' | 'published' | 'pending';

/** `/content/:apiId`: entries table with status filter, locale select, pagination and "New". */
export function ContentList({ apiId }: { apiId: string }) {
  const { formatDateTime } = useFormat();
  const { user } = useAuth();
  const navigate = useAdminNavigate();
  const { def, meta, error: loadError } = useContentType(apiId);
  const [locale, setLocale] = useEditorLocale(meta, def);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const can = (p: string) => user.permissions.includes(p as never);

  useEffect(() => {
    if (!locale || !def) return;
    let live = true;
    const q = new URLSearchParams({ locale, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (filter === 'published') q.set('status', 'published');
    if (filter === 'pending') q.set('workflow', 'in_review');
    api<{ data: Entry[]; meta: { total: number } }>(`/api/admin/content/${apiId}?${q.toString()}`).then(
      (r) => {
        if (!live) return;
        setEntries(r.data);
        setTotal(r.meta.total);
        setError(null);
      },
      (e) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [apiId, def, locale, filter, page]);

  if (!def || !meta) {
    return loadError ? (
      <ErrorAlert error={loadError} />
    ) : (
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const isPrivate = !!def.private;
  const titleField = titleFieldOf(def);
  const mayCreate = can('content.create') && canCreateEntries(def);
  const newTo = contentPath(apiId, ['new'], locale, meta.defaultLocale);
  const open = (e: Entry) => navigate(contentPath(apiId, [e.documentId], locale, meta.defaultLocale));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const count = total === 1 ? t('content.entryCountOne') : t('content.entryCount', { count: total });
  const filters: Filter[] = isPrivate ? [] : def.review && can('content.publish') ? ['all', 'published', 'pending'] : ['all', 'published'];
  const FILTER_LABEL: Record<Filter, string> = { all: 'content.filterAll', published: 'content.filterPublished', pending: 'content.filterPending' };

  return (
    <div className="space-y-6">
      <PageHeader
        title={typeTitle(def)}
        adornment={isPrivate ? <PrivateLock className="ml-2 size-5 align-[-0.125em]" /> : undefined}
        description={isPrivate ? (def.description ?? t('content.privateHint')) : def.description}
        actions={
          <>
            {filters.length > 0 && (
              <Select
                value={filter}
                onValueChange={(v) => {
                  setFilter(v as Filter);
                  setPage(0);
                }}
              >
                <SelectTrigger size="sm" aria-label={t('content.filter')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {filters.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(FILTER_LABEL[f])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!isPrivate && (
              <Select
                value={locale}
                onValueChange={(l) => {
                  setLocale(l);
                  setPage(0);
                }}
              >
                <SelectTrigger size="sm" aria-label={t('content.locale')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {meta.locales.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {can('settings.content-types') && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/settings/content-types/${def.apiId}`}>{t('content.editSchema')}</Link>
              </Button>
            )}
            {mayCreate && (
              <Button asChild size="sm">
                <Link to={newTo}>
                  <PlusIcon aria-hidden="true" />
                  {t('content.newEntry')}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <ErrorAlert error={error} />

      <Card className="py-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {count}
            {!isPrivate && <> · {t('content.showing', { locale, fallback: meta.defaultLocale })}</>}
          </p>
        </div>
        <CardContent className="px-0">
          {entries === null ? (
            <div className="space-y-2 p-4" aria-hidden="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : entries.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={FileTextIcon}
                title={t('content.emptyTitle')}
                description={mayCreate ? t('content.emptyDescription') : undefined}
                action={
                  mayCreate && filter === 'all' ? (
                    <Button asChild size="sm">
                      <Link to={newTo}>{t('content.newEntry')}</Link>
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{titleField ?? t('content.entryColumn')}</TableHead>
                  {!isPrivate && <TableHead>{t('content.localeColumn')}</TableHead>}
                  {!isPrivate && <TableHead>{t('content.statusColumn')}</TableHead>}
                  <TableHead>{t('content.updatedColumn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.documentId} className="cursor-pointer" onClick={() => open(e)}>
                    <TableCell>
                      <Link
                        to={contentPath(apiId, [e.documentId], locale, meta.defaultLocale)}
                        className="font-medium underline-offset-4 hover:underline"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {(titleField && e[titleField]) || <span className="text-muted-foreground">{t('content.untitled')}</span>}
                      </Link>
                    </TableCell>
                    {!isPrivate && <TableCell className="font-mono">{e.locale ?? t('content.noValue')}</TableCell>}
                    {!isPrivate && (
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={entryStatus(def, e)} />
                          {e.publishedAt && e.hasUnpublishedChanges && <StatusBadge status="changed" />}
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground">{e.updatedAt ? formatDateTime(e.updatedAt) : t('content.noValue')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {pages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
            <p className="text-sm text-muted-foreground">{t('content.pageOf', { page: page + 1, pages })}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                {t('content.previous')}
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                {t('content.next')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
