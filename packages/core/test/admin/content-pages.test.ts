// @vitest-environment happy-dom
// Admin content pages (spec §8): list, new, detail and edit as separate routes; private types (spec §7).
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('../../admin/src/lib/api', () => ({ api: (...a: unknown[]) => api(...a) }));

const navigate = vi.fn();
let params: Record<string, string> = {};
let search: Record<string, string> = {};
let pathname = '/';
vi.mock('../../admin/src/lib/nav', async () => {
  const { createElement: h, useEffect } = await import('react');
  const { confirmNavigation } = await import('../../admin/src/lib/nav-guard');
  return {
    adminHref: (to: string) => `/admin${to}`,
    Link: ({ to, children, onClick, ...rest }: any) =>
      h('a', { ...rest, href: `/admin${to}`, onClick: (e: any) => { onClick?.(e); e.preventDefault(); if (confirmNavigation()) navigate(to); } }, children),
    useAdminNavigate: () => (to: string, opts?: { skipGuard?: boolean }) => { if (opts?.skipGuard || confirmNavigation()) (opts === undefined ? navigate(to) : navigate(to, opts)); },
    useAdminParams: () => params,
    useAdminSearch: () => '',
    useAdminSearchParam: (name: string) => search[name] ?? null,
    useAdminPathname: () => pathname,
    Redirect: ({ to }: { to: string }) => { useEffect(() => navigate(to, { replace: true }), [to]); return null; },
  };
});

let permissions: string[] = [];
vi.mock('../../admin/src/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@example.com', name: 'A', groups: [], permissions, isSuperAdmin: false }, logout: vi.fn(), setUserLocale: vi.fn() }),
}));

import { matchRoute } from '../../admin/src/router/match';
import { routePermission } from '../../admin/src/lib/can';
import { Content } from '../../admin/src/pages/Content';
import { ContentDetail } from '../../admin/src/pages/content/ContentDetail';
import { ContentEdit } from '../../admin/src/pages/content/ContentEdit';
import { ContentNew } from '../../admin/src/pages/content/ContentNew';
import { canCreateEntries, writableBody } from '../../admin/src/pages/content/useEntry';
import { confirmNavigation, registerNavigationGuard } from '../../admin/src/lib/nav-guard';
import { enUS } from '../../admin/src/i18n/messages/en-US';
import { ApiError } from '../../admin/src/lib/api-error';
import type { ContentTypeDefinition, FieldDefinition } from '../../admin/src/lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fld = (name: string, kind: FieldDefinition['kind'], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: `fld_${name}`, name, kind, required: false, localizable: false, indexed: false, unique: false, options: {}, ...extra,
});
const post: ContentTypeDefinition = { id: 'ct_p', apiId: 'post', displayName: 'Post', fields: [fld('title', 'text', { required: true, localizable: true }), fld('body', 'longText')] };
const article: ContentTypeDefinition = { ...post, id: 'ct_a', apiId: 'article', displayName: 'Article', review: true };
const order: ContentTypeDefinition = {
  id: 'ct_o', apiId: 'order', displayName: 'Order', private: true,
  fields: [fld('code', 'text', { required: true }), fld('total', 'number', { readOnly: true }), fld('invoice', 'asset', { options: { accept: ['application/pdf'] } })],
};
const ledger: ContentTypeDefinition = { id: 'ct_l', apiId: 'ledger', displayName: 'Ledger', private: true, fields: [fld('ref', 'text', { required: true, readOnly: true })] };
const TYPES: Record<string, ContentTypeDefinition> = { post, article, order, ledger };
const META = { schemaEditable: true, defaultLocale: 'en-US', locales: ['en-US', 'vi-VN'], fieldKinds: [] };
const DOC = '11111111-1111-4111-8111-111111111111';
const entry = (extra: Record<string, unknown> = {}) => ({ documentId: DOC, status: 'draft', locale: 'en-US', publishedAt: null, updatedAt: '2026-11-20T10:00:00.000Z', title: 'Hello', body: null, ...extra });

let entries: Record<string, unknown>[] = [];
let one: Record<string, unknown> = entry();
let files: unknown[] = [];
function mockApi() {
  api.mockImplementation(async (url: string, init?: { method?: string; json?: unknown }) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/admin/meta') return META;
    const ct = /^\/api\/admin\/content-types\/(\w+)$/.exec(url);
    if (ct) return { data: TYPES[ct[1]!] };
    if (method === 'GET' && /\/versions$/.test(url)) return { data: [{ id: 'v1', createdAt: '2026-11-19T09:00:00.000Z' }] };
    if (method === 'GET' && /\/files$/.test(url)) return { data: files };
    if (method === 'GET' && /^\/api\/admin\/content\/\w+\?/.test(url)) return { data: entries, meta: { total: entries.length } };
    if (method === 'GET' && /^\/api\/admin\/content\/\w+\/[\w-]+(\?|$)/.test(url)) return { data: one };
    if (method === 'PATCH' || method === 'POST') return { data: { ...one, ...(init?.json as object) } };
    return { data: [] };
  });
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  api.mockReset();
  navigate.mockReset();
  mockApi();
  params = {};
  search = {};
  pathname = '/';
  entries = [];
  one = entry();
  files = [];
  permissions = ['content.read', 'content.create', 'content.update', 'content.publish', 'content.delete', 'content.submit'];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const render = async (node: ReactNode) => {
  await act(async () => root.render(node));
  await flush();
};
const buttons = (scope: ParentNode = document.body) => [...scope.querySelectorAll('button')];
const button = (label: string, scope: ParentNode = document.body) => buttons(scope).find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
const calls = (method: string) => api.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === method);
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('content routes', () => {
  it('matches list, new, detail and edit', () => {
    expect(matchRoute(['content', 'post'])).toEqual({ id: 'content', params: { apiId: 'post' }, guarded: true });
    expect(matchRoute(['content', 'post', 'new'])).toEqual({ id: 'contentNew', params: { apiId: 'post' }, guarded: true });
    expect(matchRoute(['content', 'post', DOC])).toEqual({ id: 'contentDetail', params: { apiId: 'post', documentId: DOC }, guarded: true });
    expect(matchRoute(['content', 'post', DOC, 'edit'])).toEqual({ id: 'contentEdit', params: { apiId: 'post', documentId: DOC }, guarded: true });
    expect(matchRoute(['content', 'post', DOC, 'nope']).id).toBe('notFound');
    expect(matchRoute(['content', 'post', DOC, 'edit', 'x']).id).toBe('notFound');
  });
  it('route permissions', () => {
    expect(routePermission('content')).toBe('content.read');
    expect(routePermission('contentDetail')).toBe('content.read');
    expect(routePermission('contentNew')).toBe('content.create');
    expect(routePermission('contentEdit')).toBe('content.update');
  });
});

describe('list', () => {
  it('row click navigates to the detail page', async () => {
    params = { apiId: 'post' };
    entries = [entry()];
    await render(createElement(Content));
    const row = container.querySelector<HTMLElement>('tbody tr')!;
    expect(row.textContent).toContain('Hello');
    act(() => row.click());
    expect(navigate).toHaveBeenCalledWith(`/content/post/${DOC}`);
  });
  it('an old ?entry= deep link redirects to the detail page', async () => {
    params = { apiId: 'post' };
    search = { entry: DOC };
    await render(createElement(Content));
    expect(navigate).toHaveBeenCalledWith(`/content/post/${DOC}`, { replace: true });
  });
  it('has New for normal types; none for a type with a required readOnly field', async () => {
    params = { apiId: 'post' };
    await render(createElement(Content));
    expect(container.querySelector('a[href="/admin/content/post/new"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    params = { apiId: 'ledger' };
    await render(createElement(Content));
    expect(container.textContent).toContain('Ledger');
    expect(container.querySelector('a[href="/admin/content/ledger/new"]')).toBeNull();
    expect(button('New entry')).toBeUndefined();
  });
  it('private list: lock in the header, no status column, no locale select', async () => {
    params = { apiId: 'order' };
    entries = [{ ...entry(), code: 'O-1' }];
    await render(createElement(Content));
    expect(container.querySelector('h1 [data-private-lock], [data-private-lock]')).not.toBeNull();
    const heads = [...container.querySelectorAll('th')].map((th) => th.textContent);
    expect(heads).not.toContain('Status');
    expect(heads).toContain('Updated');
    expect(container.querySelector('[aria-label="Locale"]')).toBeNull();
  });
  it('canCreateEntries', () => {
    expect(canCreateEntries(post)).toBe(true);
    expect(canCreateEntries(order)).toBe(true);
    expect(canCreateEntries(ledger)).toBe(false);
  });
});

describe('edit', () => {
  it('saves via PATCH and returns to the detail page', async () => {
    params = { apiId: 'post', documentId: DOC };
    await render(createElement(ContentEdit));
    const title = container.querySelector<HTMLInputElement>('#field-fld_title')!;
    expect(title.value).toBe('Hello');
    type(title, 'Changed');
    await act(async () => button('Save')!.click());
    await flush();
    const patch = calls('PATCH');
    expect(patch).toHaveLength(1);
    expect(patch[0]![0]).toBe(`/api/admin/content/post/${DOC}?locale=en-US`);
    expect(patch[0]![1].json).toMatchObject({ title: 'Changed' });
    expect(navigate).toHaveBeenCalledWith(`/content/post/${DOC}`);
  });
  it('shows inline errors and does not save when a required field is empty', async () => {
    params = { apiId: 'post', documentId: DOC };
    await render(createElement(ContentEdit));
    type(container.querySelector<HTMLInputElement>('#field-fld_title')!, '');
    await act(async () => button('Save')!.click());
    await flush();
    expect(calls('PATCH')).toHaveLength(0);
    expect(container.textContent).toContain(enUS.content.fieldRequired);
  });
  it('never sends readOnly fields', () => {
    expect(writableBody(order, { code: 'A', total: 5, invoice: null })).toEqual({ code: 'A', invoice: null });
  });
});

describe('new', () => {
  it('creates via POST and lands on the detail page', async () => {
    params = { apiId: 'post' };
    one = entry({ documentId: DOC });
    await render(createElement(ContentNew));
    type(container.querySelector<HTMLInputElement>('#field-fld_title')!, 'Fresh');
    await act(async () => button('Save')!.click());
    await flush();
    const post = calls('POST');
    expect(post[0]![0]).toBe('/api/admin/content/post?locale=en-US');
    expect(post[0]![1].json).toEqual({ title: 'Fresh' });
    expect(navigate).toHaveBeenCalledWith(`/content/post/${DOC}`, { replace: true });
  });
});

describe('detail', () => {
  it('review: the reject dialog sends the note', async () => {
    params = { apiId: 'article', documentId: DOC };
    one = entry({ workflow: { state: 'in_review', submittedBy: { id: 'u2', name: 'Bea' }, submittedAt: '2026-11-21T00:00:00.000Z', note: null } });
    await render(createElement(ContentDetail));
    expect(button('Approve and publish')).toBeDefined();
    act(() => button('Reject')!.click());
    await flush();
    const note = document.querySelector<HTMLTextAreaElement>('#reject-note')!;
    expect(note).not.toBeNull();
    type(note, 'Needs a source');
    const dialog = document.querySelector('[role="dialog"]')!;
    await act(async () => button('Reject', dialog)!.click());
    await flush();
    const reject = calls('POST').find((c) => String(c[0]).endsWith('/reject'));
    expect(reject?.[0]).toBe(`/api/admin/content/article/${DOC}/reject`);
    expect(reject?.[1].json).toEqual({ note: 'Needs a source' });
  });
  it('shows status, versions and Edit; Publish for a public draft', async () => {
    params = { apiId: 'post', documentId: DOC };
    await render(createElement(ContentDetail));
    expect(button('Publish')).toBeDefined();
    expect(container.querySelector(`a[href="/admin/content/post/${DOC}/edit"]`)).not.toBeNull();
    expect(container.textContent).toContain(enUS.content.versions);
    expect(container.querySelector<HTMLInputElement>('#field-fld_title')!.disabled).toBe(true);
  });
  it('private: no Publish, no locale select, no versions; readOnly field disabled; files with Download', async () => {
    params = { apiId: 'order', documentId: DOC };
    one = { documentId: DOC, status: 'draft', publishedAt: null, updatedAt: '2026-11-20T10:00:00.000Z', code: 'O-1', total: 12, invoice: 'a1' };
    files = [{ id: 'a1', filename: 'invoice.pdf', size: 2048, mime: 'application/pdf' }];
    await render(createElement(ContentDetail));
    expect(container.textContent).toContain('O-1');
    for (const label of ['Publish', 'Unpublish', 'Submit for review', 'Approve and publish', 'Reject']) expect(button(label), label).toBeUndefined();
    expect(container.querySelector('[aria-label="Locale"]')).toBeNull();
    expect(api.mock.calls.some((c) => String(c[0]).endsWith('/versions'))).toBe(false);
    expect(container.querySelector<HTMLInputElement>('#field-fld_total')!.disabled).toBe(true);
    expect(container.textContent).toContain('invoice.pdf');
    expect(container.textContent).toMatch(/2(\.0)?\s?KB/);
    expect(api).toHaveBeenCalledWith(`/api/admin/content/order/${DOC}/files`);
    api.mockImplementationOnce(async () => ({ url: '/api/admin/assets/a1/file?token=x', expiresAt: '2026-11-25T00:05:00.000Z' }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await act(async () => button('Download invoice.pdf')!.click());
    await flush();
    expect(api).toHaveBeenCalledWith('/api/admin/assets/a1/link', { method: 'POST' });
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
  it('private edit: readOnly field disabled, private asset upload goes to the type upload route', async () => {
    params = { apiId: 'order', documentId: DOC };
    one = { documentId: DOC, status: 'draft', publishedAt: null, updatedAt: '2026-11-20T10:00:00.000Z', code: 'O-1', total: 12, invoice: null };
    await render(createElement(ContentEdit));
    expect(container.querySelector<HTMLInputElement>('#field-fld_total')!.disabled).toBe(true);
    expect(container.querySelector('[aria-label="Locale"]')).toBeNull();
    const fileInput = container.querySelector<HTMLInputElement>('#field-fld_invoice-upload')!;
    expect(fileInput).not.toBeNull();
    api.mockImplementationOnce(async () => ({ data: { id: 'a9', filename: 'x.pdf', size: 10, mimeType: 'application/pdf' } }));
    const file = new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    await flush();
    const up = api.mock.calls.find((c) => c[0] === '/api/admin/content/order/assets');
    expect(up?.[1].method).toBe('POST');
    expect((up?.[1].body as FormData).get('field')).toBe('invoice');
    expect(container.textContent).toContain('x.pdf');
  });
});

describe('unsaved-changes guard', () => {
  it('asks before in-app navigation while registered', () => {
    const confirm = vi.fn().mockReturnValue(false);
    window.confirm = confirm;
    expect(confirmNavigation()).toBe(true);
    const off = registerNavigationGuard(() => true);
    expect(confirmNavigation()).toBe(false);
    confirm.mockReturnValue(true);
    expect(confirmNavigation()).toBe(true);
    off();
    confirm.mockClear();
    expect(confirmNavigation()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('edit page: beforeunload is blocked only while dirty', async () => {
    params = { apiId: 'post', documentId: DOC };
    await render(createElement(ContentEdit));
    const ev = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(ev()).toBe(false);
    type(container.querySelector<HTMLInputElement>('#field-fld_title')!, 'Dirty');
    await flush();
    expect(ev()).toBe(true);
  });
});

describe('fix round 1', () => {
  it('a failed save (500) keeps the unsaved-changes guard on', async () => {
    params = { apiId: 'post', documentId: DOC };
    await render(createElement(ContentEdit));
    type(container.querySelector<HTMLInputElement>('#field-fld_title')!, 'Changed');
    api.mockImplementationOnce(async () => { throw new ApiError(500, 'internal', 'Boom'); });
    await act(async () => button('Save')!.click());
    await flush();
    expect(calls('PATCH')).toHaveLength(1);
    expect(container.textContent).toContain('Boom');
    expect(navigate).not.toHaveBeenCalled();
    const confirm = vi.fn().mockReturnValue(false);
    window.confirm = confirm;
    expect(confirmNavigation()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
  it('the ?entry= redirect keeps ?locale=', async () => {
    params = { apiId: 'post' };
    search = { entry: DOC, locale: 'vi-VN' };
    await render(createElement(Content));
    expect(navigate).toHaveBeenCalledWith(`/content/post/${DOC}?locale=vi-VN`, { replace: true });
  });
  it('changing the locale writes ?locale= (replace)', async () => {
    params = { apiId: 'post' };
    pathname = '/content/post';
    await render(createElement(Content));
    act(() => container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Locale"]')!.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.trim() === 'vi-VN');
    act(() => option!.click());
    await flush();
    expect(navigate).toHaveBeenCalledWith('/content/post?locale=vi-VN', { replace: true, skipGuard: true });
    expect(api).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/admin\/content\/post\?locale=vi-VN&/));
  });
  it('the editor locale comes from ?locale=', async () => {
    params = { apiId: 'post', documentId: DOC };
    search = { locale: 'vi-VN' };
    await render(createElement(ContentDetail));
    expect(api).toHaveBeenCalledWith(`/api/admin/content/post/${DOC}?locale=vi-VN`);
    expect(container.querySelector(`a[href="/admin/content/post/${DOC}/edit?locale=vi-VN"]`)).not.toBeNull();
  });
  it('field errors set aria-invalid and aria-describedby on the control', async () => {
    params = { apiId: 'post', documentId: DOC };
    await render(createElement(ContentEdit));
    const title = container.querySelector<HTMLInputElement>('#field-fld_title')!;
    expect(title.getAttribute('aria-invalid')).not.toBe('true');
    type(title, '');
    await act(async () => button('Save')!.click());
    await flush();
    const input = container.querySelector<HTMLInputElement>('#field-fld_title')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    const msg = ids.map((id) => document.getElementById(id)).find((el) => el?.textContent === enUS.content.fieldRequired);
    expect(msg).toBeTruthy();
  });
  it('private delete uses the private description', async () => {
    params = { apiId: 'order', documentId: DOC };
    one = { documentId: DOC, status: 'draft', publishedAt: null, updatedAt: '2026-11-20T10:00:00.000Z', code: 'O-1', total: 1, invoice: null };
    await render(createElement(ContentDetail));
    act(() => button('Delete')!.click());
    await flush();
    expect(document.body.textContent).toContain(enUS.content.deletePrivateDescription);
    expect(document.body.textContent).not.toContain(enUS.content.deleteDescription);
  });
  it('a file uploaded in this edit session has no Download until saved', async () => {
    params = { apiId: 'order', documentId: DOC };
    one = { documentId: DOC, status: 'draft', publishedAt: null, updatedAt: '2026-11-20T10:00:00.000Z', code: 'O-1', total: 12, invoice: null };
    await render(createElement(ContentEdit));
    const fileInput = container.querySelector<HTMLInputElement>('#field-fld_invoice-upload')!;
    api.mockImplementationOnce(async () => ({ data: { id: 'a9', filename: 'x.pdf', size: 10, mimeType: 'application/pdf' } }));
    Object.defineProperty(fileInput, 'files', { value: [new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' })], configurable: true });
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    await flush();
    expect(container.textContent).toContain('x.pdf');
    expect(button('Download x.pdf')).toBeUndefined();
    expect(button('Remove x.pdf')).toBeDefined();
  });
});

describe('i18n', () => {
  const keys = ['fieldsCard', 'fieldsDescription', 'statusCard', 'versions', 'noVersions', 'fieldRequired', 'unsavedConfirm', 'privateType', 'download', 'save', 'cancel', 'edit', 'updatedAt', 'previous', 'next', 'filterPublished', 'deletePrivateDescription'];
  it.each(['en-US', 'vi-VN', 'fr-FR', 'id-ID'])('%s has the new content keys', async (code) => {
    const bundle = code === 'en-US' ? enUS : (await import(`../../admin/src/i18n/messages/${code}.ts`)).default;
    for (const k of keys) expect(typeof bundle.content[k], `${code} content.${k}`).toBe('string');
  });
});
