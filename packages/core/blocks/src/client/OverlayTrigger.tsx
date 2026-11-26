'use client';
import { cloneElement, type MouseEvent, type ReactElement } from 'react';
import { closeOverlay, openOverlay, toggleOverlay } from './overlay-store';

export function OverlayTrigger({
  name,
  op = 'open',
  children,
}: {
  name: string;
  op?: 'open' | 'close' | 'toggle';
  children: ReactElement<{ onClick?: (e: MouseEvent<HTMLElement>) => void }>;
}): ReactElement {
  return cloneElement(children, {
    onClick: (e: MouseEvent<HTMLElement>) => {
      children.props.onClick?.(e);
      if (op === 'close') closeOverlay(name);
      else if (op === 'toggle') toggleOverlay(name);
      else openOverlay(name);
    },
  });
}
