// Overlay frame (`<dialog>`) of overlay blocks. Isomorphic: server-rendered closed; the client runtime
// (`@opencloudcms/core/blocks/client`) opens it with `showModal()`. Class names are literal strings in the tables below so
// Tailwind's `@source` scan of dist/blocks finds them; never interpolate.
import type { ReactNode } from 'react';
import type { NodeStyle } from '@opencloudcms/schema';
import { ActionButton } from '../client/ActionButton';
import { cn } from './tokens';
import { setsBackground, setsPadding, styleAttr, styleProps } from './style';

export type OverlayVariant = 'modal' | 'drawer';
export type OverlaySide = 'left' | 'right' | 'top' | 'bottom';
export type OverlaySize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/** The dialog box: card look, dimmed backdrop, fade in/out (`open:`/`starting:` with discrete display transitions). */
export const OVERLAY_BASE = {
  frame:
    'overflow-auto border text-card-foreground shadow-lg backdrop:bg-black/50 opacity-0 transition-[opacity,translate,display,overlay] transition-discrete duration-200 open:opacity-100 starting:open:opacity-0',
  background: 'bg-card',
};
/** Content box inside the dialog; it fills the dialog so a click on the dialog itself is a click on the backdrop. */
export const OVERLAY_CONTENT = { box: 'flex min-h-full flex-col gap-4', padding: 'p-6' };
export const OVERLAY_CLOSE =
  'absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md text-xl leading-none text-muted-foreground hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const OVERLAY_VARIANT: Record<OverlayVariant, string> = {
  modal: 'm-auto w-full rounded-xl',
  drawer: 'w-full',
};
/** Drawer edge (margins pin the fixed dialog to it) and slide in/out. */
export const OVERLAY_SIDE: Record<OverlaySide, string> = {
  left: 'my-0 mr-auto ml-0 max-h-none -translate-x-full open:translate-x-0 starting:open:-translate-x-full',
  right: 'my-0 mr-0 ml-auto max-h-none translate-x-full open:translate-x-0 starting:open:translate-x-full',
  top: 'mx-0 mt-0 mb-auto max-h-none max-w-none -translate-y-full open:translate-y-0 starting:open:-translate-y-full',
  bottom: 'mx-0 mt-auto mb-0 max-h-none max-w-none translate-y-full open:translate-y-0 starting:open:translate-y-full',
};
/** `modal`: max width; `x`: left/right drawers (width, full height); `y`: top/bottom drawers (height, full width). */
export const OVERLAY_SIZE: Record<'modal' | 'x' | 'y', Record<OverlaySize, string>> = {
  modal: { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'w-full h-full max-w-none max-h-none' },
  x: { sm: 'h-full max-w-sm', md: 'h-full max-w-lg', lg: 'h-full max-w-2xl', xl: 'h-full max-w-4xl', full: 'w-full h-full max-w-none max-h-none' },
  y: { sm: 'h-1/3 w-full', md: 'h-1/2 w-full', lg: 'h-2/3 w-full', xl: 'h-5/6 w-full', full: 'h-full w-full' },
};

const CLOSE: Record<string, string> = { 'en-US': 'Close', 'vi-VN': 'Đóng', 'fr-FR': 'Fermer', 'id-ID': 'Tutup' };

const pick = <T extends string>(table: Record<T, string>, v: unknown, fallback: T): T =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(table, v) ? (v as T) : fallback;

export type OverlayProps = {
  /** `data-ocms-overlay`: the name actions and `openOverlay` target. */
  name: string;
  variant?: OverlayVariant;
  /** Drawer only. Default `right`. */
  side?: OverlaySide;
  size?: OverlaySize;
  /** Default true. */
  closeOnBackdrop?: boolean;
  /** Built-in × button closing this overlay. Default true. */
  showClose?: boolean;
  /** Id of the element naming the dialog (`aria-labelledby`), e.g. its first heading. */
  labelledBy?: string;
  id?: string;
  /** Locale of the × button label. Default `en-US`. */
  locale?: string;
  style?: NodeStyle;
  children?: ReactNode;
};

/**
 * A closed `<dialog>`. Style: padding goes to the content box, everything else (size, colors, border, radius, margin)
 * to the dialog; `hidden` and `span` do not apply.
 */
export function Overlay({ name, variant, side, size, closeOnBackdrop = true, showClose = true, labelledBy, id, locale, style, children }: OverlayProps) {
  const v = pick<OverlayVariant>(OVERLAY_VARIANT, variant, 'modal');
  const s = pick<OverlaySide>(OVERLAY_SIDE, side, 'right');
  const z = pick<OverlaySize>(OVERLAY_SIZE.modal, size, 'md');
  const { padding, hidden: _h, span: _s, ...frameStyle } = (style && typeof style === 'object' ? style : {}) as NodeStyle & Record<string, unknown>;
  const fp = styleProps(frameStyle as NodeStyle, 'block');
  const cp = styleProps(padding === undefined ? undefined : ({ padding } as NodeStyle), 'flex');
  const frame = cn(
    OVERLAY_BASE.frame,
    setsBackground(fp) ? undefined : OVERLAY_BASE.background,
    OVERLAY_VARIANT[v],
    v === 'drawer' ? OVERLAY_SIDE[s] : undefined,
    v === 'modal' ? OVERLAY_SIZE.modal[z] : s === 'left' || s === 'right' ? OVERLAY_SIZE.x[z] : OVERLAY_SIZE.y[z],
    fp.className,
  );
  const content = cn(OVERLAY_CONTENT.box, setsPadding(cp) ? undefined : OVERLAY_CONTENT.padding, cp.className);
  return (
    <dialog
      id={id}
      data-ocms-overlay={name}
      data-close-on-backdrop={closeOnBackdrop ? 'true' : 'false'}
      aria-labelledby={labelledBy}
      className={frame}
      style={styleAttr(fp)}
    >
      <div className={content} style={styleAttr(cp)}>
        {children}
      </div>
      {showClose ? (
        <ActionButton action={{ type: 'overlay', op: 'close' }} className={OVERLAY_CLOSE} aria-label={CLOSE[locale ?? ''] ?? CLOSE['en-US']}>
          <span aria-hidden="true">×</span>
        </ActionButton>
      ) : null}
    </dialog>
  );
}
