// Pure style values shared by the block builder, the admin panel and the renderer.
// Must not import from `node:*` (bundled for the browser and shared with Nest and the blocks package).
import type { ComposedIssue } from './composed-block';

export const BREAKPOINTS = ['base', 'md', 'lg'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
export type Responsive<T> = T | Partial<Record<Breakpoint, T>>;

/** Same lists as `SPACING_TOKENS` / `COLOR_TOKENS` in `@opencloudcms/blocks` (kept equal by a core test). */
export const STYLE_SPACING_TOKENS = ['0', '2', '4', '6', '8', '12', '16', '24'] as const;
export const STYLE_COLOR_TOKENS = ['primary', 'secondary', 'muted', 'accent', 'background', 'foreground', 'destructive'] as const;
export const RADIUS_TOKENS = ['none', 'sm', 'md', 'lg', 'xl', 'full'] as const;
export const BORDER_WIDTH_TOKENS = ['0', '1', '2', '4'] as const;
export const BORDER_SIDES = ['t', 'r', 'b', 'l'] as const;

/** A spacing token (unit-less), a custom length (`37px`) or `auto`. */
export type Length = string;
/** A color token, `brand:<name>` or hex. */
export type ColorValue = string;
/** `<n>fr` (1-12), `auto` or a Length. */
export type Track = string;
export type Sides = { t?: Length; r?: Length; b?: Length; l?: Length };

export interface NodeStyle {
  padding?: Responsive<Sides>;
  margin?: Responsive<Sides>;
  width?: Responsive<Length>;
  maxWidth?: Responsive<Length>;
  height?: Responsive<Length>;
  minHeight?: Responsive<Length>;
  background?: ColorValue;
  color?: ColorValue;
  borderWidth?: string;
  borderColor?: ColorValue;
  borderSides?: ('t' | 'r' | 'b' | 'l')[];
  radius?: string;
  hidden?: Partial<Record<Breakpoint, boolean>>;
  /** Column span inside Columns/Grid: 1-12 or 'full'. */
  span?: Responsive<number | 'full'>;
  /** Colors on hover (Box, Card and Button only). */
  hover?: HoverStyle;
}

export interface HoverStyle {
  background?: ColorValue;
  color?: ColorValue;
  borderColor?: ColorValue;
}

/** Elements whose style may carry `hover`. */
export const HOVER_ELEMENTS: readonly string[] = ['Box', 'Card', 'Button'];

const CUSTOM_LENGTH_RE = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|vw|vh)$/;
const BRAND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FR_RE = /^(\d{1,2})fr$/;
const MAX_LENGTH = 10000;
export const MAX_TRACKS = 12;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);

function isCustomLength(v: string, negative: boolean): boolean {
  const m = CUSTOM_LENGTH_RE.exec(v);
  if (!m) return false;
  const n = Number(m[1]);
  return Number.isFinite(n) && Math.abs(n) <= MAX_LENGTH && (negative || n >= 0);
}

export function isLength(v: unknown, opts: { negative?: boolean; auto?: boolean } = {}): boolean {
  if (typeof v !== 'string') return false;
  if (v === 'auto') return !!opts.auto;
  return has(STYLE_SPACING_TOKENS, v) || isCustomLength(v, !!opts.negative);
}

export function isColorValue(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  if (has(STYLE_COLOR_TOKENS, v)) return true;
  if (v.startsWith('brand:')) return BRAND_RE.test(v.slice(6));
  return HEX_RE.test(v);
}

export function isTrack(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const fr = FR_RE.exec(v);
  if (fr) return Number(fr[1]) >= 1 && Number(fr[1]) <= 12;
  return isLength(v, { auto: true });
}

const isBreakpoint = (k: string): k is Breakpoint => (BREAKPOINTS as readonly string[]).includes(k);
/** A responsive object: a plain object whose every key is a breakpoint. */
const isResponsiveObject = (v: unknown): v is Partial<Record<Breakpoint, unknown>> =>
  isObj(v) && Object.keys(v).every(isBreakpoint);

export function resolveResponsive<T>(v: Responsive<T> | undefined): Partial<Record<Breakpoint, T>> {
  if (v === undefined) return {};
  if (isResponsiveObject(v)) return v as Partial<Record<Breakpoint, T>>;
  return { base: v as T };
}

/** Value in effect at `bp` (inherited from the nearest smaller breakpoint) and where it comes from. */
export function valueAt<T>(v: Responsive<T> | undefined, bp: Breakpoint): { value: T | undefined; from: Breakpoint | null } {
  const r = resolveResponsive(v);
  for (let i = BREAKPOINTS.indexOf(bp); i >= 0; i--) {
    const b = BREAKPOINTS[i];
    if (r[b] !== undefined) return { value: r[b], from: b };
  }
  return { value: undefined, from: null };
}

export function setAt<T>(v: Responsive<T> | undefined, bp: Breakpoint, next: T | undefined): Responsive<T> | undefined {
  if (v !== undefined && !isResponsiveObject(v) && bp === 'base' && next !== undefined) return next;
  const r: Partial<Record<Breakpoint, T>> = { ...resolveResponsive(v) };
  if (next === undefined) delete r[bp]; else r[bp] = next;
  return Object.keys(r).length ? r : undefined;
}

type Path = (string | number)[];

/** Check a Responsive<T>: a plain value (or a non-breakpoint object, e.g. Sides) is checked as is, a breakpoint object once per breakpoint. */
export function checkResponsive(v: unknown, path: Path, leaf: (v: unknown, path: Path) => void): void {
  if (isResponsiveObject(v)) {
    for (const [k, x] of Object.entries(v)) leaf(x, [...path, k]);
  } else leaf(v, path);
}

function lengthLeaf(add: (p: Path, m: string) => void, opts: { negative?: boolean; auto?: boolean }, what = 'length') {
  return (v: unknown, p: Path) => {
    if (!isLength(v, opts)) add(p, `must be a spacing token or a ${what} like 12px, 2rem or 50%${opts.auto ? ' (or auto)' : ''}`);
  };
}

function sidesLeaf(add: (p: Path, m: string) => void, opts: { negative?: boolean; auto?: boolean }) {
  const one = lengthLeaf(add, opts);
  return (v: unknown, p: Path) => {
    if (!isObj(v)) return add(p, 'must be an object with t, r, b, l');
    for (const [k, x] of Object.entries(v)) {
      if (!has(BORDER_SIDES, k)) add([...p, k], 'side must be t, r, b or l');
      else if (x !== undefined) one(x, [...p, k]);
    }
  };
}

/**
 * Issues of a node style. With `el`, `hover` is an issue unless the element is in `HOVER_ELEMENTS`; without it,
 * `hover` is only checked for its colors.
 */
export function validateNodeStyle(style: unknown, path: Path, el?: string): ComposedIssue[] {
  const issues: ComposedIssue[] = [];
  const add = (p: Path, message: string) => issues.push({ path: p, message });
  if (style === undefined) return issues;
  if (!isObj(style)) return [{ path, message: 'style must be an object' }];
  const color = (v: unknown, p: Path) => {
    if (!isColorValue(v)) add(p, 'must be a color token, brand:<name> or a hex color');
  };
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined) continue;
    const p = [...path, k];
    switch (k) {
      case 'padding': checkResponsive(v, p, sidesLeaf(add, {})); break;
      case 'margin': checkResponsive(v, p, sidesLeaf(add, { negative: true, auto: true })); break;
      case 'width': case 'height': checkResponsive(v, p, lengthLeaf(add, { auto: true })); break;
      case 'maxWidth': case 'minHeight': checkResponsive(v, p, lengthLeaf(add, {})); break;
      case 'background': case 'color': case 'borderColor': color(v, p); break;
      case 'borderWidth':
        if (!(has(BORDER_WIDTH_TOKENS, v) || (typeof v === 'string' && /px$/.test(v) && isCustomLength(v, false)))) {
          add(p, 'must be 0, 1, 2, 4 or a px length');
        }
        break;
      case 'radius':
        if (!(has(RADIUS_TOKENS, v) || (typeof v === 'string' && /px$/.test(v) && isCustomLength(v, false)))) {
          add(p, 'must be none, sm, md, lg, xl, full or a px length');
        }
        break;
      case 'borderSides':
        if (!Array.isArray(v)) add(p, 'borderSides must be an array');
        else v.forEach((s, i) => { if (!has(BORDER_SIDES, s)) add([...p, i], 'side must be t, r, b or l'); });
        break;
      case 'hidden':
        if (!isObj(v)) add(p, 'hidden must be an object');
        else for (const [bp, b] of Object.entries(v)) {
          if (!isBreakpoint(bp)) add([...p, bp], `"${bp}" is not a breakpoint (base, md, lg)`);
          else if (typeof b !== 'boolean') add([...p, bp], 'must be a boolean');
        }
        break;
      case 'span':
        checkResponsive(v, p, (x, q) => {
          if (!(x === 'full' || (Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 12))) add(q, "span must be an integer 1-12 or 'full'");
        });
        break;
      case 'hover':
        if (el !== undefined && !HOVER_ELEMENTS.includes(el)) add(p, 'hover is only allowed on Box, Card and Button');
        else if (!isObj(v)) add(p, 'hover must be an object');
        else for (const [hk, hv] of Object.entries(v)) {
          if (hk === 'background' || hk === 'color' || hk === 'borderColor') { if (hv !== undefined) color(hv, [...p, hk]); }
          else add([...p, hk], `unknown hover property "${hk}" (background, color, borderColor)`);
        }
        break;
      default: add(p, `unknown style property "${k}"`);
    }
  }
  return issues;
}
