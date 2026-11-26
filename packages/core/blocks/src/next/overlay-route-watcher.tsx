'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { closeAllOverlays } from '../client/overlay-store';

/**
 * Closes every open overlay when the route changes (client navigation keeps a `<dialog>` of the shared base page
 * open otherwise). Mounted by `createCmsPage` only on pages that render an overlay or an action button. Renders nothing.
 * Under the App Router each path gets a new page subtree and the old one is hidden (its effects clean up), so the
 * unmount cleanup is what fires on navigation; the pathname branch covers a watcher that stays mounted.
 */
export function OverlayRouteWatcher(): null {
  const pathname = usePathname();
  const last = useRef(pathname);
  useEffect(() => () => closeAllOverlays(), []);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    closeAllOverlays();
  }, [pathname]);
  return null;
}
