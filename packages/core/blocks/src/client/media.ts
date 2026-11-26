'use client';
// Viewport queries of the client runtimes. Read only inside effects and event handlers (never at import time), so the
// module is safe to load on the server and in the CJS build.
import type { Breakpoint, Responsive } from '@opencloudcms/schema';

/** Same widths as Tailwind's `md:` / `lg:` (48rem / 64rem). */
const QUERIES: Record<Exclude<Breakpoint, 'base'>, string> = { md: '(min-width: 48rem)', lg: '(min-width: 64rem)' };
const REDUCED = '(prefers-reduced-motion: reduce)';

const mq = (q: string): MediaQueryList | null => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null);

export function currentBreakpoint(): Breakpoint {
  if (mq(QUERIES.lg)?.matches) return 'lg';
  if (mq(QUERIES.md)?.matches) return 'md';
  return 'base';
}

export const prefersReducedMotion = (): boolean => !!mq(REDUCED)?.matches;

/** Calls `cb` when the breakpoint or the reduced-motion preference changes. */
export function subscribeMedia(cb: () => void): () => void {
  const lists = [QUERIES.md, QUERIES.lg, REDUCED].map(mq).filter((l): l is MediaQueryList => !!l);
  lists.forEach((l) => l.addEventListener?.('change', cb));
  return () => lists.forEach((l) => l.removeEventListener?.('change', cb));
}

const isBpObject = (v: unknown): v is Partial<Record<Breakpoint, unknown>> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => k === 'base' || k === 'md' || k === 'lg');

/** Value of a responsive prop at each breakpoint (inherited from the nearest smaller one), or `fallback`. */
export function perBreakpoint<T>(v: Responsive<T> | undefined, fallback: T, ok: (x: unknown) => x is T): Record<Breakpoint, T> {
  const r = isBpObject(v) ? v : v === undefined ? {} : { base: v };
  const base = ok(r.base) ? r.base : fallback;
  const md = ok(r.md) ? r.md : base;
  const lg = ok(r.lg) ? r.lg : md;
  return { base, md, lg };
}
