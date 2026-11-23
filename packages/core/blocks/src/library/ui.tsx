// Presentational primitives for the core block library. They mirror the admin shadcn components
// (admin/src/components/ui/{button,badge,card}.tsx) with the same design tokens, but have no admin-only
// dependencies (router, i18n, radix) so they are safe in server components, Nest (CJS) and the editor iframe.
// Class names are literal strings so Tailwind's `@source` scan of dist/blocks finds them.
import { clsx, type ClassValue } from 'clsx';
import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ColorToken, SpacingToken } from '../types';

export const L = (en: string, vi: string, fr: string, id: string) => ({ 'en-US': en, 'vi-VN': vi, 'fr-FR': fr, 'id-ID': id });

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const BG: Record<ColorToken, string> = {
  primary: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  muted: 'bg-muted text-foreground',
  accent: 'bg-accent text-accent-foreground',
  background: 'bg-background text-foreground',
  foreground: 'bg-foreground text-background',
  destructive: 'bg-destructive text-destructive-foreground',
};

export const PY: Record<SpacingToken, string> = {
  '0': 'py-0', '2': 'py-2', '4': 'py-4', '6': 'py-6', '8': 'py-8', '12': 'py-12', '16': 'py-16', '24': 'py-24',
};
export const GAP: Record<SpacingToken, string> = {
  '0': 'gap-0', '2': 'gap-2', '4': 'gap-4', '6': 'gap-6', '8': 'gap-8', '12': 'gap-12', '16': 'gap-16', '24': 'gap-24',
};
export const H: Record<SpacingToken, string> = {
  '0': 'h-0', '2': 'h-2', '4': 'h-4', '6': 'h-6', '8': 'h-8', '12': 'h-12', '16': 'h-16', '24': 'h-24',
};
export const MY: Record<SpacingToken, string> = {
  '0': 'my-0', '2': 'my-2', '4': 'my-4', '6': 'my-6', '8': 'my-8', '12': 'my-12', '16': 'my-16', '24': 'my-24',
};

export const ALIGN: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left', center: 'text-center', right: 'text-right',
};
export const JUSTIFY: Record<'left' | 'center' | 'right', string> = {
  left: 'justify-start', center: 'justify-center', right: 'justify-end',
};

export const COLS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
};
export const GRID_COLS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'default' | 'lg';

const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3',
  default: 'h-9 px-4 py-2',
  lg: 'h-10 px-6',
};

/** A link-styled button: an anchor when `href` resolved, otherwise an inert span (never a dead `<a>`). */
export function LinkButton({
  label, href, variant = 'default', size = 'default', className,
}: { label: string; href: string | null | undefined; variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  const cls = cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className);
  return href ? (
    <a data-slot="button" href={href} className={cls}>{label}</a>
  ) : (
    <span data-slot="button" className={cls}>{label}</span>
  );
}

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';
const BADGE_VARIANT: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'border-transparent bg-destructive text-destructive-foreground',
};
export function BadgePill({ children, variant = 'default', className }: { children: ReactNode; variant?: BadgeVariant; className?: string }) {
  return (
    <span
      data-slot="badge"
      className={cn('inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', BADGE_VARIANT[variant], className)}
    >
      {children}
    </span>
  );
}

export function CardBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="card" className={cn('flex flex-col gap-4 overflow-hidden rounded-xl border bg-card py-6 text-card-foreground shadow-xs', className)}>
      {children}
    </div>
  );
}
