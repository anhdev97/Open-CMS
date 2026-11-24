'use client';

// The builders' device toggle (Mobile 375 / Tablet 768 / Desktop 1280): it sets Puck's canvas viewport, and the
// breakpoint of that viewport is the one the style panel edits (`ViewportBreakpoint`, Puck `overrides.puck`).
import { MonitorIcon, SmartphoneIcon, TabletIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { createUsePuck, useGetPuck, type Viewport } from '@puckeditor/core';
import type { Breakpoint } from '@opencloudcms/schema';
import { Button } from '../../components/ui/button';
import { t } from '../../i18n';
import { BreakpointContext, DEVICE_VIEWPORTS, breakpointForWidth } from './breakpoint';
import { bpLabel } from './shared';

const usePuck = createUsePuck();
const ICONS = { Smartphone: SmartphoneIcon, Tablet: TabletIcon, Monitor: MonitorIcon } as const;

/** Puck `viewports` of both builders (labels in the admin language). */
export function deviceViewports(): Viewport[] {
  return DEVICE_VIEWPORTS.map((v) => ({ width: v.width, height: 'auto', label: bpLabel(v.bp), icon: v.icon }));
}

/** Breakpoint of a Puck viewport width (`100%` counts as Desktop). */
const bpOf = (width: number | '100%'): Breakpoint => (typeof width === 'number' ? breakpointForWidth(width) : 'lg');

/** Provides the breakpoint of Puck's current viewport to everything inside Puck (panel fields and canvas). */
export function ViewportBreakpoint({ children }: { children?: ReactNode }) {
  const width = usePuck((s) => s.appState.ui.viewports.current.width);
  return <BreakpointContext.Provider value={bpOf(width)}>{children}</BreakpointContext.Provider>;
}

export function DeviceToggle() {
  const width = usePuck((s) => s.appState.ui.viewports.current.width);
  const getPuck = useGetPuck();
  const current = bpOf(width);
  const select = (w: number) => {
    const api = getPuck();
    api.dispatch({ type: 'setUi', ui: { viewports: { ...api.appState.ui.viewports, current: { width: w, height: 'auto' } } } });
  };
  return (
    <div role="group" aria-label={t('blockBuilder.canvas.device')} className="inline-flex rounded-md border border-border p-0.5">
      {DEVICE_VIEWPORTS.map((v) => {
        const Icon = ICONS[v.icon];
        const label = bpLabel(v.bp);
        return (
          <Button
            key={v.bp}
            type="button"
            size="icon-sm"
            className="size-7"
            variant={current === v.bp ? 'secondary' : 'ghost'}
            aria-pressed={current === v.bp}
            aria-label={label}
            title={`${label} (${v.width}px)`}
            data-device={v.bp}
            onClick={() => select(v.width)}
          >
            <Icon aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}
