// Isomorphic layout primitives (no hooks, no browser globals). Unknown token values fall back to the default class.
import type { ReactNode } from 'react';
import { isLength, type NodeStyle, type Responsive, type Track } from '@opencloudcms/schema';
import type { ColorToken, SpacingToken } from '../types';
import {
  BG, COLS, FLEX_WRAP, GAP, GRID_N, P, PY, STACK_ALIGN, STACK_ALIGN_BP, STACK_DIRECTION, STACK_JUSTIFY, STYLE_CLASS, STYLE_SINGLE, cn,
} from './tokens';
import { bpClasses, cssLength, resolveTracks, setsBackground, setsPadding, styleAttr, styleProps, type StyleResult } from './style';

type Children = { children?: ReactNode; /** Element id (scroll target). */ id?: string };
type Styled = { style?: NodeStyle };
type Align = 'start' | 'center' | 'end' | 'stretch';
type Direction = 'vertical' | 'horizontal';

type BoxProps = Styled & { padding?: SpacingToken; background?: ColorToken };
type StackProps = Styled & {
  direction: Responsive<Direction>;
  gap?: SpacingToken;
  align?: Responsive<Align>;
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
};
type ColumnsProps = Styled & {
  count: 2 | 3 | 4;
  gap?: SpacingToken;
  tracks?: Responsive<Track[]>;
  alignY?: Align;
  gapX?: string;
  gapY?: string;
};
type GridProps = Styled & { columns: 2 | 3 | 4 | 5 | 6; gap?: SpacingToken };
type CardProps = Styled & { padding?: SpacingToken; background?: ColorToken; bordered?: boolean };

/** Explicit `wrap` classes: base only for a plain direction, every breakpoint for a responsive one (its md/lg rows add `flex-wrap`). */
function wrapClasses(wrap: boolean | undefined, responsive: boolean): string[] {
  if (wrap === undefined) return [];
  const w = FLEX_WRAP[wrap ? 'true' : 'false'];
  return responsive ? [w.base, w.md, w.lg] : [w.base];
}

/** Classes and variables of each layout primitive's element. */
const layout = {
  Box: ({ padding, background, style }: BoxProps): StyleResult => {
    const sp = styleProps(style, 'block');
    return {
      className: cn(
        // Any style padding (at any breakpoint, any side) drops the legacy padding token at every breakpoint.
        setsPadding(sp) ? undefined : PY[padding as SpacingToken] ?? PY['8'],
        background && !setsBackground(sp) ? BG[background] : undefined,
        sp.className,
      ),
      style: sp.style,
    };
  },
  Stack: ({ direction, gap, align, justify, wrap, style }: StackProps): StyleResult => {
    const sp = styleProps(style, 'flex');
    return {
      className: cn(
        'flex',
        bpClasses<Direction>(direction, STACK_DIRECTION, 'vertical'),
        GAP[gap as SpacingToken] ?? GAP['4'],
        typeof align === 'string' || align === undefined ? STACK_ALIGN[align as Align] ?? STACK_ALIGN.stretch : bpClasses<Align>(align, STACK_ALIGN_BP, 'stretch'),
        justify ? STACK_JUSTIFY[justify] : undefined,
        wrapClasses(wrap, typeof direction === 'object'),
        sp.className,
      ),
      style: sp.style,
    };
  },
  Columns: ({ count, gap, tracks, alignY, gapX, gapY, style }: ColumnsProps): StyleResult => {
    const sp = styleProps(style, 'grid');
    const t = resolveTracks(tracks);
    const vars: Record<string, string> = {};
    if (t) Object.assign(vars, { '--ocms-cols': t.base, '--ocms-cols-md': t.md, '--ocms-cols-lg': t.lg });
    const gx = isLength(gapX) ? gapX! : undefined;
    const gy = isLength(gapY) ? gapY! : undefined;
    if (gx) vars['--ocms-gx'] = cssLength(gx);
    if (gy) vars['--ocms-gy'] = cssLength(gy);
    return {
      className: cn(
        'grid',
        t ? [STYLE_CLASS.cols.base, STYLE_CLASS.cols.md, STYLE_CLASS.cols.lg] : COLS[count] ?? COLS[2],
        GAP[gap as SpacingToken] ?? GAP['6'],
        alignY ? STACK_ALIGN[alignY] : undefined,
        gx ? STYLE_SINGLE.gx : undefined,
        gy ? STYLE_SINGLE.gy : undefined,
        sp.className,
      ),
      style: { ...vars, ...sp.style },
    };
  },
  Grid: ({ columns, gap, style }: GridProps): StyleResult => {
    const sp = styleProps(style, 'grid');
    return { className: cn('grid', GRID_N[columns] ?? GRID_N[3], GAP[gap as SpacingToken] ?? GAP['6'], sp.className), style: sp.style };
  },
  Card: ({ padding, background, bordered = true, style }: CardProps): StyleResult => {
    const sp = styleProps(style, 'flex');
    const bg = setsBackground(sp) ? undefined : background ? BG[background] ?? 'bg-card' : 'bg-card';
    return {
      className: cn(
        'flex flex-col gap-4 overflow-hidden rounded-xl text-card-foreground shadow-xs',
        bordered ? 'border' : undefined,
        bg,
        // Any style padding (at any breakpoint, any side) drops the legacy padding token at every breakpoint.
        setsPadding(sp) ? undefined : P[padding as SpacingToken] ?? P['6'],
        sp.className,
      ),
      style: sp.style,
    };
  },
};

/**
 * Class of each layout primitive's element, for tools that must draw the same box around their own element (the
 * block builder canvas puts the layout classes on its drop zones). `layoutStyle` gives the matching variables.
 */
export const layoutClass = {
  Box: (p: BoxProps) => layout.Box(p).className,
  Stack: (p: StackProps) => layout.Stack(p).className,
  Columns: (p: ColumnsProps) => layout.Columns(p).className,
  Grid: (p: GridProps) => layout.Grid(p).className,
  Card: (p: CardProps) => layout.Card(p).className,
};

/** `style` attribute (the `--ocms-*` variables) of each layout primitive's element; `undefined` when none. */
export const layoutStyle = {
  Box: (p: BoxProps) => styleAttr(layout.Box(p)),
  Stack: (p: StackProps) => styleAttr(layout.Stack(p)),
  Columns: (p: ColumnsProps) => styleAttr(layout.Columns(p)),
  Grid: (p: GridProps) => styleAttr(layout.Grid(p)),
  Card: (p: CardProps) => styleAttr(layout.Card(p)),
};

export function Box({ children, id, ...p }: BoxProps & Children) {
  const l = layout.Box(p);
  return <div id={id} className={l.className} style={styleAttr(l)}>{children}</div>;
}

export function Stack({ children, id, ...p }: StackProps & Children) {
  const l = layout.Stack(p);
  return <div id={id} className={l.className} style={styleAttr(l)}>{children}</div>;
}

export function Columns({ children, id, ...p }: ColumnsProps & Children) {
  const l = layout.Columns(p);
  return <div id={id} className={l.className} style={styleAttr(l)}>{children}</div>;
}

export function Grid({ children, id, ...p }: GridProps & Children) {
  const l = layout.Grid(p);
  return <div id={id} className={l.className} style={styleAttr(l)}>{children}</div>;
}

export function Card({ children, id, ...p }: CardProps & Children) {
  const l = layout.Card(p);
  return (
    <div id={id} data-slot="card" className={l.className} style={styleAttr(l)}>
      {children}
    </div>
  );
}
