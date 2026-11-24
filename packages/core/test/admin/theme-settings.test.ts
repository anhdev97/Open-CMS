// @vitest-environment happy-dom
// Page builder > Theme screen: colors x palettes matrix, save, read-only, empty state.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeDefinition } from '@opencloudcms/schema';
import { ThemeSettings } from '../../admin/src/pages/ThemeSettings';
import { addColor, addPalette, removeColor, removePalette, renameColor, renamePalette } from '../../admin/src/lib/theme-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THEME: ThemeDefinition = {
  colors: { surface: { label: 'Surface' }, ink: {} },
  palettes: {
    olive: { label: 'Olive', values: { surface: '#fbf8ef', ink: '#28291e' } },
    clay: { label: 'Clay', values: { surface: '#f5e9e0', ink: '#3a2418' } },
    night: { label: 'Night', values: { surface: '#0a1a12', ink: '#f0f0f0' } },
  },
  activePalette: 'olive',
};

let root: Root;
let container: HTMLElement;
let calls: { url: string; method: string; body?: unknown }[];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function mockApi(get: unknown, put?: (body: unknown) => Response) {
  calls = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    return method === 'PUT' && put ? put(body) : json(200, get);
  }) as unknown as typeof fetch;
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const render = async (node: ReactNode) => { await act(async () => root.render(node)); await flush(); };
const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Theme screen', () => {
  it('renders the colors x palettes matrix', async () => {
    mockApi({ theme: THEME, editable: true });
    await render(createElement(ThemeSettings));
    expect(input('Olive: Surface').value).toBe('#fbf8ef');
    expect(input('Clay: Ink').value).toBe('#3a2418');
    expect(input('Night: Surface').value).toBe('#0a1a12');
    expect((container.querySelector('input[type=radio][aria-label="Make Olive the active palette"]') as HTMLInputElement).checked).toBe(true);
  });

  it('saves the full theme after a hex change', async () => {
    mockApi({ theme: THEME, editable: true }, (b) => json(200, { theme: b, editable: true }));
    await render(createElement(ThemeSettings));
    type(input('Clay: Ink'), '#111111');
    await act(async () => button('Save')!.click());
    await flush();
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/api/admin/theme');
    expect(put.body).toEqual({ ...THEME, palettes: { ...THEME.palettes, clay: { label: 'Clay', values: { surface: '#f5e9e0', ink: '#111111' } } } });
  });

  it('blocks an invalid hex client-side with an inline error', async () => {
    mockApi({ theme: THEME, editable: true });
    await render(createElement(ThemeSettings));
    type(input('Clay: Ink'), 'red');
    await act(async () => button('Save')!.click());
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(input('Clay: Ink').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows server 422 issues', async () => {
    mockApi({ theme: THEME, editable: true }, () => json(422, { error: { code: 'validation_failed', message: 'Invalid theme', issues: [{ path: ['palettes', 'clay', 'values', 'ink'], message: 'bad hex' }] } }));
    await render(createElement(ThemeSettings));
    type(input('Clay: Ink'), '#222222');
    await act(async () => button('Save')!.click());
    await flush();
    expect(container.textContent).toContain('bad hex');
    expect(input('Clay: Ink').getAttribute('aria-invalid')).toBe('true');
  });

  it('is read-only when not editable', async () => {
    mockApi({ theme: THEME, editable: false });
    await render(createElement(ThemeSettings));
    expect(input('Clay: Ink').disabled).toBe(true);
    expect(container.textContent).toContain('read-only');
    expect(button('Save')).toBeUndefined();
  });

  it('offers Create theme when there is none', async () => {
    mockApi({ theme: null, editable: true });
    await render(createElement(ThemeSettings));
    act(() => button('Create theme')!.click());
    expect(input('Default: Primary').value).toBe('#000000');
  });
});

describe('theme edit helpers', () => {
  it('renames a color keeping values', () => {
    const t = renameColor(THEME, 'ink', 'text');
    expect(t.colors.text).toEqual({});
    expect(t.palettes.clay!.values.text).toBe('#3a2418');
    expect(t.palettes.clay!.values.ink).toBeUndefined();
  });
  it('removes a color from every palette', () => {
    const t = removeColor(THEME, 'ink');
    expect(Object.keys(t.colors)).toEqual(['surface']);
    expect(t.palettes.night!.values).toEqual({ surface: '#0a1a12' });
  });
  it('adds a color to every palette', () => {
    const t = addColor(THEME, 'accent');
    expect(t.palettes.clay!.values.accent).toBe('#000000');
  });
  it('adds a palette copying the active one, renames and removes palettes', () => {
    const a = addPalette(THEME, 'copy');
    expect(a.palettes.copy!.values).toEqual(THEME.palettes.olive!.values);
    const r = renamePalette(THEME, 'olive', 'moss');
    expect(r.activePalette).toBe('moss');
    expect(Object.keys(r.palettes)).toEqual(['moss', 'clay', 'night']);
    expect(removePalette(THEME, 'olive').activePalette).toBe('clay');
  });
});
