// Literal Tailwind class lookup tables shared by the core library and the public `ui` primitives. Class names are literal
// strings so Tailwind's `@source` scan of dist/blocks finds them; never interpolate.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ColorToken, SpacingToken } from '../types';

/**
 * Class join with tailwind-merge. The style system relies on it: Tailwind emits same-property utilities sorted by name
 * (`h-(--ocms-h)` before `h-9`), so every primitive passes its style classes last through `cn`, which drops the earlier
 * token class of the same property (`h-9`, `rounded-md`, `text-primary`, `inline-flex` under `hidden`, `flex-wrap` under
 * `flex-nowrap`, ...). test/blocks/style-css-order.test.ts compiles every primitive × style property to check it.
 */
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
/**
 * Variant classes when the node's style sets a background (`--ocms-bg`): the variant's own background and hover
 * background are left out (they would win on hover over the brand color) and hover dims instead.
 */
export const BUTTON_VARIANT_STYLED_BG: Record<ButtonVariant, string> = {
  default: 'text-primary-foreground hover:opacity-90',
  secondary: 'text-secondary-foreground hover:opacity-90',
  outline: 'border text-foreground shadow-xs hover:text-accent-foreground hover:opacity-90',
  ghost: 'hover:text-accent-foreground hover:opacity-90',
  link: 'text-primary underline-offset-4 hover:underline hover:opacity-90',
};
export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3',
  default: 'h-9 px-4 py-2',
  lg: 'h-10 px-6',
};
/** Square sizes of an icon-only button (replace `BUTTON_SIZE`). */
export const BUTTON_ICON_SIZE: Record<ButtonSize, string> = { sm: 'size-8', default: 'size-9', lg: 'size-10' };

/**
 * Image, Box and Card rendered as a link or button: theme focus ring, no default link/button look (preflight resets
 * color, background, border and padding). `CLICKABLE_BUTTON` adds what a `<button>` needs to lay out like a block.
 */
export const CLICKABLE = 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
export const CLICKABLE_BUTTON = 'w-full text-left';

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

// ---- Style system (`NodeStyle`): one literal class per property per breakpoint; values travel in `--ocms-*` variables.
type BpClass = { base: string; md: string; lg: string };

export const STYLE_CLASS = {
  pt: { base: 'pt-(--ocms-pt)', md: 'md:pt-(--ocms-pt-md)', lg: 'lg:pt-(--ocms-pt-lg)' },
  pr: { base: 'pr-(--ocms-pr)', md: 'md:pr-(--ocms-pr-md)', lg: 'lg:pr-(--ocms-pr-lg)' },
  pb: { base: 'pb-(--ocms-pb)', md: 'md:pb-(--ocms-pb-md)', lg: 'lg:pb-(--ocms-pb-lg)' },
  pl: { base: 'pl-(--ocms-pl)', md: 'md:pl-(--ocms-pl-md)', lg: 'lg:pl-(--ocms-pl-lg)' },
  mt: { base: 'mt-(--ocms-mt)', md: 'md:mt-(--ocms-mt-md)', lg: 'lg:mt-(--ocms-mt-lg)' },
  mr: { base: 'mr-(--ocms-mr)', md: 'md:mr-(--ocms-mr-md)', lg: 'lg:mr-(--ocms-mr-lg)' },
  mb: { base: 'mb-(--ocms-mb)', md: 'md:mb-(--ocms-mb-md)', lg: 'lg:mb-(--ocms-mb-lg)' },
  ml: { base: 'ml-(--ocms-ml)', md: 'md:ml-(--ocms-ml-md)', lg: 'lg:ml-(--ocms-ml-lg)' },
  w: { base: 'w-(--ocms-w)', md: 'md:w-(--ocms-w-md)', lg: 'lg:w-(--ocms-w-lg)' },
  maxw: { base: 'max-w-(--ocms-maxw)', md: 'md:max-w-(--ocms-maxw-md)', lg: 'lg:max-w-(--ocms-maxw-lg)' },
  h: { base: 'h-(--ocms-h)', md: 'md:h-(--ocms-h-md)', lg: 'lg:h-(--ocms-h-lg)' },
  minh: { base: 'min-h-(--ocms-minh)', md: 'md:min-h-(--ocms-minh-md)', lg: 'lg:min-h-(--ocms-minh-lg)' },
  cols: { base: 'grid-cols-(--ocms-cols)', md: 'md:grid-cols-(--ocms-cols-md)', lg: 'lg:grid-cols-(--ocms-cols-lg)' },
  span: { base: 'col-span-(--ocms-span)', md: 'md:col-span-(--ocms-span-md)', lg: 'lg:col-span-(--ocms-span-lg)' },
  spanFull: { base: 'col-span-full', md: 'md:col-span-full', lg: 'lg:col-span-full' },
} satisfies Record<string, BpClass>;
export type StyleVar = Exclude<keyof typeof STYLE_CLASS, 'spanFull'>;

/** Single (non-responsive) style classes. */
export const STYLE_SINGLE = {
  bg: 'bg-(--ocms-bg)', fg: 'text-(--ocms-fg)', bc: 'border-(--ocms-bc)', r: 'rounded-(--ocms-r)',
  gx: 'gap-x-(--ocms-gx)', gy: 'gap-y-(--ocms-gy)',
};
/** `style.hover` colors (Box, Card, Button): emitted only when set. */
export const STYLE_HOVER = {
  background: { cls: 'hover:bg-(--ocms-hover-bg)', v: '--ocms-hover-bg' },
  color: { cls: 'hover:text-(--ocms-hover-fg)', v: '--ocms-hover-fg' },
  borderColor: { cls: 'hover:border-(--ocms-hover-border)', v: '--ocms-hover-border' },
} as const;
export const BORDER_SIDE: Record<'t' | 'r' | 'b' | 'l', string> = {
  t: 'border-t-(length:--ocms-bw)', r: 'border-r-(length:--ocms-bw)', b: 'border-b-(length:--ocms-bw)', l: 'border-l-(length:--ocms-bw)',
};

export type Display = 'block' | 'flex' | 'grid' | 'inline-flex' | 'inline';
export const HIDE: BpClass = { base: 'hidden', md: 'md:hidden', lg: 'lg:hidden' };
export const SHOW: Record<Display, BpClass> = {
  block: { base: 'block', md: 'md:block', lg: 'lg:block' },
  flex: { base: 'flex', md: 'md:flex', lg: 'lg:flex' },
  grid: { base: 'grid', md: 'md:grid', lg: 'lg:grid' },
  'inline-flex': { base: 'inline-flex', md: 'md:inline-flex', lg: 'lg:inline-flex' },
  inline: { base: 'inline', md: 'md:inline', lg: 'lg:inline' },
};

/** Responsive Stack direction; `base` matches the classes of the plain value. */
export const STACK_DIRECTION: { [K in 'base' | 'md' | 'lg']: Record<'vertical' | 'horizontal', string> } = {
  base: { vertical: 'flex-col', horizontal: 'flex-row flex-wrap' },
  md: { vertical: 'md:flex-col', horizontal: 'md:flex-row md:flex-wrap' },
  lg: { vertical: 'lg:flex-col', horizontal: 'lg:flex-row lg:flex-wrap' },
};
export const STACK_ALIGN_BP: { [K in 'base' | 'md' | 'lg']: Record<'start' | 'center' | 'end' | 'stretch', string> } = {
  base: { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' },
  md: { start: 'md:items-start', center: 'md:items-center', end: 'md:items-end', stretch: 'md:items-stretch' },
  lg: { start: 'lg:items-start', center: 'lg:items-center', end: 'lg:items-end', stretch: 'lg:items-stretch' },
};
export const STACK_JUSTIFY: Record<'start' | 'center' | 'end' | 'between', string> = {
  start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between',
};
/** Explicit Stack `wrap`, per breakpoint, so it also beats the `md:flex-wrap` of a responsive horizontal direction. */
export const FLEX_WRAP: Record<'true' | 'false', { base: string; md: string; lg: string }> = {
  true: { base: 'flex-wrap', md: 'md:flex-wrap', lg: 'lg:flex-wrap' },
  false: { base: 'flex-nowrap', md: 'md:flex-nowrap', lg: 'lg:flex-nowrap' },
};

export type ImageAspect = 'auto' | 'square' | 'video' | '3/2' | '4/3' | 'wide';
export const IMAGE_ASPECT: { [K in 'base' | 'md' | 'lg']: Record<ImageAspect, string> } = {
  base: { auto: 'aspect-auto', square: 'aspect-square', video: 'aspect-video', '3/2': 'aspect-[3/2]', '4/3': 'aspect-[4/3]', wide: 'aspect-[21/9]' },
  md: { auto: 'md:aspect-auto', square: 'md:aspect-square', video: 'md:aspect-video', '3/2': 'md:aspect-[3/2]', '4/3': 'md:aspect-[4/3]', wide: 'md:aspect-[21/9]' },
  lg: { auto: 'lg:aspect-auto', square: 'lg:aspect-square', video: 'lg:aspect-video', '3/2': 'lg:aspect-[3/2]', '4/3': 'lg:aspect-[4/3]', wide: 'lg:aspect-[21/9]' },
};
export const OBJECT_FIT: Record<'cover' | 'contain', string> = { cover: 'object-cover', contain: 'object-contain' };
