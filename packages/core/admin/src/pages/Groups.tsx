import { PERMISSIONS, type Permission } from '@opencms/schema';
import { PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { t } from '../i18n';
import {
  createGroup,
  deleteGroup,
  groupError,
  groupName,
  groupUpdateInput,
  isSeedGroupKey,
  listGroups,
  PERMISSION_SECTIONS,
  updateGroup,
  type AdminGroup,
} from '../lib/groups';

const KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

type Dialogs = { kind: 'edit'; group: AdminGroup | null } | { kind: 'delete'; group: AdminGroup };

function GroupDialog({ group, onClose, onDone }: { group: AdminGroup | null; onClose: () => void; onDone: () => void }) {
  const isNew = group === null;
  const readOnly = group?.system === true;
  const nameLocked = readOnly || (group !== null && isSeedGroupKey(group.key));
  const [key, setKey] = useState(group?.key ?? '');
  const [name, setName] = useState(group ? (nameLocked ? groupName(group) : group.name) : '');
  const [roles, setRoles] = useState<Permission[]>(readOnly ? [...PERMISSIONS] : (group?.roles ?? []));
  const [errors, setErrors] = useState<{ key?: string; name?: string }>({});
  const [formError, setFormError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (p: Permission, on: boolean) =>
    setRoles((cur) => PERMISSIONS.filter((x) => (x === p ? on : cur.includes(x))));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const next: { key?: string; name?: string } = {};
    if (isNew && !KEY_RE.test(key)) next.key = t('permGroups.keyInvalid');
    const trimmed = name.trim();
    if (!nameLocked && (trimmed.length < 1 || trimmed.length > 100)) next.name = t('permGroups.nameInvalid');
    setErrors(next);
    if (next.key || next.name) return;
    setBusy(true);
    setFormError(null);
    try {
      if (isNew) await createGroup({ key, name: trimmed, roles });
      else await updateGroup(group.id, groupUpdateInput(group, name, roles));
      toast.success(t('permGroups.saved'));
      onDone();
      onClose();
    } catch (err) {
      const mapped = groupError(err);
      if ((mapped as { code?: string }).code === 'group_key_taken') setErrors({ key: mapped.message });
      else setFormError(mapped);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? t('permGroups.newTitle') : t('permGroups.editTitle')}</DialogTitle>
          <DialogDescription>{readOnly ? t('permGroups.systemHint') : t('permGroups.formHint')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <ErrorAlert error={formError} />
          <div className="grid gap-2">
            <Label htmlFor="group-key">{t('permGroups.key')}</Label>
            <Input
              id="group-key"
              value={key}
              disabled={!isNew}
              autoComplete="off"
              autoFocus={isNew}
              aria-invalid={errors.key ? true : undefined}
              aria-describedby={errors.key ? 'group-key-error' : undefined}
              onChange={(e) => setKey(e.target.value)}
            />
            {errors.key && (
              <p id="group-key-error" className="text-sm text-destructive">
                {errors.key}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="group-name">{t('permGroups.name')}</Label>
            <Input
              id="group-name"
              value={name}
              disabled={nameLocked}
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'group-name-error' : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && (
              <p id="group-name-error" className="text-sm text-destructive">
                {errors.name}
              </p>
            )}
          </div>
          {PERMISSION_SECTIONS.map((section) => (
            <fieldset key={section.id} className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">{t(`permGroups.sections.${section.id}`)}</legend>
              {section.permissions.map((p) => {
                const id = `perm-${p}`;
                return (
                  <div key={p} className="flex items-start gap-3">
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={roles.includes(p)}
                      disabled={readOnly}
                      onCheckedChange={(v) => toggle(p, v === true)}
                    />
                    <div className="grid gap-0.5">
                      <Label htmlFor={id}>{t(`permissions.${p}.label`)}</Label>
                      <p className="text-xs text-muted-foreground">{t(`permissions.${p}.description`)}</p>
                    </div>
                  </div>
                );
              })}
            </fieldset>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? t('common.close') : t('common.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={busy}>
                {busy ? t('permGroups.saving') : t('permGroups.save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Groups() {
  const [groups, setGroups] = useState<AdminGroup[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [dialog, setDialog] = useState<Dialogs | null>(null);

  const load = useCallback(() => {
    listGroups().then(
      (rows) => {
        setGroups(rows);
        setError(null);
      },
      (e: unknown) => setError(groupError(e)),
    );
  }, []);
  useEffect(load, [load]);

  const close = () => setDialog(null);
  const lastDialog = useRef<Dialogs | null>(null);
  if (dialog) lastDialog.current = dialog;
  const shown = dialog ?? lastDialog.current;
  const target = shown?.kind === 'delete' ? shown.group : null;

  async function remove(g: AdminGroup) {
    try {
      await deleteGroup(g.id);
      toast.success(t('permGroups.deleted'));
    } catch (e) {
      toast.error(groupError(e).message);
    }
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('permGroups.title')}
        description={t('permGroups.description')}
        actions={
          <Button onClick={() => setDialog({ kind: 'edit', group: null })}>
            <PlusIcon aria-hidden="true" />
            {t('permGroups.newGroup')}
          </Button>
        }
      />

      <ErrorAlert error={error} />

      {groups === null && !error && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {groups?.length === 0 && (
        <EmptyState icon={ShieldCheckIcon} title={t('permGroups.emptyTitle')} description={t('permGroups.emptyDescription')} />
      )}

      {groups && groups.length > 0 && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table aria-label={t('permGroups.listLabel')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('permGroups.name')}</TableHead>
                  <TableHead>{t('permGroups.permissionsCount')}</TableHead>
                  <TableHead>{t('permGroups.users')}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t('users.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">
                      {groupName(g)}
                      {g.system && (
                        <Badge variant="secondary" className="ml-2">
                          {t('permGroups.system')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {g.system ? PERMISSIONS.length : g.roles.length}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{g.userCount}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={g.system ? t('permGroups.view', { name: groupName(g) }) : t('permGroups.edit', { name: groupName(g) })}
                        onClick={() => setDialog({ kind: 'edit', group: g })}
                      >
                        {g.system ? <ShieldCheckIcon aria-hidden="true" /> : <PencilIcon aria-hidden="true" />}
                      </Button>
                      {!g.system && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('permGroups.delete', { name: groupName(g) })}
                          onClick={() => setDialog({ kind: 'delete', group: g })}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {dialog?.kind === 'edit' && <GroupDialog group={dialog.group} onClose={close} onDone={load} />}

      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => !open && close()}
        title={t('permGroups.deleteTitle', { name: target ? groupName(target) : '' })}
        description={t('permGroups.deleteDescription', { count: target?.userCount ?? 0 })}
        confirmLabel={t('permGroups.deleteConfirm')}
        destructive
        onConfirm={() => target && void remove(target)}
      />
    </div>
  );
}
