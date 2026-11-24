import { BREAKPOINTS, isTrack, resolveResponsive, type Breakpoint, type Responsive, type Track } from '@opencloudcms/schema';

/** Most tracks per breakpoint (same bound as the composed `Columns`). */
export const MAX_TRACKS = 12;

const ok = (t: unknown, max: number): t is Track[] =>
  Array.isArray(t) && t.length >= 1 && t.length <= max && t.every(isTrack);

/** True for a `Responsive<Track[]>` whose every breakpoint holds 1..max valid tracks. */
export function tracksValid(v: unknown, max: number): boolean {
  if (v === null || v === undefined) return false;
  const r = resolveResponsive(v as Responsive<Track[]>) as Partial<Record<Breakpoint, unknown>>;
  const set = BREAKPOINTS.filter((bp) => r[bp] !== undefined);
  return set.length > 0 && set.every((bp) => ok(r[bp], max));
}

/** Stored tracks the renderer can use: `null` unless fully valid; otherwise the value and its widest track count. */
export function readTracks(v: unknown, max: number): { value: Responsive<Track[]>; count: number } | null {
  if (!tracksValid(v, max)) return null;
  const r = resolveResponsive(v as Responsive<Track[]>) as Partial<Record<Breakpoint, Track[]>>;
  return { value: v as Responsive<Track[]>, count: Math.max(...BREAKPOINTS.map((bp) => r[bp]?.length ?? 0)) };
}
