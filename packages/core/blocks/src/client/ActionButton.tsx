'use client';
import type { ButtonAction } from '@opencloudcms/schema';
import type { CSSProperties, ReactNode } from 'react';
import { closeOverlay, openOverlay, toggleOverlay } from './overlay-store';

export function ActionButton({
  action,
  className,
  style,
  children,
}: {
  action: ButtonAction;
  className?: string;
  style?: CSSProperties;
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
    <button type="button" className={className} style={style} onClick={run}>
      {children}
    </button>
  );
}
