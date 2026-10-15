import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlertIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation } from 'react-router';
import { z } from 'zod';
import { ErrorAlert } from '@/components/ErrorAlert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n/en';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import { errorMessage, loginPageAction, originMismatchMessage } from '../lib/auth-flow';

interface Interaction {
  loginHint?: string;
  idps: { id: string; label: string }[];
}
type InteractionResponse = Interaction | { redirectTo: string };

const schema = z.object({
  email: z.string().trim().min(1, t('setup.errors.emailRequired')),
  password: z.string().min(1, t('login.errors.passwordRequired')),
});
type Values = z.infer<typeof schema>;

function submitErrorText(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const mismatch = originMismatchMessage(e);
  if (mismatch) return mismatch;
  if (e.status === 401 && e.code === 'invalid_credentials') return t('login.errors.invalid_credentials');
  if (e.status === 403 && e.code === 'account_disabled') return errorMessage('account_disabled');
  if (e.status === 429) {
    return e.retryAfterSec === undefined
      ? t('login.rateLimitedNoTime')
      : t('login.rateLimited', { seconds: e.retryAfterSec });
  }
  return null;
}

function LoginForm({ uid, interaction }: { uid: string; interaction: Interaction }) {
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [otherError, setOtherError] = useState<Error | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: interaction.loginHint ?? '', password: '' },
  });
  const base = `/oauth2/interaction/${encodeURIComponent(uid)}`;

  async function onSubmit(values: Values) {
    setInlineError(null);
    setOtherError(null);
    try {
      const { redirectTo } = await api<{ redirectTo: string }>(`${base}/login`, {
        method: 'POST',
        json: values,
        redirectOn401: false,
      });
      window.location.assign(redirectTo);
    } catch (e) {
      const text = submitErrorText(e);
      if (text) setInlineError(text);
      else setOtherError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {inlineError && (
          <Alert variant="destructive" role="alert">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{inlineError}</AlertTitle>
          </Alert>
        )}
        <ErrorAlert error={otherError} />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('login.email')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="username" autoFocus={!interaction.loginHint} {...field} />
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
              <FormLabel>{t('login.password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" autoFocus={!!interaction.loginHint} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('login.submitting') : t('login.submit')}
        </Button>
        {interaction.idps.length > 0 && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              {t('login.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
            {interaction.idps.map((idp) => (
              <Button key={idp.id} variant="outline" asChild>
                <a href={`${base}/idp/${encodeURIComponent(idp.id)}`}>{t('login.continueWith', { label: idp.label })}</a>
              </Button>
            ))}
          </>
        )}
      </form>
    </Form>
  );
}

export function Login() {
  const { search } = useLocation();
  const action = useMemo(() => loginPageAction(search), [search]);
  const uid = action.kind === 'show' ? action.uid : null;
  const errorCode = action.kind === 'restart' ? null : (action.error ?? null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    if (uid === null) {
      if (action.kind === 'restart') window.location.assign('/api/auth/login');
      return;
    }
    let live = true;
    api<InteractionResponse>(`/oauth2/interaction/${encodeURIComponent(uid)}`, { redirectOn401: false }).then(
      (res) => {
        if (!live) return;
        if ('redirectTo' in res) window.location.assign(res.redirectTo);
        else setInteraction(res);
      },
      (e: unknown) => live && setLoadError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [uid, action.kind]);

  if (action.kind === 'restart') return null;

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{t('login.title')}</CardTitle>
          <CardDescription>{t('login.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {errorCode !== null && (
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle>{errorMessage(errorCode)}</AlertTitle>
              <AlertDescription>
                <a href="/api/auth/login" className="font-medium underline underline-offset-4">
                  {t('login.tryAgain')}
                </a>
              </AlertDescription>
            </Alert>
          )}
          {uid === null ? null : loadError ? (
            <ErrorAlert error={loadError} />
          ) : interaction ? (
            <LoginForm uid={uid} interaction={interaction} />
          ) : (
            <div className="space-y-4" role="status" aria-label={t('login.loading')}>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
