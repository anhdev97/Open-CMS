'use client';
// Dropdown: a trigger and one panel (`role="group"`), all content in the server HTML. Without JS a `popover` panel opens
// on `:hover` / `:focus-within` (literal `group-hover/dropdown:` classes); after hydration the client owns the state:
// hover (mouse only) or click/tap toggles, Esc, outside pointerdown, focus leaving, a link click, the containing overlay
// closing and route changes (`closeAllDropdowns`) close it. The hover classes are dropped once hydrated, so a tap never
// leaves a "sticky hover" panel. Responsive `display` uses one markup: per breakpoint `popover` positions the panel,
// `inline` keeps it in the flow (drawers). No browser globals at import time.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { Breakpoint, NodeStyle, Responsive } from '@opencloudcms/schema';
import { BUTTON_BASE, BUTTON_SIZE, BUTTON_VARIANT, cn, type ButtonVariant } from '../ui/tokens';
import { styleAttr, styleProps } from '../ui/style';
import { subscribeOverlays } from './overlay-store';
import { registerDropdown } from './dropdown-store';
import { currentBreakpoint, perBreakpoint } from './media';

export type DropdownDisplay = 'popover' | 'inline';
export type DropdownPlacement = 'bottom-start' | 'bottom-end' | 'bottom';

export const DROPDOWN = 'relative group/dropdown';
export const DROPDOWN_LINK_ROW = 'inline-flex items-center';
/** The chevron-only toggle next to a link label. */
export const DROPDOWN_CHEVRON_BUTTON = 'size-9 px-0';
export const DROPDOWN_CHEVRON = 'size-4 shrink-0 transition-transform group-data-[open]/dropdown:rotate-180';
export const DROPDOWN_PANEL = 'hidden';
export const DROPDOWN_OPEN = 'block';
/** Panel box per breakpoint and display. `inline` resets every popover property it would inherit from a smaller one. */
export const DROPDOWN_DISPLAY: Record<DropdownDisplay, Record<Breakpoint, string>> = {
  popover: {
    base: 'absolute top-full z-50 mt-1 w-max min-w-48 max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
    md: 'md:absolute md:top-full md:z-50 md:mt-1 md:w-max md:min-w-48 md:max-w-[calc(100vw-2rem)] md:rounded-md md:border md:bg-popover md:p-1 md:text-popover-foreground md:shadow-md',
    lg: 'lg:absolute lg:top-full lg:z-50 lg:mt-1 lg:w-max lg:min-w-48 lg:max-w-[calc(100vw-2rem)] lg:rounded-md lg:border lg:bg-popover lg:p-1 lg:text-popover-foreground lg:shadow-md',
  },
  inline: {
    base: 'static mt-1 w-full min-w-0 max-w-none translate-x-0 rounded-none border-0 bg-transparent p-0 pl-4 text-inherit shadow-none',
    md: 'md:static md:mt-1 md:w-full md:min-w-0 md:max-w-none md:translate-x-0 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:pl-4 md:text-inherit md:shadow-none',
    lg: 'lg:static lg:mt-1 lg:w-full lg:min-w-0 lg:max-w-none lg:translate-x-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:pl-4 lg:text-inherit lg:shadow-none',
  },
};
/** Popover anchoring, emitted only at the breakpoints where the panel is a popover. */
export const DROPDOWN_PLACEMENT: Record<DropdownPlacement, Record<Breakpoint, string>> = {
  'bottom-start': { base: 'left-0', md: 'md:left-0', lg: 'lg:left-0' },
  'bottom-end': { base: 'right-0', md: 'md:right-0', lg: 'lg:right-0' },
  bottom: { base: 'left-1/2 -translate-x-1/2', md: 'md:left-1/2 md:-translate-x-1/2', lg: 'lg:left-1/2 lg:-translate-x-1/2' },
};
/** Before hydration only: CSS opening of a popover panel (an `inline` one needs JS). */
export const DROPDOWN_NOJS: Record<DropdownDisplay, Record<Breakpoint, string>> = {
  popover: {
    base: 'group-hover/dropdown:block group-focus-within/dropdown:block',
    md: 'md:group-hover/dropdown:block md:group-focus-within/dropdown:block',
    lg: 'lg:group-hover/dropdown:block lg:group-focus-within/dropdown:block',
  },
  inline: {
    base: '',
    md: 'md:group-hover/dropdown:hidden md:group-focus-within/dropdown:hidden',
    lg: 'lg:group-hover/dropdown:hidden lg:group-focus-within/dropdown:hidden',
  },
};

const SUBMENU: Record<string, string> = {
  'en-US': 'Show submenu',
  'vi-VN': 'Hiện menu con',
  'fr-FR': 'Afficher le sous-menu',
  'id-ID': 'Tampilkan submenu',
};

const BPS: Breakpoint[] = ['base', 'md', 'lg'];
const isDisplay = (x: unknown): x is DropdownDisplay => x === 'popover' || x === 'inline';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** A tap's own `click` follows its `pointerdown`; it is ignored for this long. */
const TAP_CLICK_MS = 800;
const HOVER_CLOSE_MS = 150;

export type DropdownProps = {
  label: string;
  /** Bound link of the label: the label renders as `<a>` and only the chevron toggles. */
  href?: string | null;
  openOn?: 'hover' | 'click';
  placement?: DropdownPlacement;
  display?: Responsive<DropdownDisplay>;
  triggerVariant?: ButtonVariant;
  chevron?: boolean;
  locale?: string;
  id?: string;
  style?: NodeStyle;
  children?: ReactNode;
  /** Builder canvas only: force the panel open. Absent on the website. */
  editor?: { open?: boolean };
};

type OpenBy = 'hover' | 'click' | null;

export function Dropdown({
  label,
  href,
  openOn = 'hover',
  placement = 'bottom-start',
  display,
  triggerVariant = 'ghost',
  chevron = true,
  locale,
  id,
  style,
  children,
  editor,
}: DropdownProps) {
  const uid = useId();
  const triggerId = `${uid}-trigger`;
  const panelId = `${uid}-panel`;
  const [openBy, setOpenBy] = useState<OpenBy>(null);
  const [hydrated, setHydrated] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastTap = useRef(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusFirst = useRef(false);
  const open = editor?.open === true || openBy !== null;
  const modes = perBreakpoint<DropdownDisplay>(display, 'popover', isDisplay);
  const place = DROPDOWN_PLACEMENT[placement] ? placement : 'bottom-start';
  const variant: ButtonVariant = BUTTON_VARIANT[triggerVariant] ? triggerVariant : 'ghost';
  const link = href || null;

  const close = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setOpenBy(null);
  }, []);

  useEffect(() => setHydrated(true), []);
  useEffect(() => registerDropdown(close), [close]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Inside an overlay: close with it.
  useEffect(
    () =>
      subscribeOverlays(() => {
        const dialog = root.current?.closest('dialog');
        if (dialog && !dialog.open) close();
      }),
    [close],
  );

  // While open: outside pointerdown and Esc (when focus is elsewhere) close.
  useEffect(() => {
    if (!open || editor?.open) return;
    const onDown = (e: Event) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, editor?.open, close]);

  // Keyboard open (ArrowDown on the trigger): focus the first item once the panel is shown.
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  const popoverNow = () => modes[currentBreakpoint()] === 'popover';

  const onPointerEnter = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || openOn !== 'hover' || !popoverNow()) return;
    clearTimeout(hoverTimer.current);
    setOpenBy((by) => by ?? 'hover');
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpenBy((by) => (by === 'hover' ? null : by)), HOVER_CLOSE_MS);
  };
  // Touch and pen: the tap toggles on pointerdown (hover never fires for them); the tap's own click is ignored.
  const onTogglePointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    lastTap.current = Date.now();
    setOpenBy((by) => (by ? null : 'click'));
  };
  const onToggleClick = () => {
    if (Date.now() - lastTap.current < TAP_CLICK_MS) return;
    // A click on a hover-opened panel pins it open; the next click closes it.
    setOpenBy((by) => (by === 'hover' ? 'click' : by ? null : 'click'));
  };
  const onToggleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    focusFirst.current = true;
    if (open) {
      focusFirst.current = false;
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    } else setOpenBy('click');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      // Handled here so an enclosing dialog does not close too.
      e.preventDefault();
      e.stopPropagation();
      close();
      toggleRef.current?.focus();
      return;
    }
    const panel = panelRef.current;
    if (!panel || !open || !(e.target instanceof Node) || !panel.contains(e.target)) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const i = items.indexOf(e.target as HTMLElement);
    const to =
      e.key === 'ArrowDown' ? items[(i + 1) % items.length]
      : e.key === 'ArrowUp' ? items[(i - 1 + items.length) % items.length]
      : e.key === 'Home' ? items[0]
      : e.key === 'End' ? items[items.length - 1]
      : undefined;
    if (!to) return;
    e.preventDefault();
    to.focus();
  };
  const onBlur = (e: { relatedTarget: EventTarget | null }) => {
    const next = e.relatedTarget;
    if (next instanceof Node && root.current && !root.current.contains(next)) close();
  };
  // A link in the panel navigates: close (the route watcher closes any overlay).
  const onPanelClick = (e: { target: EventTarget | null }) => {
    if (e.target instanceof Element && e.target.closest('a[href]')) close();
  };

  const sp = styleProps(style, 'block');
  const btn = cn(BUTTON_BASE, BUTTON_VARIANT[variant]);
  const chevronIcon = <ChevronDownIcon className={DROPDOWN_CHEVRON} aria-hidden="true" />;
  const toggleProps = {
    ref: toggleRef,
    type: 'button' as const,
    'aria-expanded': open,
    'aria-controls': panelId,
    onPointerDown: onTogglePointerDown,
    onClick: onToggleClick,
    onKeyDown: onToggleKeyDown,
  };

  const panelClass = cn(
    DROPDOWN_PANEL,
    BPS.map((bp) => [modes[bp] === 'popover' ? DROPDOWN_PLACEMENT[place][bp] : '', DROPDOWN_DISPLAY[modes[bp]][bp]]),
    hydrated || editor?.open ? undefined : BPS.map((bp) => DROPDOWN_NOJS[modes[bp]][bp]),
    open ? DROPDOWN_OPEN : undefined,
  );

  return (
    <div
      ref={root}
      id={id}
      data-ocms-dropdown=""
      data-open={open ? '' : undefined}
      className={cn(DROPDOWN, sp.className)}
      style={styleAttr(sp)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {link ? (
        <div className={DROPDOWN_LINK_ROW}>
          <a id={triggerId} href={link} className={cn(btn, BUTTON_SIZE.default)}>
            {label}
          </a>
          <button {...toggleProps} aria-label={`${SUBMENU[locale ?? ''] ?? SUBMENU['en-US']}: ${label}`} className={cn(btn, DROPDOWN_CHEVRON_BUTTON)}>
            {chevronIcon}
          </button>
        </div>
      ) : (
        <button {...toggleProps} id={triggerId} className={cn(btn, BUTTON_SIZE.default)}>
          {label}
          {chevron ? chevronIcon : null}
        </button>
      )}
      <div ref={panelRef} id={panelId} role="group" aria-labelledby={triggerId} className={panelClass} onClick={onPanelClick}>
        {children}
      </div>
    </div>
  );
}
