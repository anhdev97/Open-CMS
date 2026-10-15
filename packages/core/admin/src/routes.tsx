import type { RouteObject } from 'react-router';
import { AuthGate } from './auth/AuthGate';

// /setup and /login sit outside AuthGate; users and account routes join the gate in later tasks.
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
      { index: true, lazy: async () => ({ Component: (await import('./pages/Home')).Home }) },
      { path: 'content/:apiId', lazy: async () => ({ Component: (await import('./pages/Content')).Content }) },
      { path: 'builder', lazy: async () => ({ Component: (await import('./pages/Builder')).Builder }) },
      { path: '*', lazy: async () => ({ Component: (await import('./pages/NotFound')).NotFound }) },
    ],
  },
];
