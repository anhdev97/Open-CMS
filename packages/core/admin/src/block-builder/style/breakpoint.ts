'use client';

// The breakpoint the style panel edits (mobile-first: `base` = Mobile). The builder's device toggle provides it.
import { createContext, useContext } from 'react';
import type { Breakpoint } from '@opencloudcms/schema';

export const BreakpointContext = createContext<Breakpoint>('base');

export function useBreakpoint(): Breakpoint {
  return useContext(BreakpointContext);
}

/** Canvas widths of the device toggle (Puck `viewports`), smallest first. */
export const DEVICE_VIEWPORTS: readonly { bp: Breakpoint; width: number; icon: 'Smartphone' | 'Tablet' | 'Monitor' }[] = [
  { bp: 'base', width: 375, icon: 'Smartphone' },
  { bp: 'md', width: 768, icon: 'Tablet' },
  { bp: 'lg', width: 1280, icon: 'Monitor' },
];

/** The breakpoint a canvas of `width` px shows (`md` ≥ 768, `lg` ≥ 1024, as the site's Tailwind breakpoints). */
export function breakpointForWidth(width: number): Breakpoint {
  return width < 768 ? 'base' : width < 1024 ? 'md' : 'lg';
}
