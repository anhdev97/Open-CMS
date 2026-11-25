// @vitest-environment happy-dom
// Device toggle, palette preview and canvas fidelity of the builders (Puck's store is stubbed).
import { act, createElement, useContext, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeDefinition } from '@opencloudcms/schema';

const puck = vi.hoisted(() => ({
  state: { appState: { ui: { viewports: { current: { width: 1280 as number | '100%', height: 'auto' }, controlsVisible: true, options: [] } } }, dispatch: (() => {}) as (a: unknown) => void },
}));
vi.mock('@puckeditor/core', async (orig) => ({
  ...(await orig<object>()),
  createUsePuck: () => (sel: (s: unknown) => unknown) => sel(puck.state),
  useGetPuck: () => () => puck.state,
}));

import { BreakpointContext } from '../../admin/src/block-builder/style/breakpoint';
import { DeviceMemory, DeviceToggle, ViewportBreakpoint, deviceUi } from '../../admin/src/block-builder/style/DeviceToggle';
import { CanvasFrame, PaletteSelect, ThemeContext, ThemeProvider } from '../../admin/src/block-builder/style/theme-context';
import { elementRender } from '../../admin/src/block-builder/Canvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  puck.state.appState.ui.viewports.current = { width: 1280, height: 'auto' };
  puck.state.dispatch = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const render = (node: ReactNode) => act(() => root.render(node));
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);

const theme = (palettes: string[]): ThemeDefinition => ({
  colors: { surface: { label: 'Surface' }, ink: {} },
  palettes: Object.fromEntries(palettes.map((id, i) => [id, { label: id.toUpperCase(), values: { surface: `#00000${i}`, ink: `#ffffff` } }])),
  activePalette: palettes[0]!,
});

describe('device toggle', () => {
  it('shows the current device and sets Puck viewport 768 on Tablet', () => {
    render(createElement(DeviceToggle));
    expect(button('Desktop')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Tablet')?.getAttribute('aria-pressed')).toBe('false');
    act(() => button('Tablet')!.click());
    expect(puck.state.dispatch).toHaveBeenCalledWith({
      type: 'setUi',
      ui: { viewports: { current: { width: 768, height: 'auto' }, controlsVisible: true, options: [] } },
    });
  });

  it('provides the breakpoint of the current viewport to the style panel', () => {
    const Probe = () => createElement('span', { 'data-bp': useContext(BreakpointContext) });
    puck.state.appState.ui.viewports.current = { width: 768, height: 'auto' };
    render(createElement(ViewportBreakpoint, null, createElement(Probe)));
    expect(container.querySelector('[data-bp]')?.getAttribute('data-bp')).toBe('md');
    puck.state.appState.ui.viewports.current = { width: 375, height: 'auto' };
    render(createElement(ViewportBreakpoint, null, createElement(Probe)));
    expect(container.querySelector('[data-bp]')?.getAttribute('data-bp')).toBe('base');
  });
});

describe('device across Puck remounts', () => {
  it('Puck starts on the remembered width (else the device closest to the window), its own controls hidden', () => {
    expect(deviceUi(768)).toEqual({ viewports: { current: { width: 768, height: 'auto' }, controlsVisible: false, options: [] } });
    window.innerWidth = 1400;
    expect(deviceUi(undefined).viewports!.current.width).toBe(1280);
    window.innerWidth = 800;
    expect(deviceUi(undefined).viewports!.current.width).toBe(768);
    window.innerWidth = 390;
    expect(deviceUi(undefined).viewports!.current.width).toBe(375);
  });

  it('ViewportBreakpoint remembers the current width for the next mount', () => {
    const memory: { current?: number } = {};
    puck.state.appState.ui.viewports.current = { width: 375, height: 'auto' };
    render(createElement(DeviceMemory.Provider, { value: memory }, createElement(ViewportBreakpoint, null, 'x')));
    expect(memory.current).toBe(375);
  });
});

describe('palette preview', () => {
  it('is hidden with one palette (or no theme)', () => {
    render(createElement(ThemeProvider, { theme: theme(['olive']) }, createElement(PaletteSelect)));
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    render(createElement(ThemeProvider, { theme: null }, createElement(PaletteSelect)));
    expect(container.querySelector('[role="combobox"]')).toBeNull();
  });

  it('the canvas root carries the selected palette; switching it changes the canvas only', () => {
    let setPalette: (p: string) => void = () => {};
    const Grab = () => {
      setPalette = useContext(ThemeContext).setPalette;
      return null;
    };
    render(
      createElement(ThemeProvider, { theme: theme(['olive', 'clay']) }, createElement(PaletteSelect), createElement(Grab), createElement(CanvasFrame, null, createElement('p', null, 'canvas'))),
    );
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    expect(container.innerHTML).toContain('--ocms-color-surface:#000000');
    act(() => setPalette('clay'));
    expect(container.innerHTML).toContain('--ocms-color-surface:#000001');
    expect(container.textContent).toContain('canvas');
  });

  it('renders no theme style without a theme', () => {
    render(createElement(ThemeProvider, { theme: null }, createElement(CanvasFrame, null, 'x')));
    expect(container.innerHTML).not.toContain('--ocms-color-');
  });
});

describe('canvas item frame', () => {
  const Divider = elementRender('Divider');
  const draw = (style: object, bp: 'base' | 'md' = 'base') =>
    render(createElement(BreakpointContext.Provider, { value: bp }, createElement(Divider, { id: 'Divider-1', style, puck: {} })));

  it('is the box the parent lays out: margin and width go on it, not on the element', () => {
    draw({ margin: { l: 'auto' }, width: '50%' });
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).toContain('ml-(--ocms-ml)');
    expect(frame.className).toContain('w-(--ocms-w)');
    expect(frame.getAttribute('style')).toContain('--ocms-ml: auto');
    expect(frame.getAttribute('style')).toContain('--ocms-w: 50%');
    const inner = frame.querySelector('hr, [data-slot="separator"], div') as HTMLElement;
    expect(inner.outerHTML).not.toContain('--ocms-ml');
    expect(inner.outerHTML).toContain('--ocms-w: 100%');
  });

  it('an element hidden at the current breakpoint is dimmed, not display:none', () => {
    draw({ hidden: { md: true } }, 'md');
    expect(container.innerHTML).not.toMatch(/md:hidden|class="hidden/);
    expect(container.querySelector('.opacity-40')).not.toBeNull();
    draw({ hidden: { md: true } }, 'base');
    expect(container.querySelector('.opacity-40')).toBeNull();
  });

  it('one dim wrapper for both reasons, filling the frame for a relative height', () => {
    render(
      createElement(BreakpointContext.Provider, { value: 'md' as const },
        createElement(Divider, { id: 'Divider-1', style: { hidden: { md: true }, height: '100%' }, showIf: { from: 'field', name: 'x', is: 'present' }, puck: {} })),
    );
    const dims = container.querySelectorAll('.opacity-40');
    expect(dims.length).toBe(1);
    expect(dims[0]!.getAttribute('title')).toContain('Tablet');
    expect(dims[0]!.getAttribute('title')).toContain('show condition');
    expect(dims[0]!.className).toContain('h-full');
  });
});

describe('layout and overlay elements on the canvas', () => {
  const Slot = ({ className }: { className?: string }) => createElement('div', { 'data-zone': true, className });

  it('a Region is a dashed drop area labelled with its label (else its name)', () => {
    render(createElement(elementRender('Region'), { id: 'Region-1', name: 'header', label: 'Site header', puck: {} }));
    const r = container.querySelector('[data-region]') as HTMLElement;
    expect(r.getAttribute('data-region')).toBe('header');
    expect(r.className).toContain('border-dashed');
    expect(r.textContent).toContain('Site header');
    render(createElement(elementRender('Region'), { id: 'Region-1', name: 'footer', puck: {} }));
    expect(container.textContent).toContain('footer');
  });

  it('PageContent is a hatched "Page content" placeholder', () => {
    render(createElement(elementRender('PageContent'), { id: 'PageContent-1', puck: {} }));
    const p = container.querySelector('[data-page-content]') as HTMLElement;
    expect(p.textContent).toContain('Page content');
    expect(p.getAttribute('style')).toContain('repeating-linear-gradient');
  });

  it('an Overlay is a framed preview at its size and side, not a <dialog>', () => {
    render(createElement(elementRender('Overlay'), { id: 'Overlay-1', variant: 'modal', size: 'lg', showClose: true, children: Slot, puck: {} }));
    expect(container.querySelector('dialog')).toBeNull();
    const panel = container.querySelector('[data-overlay-panel]') as HTMLElement;
    expect(panel.getAttribute('data-variant')).toBe('modal');
    expect(panel.className).toContain('max-w-2xl');
    expect(panel.className).toContain('m-auto');
    expect(panel.querySelector('[data-zone]')).not.toBeNull();
    expect(container.querySelector('[data-overlay-close]')).not.toBeNull();

    render(createElement(elementRender('Overlay'), { id: 'Overlay-1', variant: 'drawer', side: 'left', size: 'sm', showClose: false, children: Slot, puck: {} }));
    const drawer = container.querySelector('[data-overlay-panel]') as HTMLElement;
    expect(drawer.getAttribute('data-side')).toBe('left');
    expect(drawer.className).toContain('mr-auto');
    expect(drawer.className).toContain('max-w-sm');
    expect(container.querySelector('[data-overlay-close]')).toBeNull();

    render(createElement(elementRender('Overlay'), { id: 'Overlay-1', variant: 'drawer', side: 'bottom', size: 'md', children: Slot, puck: {} }));
    expect((container.querySelector('[data-overlay-panel]') as HTMLElement).className).toContain('h-1/2');
  });
});
