'use client';
// The bubble of a Tooltip: the same `<span role="tooltip">` as the server HTML (shown with CSS `group-hover/tooltip:` /
// `group-focus-within/tooltip:`), plus two client behaviours on its wrapper (the parent element):
// - when shown (pointerenter / focusin) it is moved horizontally into the viewport with an 8 px margin, using an inline
//   `transform: translateX()` so Tailwind's `translate` centring stays (`shiftIntoViewport`: measured parked off to the
//   left, so the page is never laid out with the bubble past the right edge);
// - while shown, Esc hides it (`display: none`) until the pointer has left and focus has left the wrapper (WCAG 1.4.13).
// No browser globals at import time.
import { useEffect, useRef } from 'react';
import { shiftIntoViewport } from './media';

export { clampShift } from './media';

export type TooltipBubbleProps = {
  id: string;
  className: string;
  text: string;
  /** Builder canvas: the bubble is forced open; no Esc handling. */
  forced?: boolean;
};

export function TooltipBubble({ id, className, text, forced }: TooltipBubbleProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const bubble = ref.current;
    const host = bubble?.parentElement;
    if (!bubble || !host) return;
    const doc = bubble.ownerDocument;
    // Hover or focus may already be there when this hydrates.
    let hovered = false;
    try {
      hovered = host.matches(':hover');
    } catch {
      hovered = false;
    }
    let focused = host.contains(doc.activeElement);
    let dismissed = false;

    // Positioned before CSS shows it: a touch's pointerenter comes before `:hover` applies, and the browser lays the
    // page out for the tap's hit test before any later event, so the bubble is measured with `display` forced for the
    // duration of this call (no paint in between) and is already in place when hover or focus reveals it.
    const show = () => {
      if (dismissed) return;
      const display = bubble.style.display;
      bubble.style.display = 'block';
      shiftIntoViewport(bubble);
      bubble.style.display = display;
    };
    const maybeRestore = () => {
      if (hovered || focused || !dismissed) return;
      dismissed = false;
      bubble.style.display = '';
    };
    const onEnter = () => {
      hovered = true;
      show();
    };
    const onLeave = () => {
      hovered = false;
      maybeRestore();
    };
    const onFocusIn = () => {
      focused = true;
      show();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && host.contains(e.relatedTarget)) return;
      focused = false;
      maybeRestore();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || forced || dismissed || !(hovered || focused)) return;
      dismissed = true;
      bubble.style.display = 'none';
    };

    host.addEventListener('pointerenter', onEnter);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
    doc.addEventListener('keydown', onKey);
    if (forced) show();
    return () => {
      host.removeEventListener('pointerenter', onEnter);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
      doc.removeEventListener('keydown', onKey);
    };
  }, [forced]);

  return (
    <span ref={ref} role="tooltip" id={id} className={className}>
      {text}
    </span>
  );
}
