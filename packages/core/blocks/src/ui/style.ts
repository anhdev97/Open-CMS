// `NodeStyle` → literal classes + `--ocms-*` variables. Every value is re-validated with the schema checks before it
// reaches a `style` attribute (invalid values are skipped), and every class comes from the literal tables in tokens.ts.
// Isomorphic: no hooks, no browser or Node globals.
import type { CSSProperties } from 'react';
import {
  BORDER_SIDES, BORDER_WIDTH_TOKENS, BREAKPOINTS, RADIUS_TOKENS, STYLE_COLOR_TOKENS, STYLE_SPACING_TOKENS,
  isColorValue, isLength, isTrack, resolveResponsive,
  type Breakpoint, type NodeStyle, type Responsive, type Track,
} from '@opencloudcms/schema';
import { BORDER_SIDE, HIDE, SHOW, STYLE_CLASS, STYLE_HOVER, STYLE_SINGLE, type Display, type StyleVar } from './tokens';

export type StyleResult = { className: string; style: CSSProperties };

const SUFFIX: Record<Breakpoint, string> = { base: '', md: '-md', lg: '-lg' };
const MAX_TRACKS = 12;
const PX_RE = /^\d+(?:\.\d+)?px$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const inList = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);

/** Spacing token → `calc(var(--spacing) * N)`; any other (already validated) length as is. */
export function cssLength(v: string): string {
  return inList(STYLE_SPACING_TOKENS, v) ? `calc(var(--spacing) * ${v})` : v;
}

/** Color token → `var(--color-<token>)`, `brand:x` → `var(--ocms-color-x)`, hex as is. */
export function cssColor(v: string): string {
  if (inList(STYLE_COLOR_TOKENS, v)) return `var(--color-${v})`;
  if (v.startsWith('brand:')) return `var(--ocms-color-${v.slice(6)})`;
  return v;
}

const FR_RE = /^\d{1,2}fr$/;
/** One track: `<n>fr` → `minmax(0,<n>fr)` (shrinks below its content, like Tailwind's `grid-cols-N`), others as `cssLength`. */
const cssTrack = (t: string): string => (FR_RE.test(t) ? `minmax(0,${t})` : cssLength(t));

/**
 * Track list → `grid-template-columns` value (`minmax(0,2fr) minmax(0,3fr)`, `auto minmax(0,1fr) auto`). fr tracks get
 * a 0 minimum so wide content (a nowrap button, a long word) cannot widen its column, as with `grid-cols-N`.
 */
export function cssTracks(t: Track[]): string {
  return t.map(cssTrack).join(' ');
}

/** Valid `tracks` per breakpoint, missing ones filled from the smaller breakpoint; `null` when none is valid. */
export function resolveTracks(tracks: Responsive<Track[]> | undefined): Record<Breakpoint, string> | null {
  const r = resolveResponsive(tracks as Responsive<Track[]> | undefined);
  const ok = (t: unknown): t is Track[] => Array.isArray(t) && t.length >= 1 && t.length <= MAX_TRACKS && t.every(isTrack);
  const out: Partial<Record<Breakpoint, string>> = {};
  let prev: string | undefined;
  let any = false;
  for (const bp of BREAKPOINTS) {
    const t = r[bp];
    if (ok(t)) { prev = cssTracks(t); any = true; }
    out[bp] = prev ?? 'minmax(0,1fr)';
  }
  return any ? (out as Record<Breakpoint, string>) : null;
}

const RADIUS: Record<(typeof RADIUS_TOKENS)[number], string> = {
  none: '0', sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)', full: '9999px',
};

const isPx = (v: unknown): v is string => typeof v === 'string' && PX_RE.test(v) && Number.parseFloat(v) <= 10000;

/** Classes and variables of `style`; `display` is the element's own display, restored where it is not hidden. */
export function styleProps(style: NodeStyle | undefined, display: Display = 'block'): StyleResult {
  const cls: string[] = [];
  const vars: Record<string, string> = {};
  if (!isObj(style)) return { className: '', style: {} };
  const s = style as Record<string, unknown>;

  const put = (key: StyleVar, bp: Breakpoint, value: string) => {
    cls.push(STYLE_CLASS[key][bp]);
    vars[`--ocms-${key}${SUFFIX[bp]}`] = value;
  };
  const responsive = (v: unknown, each: (x: unknown, bp: Breakpoint) => void) => {
    const r = resolveResponsive(v as Responsive<unknown>);
    for (const bp of BREAKPOINTS) if (r[bp] !== undefined) each(r[bp], bp);
  };
  const sides = (v: unknown, prefix: 'p' | 'm', opts: { negative?: boolean; auto?: boolean }) =>
    responsive(v, (x, bp) => {
      if (!isObj(x)) return;
      for (const side of BORDER_SIDES) {
        const len = x[side];
        if (isLength(len, opts)) put(`${prefix}${side}` as StyleVar, bp, cssLength(len as string));
      }
    });
  const length = (v: unknown, key: StyleVar, opts: { auto?: boolean }) =>
    responsive(v, (x, bp) => { if (isLength(x, opts)) put(key, bp, cssLength(x as string)); });
  const color = (v: unknown, key: 'bg' | 'fg' | 'bc') => {
    if (!isColorValue(v)) return;
    cls.push(STYLE_SINGLE[key]);
    vars[`--ocms-${key}`] = cssColor(v as string);
  };

  sides(s.padding, 'p', {});
  sides(s.margin, 'm', { negative: true, auto: true });
  length(s.width, 'w', { auto: true });
  length(s.maxWidth, 'maxw', {});
  length(s.height, 'h', { auto: true });
  length(s.minHeight, 'minh', {});
  color(s.background, 'bg');
  color(s.color, 'fg');

  const bw = s.borderWidth;
  if (inList(BORDER_WIDTH_TOKENS, bw) || isPx(bw)) {
    const list = Array.isArray(s.borderSides) ? s.borderSides.filter((x) => inList(BORDER_SIDES, x)) : [...BORDER_SIDES];
    for (const side of BORDER_SIDES) if (list.includes(side)) cls.push(BORDER_SIDE[side]);
    vars['--ocms-bw'] = inList(BORDER_WIDTH_TOKENS, bw) ? `${bw}px` : (bw as string);
  }
  color(s.borderColor, 'bc');

  const radius = s.radius;
  if (inList(RADIUS_TOKENS, radius) || isPx(radius)) {
    cls.push(STYLE_SINGLE.r);
    vars['--ocms-r'] = inList(RADIUS_TOKENS, radius) ? RADIUS[radius as keyof typeof RADIUS] : (radius as string);
  }

  responsive(s.span, (x, bp) => {
    if (x === 'full') cls.push(STYLE_CLASS.spanFull[bp]);
    else if (Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 12) put('span', bp, String(x));
  });

  // Hover colors (validated onto Box, Card and Button only); after the base colors so they win in `cn`.
  if (isObj(s.hover)) {
    for (const k of ['background', 'color', 'borderColor'] as const) {
      const v = s.hover[k];
      if (!isColorValue(v)) continue;
      cls.push(STYLE_HOVER[k].cls);
      vars[STYLE_HOVER[k].v] = cssColor(v as string);
    }
  }

  const hidden = s.hidden;
  if (isObj(hidden) && BREAKPOINTS.some((bp) => hidden[bp] === true)) {
    const show = SHOW[display] ?? SHOW.block;
    for (const bp of BREAKPOINTS) cls.push(hidden[bp] === true ? HIDE[bp] : show[bp]);
  }

  return { className: cls.join(' '), style: vars as CSSProperties };
}

/** Per-breakpoint classes of a responsive enum prop; a missing `base` falls back to `fallback`'s base class. */
export function bpClasses<T extends string>(v: Responsive<T> | undefined, table: Record<Breakpoint, Record<T, string>>, fallback?: T): string[] {
  const r = resolveResponsive(v);
  const out: string[] = [];
  for (const bp of BREAKPOINTS) {
    const x = r[bp];
    const c = typeof x === 'string' && Object.prototype.hasOwnProperty.call(table[bp], x) ? table[bp][x] : undefined;
    if (c) out.push(c);
    else if (bp === 'base' && fallback !== undefined) out.push(table.base[fallback]);
  }
  return out;
}

/** Whether `sp` sets any padding side (the element then drops its padding token class). */
export const setsPadding = (sp: StyleResult) => Object.keys(sp.style).some((k) => /^--ocms-p[trbl]/.test(k));
/** Whether `sp` sets a background (the element then drops its background token class). */
export const setsBackground = (sp: StyleResult) => '--ocms-bg' in sp.style;
/** `style` attribute value: `undefined` when empty so unstyled elements render as before. */
export const styleAttr = (sp: StyleResult): CSSProperties | undefined => (Object.keys(sp.style).length ? sp.style : undefined);
