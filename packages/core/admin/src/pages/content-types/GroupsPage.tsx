import { localizedText, type ContentGroupDefinition } from '@opencloudcms/schema';
import { FolderIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorAlert } from '../../components/ErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { getActiveLocale, t } from '../../i18n';
import { ApiError } from '../../lib/api-error';
import { fetchContentGroups, groupUsage, saveContentGroups } from '../../lib/content-groups';
import { GroupDialog } from './GroupDialog';
import { announceSchemaChange, typesPath, TypesSkeleton, useSchemaTypes } from './shared';

/** Maps a failed save to a translated error; `group_in_use` lists the types that still use the group. */
function describeError(e: unknown): Error {
  if (e instanceof ApiError && e.code === 'group_in_use') {
    const first = e.issues[0] as { path?: string[]; message?: string } | undefined;
    return new Error(t('groups.inUse', { key: first?.path?.[0] ?? '', types: first?.message ?? '' }));
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** `/settings/content-types/groups`: content groups table; create / edit / delete in a Dialog (dev only). */
export function GroupsPage() {
  const { types } = useSchemaTypes();
  const [groups, setGroups] = useState<ContentGroupDefinition[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [dialog, setDialog] = useState<{ editing: ContentGroupDefinition | null } | null>(null);
  const [dialogError, setDialogError] = useState<Error | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [toDelete, setToDelete] = useState<ContentGroupDefinition | null>(null);

  useEffect(() => {
    fetchContentGroups()
      .then((r) => {
        setGroups(r.groups);
        setCanEdit(r.editable);
      })
      .catch((e) => setError(describeError(e)));
  }, []);

  const locale = getActiveLocale();
  const usage = groupUsage(groups ?? [], types ?? []);
  const sorted = [...(groups ?? [])].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.key.localeCompare(b.key));

  const persist = async (next: ContentGroupDefinition[], onError: (e: Error) => void): Promise<boolean> => {
    try {
      const r = await saveContentGroups(next);
      setGroups(r.groups);
      announceSchemaChange();
      toast.success(t('groups.savedToast'));
      return true;
    } catch (e) {
      onError(describeError(e));
      return false;
    }
  };

  const submit = async (def: ContentGroupDefinition) => {
    if (!groups || !dialog) return false;
    setDialogError(null);
    const next = dialog.editing ? groups.map((g) => (g.key === dialog.editing!.key ? def : g)) : [...groups, def];
    const ok = await persist(next, setDialogError);
    if (ok) setDialog(null);
    return ok;
  };

  const remove = async () => {
    if (!toDelete || !groups) return;
    setError(null);
    await persist(
      groups.filter((g) => g.key !== toDelete.key),
      setError,
    );
  };

  const open = (editing: ContentGroupDefinition | null) => {
    setDialogError(null);
    setDialog({ editing });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('contentTypes.listTitle'), to: typesPath() }, { label: t('contentTypes.groupsLink') }]} />
      <PageHeader
        title={t('contentTypes.groupsLink')}
        description={t('groups.description')}
        actions={
          canEdit && (
            <Button size="sm" onClick={() => open(null)}>
              <PlusIcon aria-hidden="true" />
              {t('groups.add')}
            </Button>
          )
        }
      />

      {groups !== null && !canEdit && (
        <Alert variant="warning">
          <AlertDescription>{t('builder.readOnly')}</AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={error} />

      {groups === null ? (
        !error && <TypesSkeleton />
      ) : groups.length === 0 ? (
        <EmptyState icon={FolderIcon} title={t('groups.empty')} />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('groups.key')}</TableHead>
                  <TableHead>{t('groups.title')}</TableHead>
                  <TableHead className="text-right">{t('groups.order')}</TableHead>
                  <TableHead className="text-right">{t('groups.types')}</TableHead>
                  {canEdit && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((g) => (
                  <TableRow key={g.key}>
                    <TableCell className="font-mono text-xs">{g.key}</TableCell>
                    <TableCell>{localizedText(g.title, locale, g.key)}</TableCell>
                    <TableCell className="text-right">{g.order ?? '—'}</TableCell>
                    <TableCell className="text-right">{usage[g.key] ?? 0}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" aria-label={t('groups.edit', { key: g.key })} onClick={() => open(g)}>
                            <PencilIcon aria-hidden="true" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={t('groups.delete', { key: g.key })} onClick={() => setToDelete(g)}>
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <GroupDialog
        open={dialog !== null}
        editing={dialog?.editing ?? null}
        groups={groups ?? []}
        error={dialogError}
        onSubmit={submit}
        onClose={() => setDialog(null)}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('groups.deleteTitle', { name: toDelete ? localizedText(toDelete.title, locale, toDelete.key) : '' })}
        description={t('groups.deleteDescription')}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
