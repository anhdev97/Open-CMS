// Literal Tailwind class lookup tables shared by the core library and the public `ui` primitives. Class names are literal
// strings so Tailwind's `@source` scan of dist/blocks finds them; never interpolate.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ColorToken, SpacingToken } from '../types';

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

export const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};
export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3',
  default: 'h-9 px-4 py-2',
  lg: 'h-10 px-6',
};

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';
export const BADGE_VARIANT: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'border-transparent bg-destructive text-destructive-foreground',
};

export const P: Record<SpacingToken, string> = {
  '0': 'p-0', '2': 'p-2', '4': 'p-4', '6': 'p-6', '8': 'p-8', '12': 'p-12', '16': 'p-16', '24': 'p-24',
};
export const GRID_N: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
};
export const STACK_ALIGN: Record<'start' | 'center' | 'end' | 'stretch', string> = {
  start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch',
};
export const RATIO: Record<'auto' | 'square' | 'video' | 'wide', string> = {
  auto: 'h-auto', square: 'aspect-square', video: 'aspect-video', wide: 'aspect-[21/9]',
};
export const TEXT_SIZE: Record<'sm' | 'base' | 'lg', string> = { sm: 'text-sm', base: 'text-base', lg: 'text-lg' };
export const TEXT_COLOR: Record<ColorToken, string> = {
  primary: 'text-primary', secondary: 'text-secondary-foreground', muted: 'text-muted-foreground', accent: 'text-accent-foreground',
  background: 'text-background', foreground: 'text-foreground', destructive: 'text-destructive',
};
export const HEADING: Record<1 | 2 | 3 | 4, string> = {
  1: 'text-4xl font-bold tracking-tight', 2: 'text-3xl font-semibold tracking-tight',
  3: 'text-2xl font-semibold', 4: 'text-xl font-semibold',
};
