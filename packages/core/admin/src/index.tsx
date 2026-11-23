'use client';

import { useParams } from 'next/navigation';
import { AuthGate } from './auth/AuthGate';
import { AdminParamsContext } from './lib/nav';
import { matchRoute } from './router/match';
import { useLocale } from './i18n/hooks';
import { pages } from './router/routes';
import { RouteGuard } from './router/RouteGuard';

export default function AdminApp() {
  useLocale(); // re-render the route tree (state kept) when the admin language changes
  const { slug } = useParams<{ slug?: string[] }>();
  const { id, params, guarded, fullScreen } = matchRoute(slug);
  const Page = pages[id];
  const page = (
    <AdminParamsContext.Provider value={params}>
      <RouteGuard id={id}>
        <Page />
      </RouteGuard>
    </AdminParamsContext.Provider>
  );
  return guarded ? <AuthGate fullScreen={fullScreen}>{page}</AuthGate> : page;
}

export {
  SUPPORTED_LOCALES,
  isLocale,
  matchLocale,
  localizedText,
  defineMessages,
  createTranslator,
  formatDateTime,
  formatNumber,
} from '@opencloudcms/schema';
export type { Locale } from '@opencloudcms/schema';
export { useLocale, useTranslator, useFormat } from './i18n/hooks';
