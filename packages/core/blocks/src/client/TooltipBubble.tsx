'use client';
// The bubble of a Tooltip: the same `<span role="tooltip">` as the server HTML (shown with CSS `group-hover/tooltip:` /
// `group-focus-within/tooltip:`), plus two client behaviours on its wrapper (the parent element):
// - when shown (pointerenter / focusin) it is moved horizontally into the viewport with an 8 px margin, using an inline
//   `transform: translateX()` so Tailwind's `translate` centring stays;
// - while shown, Esc hides it (`display: none`) until the pointer has left and focus has left the wrapper (WCAG 1.4.13).
// No browser globals at import time.
import { useEffect, useRef } from 'react';

const MARGIN = 8;

export type TooltipBubbleProps = {
  id: string;
  className: string;
  text: string;
  /** Builder canvas: the bubble is forced open; no Esc handling. */
  forced?: boolean;
};

/** Horizontal shift that brings [left, right] inside [MARGIN, vw - MARGIN] (left edge wins when it does not fit). */
export function clampShift(left: number, right: number, vw: number): number {
  let dx = Math.min(0, vw - MARGIN - right);
  if (left + dx < MARGIN) dx = MARGIN - left;
  return dx;
}

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
    let frame = 0;

    const clamp = () => {
      bubble.style.transform = '';
      const r = bubble.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false; // not displayed (yet)
      const dx = clampShift(r.left, r.right, doc.documentElement.clientWidth);
      bubble.style.transform = dx ? `translateX(${dx}px)` : '';
      return true;
    };
    const show = () => {
      if (dismissed) return;
      const win = doc.defaultView;
      if (!clamp() && win) {
        win.cancelAnimationFrame(frame);
        frame = win.requestAnimationFrame(() => void clamp());
      }
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
      doc.defaultView?.cancelAnimationFrame(frame);
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
