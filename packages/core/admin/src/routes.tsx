import type { RouteObject } from 'react-router';
import { AuthGate } from './auth/AuthGate';
import { t } from './i18n/en';

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
  { path: 'setup', lazy: async () => ({ Component: (await import('./pages/Setup')).Setup }) },
  { path: 'login', lazy: async () => ({ Component: (await import('./pages/Login')).Login }) },
  {
    element: <AuthGate />,
    children: [
      { index: true, element: <Placeholder /> },
      { path: '*', lazy: async () => ({ Component: (await import('./pages/NotFound')).NotFound }) },
    ],
  },
];
