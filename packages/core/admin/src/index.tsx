'use client';

import { useParams } from 'next/navigation';
import { AuthGate } from './auth/AuthGate';
import { AdminParamsContext } from './lib/nav';
import { matchRoute } from './router/match';
import { pages } from './router/routes';

export default function AdminApp() {
  const { slug } = useParams<{ slug?: string[] }>();
  const { id, params, guarded } = matchRoute(slug);
  const Page = pages[id];
  const page = (
    <AdminParamsContext.Provider value={params}>
      <Page />
    </AdminParamsContext.Provider>
  );
  return guarded ? <AuthGate>{page}</AuthGate> : page;
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
} from '@opencms/schema';
export type { Locale } from '@opencms/schema';
export { useLocale, useTranslator, useFormat } from './i18n/hooks';
