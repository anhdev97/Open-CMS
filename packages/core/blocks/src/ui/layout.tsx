// Isomorphic layout primitives (no hooks, no browser globals). Unknown token values fall back to the default class.
import type { ReactNode } from 'react';
import type { ColorToken, SpacingToken } from '../types';
import { BG, COLS, GAP, GRID_N, P, PY, STACK_ALIGN, cn } from './tokens';

type Children = { children?: ReactNode };

type BoxProps = { padding?: SpacingToken; background?: ColorToken };
type StackProps = { direction: 'vertical' | 'horizontal'; gap?: SpacingToken; align?: 'start' | 'center' | 'end' | 'stretch' };
type ColumnsProps = { count: 2 | 3 | 4; gap?: SpacingToken };
type GridProps = { columns: 2 | 3 | 4 | 5 | 6; gap?: SpacingToken };
type CardProps = { padding?: SpacingToken; background?: ColorToken; bordered?: boolean };

/**
 * Class of each layout primitive's element, for tools that must draw the same box around their own element (the
 * block builder canvas puts the layout classes on its drop zones).
 */
export const layoutClass = {
  Box: ({ padding, background }: BoxProps) => cn(PY[padding as SpacingToken] ?? PY['8'], background ? BG[background] : undefined),
  Stack: ({ direction, gap, align }: StackProps) =>
    cn('flex', direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col', GAP[gap as SpacingToken] ?? GAP['4'], STACK_ALIGN[align as 'start'] ?? STACK_ALIGN.stretch),
  Columns: ({ count, gap }: ColumnsProps) => cn('grid', COLS[count] ?? COLS[2], GAP[gap as SpacingToken] ?? GAP['6']),
  Grid: ({ columns, gap }: GridProps) => cn('grid', GRID_N[columns] ?? GRID_N[3], GAP[gap as SpacingToken] ?? GAP['6']),
  Card: ({ padding, background, bordered = true }: CardProps) =>
    cn(
      'flex flex-col gap-4 overflow-hidden rounded-xl text-card-foreground shadow-xs',
      bordered ? 'border' : undefined,
      background ? BG[background] ?? 'bg-card' : 'bg-card',
      P[padding as SpacingToken] ?? P['6'],
    ),
};

export function Box({ children, ...p }: BoxProps & Children) {
  return <div className={layoutClass.Box(p)}>{children}</div>;
}

export function Stack({ children, ...p }: StackProps & Children) {
  return <div className={layoutClass.Stack(p)}>{children}</div>;
}

export function Columns({ children, ...p }: ColumnsProps & Children) {
  return <div className={layoutClass.Columns(p)}>{children}</div>;
}

export function Grid({ children, ...p }: GridProps & Children) {
  return <div className={layoutClass.Grid(p)}>{children}</div>;
}

export function Card({ children, ...p }: CardProps & Children) {
  return (
    <div data-slot="card" className={layoutClass.Card(p)}>
      {children}
    </div>
  );
}
