'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { closeOverlay, isOverlayOpen, openOverlay, subscribeOverlays, toggleOverlay } from './overlay-store';

export function useOverlay(name: string): { open(): void; close(): void; toggle(): void; isOpen: boolean } {
  const isOpen = useSyncExternalStore(
    subscribeOverlays,
    () => isOverlayOpen(name),
    () => false,
  );
  const open = useCallback(() => openOverlay(name), [name]);
  const close = useCallback(() => closeOverlay(name), [name]);
  const toggle = useCallback(() => toggleOverlay(name), [name]);
  return { open, close, toggle, isOpen };
}
