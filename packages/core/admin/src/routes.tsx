import type { RouteObject } from 'react-router';
import { AuthGate } from './auth/AuthGate';

// /setup and /login sit outside AuthGate.
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
      { path: 'users', lazy: async () => ({ Component: (await import('./pages/Users')).Users }) },
      { path: 'roles', lazy: async () => ({ Component: (await import('./pages/Roles')).Roles }) },
      { path: 'account', lazy: async () => ({ Component: (await import('./pages/Account')).Account }) },
      { path: '*', lazy: async () => ({ Component: (await import('./pages/NotFound')).NotFound }) },
    ],
  },
];
