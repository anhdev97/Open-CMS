'use client';

import { useParams } from 'next/navigation';
import type { BlockRegistry } from '@opencloudcms/core/blocks';
import { AuthGate } from './auth/AuthGate';
import { AdminParamsContext } from './lib/nav';
import { matchRoute } from './router/match';
import { useLocale } from './i18n/hooks';
import { pages } from './router/routes';
import { RouteGuard } from './router/RouteGuard';
import { BlocksContext } from './page-editor/blocks-context';

export interface AdminAppProps {
  /** The project's blocks for the page editor (`defineBlocks([...])`). Absent: `defineBlocks(coreBlocks)`. */
  blocks?: BlockRegistry;
}

/**
 * The whole admin (catch-all route). Export it as the page as-is, or wrap it in a client component that passes
 * the project's `blocks`.
 */
export default function AdminApp({ blocks }: AdminAppProps = {}) {
  useLocale(); // re-render the route tree (state kept) when the admin language changes
  const { slug } = useParams<{ slug?: string[] }>();
  const { id, params, guarded, fullScreen } = matchRoute(slug);
  const Page = pages[id];
  const page = (
    <BlocksContext.Provider value={blocks ?? null}>
      <AdminParamsContext.Provider value={params}>
        <RouteGuard id={id}>
          <Page />
        </RouteGuard>
      </AdminParamsContext.Provider>
    </BlocksContext.Provider>
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
export type { BlockRegistry } from '@opencloudcms/core/blocks';
export { useLocale, useTranslator, useFormat } from './i18n/hooks';
