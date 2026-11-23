// @vitest-environment happy-dom
import { StrictMode, act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { b, defineBlock, defineBlocks, type ContentFetcher, type PuckData } from '@opencloudcms/core/blocks';
import { useAutosave, usePreviewResolution } from '../../admin/src/page-editor/hooks';
import type { Autosave } from '../../admin/src/page-editor/autosave';
import type { ResolvedItem } from '../../admin/src/page-editor/field-logic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const render = (node: ReactNode) => act(() => root.render(createElement(StrictMode, null, node)));

describe('useAutosave under StrictMode', () => {
  it('still saves a change made after the double mount, and flushes on unmount', async () => {
    const save = vi.fn(async () => ({ updatedAt: 't1' }));
    let api: Autosave<string> | null = null;
    function Harness() {
      const { autosave } = useAutosave<string>({ save, ifMatch: 't0' });
      useEffect(() => {
        api = autosave;
      }, [autosave]);
      return null;
    }
    render(createElement(Harness));
    act(() => api!.change('a'));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(save).toHaveBeenCalledWith('a', 't0');

    act(() => api!.change('b'));
    await act(async () => root.unmount());
    root = createRoot(container); // afterEach unmounts again
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(save).toHaveBeenLastCalledWith('b', 't1');
  });
});

const registry = defineBlocks([
  defineBlock({ name: 'Pick', label: 'Pick', category: 'data', fields: { items: b.entries('product') }, render: () => null }),
]);

describe('usePreviewResolution under StrictMode', () => {
  it('resolves the initial data after the double mount', async () => {
    const fetcher: ContentFetcher = {
      byIds: vi.fn(async () => [{ documentId: 'a', name: 'A' }]),
      query: vi.fn(async () => []),
      pagePaths: vi.fn(async () => ({})),
    };
    const initial = {
      root: { props: {} },
      content: [{ type: 'Pick', props: { id: 'p1', items: { mode: 'pick', ids: ['a'] } } }],
    } as unknown as PuckData;
    let resolved: ReadonlyMap<string, ResolvedItem> = new Map();
    function Harness() {
      const r = usePreviewResolution(registry, initial, fetcher, { locale: 'en-US', defaultLocale: 'en-US' });
      resolved = r.resolved;
      return null;
    }
    render(createElement(Harness));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(fetcher.byIds).toHaveBeenCalled();
    expect(resolved.get('p1')?.props.items).toEqual([{ documentId: 'a', name: 'A' }]);
  });
});
