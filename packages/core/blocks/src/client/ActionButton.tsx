'use client';
import type { ButtonAction } from '@opencloudcms/schema';
import type { CSSProperties, ReactNode } from 'react';
import { closeOverlay, openOverlay, toggleOverlay } from './overlay-store';

export function ActionButton({
  action,
  id,
  className,
  style,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  children,
}: {
  action: ButtonAction;
  id?: string;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-describedby'?: string;
  children?: ReactNode;
}) {
  const run = (e: { currentTarget: HTMLElement }) => {
    if (action.type === 'scroll') {
      document.getElementById(action.target)?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (action.op === 'open') return action.target ? openOverlay(action.target) : undefined;
    if (action.op === 'toggle') return action.target ? toggleOverlay(action.target) : undefined;
    if (action.target) return closeOverlay(action.target);
    const own = e.currentTarget.closest<HTMLElement>('dialog[data-ocms-overlay]');
    closeOverlay(own?.getAttribute('data-ocms-overlay') ?? undefined);
  };
  return (
    <button type="button" id={id} className={className} style={style} aria-label={ariaLabel} aria-describedby={describedBy} onClick={run}>
      {children}
    </button>
  );
}
