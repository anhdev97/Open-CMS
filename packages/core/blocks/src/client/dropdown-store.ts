'use client';
// Registry of mounted Dropdowns, so a route change (OverlayRouteWatcher) can close every open one.
const closers = new Set<() => void>();

export function registerDropdown(close: () => void): () => void {
  closers.add(close);
  return () => {
    closers.delete(close);
  };
}

/** Closes every open Dropdown (route change). */
export function closeAllDropdowns(): void {
  closers.forEach((c) => c());
}
