// Carousel class tables (literal Tailwind classes), in a plain module so server code and the block builder canvas
// can import them without the 'use client' Carousel runtime.
import type { SpacingToken } from '../types';

export const CAROUSEL = 'relative';
export const CAROUSEL_TRACK = 'flex gap-(--ocms-gap) overflow-x-auto overscroll-x-contain [scrollbar-width:thin]';
export const CAROUSEL_SNAP = 'snap-x snap-mandatory';
export const CAROUSEL_TRACK_ARROWS = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
/** Slide width from `--ocms-pv` (slides per view, may be fractional: 1.25 shows a peek of the next one) and the gap. */
export const CAROUSEL_SLIDE =
  'min-w-0 shrink-0 grow-0 basis-[calc((100%-(var(--ocms-pv)-1)*var(--ocms-gap))/var(--ocms-pv))] md:basis-[calc((100%-(var(--ocms-pv-md)-1)*var(--ocms-gap))/var(--ocms-pv-md))] lg:basis-[calc((100%-(var(--ocms-pv-lg)-1)*var(--ocms-gap))/var(--ocms-pv-lg))]';
export const CAROUSEL_SLIDE_SNAP = 'snap-start';
export const CAROUSEL_ARROW =
  'absolute top-1/2 z-10 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40';
export const CAROUSEL_PREV = 'left-2';
export const CAROUSEL_NEXT = 'right-2';
export const CAROUSEL_DOTS = 'mt-3 flex flex-wrap items-center justify-center gap-1';
export const CAROUSEL_DOT =
  'group/dot inline-flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const CAROUSEL_DOT_MARK = 'size-2 rounded-full bg-muted-foreground/40 group-aria-[current=true]/dot:bg-foreground';
export const CAROUSEL_PAUSE =
  'inline-flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';
export const CAROUSEL_GAP: Record<SpacingToken, string> = {
  '0': '0px', '2': 'calc(var(--spacing) * 2)', '4': 'calc(var(--spacing) * 4)', '6': 'calc(var(--spacing) * 6)', '8': 'calc(var(--spacing) * 8)',
  '12': 'calc(var(--spacing) * 12)', '16': 'calc(var(--spacing) * 16)', '24': 'calc(var(--spacing) * 24)',
};
