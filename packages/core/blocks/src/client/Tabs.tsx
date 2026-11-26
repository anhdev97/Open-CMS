'use client';
// Tabs (ARIA tabs pattern, automatic activation): `role="tablist"` of `<button role="tab">`, one `role="tabpanel"` per
// tab, every panel in the server HTML and all but the active one `hidden`. Arrow keys, Home and End move focus and
// select; only the active tab is in the tab order. Ids come from `useId`, so every rendered copy (collection items) has
// its own. No browser globals at import time.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { NodeStyle } from '@opencloudcms/schema';
import { cn } from '../ui/tokens';
import { styleAttr, styleProps } from '../ui/style';

export type TabsVariant = 'underline' | 'pills';
export type TabsAlign = 'start' | 'center' | 'stretch';

export const TABS = 'flex flex-col gap-4';
export const TABS_LIST: Record<TabsVariant, string> = {
  underline: 'flex max-w-full overflow-x-auto border-b border-border',
  pills: 'flex max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1',
};
export const TABS_ALIGN: Record<TabsAlign, string> = { start: 'justify-start', center: 'justify-center', stretch: '' };
export const TABS_TAB_BASE =
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
export const TABS_TAB: Record<TabsVariant, { on: string; off: string }> = {
  underline: { on: '-mb-px border-b-2 border-primary text-foreground', off: '-mb-px border-b-2 border-transparent text-muted-foreground hover:text-foreground' },
  pills: { on: 'rounded-md bg-background text-foreground shadow-sm', off: 'rounded-md text-muted-foreground hover:text-foreground' },
};
export const TABS_TAB_STRETCH = 'flex-1';
export const TABS_PANEL =
  'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export type TabsPanel = { label: string; content?: ReactNode; id?: string };

export type TabsProps = {
  panels: TabsPanel[];
  variant?: TabsVariant;
  align?: TabsAlign;
  id?: string;
  style?: NodeStyle;
  /** Builder canvas only: the shown tab is controlled by the canvas. Absent on the website. */
  editor?: { activeIndex?: number; onSelect?: (i: number) => void };
};

export function Tabs({ panels, variant = 'underline', align = 'start', id, style, editor }: TabsProps) {
  const uid = useId();
  const [own, setOwn] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const v: TabsVariant = TABS_LIST[variant] ? variant : 'underline';
  const a: TabsAlign = align in TABS_ALIGN ? align : 'start';
  const n = panels.length;
  const controlled = typeof editor?.activeIndex === 'number';
  const raw = controlled ? (editor!.activeIndex as number) : own;
  const active = n ? Math.min(Math.max(0, Math.trunc(raw)), n - 1) : 0;

  const select = (i: number) => {
    if (!controlled) setOwn(i);
    editor?.onSelect?.(i);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const to =
      e.key === 'ArrowRight' ? (active + 1) % n
      : e.key === 'ArrowLeft' ? (active - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    select(to);
    tabs.current[to]?.focus();
  };

  const sp = styleProps(style, 'flex');
  const tabId = (i: number) => `${uid}-tab-${i}`;
  const panelId = (i: number) => panels[i]?.id ?? `${uid}-panel-${i}`;
  return (
    <div id={id} className={cn(TABS, sp.className)} style={styleAttr(sp)}>
      <div role="tablist" aria-orientation="horizontal" className={cn(TABS_LIST[v], TABS_ALIGN[a])} onKeyDown={onKeyDown}>
        {panels.map((p, i) => (
          <button
            key={i}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(i)}
            aria-selected={i === active}
            aria-controls={panelId(i)}
            tabIndex={i === active ? 0 : -1}
            className={cn(TABS_TAB_BASE, i === active ? TABS_TAB[v].on : TABS_TAB[v].off, a === 'stretch' ? TABS_TAB_STRETCH : undefined)}
            onClick={() => select(i)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {panels.map((p, i) => (
        <div key={i} role="tabpanel" id={panelId(i)} aria-labelledby={tabId(i)} tabIndex={0} hidden={i !== active} className={TABS_PANEL}>
          {p.content}
        </div>
      ))}
    </div>
  );
}
