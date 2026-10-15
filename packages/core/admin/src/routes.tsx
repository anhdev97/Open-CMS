import type { RouteObject } from 'react-router';
import { t } from './i18n/en';

function Placeholder() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
      <p className="text-muted-foreground">{t('app.comingSoon')}</p>
    </main>
  );
}

// Placeholder only: the real route table (§5.1) arrives with the pages in later tasks.
export const routes: RouteObject[] = [{ path: '*', element: <Placeholder /> }];
