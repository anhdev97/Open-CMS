// Tooltip shown with CSS only (`group-hover:` / `group-focus-within:`): the bubble is in the server HTML, named by
// `useId` so every rendered copy (collection items) has its own id. Isomorphic: `useId` is allowed in server
// components; no state, no browser globals. Esc-to-dismiss is client behaviour (blocks/client).
import { useId, type ReactNode } from 'react';
import type { NodeStyle } from '@opencloudcms/schema';
import { cn } from './tokens';
import { styleAttr, styleProps } from './style';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export const TOOLTIP_WRAPPER = 'relative inline-flex group';
/** Wrapper focus ring, when the wrapper itself takes focus (a target with nothing focusable). */
export const TOOLTIP_WRAPPER_FOCUS =
  'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
/** Wraps and is capped to the viewport so a bubble near an edge never adds horizontal scroll. */
export const TOOLTIP_BUBBLE =
  'pointer-events-none absolute z-50 w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-md bg-foreground px-3 py-1.5 text-xs leading-snug font-normal whitespace-normal break-words text-background shadow-md transition-opacity invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100';
export const TOOLTIP_OPEN = 'visible opacity-100';
export const TOOLTIP_SIDE: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
};

export type TooltipProps = {
  text: string;
  side?: TooltipSide;
  /**
   * The target. As a function it gets the bubble id, to put `aria-describedby` on the target's first focusable
   * element; the wrapper is then not focusable unless `focusWrapper` says the target has nothing to focus.
   */
  children: ReactNode | ((tooltipId: string) => ReactNode);
  /** The target has no focusable element: the wrapper takes focus (`tabindex=0`) and the description. */
  focusWrapper?: boolean;
  id?: string;
  style?: NodeStyle;
  /** Builder canvas only: force the bubble visible. Unused on the website. */
  editor?: { open?: boolean };
};

export function Tooltip({ text, side, children, focusWrapper, id, style, editor }: TooltipProps) {
  const tipId = useId();
  const sp = styleProps(style, 'inline-flex');
  const fn = typeof children === 'function';
  // A plain child cannot receive `aria-describedby`, so the wrapper describes itself and takes focus.
  const own = !fn || focusWrapper === true;
  return (
    <span
      id={id}
      className={cn(TOOLTIP_WRAPPER, own ? TOOLTIP_WRAPPER_FOCUS : undefined, sp.className)}
      style={styleAttr(sp)}
      tabIndex={own ? 0 : undefined}
      aria-describedby={own ? tipId : undefined}
    >
      {fn ? (children as (tooltipId: string) => ReactNode)(tipId) : children}
      <span role="tooltip" id={tipId} className={cn(TOOLTIP_BUBBLE, TOOLTIP_SIDE[side as TooltipSide] ?? TOOLTIP_SIDE.top, editor?.open ? TOOLTIP_OPEN : undefined)}>
        {text}
      </span>
    </span>
  );
}
