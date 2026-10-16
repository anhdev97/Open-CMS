import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontalIcon, PlusIcon, ShieldIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n/en';
import { ApiError } from '@/lib/api-error';
import {
  createRole,
  deleteRole,
  listRoles,
  roleError,
  roleErrorMessage,
  updateRole,
  type AdminRole,
} from '@/lib/roles';

type Dialogs = { kind: 'create' } | { kind: 'edit'; role: AdminRole } | { kind: 'delete'; role: AdminRole };

const roleFieldsSchema = z.object({
  name: z.string().trim().min(1, t('roles.create.nameRequired')),
  description: z.string(),
});
type RoleFields = z.infer<typeof roleFieldsSchema>;

function RoleFieldsForm({
  defaultValues,
  nameDisabled,
  onSubmit,
  onClose,
  submitLabel,
  submittingLabel,
}: {
  defaultValues: RoleFields;
  nameDisabled?: boolean;
  onSubmit: (values: RoleFields) => Promise<void>;
  onClose: () => void;
  submitLabel: string;
  submittingLabel: string;
}) {
  const [formError, setFormError] = useState<Error | null>(null);
  const form = useForm<RoleFields>({
    resolver: zodResolver(roleFieldsSchema),
    defaultValues,
  });

  async function handleSubmit(values: RoleFields) {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'role_name_taken') {
        form.setError('name', { message: roleErrorMessage(e) });
      } else if (e instanceof ApiError && e.code === 'validation_failed') {
        form.setError('name', { message: roleErrorMessage(e) });
      } else {
        setFormError(roleError(e));
      }
    }
  }

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(handleSubmit)} noValidate>
        <ErrorAlert error={formError} />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('roles.name')}</FormLabel>
              <FormControl>
                <Input autoComplete="off" autoFocus={!nameDisabled} disabled={nameDisabled} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('roles.descriptionField')}</FormLabel>
              <FormControl>
                <Textarea autoComplete="off" rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? submittingLabel : submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function CreateRoleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('roles.create.title')}</DialogTitle>
          <DialogDescription>{t('roles.create.description')}</DialogDescription>
        </DialogHeader>
        <RoleFieldsForm
          defaultValues={{ name: '', description: '' }}
          submitLabel={t('roles.create.submit')}
          submittingLabel={t('roles.create.submitting')}
          onClose={onClose}
          onSubmit={async ({ name, description }) => {
            await createRole({ name, ...(description ? { description } : {}) });
            toast.success(t('roles.create.created'));
            onDone();
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditRoleDialog({ role, onClose, onDone }: { role: AdminRole; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('roles.edit.title')}</DialogTitle>
          <DialogDescription>{t('roles.edit.description')}</DialogDescription>
        </DialogHeader>
        <RoleFieldsForm
          defaultValues={{ name: role.name, description: role.description }}
          nameDisabled={role.isSystem}
          submitLabel={t('roles.edit.submit')}
          submittingLabel={t('roles.edit.submitting')}
          onClose={onClose}
          onSubmit={async ({ name, description }) => {
            await updateRole(
              role.id,
              role.isSystem ? { description } : { name, ...(description ? { description } : { description: '' }) },
            );
            toast.success(t('roles.edit.done'));
            onDone();
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function Roles() {
  const [roles, setRoles] = useState<AdminRole[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [dialog, setDialog] = useState<Dialogs | null>(null);

  const load = useCallback(() => {
    listRoles().then(
      (rows) => {
        setRoles(rows);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e : new Error(String(e))),
    );
  }, []);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (e) {
      toast.error(roleErrorMessage(e));
    }
    load();
  }

  const close = () => setDialog(null);
  const lastDialog = useRef<Dialogs | null>(null);
  if (dialog) lastDialog.current = dialog;
  const deleteTarget = dialog?.kind === 'delete' ? dialog.role : lastDialog.current?.kind === 'delete' ? lastDialog.current.role : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('roles.title')}
        description={t('roles.description')}
        actions={
          <Button onClick={() => setDialog({ kind: 'create' })}>
            <PlusIcon aria-hidden="true" />
            {t('roles.newRole')}
          </Button>
        }
      />

      <ErrorAlert error={error} />

      {roles === null && !error && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {roles?.length === 0 && (
        <EmptyState icon={ShieldIcon} title={t('roles.emptyTitle')} description={t('roles.emptyDescription')} />
      )}

      {roles && roles.length > 0 && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table aria-label={t('roles.listLabel')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('roles.name')}</TableHead>
                  <TableHead>{t('roles.descriptionField')}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t('roles.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">
                      {role.name}
                      {role.isSystem && (
                        <Badge variant="secondary" className="ml-2">
                          {t('roles.systemBadge')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{role.description || '—'}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={t('roles.actions')}>
                            <MoreHorizontalIcon aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', role })}>
                            {t('roles.edit.title')}
                          </DropdownMenuItem>
                          {!role.isSystem && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setDialog({ kind: 'delete', role })}
                              >
                                {t('roles.remove.confirm')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {dialog?.kind === 'create' && <CreateRoleDialog onClose={close} onDone={load} />}
      {dialog?.kind === 'edit' && <EditRoleDialog role={dialog.role} onClose={close} onDone={load} />}

      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => !open && close()}
        title={t('roles.remove.title', { name: deleteTarget?.name ?? '' })}
        description={t('roles.remove.description')}
        confirmLabel={t('roles.remove.confirm')}
        destructive
        onConfirm={() => deleteTarget && void run(() => deleteRole(deleteTarget.id), t('roles.remove.done'))}
      />
    </div>
  );
}
