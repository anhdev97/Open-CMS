import { FileTextIcon, PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { FieldInput } from '../components/FieldInput';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Link, useAdminParams } from '../lib/nav';
import { localizedText } from '@opencms/schema';
import { getActiveLocale, t } from '../i18n';
import { useFormat } from '../i18n/hooks';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import type { ContentTypeDefinition, Meta } from '../lib/types';

type Entry = Record<string, any> & { documentId: string; status: string; publishedAt: string | null; hasUnpublishedChanges?: boolean };

/** Keyed by `apiId` so moving between content types starts from clean state. */
export function Content() {
  const { apiId = '' } = useAdminParams();
  return <ContentView key={apiId} apiId={apiId} />;
}

function ContentView({ apiId }: { apiId: string }) {
  const { formatDateTime } = useFormat();
  const [def, setDef] = useState<ContentTypeDefinition | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [locale, setLocale] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Bumped whenever the form is replaced from the server (open, locale switch), so the editor card remounts with
  // the new values; uncontrolled-text inputs such as JSON would otherwise keep showing the previous ones.
  const [formGen, setFormGen] = useState(0);

  useEffect(() => {
    api<Meta>('/api/admin/meta')
      .then((m) => {
        setMeta(m);
        setLocale((l) => l || m.defaultLocale);
      })
      .catch(setError);
    api<{ data: ContentTypeDefinition }>(`/api/admin/content-types/${apiId}`)
      .then((r) => setDef(r.data))
      .catch(setError);
  }, [apiId]);

  const reload = useCallback(() => {
    if (!locale) return;
    api<{ data: Entry[]; meta: { total: number } }>(`/api/admin/content/${apiId}?locale=${locale}&limit=50`)
      .then((r) => {
        setEntries(r.data);
        setTotal(r.meta.total);
      })
      .catch(setError);
  }, [apiId, locale]);
  useEffect(reload, [reload]);

  const titleField = def?.fields.find((f) => ['text', 'slug'].includes(f.kind))?.name;

  const openEntry = (entry: Entry | null) => {
    setEditing(entry ?? ({ documentId: '', status: 'draft', publishedAt: null } as Entry));
    setForm(entry ? Object.fromEntries(def!.fields.map((f) => [f.name, entry[f.name]])) : {});
    setFormGen((g) => g + 1);
    setError(null);
  };

  useEffect(() => {
    // Re-load the entry in the newly selected locale while editing.
    if (editing?.documentId) {
      api<{ data: Entry }>(`/api/admin/content/${apiId}/${editing.documentId}?locale=${locale}`)
        .then((r) => openEntry(r.data))
        .catch(setError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    try {
      await fn();
      toast.success(ok);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : e instanceof Error ? e : new Error(String(e)));
    }
  };

  const save = () =>
    act(async () => {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined));
      const r = editing!.documentId
        ? await api<{ data: Entry }>(`/api/admin/content/${apiId}/${editing!.documentId}?locale=${locale}`, { method: 'PATCH', json: body })
        : await api<{ data: Entry }>(`/api/admin/content/${apiId}?locale=${locale}`, { method: 'POST', json: body });
      setEditing(r.data);
    }, t('content.saved'));

  const refreshEditing = async (id: string) =>
    setEditing((await api<{ data: Entry }>(`/api/admin/content/${apiId}/${id}?locale=${locale}`)).data);
  const publish = (id: string) =>
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}/publish`, { method: 'POST' });
      await refreshEditing(id);
    }, t('content.published'));
  const unpublish = (id: string) =>
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}/unpublish`, { method: 'POST' });
      await refreshEditing(id);
    }, t('content.unpublished'));
  const remove = (id: string) =>
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}`, { method: 'DELETE' });
      setEditing(null);
    }, t('content.deleted'));

  if (!def) {
    return error ? (
      <ErrorAlert error={error} />
    ) : (
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const count = total === 1 ? t('content.entryCountOne') : t('content.entryCount', { count: total });

  return (
    <div className="space-y-6">
      <PageHeader
        title={localizedText(def.displayName, getActiveLocale(), def.apiId)}
        description={def.description}
        actions={
          <>
            <Select value={locale} onValueChange={setLocale}>
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
            <Button asChild variant="outline" size="sm">
              <Link to={`/settings/content-types?type=${def.apiId}`}>{t('content.editSchema')}</Link>
            </Button>
            <Button size="sm" onClick={() => openEntry(null)}>
              <PlusIcon aria-hidden="true" />
              {t('content.newEntry')}
            </Button>
          </>
        }
      />

      <ErrorAlert error={error} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card className="py-0">
          <div className="border-b px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {count} · {t('content.showing', { locale, fallback: meta?.defaultLocale ?? '' })}
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
                  description={t('content.emptyDescription')}
                  action={
                    <Button size="sm" onClick={() => openEntry(null)}>
                      {t('content.newEntry')}
                    </Button>
                  }
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{titleField ?? t('content.entryColumn')}</TableHead>
                    <TableHead>{t('content.localeColumn')}</TableHead>
                    <TableHead>{t('content.statusColumn')}</TableHead>
                    <TableHead>{t('content.updatedColumn')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.documentId} data-state={editing?.documentId === e.documentId ? 'selected' : undefined}>
                      <TableCell>
                        <Button variant="link" className="h-auto p-0" onClick={() => openEntry(e)}>
                          {(titleField && e[titleField]) || <span className="text-muted-foreground">{t('content.untitled')}</span>}
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono">{e.locale ?? t('content.noValue')}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={e.publishedAt ? 'published' : 'draft'} />
                          {e.publishedAt && e.hasUnpublishedChanges && <StatusBadge status="changed" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(e.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {editing && (
          <Card key={`${editing.documentId}:${formGen}`} role="region" aria-label={t('content.editorLabel')}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{editing.documentId ? t('content.editEntry') : t('content.newEntry')}</CardTitle>
              <span className="font-mono text-sm text-muted-foreground">{locale}</span>
            </CardHeader>
            <CardContent className="space-y-4">
              {def.fields.map((f) => {
                const id = `field-${f.id}`;
                return (
                  <div key={f.id} className="space-y-2">
                    <Label id={`${id}-label`} htmlFor={id}>
                      {f.label ?? f.name}
                      {f.required && (
                        <>
                          <span aria-hidden="true"> *</span>
                          <span className="sr-only"> {t('field.required')}</span>
                        </>
                      )}
                      {f.localizable && <Badge variant="outline">{locale}</Badge>}
                    </Label>
                    <FieldInput id={id} field={f} value={form[f.name]} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button onClick={save}>{t('content.saveDraft')}</Button>
                {editing.documentId && (
                  <Button variant="outline" onClick={() => publish(editing.documentId)}>
                    {t('content.publish')}
                  </Button>
                )}
                {editing.documentId && editing.publishedAt && (
                  <Button variant="outline" onClick={() => unpublish(editing.documentId)}>
                    {t('content.unpublish')}
                  </Button>
                )}
                <span className="grow" />
                {editing.documentId && (
                  <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                    {t('content.delete')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('content.deleteTitle')}
        description={t('content.deleteDescription')}
        confirmLabel={t('content.delete')}
        destructive
        onConfirm={() => editing && remove(editing.documentId)}
      />
    </div>
  );
}
