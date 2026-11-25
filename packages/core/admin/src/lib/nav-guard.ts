// In-app navigation guard for unsaved changes (spec §8). `Link` and `useAdminNavigate` (lib/nav) ask
// `confirmNavigation()` before they navigate. Pure module state; relative imports only.
import { t } from '../i18n';

type Guard = () => boolean;
const guards = new Set<Guard>();

/** Registers a guard that returns `true` while it holds unsaved changes. Returns the unregister function. */
export function registerNavigationGuard(blocking: Guard): () => void {
  guards.add(blocking);
  return () => {
    guards.delete(blocking);
  };
}

/** `true` when navigation may go ahead: nothing is dirty, or the user confirmed leaving. */
export function confirmNavigation(): boolean {
  for (const g of guards) {
    if (g()) return typeof window === 'undefined' || window.confirm(t('content.unsavedConfirm'));
  }
  return true;
}
