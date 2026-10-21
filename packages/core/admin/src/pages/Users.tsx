import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontalIcon, PlusIcon, UsersIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { t } from '../i18n';
import { useFormat } from '../i18n/hooks';
import { ApiError } from '../lib/api-error';
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserStatus,
  unlinkIdentity,
  userActions,
  userError,
  userErrorMessage,
  type AdminUser,
} from '../lib/users';

type Identity = AdminUser['identities'][number];

type Dialogs =
  | { kind: 'create' }
  | { kind: 'reset' | 'disable' | 'enable' | 'delete'; user: AdminUser }
  | { kind: 'unlink'; user: AdminUser; identity: Identity };

const createSchema = () =>
  z.object({
    email: z
      .string()
      .trim()
      .min(1, t('users.create.emailRequired'))
      .pipe(z.string().email(t('users.create.emailInvalid'))),
    name: z.string().trim().min(1, t('users.create.nameRequired')),
    password: z.string(),
  });
type CreateValues = z.infer<ReturnType<typeof createSchema>>;

const resetSchema = () => z.object({ password: z.string().min(1, t('users.create.passwordRequired')) });

function CreateUserDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [formError, setFormError] = useState<Error | null>(null);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema()),
    defaultValues: { email: '', name: '', password: '' },
  });

  async function onSubmit({ email, name, password }: CreateValues) {
    setFormError(null);
    try {
      // Task 16 adds the group picker; until then the server answers 422 (groupIds must not be empty).
      await createUser({ email, name, groupIds: [], ...(password ? { password } : {}) });
      toast.success(t('users.create.created'));
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'email_taken') form.setError('email', { message: userErrorMessage(e) });
      else if (e instanceof ApiError && e.code === 'weak_password') form.setError('password', { message: e.message });
      else setFormError(userError(e));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('users.create.title')}</DialogTitle>
          <DialogDescription>{t('users.create.description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <ErrorAlert error={formError} />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('users.email')}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('users.name')}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('users.create.password')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>{t('users.create.passwordHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('users.create.submitting') : t('users.create.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, isMe, onClose }: { user: AdminUser; isMe: boolean; onClose: () => void }) {
  const [formError, setFormError] = useState<Error | null>(null);
  const form = useForm<z.infer<ReturnType<typeof resetSchema>>>({
    resolver: zodResolver(resetSchema()),
    defaultValues: { password: '' },
  });

  async function onSubmit({ password }: { password: string }) {
    setFormError(null);
    try {
      await resetUserPassword(user.id, password);
      toast.success(t('users.reset.done'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'weak_password') form.setError('password', { message: e.message });
      else setFormError(userError(e));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('users.reset.title')}</DialogTitle>
          <DialogDescription>
            {t('users.reset.description', { email: user.email })}
            {isMe && ` ${t('users.reset.selfNote')}`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <ErrorAlert error={formError} />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('users.reset.password')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" autoFocus {...field} />
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
                {form.formState.isSubmitting ? t('users.reset.submitting') : t('users.reset.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function Users() {
  const { user: me } = useAuth();
  const { formatDateTime } = useFormat();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [dialog, setDialog] = useState<Dialogs | null>(null);

  const load = useCallback(() => {
    listUsers().then(
      (rows) => {
        setUsers(rows);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e : new Error(String(e))),
    );
  }, []);
  useEffect(load, [load]);

  /** Runs a mutation, then reloads the list; failures become a toast with the known-code message. */
  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (e) {
      toast.error(userErrorMessage(e));
    }
    load();
  }

  const close = () => setDialog(null);
  // Texts keep showing the last dialog while the close animation runs.
  const lastDialog = useRef<Dialogs | null>(null);
  if (dialog) lastDialog.current = dialog;
  const shown = dialog ?? lastDialog.current;
  const target = shown && shown.kind !== 'create' ? shown.user : null;
  const targetIsMe = target?.id === me.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        actions={
          <Button onClick={() => setDialog({ kind: 'create' })}>
            <PlusIcon aria-hidden="true" />
            {t('users.newUser')}
          </Button>
        }
      />

      <ErrorAlert error={error} />

      {users === null && !error && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {users?.length === 0 && (
        <EmptyState icon={UsersIcon} title={t('users.emptyTitle')} description={t('users.emptyDescription')} />
      )}

      {users && users.length > 0 && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table aria-label={t('users.listLabel')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('users.name')}</TableHead>
                  <TableHead>{t('users.email')}</TableHead>
                  <TableHead>{t('users.status')}</TableHead>
                  <TableHead>{t('users.lastLogin')}</TableHead>
                  <TableHead>{t('users.sso')}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t('users.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const actions = userActions(u, me);
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.name}
                        {u.id === me.id && (
                          <Badge variant="secondary" className="ml-2">
                            {t('users.you')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <StatusBadge status={u.status === 'disabled' ? 'disabled' : 'active'} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('users.never')}
                      </TableCell>
                      <TableCell>
                        {u.identities.length === 0 ? (
                          <span className="text-muted-foreground">{t('users.noSso')}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {u.identities.map((identity) => (
                              <Badge key={identity.id} variant="secondary" className="gap-1 pr-1">
                                {identity.provider}
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="size-5"
                                  aria-label={t('users.unlink.label', { provider: identity.provider, email: u.email })}
                                  onClick={() => setDialog({ kind: 'unlink', user: u, identity })}
                                >
                                  <XIcon className="size-3" aria-hidden="true" />
                                </Button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={t('users.actionsFor', { email: u.email })}>
                              <MoreHorizontalIcon aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'reset', user: u })}>
                              {t('users.reset.menu')}
                            </DropdownMenuItem>
                            {actions.canDisable && (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'disable', user: u })}>
                                {t('users.disable.menu')}
                              </DropdownMenuItem>
                            )}
                            {actions.canEnable && (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'enable', user: u })}>
                                {t('users.enable.menu')}
                              </DropdownMenuItem>
                            )}
                            {actions.canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'delete', user: u })}>
                                  {t('users.remove.menu')}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {dialog?.kind === 'create' && <CreateUserDialog onClose={close} onDone={load} />}
      {dialog?.kind === 'reset' && <ResetPasswordDialog user={dialog.user} isMe={dialog.user.id === me.id} onClose={close} />}

      <ConfirmDialog
        open={dialog?.kind === 'disable'}
        onOpenChange={(open) => !open && close()}
        title={t('users.disable.title', { email: target?.email ?? '' })}
        description={targetIsMe ? t('users.disable.descriptionSelf') : t('users.disable.description')}
        confirmLabel={t('users.disable.confirm')}
        destructive
        onConfirm={() => target && void run(() => setUserStatus(target.id, 'disabled'), t('users.disable.done'))}
      />
      <ConfirmDialog
        open={dialog?.kind === 'enable'}
        onOpenChange={(open) => !open && close()}
        title={t('users.enable.title', { email: target?.email ?? '' })}
        description={t('users.enable.description')}
        confirmLabel={t('users.enable.confirm')}
        onConfirm={() => target && void run(() => setUserStatus(target.id, 'active'), t('users.enable.done'))}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => !open && close()}
        title={t('users.remove.title', { email: target?.email ?? '' })}
        description={t('users.remove.description')}
        confirmLabel={t('users.remove.confirm')}
        destructive
        onConfirm={() => target && void run(() => deleteUser(target.id), t('users.remove.done'))}
      />
      <ConfirmDialog
        open={dialog?.kind === 'unlink'}
        onOpenChange={(open) => !open && close()}
        title={t('users.unlink.title', { provider: shown?.kind === 'unlink' ? shown.identity.provider : '' })}
        description={t('users.unlink.description', {
          provider: shown?.kind === 'unlink' ? shown.identity.provider : '',
          email: target?.email ?? '',
        })}
        confirmLabel={t('users.unlink.confirm')}
        destructive
        onConfirm={() =>
          dialog?.kind === 'unlink' &&
          void run(() => unlinkIdentity(dialog.user.id, dialog.identity.id), t('users.unlink.done'))
        }
      />
    </div>
  );
}
