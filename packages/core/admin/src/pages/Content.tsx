import { FileTextIcon, PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { FieldInput } from '../components/FieldInput';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Textarea } from '../components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useAuth } from '../auth/AuthContext';
import { entryActions, formLocked, type EntryAction, type WorkflowState } from '../lib/entry-actions';
import { Link, useAdminParams } from '../lib/nav';
import { localizedText } from '@opencloudcms/schema';
import { getActiveLocale, t } from '../i18n';
import { useFormat } from '../i18n/hooks';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import { pickEditorLocale } from '../lib/locales';
import type { ContentTypeDefinition, Meta } from '../lib/types';

type WorkflowInfo = { state: WorkflowState; submittedBy: { id: string; name: string } | null; submittedAt: string | null; note: string | null };
type Entry = Record<string, any> & {
  documentId: string;
  status: string;
  publishedAt: string | null;
  hasUnpublishedChanges?: boolean;
  workflow?: WorkflowInfo | null;
};

const WORKFLOW_ERRORS = ['in_review_locked', 'invalid_transition', 'forbidden'];

/** Known workflow error codes get the active-locale message; anything else passes through. */
function workflowError(e: unknown): ApiError | Error {
  if (e instanceof ApiError && WORKFLOW_ERRORS.includes(e.code)) {
    return new ApiError(e.status, e.code, t(`content.errors.${e.code}`), e.issues, e.retryAfterSec);
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** Keyed by `apiId` so moving between content types starts from clean state. */
export function Content() {
  const { apiId = '' } = useAdminParams();
  return <ContentView key={apiId} apiId={apiId} />;
}

function ContentView({ apiId }: { apiId: string }) {
  const { formatDateTime } = useFormat();
  const { user } = useAuth();
  const [def, setDef] = useState<ContentTypeDefinition | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [locale, setLocale] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  // Bumped whenever the form is replaced from the server (open, locale switch), so the editor card remounts with
  // the new values; uncontrolled-text inputs such as JSON would otherwise keep showing the previous ones.
  const [formGen, setFormGen] = useState(0);

  useEffect(() => {
    // Meta is refetched when languages change; a now-disabled selected locale falls back to the default.
    const loadMeta = () =>
      api<Meta>('/api/admin/meta')
        .then((m) => {
          setMeta(m);
          setLocale((l) => pickEditorLocale(l, m.locales, m.defaultLocale));
        })
        .catch(setError);
    loadMeta();
    window.addEventListener('opencms:schema-changed', loadMeta);
    api<{ data: ContentTypeDefinition }>(`/api/admin/content-types/${apiId}`)
      .then((r) => setDef(r.data))
      .catch(setError);
    return () => window.removeEventListener('opencms:schema-changed', loadMeta);
  }, [apiId]);

  const reload = useCallback(() => {
    if (!locale) return;
    api<{ data: Entry[]; meta: { total: number } }>(`/api/admin/content/${apiId}?locale=${locale}&limit=50${pendingOnly ? '&workflow=in_review' : ''}`)
      .then((r) => {
        setEntries(r.data);
        setTotal(r.meta.total);
      })
      .catch(setError);
  }, [apiId, locale, pendingOnly]);
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
      setError(workflowError(e));
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
  const approve = (id: string) =>
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}/approve`, { method: 'POST' });
      await refreshEditing(id);
    }, t('content.approved'));
  const transition = (id: string, action: 'submit' | 'withdraw', ok: string) =>
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}/${action}`, { method: 'POST' });
      await refreshEditing(id);
    }, ok);
  const reject = (id: string) =>
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}/reject`, { method: 'POST', json: { note: rejectNote.trim() } });
      setRejecting(false);
      setRejectNote('');
      await refreshEditing(id);
    }, t('content.rejected'));
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

  const actionInput = editing && {
    review: !!def.review,
    workflow: editing.workflow ?? null,
    published: !!editing.publishedAt,
    permissions: user.permissions,
    userId: user.id,
  };
  const isNew = !!editing && !editing.documentId;
  const actions: EntryAction[] =
    !editing || !actionInput
      ? []
      : isNew
        ? user.permissions.includes('content.create') ? ['save'] : []
        : entryActions(actionInput);
  const locked = !!actionInput && !isNew && formLocked(actionInput);
  const rejection = editing?.workflow?.state === 'draft' && editing.workflow.note ? editing.workflow : null;
  const statusOf = (e: Entry) => (e.workflow?.state === 'in_review' && def.review ? 'in_review' : e.publishedAt ? 'published' : 'draft');

  const count = total === 1 ? t('content.entryCountOne') : t('content.entryCount', { count: total });

  return (
    <div className="space-y-6">
      <PageHeader
        title={localizedText(def.displayName, getActiveLocale(), def.apiId)}
        description={def.description}
        actions={
          <>
            {def.review && user.permissions.includes('content.publish') && (
              <Select value={pendingOnly ? 'pending' : 'all'} onValueChange={(v) => setPendingOnly(v === 'pending')}>
                <SelectTrigger size="sm" aria-label={t('content.filter')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('content.filterAll')}</SelectItem>
                  <SelectItem value="pending">{t('content.filterPending')}</SelectItem>
                </SelectContent>
              </Select>
            )}
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
            {user.permissions.includes('settings.content-types') && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/settings/content-types?type=${def.apiId}`}>{t('content.editSchema')}</Link>
              </Button>
            )}
            {user.permissions.includes('content.create') && (
              <Button size="sm" onClick={() => openEntry(null)}>
                <PlusIcon aria-hidden="true" />
                {t('content.newEntry')}
              </Button>
            )}
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
                    user.permissions.includes('content.create') && !pendingOnly ? (
                      <Button size="sm" onClick={() => openEntry(null)}>
                        {t('content.newEntry')}
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
                          <StatusBadge status={statusOf(e)} />
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
              {rejection && (
                <Alert variant="destructive" role="status">
                  <AlertTitle>{t('content.rejectedBanner', { name: rejection.submittedBy?.name ?? t('content.noValue') })}</AlertTitle>
                  <AlertDescription>{rejection.note}</AlertDescription>
                </Alert>
              )}
              {def.review && editing.workflow?.state === 'in_review' && (
                <Alert role="status">
                  <AlertTitle>
                    {t('content.inReviewBanner', {
                      name: editing.workflow.submittedBy?.name ?? t('content.noValue'),
                      date: editing.workflow.submittedAt ? formatDateTime(editing.workflow.submittedAt) : t('content.noValue'),
                    })}
                  </AlertTitle>
                  {locked && <AlertDescription>{t('content.lockedHint')}</AlertDescription>}
                </Alert>
              )}
              <fieldset disabled={locked} className="m-0 min-w-0 space-y-4 border-0 p-0">
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
              </fieldset>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {actions.includes('save') && <Button onClick={save}>{t('content.saveDraft')}</Button>}
                {actions.includes('submit') && (
                  <Button variant="outline" onClick={() => transition(editing.documentId, 'submit', t('content.submitted'))}>
                    {t('content.submit')}
                  </Button>
                )}
                {actions.includes('publish') && (
                  <Button variant="outline" onClick={() => publish(editing.documentId)}>
                    {t('content.publish')}
                  </Button>
                )}
                {actions.includes('approve') && (
                  <Button variant="outline" onClick={() => approve(editing.documentId)}>
                    {t('content.approve')}
                  </Button>
                )}
                {actions.includes('reject') && (
                  <Button variant="outline" onClick={() => setRejecting(true)}>
                    {t('content.reject')}
                  </Button>
                )}
                {actions.includes('withdraw') && (
                  <Button variant="outline" onClick={() => transition(editing.documentId, 'withdraw', t('content.withdrawn'))}>
                    {t('content.withdraw')}
                  </Button>
                )}
                {actions.includes('unpublish') && (
                  <Button variant="outline" onClick={() => unpublish(editing.documentId)}>
                    {t('content.unpublish')}
                  </Button>
                )}
                <span className="grow" />
                {editing.documentId && user.permissions.includes('content.delete') && (
                  <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                    {t('content.delete')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={rejecting}
        onOpenChange={(o) => {
          setRejecting(o);
          if (!o) setRejectNote('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('content.rejectTitle')}</DialogTitle>
            <DialogDescription>{t('content.rejectDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">{t('content.rejectNote')}</Label>
            <Textarea id="reject-note" value={rejectNote} maxLength={1000} onChange={(e) => setRejectNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={rejectNote.trim() === ''} onClick={() => editing && reject(editing.documentId)}>
              {t('content.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
