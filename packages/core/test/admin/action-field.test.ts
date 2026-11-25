// @vitest-environment happy-dom
// Button action editor of the block builder and the page editor (`b.action()`).
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComposedBlock, defineBlocks, type BlockDefinition } from '@opencloudcms/core/blocks';
import { ActionEditor, overlayNamesInData, treeAnchorIds } from '../../admin/src/block-builder/ActionField';
import { PAGE_CUSTOM_FIELDS } from '../../admin/src/page-editor/custom-fields';
import { BuilderContext, type BuilderModel } from '../../admin/src/block-builder/context';
import { PatternField, RegionLabelField } from '../../admin/src/block-builder/ElementPanel';

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

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T | null;

function pick(label: string) {
  act(() => q<HTMLButtonElement>('[role="combobox"]')!.click());
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

const draw = (props: Partial<Parameters<typeof ActionEditor>[0]> & { onChange: (v: unknown) => void }) =>
  act(() => root.render(createElement(ActionEditor, { id: 'act', label: 'Action', value: undefined, overlays: null, anchors: [], ...props })));

describe('ActionEditor', () => {
  it('offers Link / Open / Close / Toggle / Scroll; Link is the default (no target box)', () => {
    draw({ onChange: vi.fn() });
    expect(q('[role="combobox"]')!.textContent).toContain('Link');
    expect(q('input[data-action-target]')).toBeNull();
    act(() => q<HTMLButtonElement>('[role="combobox"]')!.click());
    const labels = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
    expect(labels).toEqual(['Link', 'Open overlay', 'Close overlay', 'Toggle overlay', 'Scroll to']);
  });

  it('writes {type:overlay, op:open, target:lien-he}', () => {
    const onChange = vi.fn();
    draw({ onChange });
    pick('Open overlay');
    expect(onChange).not.toHaveBeenCalled(); // open needs a target first
    expect(q('[data-action-pending]')!.textContent).toMatch(/not saved/i);
    type(q<HTMLInputElement>('input[data-action-target]')!, 'lien-he');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'overlay', op: 'open', target: 'lien-he' });
    expect(q('[data-action-pending]')).toBeNull();
  });

  it('rejects target "Bad Name" with an inline error and writes nothing', () => {
    const onChange = vi.fn();
    draw({ onChange, value: { type: 'overlay', op: 'toggle', target: 'menu' } });
    const input = q<HTMLInputElement>('input[data-action-target]')!;
    expect(input.value).toBe('menu');
    type(input, 'Bad Name');
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(q('[data-action-error]')!.textContent).toMatch(/lowercase/i);
    expect(q('[data-action-pending]')).not.toBeNull();
  });

  it('close without a target is valid (the containing overlay); Link writes null', () => {
    const onChange = vi.fn();
    draw({ onChange, value: { type: 'overlay', op: 'open', target: 'menu' } });
    pick('Close overlay');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'overlay', op: 'close', target: 'menu' });
    type(q<HTMLInputElement>('input[data-action-target]')!, '');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'overlay', op: 'close' });
    pick('Link');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('scroll targets use the anchor id pattern and list the anchors of the block', () => {
    const onChange = vi.fn();
    draw({ onChange, anchors: ['Features', 'pricing'] });
    pick('Scroll to');
    const input = q<HTMLInputElement>('input[data-action-target]')!;
    const list = container.querySelector(`#${input.getAttribute('list')!}`)!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['Features', 'pricing']);
    type(input, 'Features');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'scroll', target: 'Features' });
    type(input, '1abc');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(q('[data-action-error]')).not.toBeNull();
  });

  it('free text is allowed with a warning when the overlay is not on the page', () => {
    const onChange = vi.fn();
    draw({ onChange, overlays: ['lien-he'] });
    pick('Open overlay');
    const input = q<HTMLInputElement>('input[data-action-target]')!;
    type(input, 'lien-he');
    expect(q('[data-action-warning]')).toBeNull();
    type(input, 'other');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'overlay', op: 'open', target: 'other' });
    expect(q('[data-action-warning]')!.textContent).toContain('other');
  });

  it('is disabled read-only', () => {
    draw({ onChange: vi.fn(), readOnly: true, value: { type: 'scroll', target: 'top' } });
    expect(q<HTMLButtonElement>('[role="combobox"]')!.disabled).toBe(true);
    expect(q<HTMLInputElement>('input[data-action-target]')!.disabled).toBe(true);
  });
});

describe('action targets', () => {
  it('anchor ids of the block tree, valid and first seen, in tree order', () => {
    expect(
      treeAnchorIds({
        el: 'Stack',
        props: { anchorId: 'top' },
        children: [{ el: 'Heading', props: { anchorId: 'Features' } }, { el: 'Box', props: { anchorId: '1bad' } }, { el: 'Text', props: { anchorId: 'top' } }],
      }),
    ).toEqual(['top', 'Features']);
  });

  it('overlay names of the overlay blocks on the page data (default name, else a valid name prop), nested slots included', () => {
    const overlay = defineComposedBlock({
      id: 'blk_contact1', name: 'ContactForm', label: { 'en-US': 'Contact' }, category: 'basic', version: 1, fields: {},
      tree: { el: 'Overlay', children: [{ el: 'Heading', bind: { text: { from: 'const', value: 'Hi' } } }] },
    });
    const holder = defineComposedBlock({
      id: 'blk_holder1', name: 'Holder', label: { 'en-US': 'Holder' }, category: 'basic', version: 1, fields: {}, tree: { el: 'Box', children: [{ el: 'Slot' }] },
    });
    const registry = defineBlocks([overlay, holder] as BlockDefinition[]);
    const data = {
      root: { props: {} },
      content: [
        { type: 'ContactForm', props: { id: 'a' } },
        { type: 'Holder', props: { id: 'b', slot: [{ type: 'ContactForm', props: { id: 'c', name: 'lien-he' } }, { type: 'ContactForm', props: { id: 'd', name: 'Bad Name' } }] } },
        // A slot inside a list-field row (rows are plain objects without `type`).
        { type: 'Tabs', props: { id: 'e', items: [{ title: 'A', content: [{ type: 'ContactForm', props: { id: 'f', name: 'in-row' } }] }] } },
      ],
    };
    expect(overlayNamesInData(data, registry)).toEqual(['contact-form', 'lien-he', 'in-row']);
    expect(overlayNamesInData(null, registry)).toEqual([]);
  });

  it('is registered as the page-editor custom field of b.action()', () => {
    expect((PAGE_CUSTOM_FIELDS as Record<string, unknown>).action).toBeTypeOf('function');
  });
});

describe('PatternField (anchorId, Region name)', () => {
  const model = (regions: string[]) =>
    ({ readOnly: false, regionCount: (n: string) => regions.filter((r) => r === n).length }) as unknown as BuilderModel;
  const drawPattern = (pattern: 'name' | 'anchor', value: unknown, onChange: (v: unknown) => void, regions: string[] = []) =>
    act(() =>
      root.render(
        createElement(
          BuilderContext.Provider,
          { value: model(regions) },
          createElement(PatternField as never, { field: { type: 'custom', label: 'Id', metadata: { pattern, required: pattern === 'name' } }, name: 'anchorId', id: 'pf', value, onChange }),
        ),
      ),
    );

  it('anchorId: an invalid id shows the error inline and is not written; empty clears it', () => {
    const onChange = vi.fn();
    drawPattern('anchor', 'top', onChange);
    const input = q<HTMLInputElement>('input[data-pattern]')!;
    type(input, '1bad');
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Start with a letter');
    type(input, 'Features');
    expect(onChange).toHaveBeenLastCalledWith('Features');
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('Region name: required, lowercase pattern, and unique in the block', () => {
    const onChange = vi.fn();
    drawPattern('name', 'header', onChange, ['header', 'footer']);
    const input = q<HTMLInputElement>('input[data-pattern]')!;
    type(input, '');
    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Required');
    type(input, 'footer');
    expect(container.textContent).toContain('Another region is already named footer');
    expect(onChange).not.toHaveBeenCalled();
    type(input, 'main');
    expect(onChange).toHaveBeenLastCalledWith('main');
  });
});

describe('RegionLabelField', () => {
  const drawLabel = (value: unknown, onChange: (v: unknown) => void) =>
    act(() =>
      root.render(
        createElement(
          BuilderContext.Provider,
          { value: { readOnly: false } as unknown as BuilderModel },
          createElement(RegionLabelField as never, { field: { type: 'custom', label: 'Label' }, name: 'label', id: 'rl', value, onChange }),
        ),
      ),
    );

  it('a plain label is edited as text (empty clears it)', () => {
    const onChange = vi.fn();
    drawLabel('Header', onChange);
    const input = q<HTMLInputElement>('input')!;
    expect(input.value).toBe('Header');
    type(input, 'Top bar');
    expect(onChange).toHaveBeenLastCalledWith('Top bar');
    type(input, '');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('a localized label (set in code) is shown read-only in the current locale, never overwritten', () => {
    const onChange = vi.fn();
    drawLabel({ 'en-US': 'Header', 'vi-VN': 'Đầu trang' }, onChange);
    const input = q<HTMLInputElement>('input')!;
    expect(input.value).toBe('Header');
    expect(input.readOnly).toBe(true);
    expect(container.textContent).not.toContain('[object Object]');
    expect(container.textContent).toMatch(/code/i);
  });
});
