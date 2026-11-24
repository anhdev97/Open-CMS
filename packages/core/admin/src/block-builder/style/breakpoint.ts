'use client';

// The breakpoint the style panel edits (mobile-first: `base` = Mobile). The builder's device toggle provides it.
import { createContext, useContext } from 'react';
import type { Breakpoint } from '@opencloudcms/schema';

export const BreakpointContext = createContext<Breakpoint>('base');

export function useBreakpoint(): Breakpoint {
  return useContext(BreakpointContext);
}
