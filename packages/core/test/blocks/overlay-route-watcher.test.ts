// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/a' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
const closeAll = vi.hoisted(() => vi.fn());
vi.mock('../../blocks/src/client/overlay-store', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  closeAllOverlays: closeAll,
}));

import { OverlayRouteWatcher } from '../../blocks/src/next/overlay-route-watcher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
beforeEach(() => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  closeAll.mockClear();
  nav.pathname = '/a';
});
let mounted = true;
afterEach(() => {
  if (mounted) act(() => root.unmount());
  mounted = true;
});

describe('OverlayRouteWatcher', () => {
  it('renders nothing and closes every overlay when the pathname changes (not on mount)', () => {
    act(() => root.render(createElement(OverlayRouteWatcher)));
    expect(document.body.textContent).toBe('');
    expect(closeAll).not.toHaveBeenCalled();
    act(() => root.render(createElement(OverlayRouteWatcher)));
    expect(closeAll).not.toHaveBeenCalled();
    nav.pathname = '/b';
    act(() => root.render(createElement(OverlayRouteWatcher)));
    expect(closeAll).toHaveBeenCalledTimes(1);
  });

  it('closes every overlay when it unmounts (App Router: the old page subtree is hidden, the new watcher mounts with the new path)', () => {
    act(() => root.render(createElement(OverlayRouteWatcher)));
    expect(closeAll).not.toHaveBeenCalled();
    act(() => root.unmount());
    mounted = false;
    expect(closeAll).toHaveBeenCalledTimes(1);
  });
});
