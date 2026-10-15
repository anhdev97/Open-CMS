import type { RouteObject } from 'react-router';
import { AuthGate } from './auth/AuthGate';
import { t } from './i18n/en';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { Setup } from './pages/Setup';

function Placeholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
      <p className="text-muted-foreground">{t('app.comingSoon')}</p>
    </div>
  );
}

// /setup and /login sit outside AuthGate; the content, builder, users and account routes join the gate in later tasks.
export const routes: RouteObject[] = [
  // `import.meta.env.DEV` is a build-time constant: in production the branch (and the lazy chunk) is dropped.
  ...(import.meta.env.DEV
    ? [{ path: '_ui', lazy: async () => ({ Component: (await import('./pages/UiKit')).UiKit }) }]
    : []),
  { path: 'setup', element: <Setup /> },
  { path: 'login', element: <Login /> },
  {
    element: <AuthGate />,
    children: [
      { index: true, element: <Placeholder /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
