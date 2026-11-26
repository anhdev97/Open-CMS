'use client';
// Wrapper of a `single` Accordion: when one item opens, its sibling items close. Native exclusive `<details name>`
// does this where supported; this covers the other browsers. Without JS several items may be open. No browser globals
// at import time.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export function AccordionSingle({
  id,
  className,
  style,
  disabled,
  children,
}: {
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** Builder canvas forcing every item open: siblings are left alone. */
  disabled?: boolean;
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || disabled) return;
    // `toggle` does not bubble: listen in the capture phase.
    const onToggle = (e: Event) => {
      const d = e.target;
      if (!(d instanceof HTMLDetailsElement) || d.parentElement !== el || !d.open) return;
      for (const other of Array.from(el.children)) {
        if (other !== d && other instanceof HTMLDetailsElement && other.open) other.open = false;
      }
    };
    el.addEventListener('toggle', onToggle, true);
    return () => el.removeEventListener('toggle', onToggle, true);
  }, [disabled]);
  return (
    <div ref={root} id={id} data-ocms-accordion="single" className={className} style={style}>
      {children}
    </div>
  );
}
