// Isomorphic layout primitives (no hooks, no browser globals). Unknown token values fall back to the default class.
import type { ReactNode } from 'react';
import type { ColorToken, SpacingToken } from '../types';
import { BG, COLS, GAP, GRID_N, P, PY, STACK_ALIGN, cn } from './tokens';

type Children = { children?: ReactNode };

export function Box({ padding, background, children }: { padding?: SpacingToken; background?: ColorToken } & Children) {
  return <div className={cn(PY[padding as SpacingToken] ?? PY['8'], background ? BG[background] : undefined)}>{children}</div>;
}

export function Stack({
  direction, gap, align, children,
}: { direction: 'vertical' | 'horizontal'; gap?: SpacingToken; align?: 'start' | 'center' | 'end' | 'stretch' } & Children) {
  return (
    <div className={cn('flex', direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col', GAP[gap as SpacingToken] ?? GAP['4'], STACK_ALIGN[align as 'start'] ?? STACK_ALIGN.stretch)}>
      {children}
    </div>
  );
}

export function Columns({ count, gap, children }: { count: 2 | 3 | 4; gap?: SpacingToken } & Children) {
  return <div className={cn('grid', COLS[count] ?? COLS[2], GAP[gap as SpacingToken] ?? GAP['6'])}>{children}</div>;
}

export function Grid({ columns, gap, children }: { columns: 2 | 3 | 4 | 5 | 6; gap?: SpacingToken } & Children) {
  return <div className={cn('grid', GRID_N[columns] ?? GRID_N[3], GAP[gap as SpacingToken] ?? GAP['6'])}>{children}</div>;
}

export function Card({
  padding, background, bordered = true, children,
}: { padding?: SpacingToken; background?: ColorToken; bordered?: boolean } & Children) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 overflow-hidden rounded-xl text-card-foreground shadow-xs',
        bordered ? 'border' : undefined,
        background ? BG[background] ?? 'bg-card' : 'bg-card',
        P[padding as SpacingToken] ?? P['6'],
      )}
    >
      {children}
    </div>
  );
}
