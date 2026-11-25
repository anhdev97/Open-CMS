// @vitest-environment happy-dom
// Private content types (spec §7) are absent from the page editor and block builder pickers; a stored binding to one
// shows an inline warning instead of entries.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('../../admin/src/lib/api', () => ({ api: (...a: unknown[]) => api(...a) }));

import { b } from '@opencloudcms/core/blocks';
import { ContentTypeField } from '../../admin/src/page-editor/ContentTypeField';
import { EntryField } from '../../admin/src/page-editor/EntryPicker';
import { invalidate } from '../../admin/src/page-editor/data';
import { contentTypeOptions } from '../../admin/src/page-editor/field-logic';
import { bindableTypes } from '../../admin/src/block-builder/logic';
import type { ContentTypeDefinition } from '../../admin/src/lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const order: ContentTypeDefinition = { id: 'o', apiId: 'order', displayName: 'Order', private: true, fields: [] };
const post: ContentTypeDefinition = { id: 'p', apiId: 'post', displayName: 'Post', fields: [] };
const page: ContentTypeDefinition = { id: 'g', apiId: 'opencloudcmsPage', displayName: 'Page', fields: [] };

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  invalidate();
  api.mockReset();
  api.mockImplementation(async (url: string) => (url === '/api/admin/content-types' ? { data: [page, order, post] } : { data: [] }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
};

describe('type pickers exclude private types', () => {
  it('page editor content type select', () => {
    expect(contentTypeOptions([page, order, post], 'en-US').map((o) => o.value)).toEqual(['post']);
  });
  it('block builder binding type list (core types hidden too)', () => {
    expect(bindableTypes([page, order, post]).map((t) => t.apiId)).toEqual(['post']);
  });
});

describe('stored binding to a private type', () => {
  it('entry field: warns and loads no entries', async () => {
    const bf = b.entry('order');
    const render = EntryField as unknown as (p: Record<string, unknown>) => ReturnType<typeof createElement>;
    act(() => root.render(createElement(render, { field: { type: 'custom', metadata: { blockField: bf } }, name: 'item', id: 'f1', value: { documentId: 'x' }, onChange: vi.fn(), readOnly: false })));
    await settle();
    const warn = container.querySelector('[data-private-type]');
    expect(warn?.textContent).toMatch(/private content type/i);
    expect(api.mock.calls.map((c) => c[0])).toEqual(['/api/admin/content-types']);
  });

  it('content type select: warns about a stored private apiId; public values show no warning', async () => {
    const render = ContentTypeField as unknown as (p: Record<string, unknown>) => ReturnType<typeof createElement>;
    const props = { field: { type: 'custom', label: 'Type' }, name: 'apiId', id: 'f2', onChange: vi.fn(), readOnly: false };
    act(() => root.render(createElement(render, { ...props, value: 'order' })));
    await settle();
    expect(container.querySelector('[data-private-type]')?.textContent).toMatch(/private content type/i);
    act(() => root.render(createElement(render, { ...props, value: 'post' })));
    await settle();
    expect(container.querySelector('[data-private-type]')).toBeNull();
  });
});
