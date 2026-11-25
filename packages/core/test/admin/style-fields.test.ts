// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Breakpoint, ThemeDefinition } from '@opencloudcms/schema';
import { BreakpointContext } from '../../admin/src/block-builder/style/breakpoint';
import { ColorField, LengthField, SidesField, TrackField } from '../../admin/src/block-builder/style/fields';
import { StylePanel } from '../../admin/src/block-builder/style/StylePanel';
import { enUS } from '../../admin/src/i18n/messages/en-US';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const render = (node: ReactNode, bp: Breakpoint = 'md') =>
  act(() => root.render(createElement(BreakpointContext.Provider, { value: bp }, node)));

const q = <T extends Element = HTMLElement>(sel: string, from: ParentNode = container) => from.querySelector(sel) as T | null;

/** Opens the Radix select inside `scope` and picks the option labelled `label`. */
function pick(scope: ParentNode, label: string) {
  const trigger = q<HTMLButtonElement>('[role="combobox"]', scope)!;
  act(() => trigger.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.trim() === label);
  expect(option, `option ${label}`).toBeTruthy();
  act(() => option!.click());
}

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('LengthField', () => {
  it('at Tablet shows the Mobile value muted and writes a custom value for Tablet only', () => {
    const onChange = vi.fn();
    render(createElement(LengthField, { label: 'Width', value: '4', onChange }));
    const inherited = q('[data-inherited]')!;
    expect(inherited.textContent).toContain('4');
    expect(inherited.className).toContain('text-muted-foreground');
    expect(container.textContent).toContain('from Mobile');
    expect(q('[data-reset]')).toBeNull();

    pick(container, 'Custom');
    const input = q<HTMLInputElement>('input[data-custom]')!;
    expect(input).toBeTruthy();
    type(input, '37px');
    expect(onChange).toHaveBeenLastCalledWith({ base: '4', md: '37px' });
  });

  it('a bare number takes the unit; invalid input shows an error and writes nothing', () => {
    const onChange = vi.fn();
    render(createElement(LengthField, { label: 'Width', value: { base: '4', md: '12px' }, onChange }));
    const input = q<HTMLInputElement>('input[data-custom]')!;
    expect(input.value).toBe('12');
    type(input, '4px;x');
    expect(q('[role="alert"]')?.textContent).toBe(enUS.blockBuilder.style.invalidLength);
    expect(onChange).not.toHaveBeenCalled();
    type(input, '20');
    expect(onChange).toHaveBeenLastCalledWith({ base: '4', md: '20px' });
  });

  it('negative values only where allowed; reset clears the breakpoint', () => {
    const onChange = vi.fn();
    render(createElement(LengthField, { label: 'Width', value: { base: '4', md: '12px' }, onChange }));
    type(q<HTMLInputElement>('input[data-custom]')!, '-8px');
    expect(onChange).not.toHaveBeenCalled();
    act(() => q<HTMLButtonElement>('[data-reset]')!.click());
    expect(onChange).toHaveBeenLastCalledWith('4'); // a base-only value is stored plain
  });

  it('picks a token at the current breakpoint', () => {
    const onChange = vi.fn();
    render(createElement(LengthField, { label: 'Width', value: undefined, onChange }), 'base');
    pick(container, '8');
    expect(onChange).toHaveBeenLastCalledWith('8');
  });
});

const theme: ThemeDefinition = {
  colors: { sky: { label: 'Sky' }, ink: {} },
  palettes: { day: { values: { sky: '#38bdf8', ink: '#111827' } } },
  activePalette: 'day',
};

describe('ColorField', () => {
  it('offers semantic, then brand swatches, then a custom hex', () => {
    const onChange = vi.fn();
    render(createElement(ColorField, { label: 'Background', value: undefined, onChange, theme }));
    act(() => q<HTMLButtonElement>('[role="combobox"]')!.click());
    const labels = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
    expect(labels.indexOf('primary')).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf('primary')).toBeLessThan(labels.indexOf('Sky'));
    expect(labels.at(-1)).toBe('Custom');
    act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.trim() === 'Sky')!.click());
    expect(onChange).toHaveBeenLastCalledWith('brand:sky');
  });

  it('checks a custom hex and warns about a brand color the theme no longer has', () => {
    const onChange = vi.fn();
    render(createElement(ColorField, { label: 'Background', value: '#ff0000', onChange, theme: null }));
    const hex = q<HTMLInputElement>('input[data-custom]')!;
    type(hex, 'red;');
    expect(q('[role="alert"]')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    type(hex, '#00ff00');
    expect(onChange).toHaveBeenLastCalledWith('#00ff00');

    render(createElement(ColorField, { label: 'Background', value: 'brand:gone', onChange, theme }));
    expect(q('[data-missing-brand]')?.textContent).toContain('gone');
  });
});

describe('SidesField', () => {
  it('writes one side at the breakpoint (the others inherit), or all four when linked', () => {
    const onChange = vi.fn();
    render(createElement(SidesField, { label: 'Padding', value: { base: { t: '4', b: '4' } }, onChange }));
    const top = q<HTMLInputElement>('input[data-side="t"]')!;
    expect(top.placeholder).toBe('4');
    type(top, '24px');
    expect(onChange).toHaveBeenLastCalledWith({ base: { t: '4', b: '4' }, md: { t: '24px' } });
    act(() => q<HTMLButtonElement>('[data-link]')!.click());
    type(q<HTMLInputElement>('input[data-side="l"]')!, '8');
    expect(onChange).toHaveBeenLastCalledWith({ base: { t: '4', b: '4' }, md: { t: '8', r: '8', b: '8', l: '8' } });
  });
});

describe('TrackField', () => {
  it('presets write the breakpoint; add stops at max', () => {
    const onChange = vi.fn();
    render(createElement(TrackField, { label: 'Columns', value: { base: ['1fr'] }, onChange, max: 2 }));
    act(() => q<HTMLButtonElement>('[data-preset="1:2"]')!.click());
    expect(onChange).toHaveBeenLastCalledWith({ base: ['1fr'], md: ['1fr', '2fr'] });
    // more tracks than max: not offered
    expect(q('[data-preset="1:1:1"]')).toBeNull();
    render(createElement(TrackField, { label: 'Columns', value: { base: ['1fr'], md: ['1fr', '1fr'] }, onChange, max: 2 }));
    expect(q<HTMLButtonElement>('[data-add-track]')!.disabled).toBe(true);
  });
});

describe('StylePanel', () => {
  it('shows only the sections of the element; span only inside Columns or Grid', () => {
    const onChange = vi.fn();
    render(createElement(StylePanel, { el: 'Heading', value: undefined, onChange, theme: null, parent: 'Stack' }));
    const sections = [...container.querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'));
    expect(sections).toEqual(['margin', 'maxWidth', 'textColor', 'visibility']);
    render(createElement(StylePanel, { el: 'Heading', value: undefined, onChange, theme: null, parent: 'Columns' }));
    expect(q('[data-section="span"]')).toBeTruthy();
  });

  it('Box/Card without padding show their default padding and seed it on the first padding edit', () => {
    const onChange = vi.fn();
    render(createElement(StylePanel, { el: 'Box', value: undefined, onChange, theme: null }), 'base');
    const pad = (side: string) => container.querySelectorAll<HTMLInputElement>(`input[data-side="${side}"]`)[1]!;
    expect([pad('t').placeholder, pad('r').placeholder, pad('b').placeholder, pad('l').placeholder]).toEqual(['8', '–', '8', '–']);
    type(pad('l'), '4');
    expect(onChange).toHaveBeenLastCalledWith({ padding: { t: '8', b: '8', l: '4' } });

    render(createElement(StylePanel, { el: 'Card', value: undefined, onChange, theme: null }), 'md');
    expect(pad('r').placeholder).toBe('6');
    type(pad('r'), '12');
    expect(onChange).toHaveBeenLastCalledWith({ padding: { base: { t: '6', r: '6', b: '6', l: '6' }, md: { r: '12' } } });

    // A node with a style padding (or a legacy prop, shown migrated) keeps its own values; other elements have no defaults.
    render(createElement(StylePanel, { el: 'Box', value: { padding: { t: '2' } }, onChange, theme: null }), 'base');
    expect(pad('b').placeholder).toBe('–');
    type(pad('b'), '4');
    expect(onChange).toHaveBeenLastCalledWith({ padding: { t: '2', b: '4' } });
    render(createElement(StylePanel, { el: 'Stack', value: undefined, onChange, theme: null }), 'base');
    expect(pad('t').placeholder).toBe('–');
  });

  it('Button has the colors section (text color and radius); Badge has text color', () => {
    const onChange = vi.fn();
    render(createElement(StylePanel, { el: 'Button', value: { color: 'brand:ink' }, onChange, theme: null }));
    expect([...container.querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'))).toEqual(['margin', 'size', 'colors', 'visibility']);
    render(createElement(StylePanel, { el: 'Badge', value: undefined, onChange, theme: null }));
    expect([...container.querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'))).toEqual(['margin', 'size', 'textColor', 'visibility']);
  });

  it('hide toggles write the breakpoint flag', () => {
    const onChange = vi.fn();
    render(createElement(StylePanel, { el: 'Divider', value: { margin: { t: '4' } }, onChange, theme: null }));
    act(() => q<HTMLButtonElement>('[data-hide="md"]')!.click());
    expect(onChange).toHaveBeenLastCalledWith({ margin: { t: '4' }, hidden: { md: true } });
  });
});

const flatKeys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatKeys(v as object, `${prefix}${k}.`)));

describe('style strings', () => {
  it('exist in all four locales', async () => {
    const keys = flatKeys(enUS.blockBuilder.style, 'blockBuilder.style.');
    expect(keys.length).toBeGreaterThan(20);
    for (const mod of [import('../../admin/src/i18n/messages/vi-VN'), import('../../admin/src/i18n/messages/fr-FR'), import('../../admin/src/i18n/messages/id-ID')]) {
      const bundle = (await mod).default as unknown as { blockBuilder: { style: object } };
      expect(flatKeys(bundle.blockBuilder.style, 'blockBuilder.style.').sort()).toEqual([...keys].sort());
    }
  });
});

describe('canvas item frame', () => {
  it('carries the column span and fills the cell for a relative height', async () => {
    const { frameAttrs } = await import('../../admin/src/block-builder/Canvas');
    expect(frameAttrs(undefined)).toEqual({});
    expect(frameAttrs({ height: '300px' })).toEqual({});
    const f = frameAttrs({ height: { md: '100%' }, span: { md: 2 } });
    expect(f.className).toContain('h-full');
    expect(f.style).toEqual({ '--ocms-span-md': '2' });
    expect(f.className!.split(' ').length).toBeGreaterThan(1);
  });
});
