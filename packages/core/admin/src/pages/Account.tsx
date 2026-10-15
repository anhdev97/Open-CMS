import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '@/auth/AuthContext';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n/en';
import { ApiError } from '@/lib/api-error';
import { PASSWORD_MAX, PASSWORD_MIN, validateSetup } from '@/lib/auth-flow';
import { getTheme, setTheme, type Theme } from '@/lib/theme';
import { changePassword } from '@/lib/users';

const THEMES: Theme[] = ['light', 'dark', 'system'];

const schema = z.object({ current: z.string(), next: z.string(), confirm: z.string() });
type Values = z.infer<typeof schema>;

function ChangePasswordCard({ email }: { email: string }) {
  const [formError, setFormError] = useState<Error | null>(null);
  const form = useForm<Values>({
    // The new password follows the same rules as setup (length, not equal to the account email, matching confirm).
    resolver: zodResolver(
      schema.superRefine((v, ctx) => {
        if (!v.current) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['current'], message: t('account.currentRequired') });
        const found = validateSetup({ email, name: '-', password: v.next, confirm: v.confirm });
        if (found.password) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['next'], message: found.password });
        if (found.confirm) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirm'], message: found.confirm });
      }),
    ),
    defaultValues: { current: '', next: '', confirm: '' },
  });

  async function onSubmit({ current, next }: Values) {
    setFormError(null);
    try {
      await changePassword(current, next);
      toast.success(t('account.passwordChanged'));
      form.reset();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.code === 'invalid_credentials') {
        form.setError('current', { message: t('account.wrongPassword') });
      } else if (e instanceof ApiError && e.code === 'weak_password') {
        form.setError('next', { message: e.message });
      } else {
        setFormError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.changePassword')}</CardTitle>
        <CardDescription>{t('account.changePasswordHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="grid max-w-md gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <ErrorAlert error={formError} />
            <FormField
              control={form.control}
              name="current"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('account.currentPassword')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="next"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('account.newPassword')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>{t('setup.passwordHint', { min: PASSWORD_MIN, max: PASSWORD_MAX })}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('account.confirmPassword')}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-fit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('account.submitting') : t('account.submit')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function ThemeCard() {
  const [theme, setCurrent] = useState<Theme>(getTheme);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.appearance')}</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">{t('account.themeLabel')}</legend>
          {THEMES.map((name) => (
            <Label key={name} className="flex cursor-pointer items-center gap-2 font-normal">
              <input
                type="radio"
                name="theme"
                value={name}
                checked={theme === name}
                onChange={() => {
                  setTheme(name);
                  setCurrent(name);
                }}
                className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
              />
              {t(`theme.${name}`)}
            </Label>
          ))}
        </fieldset>
      </CardContent>
    </Card>
  );
}

export function Account() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader title={t('account.title')} description={t('account.description')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('account.profile')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid max-w-md gap-4 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">{t('account.name')}</dt>
            <dd>{user.name || t('content.noValue')}</dd>
            <dt className="text-muted-foreground">{t('account.email')}</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">{t('account.roles')}</dt>
            <dd className="flex flex-wrap gap-1">
              {user.roles.length === 0 ? t('account.noRoles') : user.roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <ChangePasswordCard email={user.email} />
      <ThemeCard />
    </div>
  );
}
