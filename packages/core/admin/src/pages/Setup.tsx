import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { ErrorAlert } from '@/components/ErrorAlert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n/en';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import { PASSWORD_MAX, PASSWORD_MIN, setupFieldErrors, validateSetup } from '../lib/auth-flow';

// One rule set: the zod schema reports whatever `validateSetup` finds, field by field.
const schema = z
  .object({ email: z.string(), name: z.string(), password: z.string(), confirm: z.string() })
  .superRefine((values, ctx) => {
    for (const [field, message] of Object.entries(validateSetup(values))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
  });
type Values = z.infer<typeof schema>;

export function Setup() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [formError, setFormError] = useState<Error | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', password: '', confirm: '' },
  });

  useEffect(() => {
    let live = true;
    setLoadError(null);
    api<{ required: boolean }>('/api/auth/setup', { redirectOn401: false }).then(
      ({ required }) => {
        if (!live) return;
        if (required) setReady(true);
        else void navigate('/', { replace: true });
      },
      (e: unknown) => live && setLoadError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [navigate, attempt]);

  async function onSubmit({ email, name, password }: Values) {
    setFormError(null);
    const body = { email: email.trim(), name: name.trim(), password };
    try {
      await api('/api/auth/setup', { method: 'POST', json: body, redirectOn401: false });
      window.location.assign('/api/auth/login?login_hint=' + encodeURIComponent(body.email));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        void navigate('/', { replace: true });
      } else if (e instanceof ApiError && e.status === 422) {
        const { form: general, ...fields } = setupFieldErrors(e);
        for (const [field, message] of Object.entries(fields)) form.setError(field as keyof Values, { message });
        if (general) setFormError(new ApiError(e.status, e.code, general));
      } else {
        setFormError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{t('setup.title')}</CardTitle>
          <CardDescription>{t('setup.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <div className="grid gap-4">
              <ErrorAlert error={loadError} />
              <Button className="w-fit" onClick={() => setAttempt((n) => n + 1)}>
                {t('auth.retry')}
              </Button>
            </div>
          ) : !ready ? (
            <div className="space-y-4" role="status" aria-label={t('setup.checking')}>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <Form {...form}>
              <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <ErrorAlert error={formError} />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('setup.email')}</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="email" autoFocus {...field} />
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
                      <FormLabel>{t('setup.name')}</FormLabel>
                      <FormControl>
                        <Input autoComplete="name" {...field} />
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
                      <FormLabel>{t('setup.password')}</FormLabel>
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
                      <FormLabel>{t('setup.confirm')}</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? t('setup.submitting') : t('setup.submit')}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
