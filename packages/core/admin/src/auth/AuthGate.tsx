import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AppLayout } from '@/components/AppLayout';
import { ErrorAlert } from '@/components/ErrorAlert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n/en';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import { loginUrl } from '../lib/auth-flow';
import { AuthContext, type AuthContextValue, type AuthUser } from './AuthContext';

type State = { status: 'loading' } | { status: 'ready'; user: AuthUser } | { status: 'error'; error: Error };

/** Wraps every route except `/setup` and `/login` (spec §5.2): checks the session, then renders the layout. */
export function AuthGate() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    api<AuthUser>('/api/auth/me', { redirectOn401: false }).then(
      (user) => live && setState({ status: 'ready', user }),
      (error: unknown) => {
        if (!live) return;
        if (error instanceof ApiError && error.status === 409 && error.code === 'setup_required') {
          void navigate('/setup', { replace: true });
        } else if (error instanceof ApiError && error.status === 401) {
          window.location.assign(loginUrl(window.location));
        } else {
          setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [navigate, attempt]);

  const logout = useCallback(async () => {
    try {
      const { redirectTo } = await api<{ redirectTo: string }>('/api/auth/logout', { method: 'POST' });
      window.location.assign(redirectTo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const value = useMemo<AuthContextValue | null>(
    () => (state.status === 'ready' ? { user: state.user, logout } : null),
    [state, logout],
  );

  if (state.status === 'error') {
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">{t('auth.failedTitle')}</h1>
        <ErrorAlert error={state.error} />
        <Button className="w-fit" onClick={() => setAttempt((n) => n + 1)}>
          {t('auth.retry')}
        </Button>
      </main>
    );
  }

  if (!value) {
    return (
      <div className="flex min-h-svh" role="status" aria-label={t('auth.checking')}>
        <div className="hidden w-64 shrink-0 space-y-3 border-r p-4 md:block">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full max-w-3xl" />
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      <AppLayout user={value.user} onLogout={() => void value.logout()}>
        <Outlet />
      </AppLayout>
    </AuthContext.Provider>
  );
}
