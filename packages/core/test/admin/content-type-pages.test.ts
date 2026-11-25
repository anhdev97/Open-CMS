// @vitest-environment happy-dom
// Admin content type setup pages (spec §8): list, new, detail, edit (fields in a Sheet), groups (Dialog).
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('../../admin/src/lib/api', () => ({ api: (...a: unknown[]) => api(...a) }));

const navigate = vi.fn();
let params: Record<string, string> = {};
let search: Record<string, string> = {};
vi.mock('../../admin/src/lib/nav', async () => {
  const { createElement: h, useEffect } = await import('react');
  const { confirmNavigation } = await import('../../admin/src/lib/nav-guard');
  return {
    adminHref: (to: string) => `/admin${to}`,
    Link: ({ to, children, onClick, ...rest }: any) =>
      h('a', { ...rest, href: `/admin${to}`, onClick: (e: any) => { onClick?.(e); e.preventDefault(); if (confirmNavigation()) navigate(to); } }, children),
    useAdminNavigate: () => (to: string, opts?: { replace?: boolean; skipGuard?: boolean }) => {
      if (opts?.skipGuard || confirmNavigation()) (opts === undefined ? navigate(to) : navigate(to, opts));
    },
    useAdminParams: () => params,
    useAdminSearch: () => '',
    useAdminSearchParam: (name: string) => search[name] ?? null,
    useAdminPathname: () => '/',
    Redirect: ({ to }: { to: string }) => { useEffect(() => navigate(to, { replace: true }), [to]); return null; },
  };
});

vi.mock('../../admin/src/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'a@example.com', name: 'A', groups: [], permissions: ['content.read', 'settings.content-types'], isSuperAdmin: false },
    logout: vi.fn(),
    setUserLocale: vi.fn(),
  }),
}));

import { matchRoute } from '../../admin/src/router/match';
import { routePermission } from '../../admin/src/lib/can';
import { TypeList } from '../../admin/src/pages/content-types/TypeList';
import { TypeNew } from '../../admin/src/pages/content-types/TypeNew';
import { TypeDetail } from '../../admin/src/pages/content-types/TypeDetail';
import { TypeEdit } from '../../admin/src/pages/content-types/TypeEdit';
import { GroupsPage } from '../../admin/src/pages/content-types/GroupsPage';
import { referenceTargets } from '../../admin/src/pages/content-types/FieldSheet';
import { Content } from '../../admin/src/pages/Content';
import type { ContentTypeDefinition, FieldDefinition } from '../../admin/src/lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fld = (name: string, kind: FieldDefinition['kind'], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: `fld_${name}`, name, kind, required: false, localizable: false, indexed: false, unique: false, options: {}, ...extra,
});
const post: ContentTypeDefinition = {
  id: 'ct_p', apiId: 'post', displayName: { 'en-US': 'Post', 'vi-VN': 'Bài viết' }, group: 'blog', description: 'Blog posts',
  fields: [fld('title', 'text', { required: true, localizable: true, options: { maxLength: 120 } }), fld('body', 'longText'), fld('cover', 'asset')],
};
const order: ContentTypeDefinition = {
  id: 'ct_o', apiId: 'order', displayName: 'Order', private: true,
  fields: [fld('code', 'text', { required: true }), fld('total', 'number', { readOnly: true })],
};
const GROUPS = [{ key: 'blog', title: { 'en-US': 'Blog' }, order: 1 }, { key: 'shop', title: { 'en-US': 'Shop' } }];

let editable = true;
let types: ContentTypeDefinition[] = [];
let entryTotal = 0;
let groups = GROUPS;
function mockApi() {
  api.mockImplementation(async (url: string, init?: { method?: string; json?: any }) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/admin/meta') return { schemaEditable: editable, defaultLocale: 'en-US', locales: ['en-US'], fieldKinds: [], groups };
    if (url === '/api/admin/content-types' && method === 'GET') return { data: types };
    if (url === '/api/admin/content-types' && method === 'POST') {
      return { status: 'metadata-only', changed: true, summary: [], warnings: [], sql: [], schemaFile: 'src/content-types/x.schema.ts', migrationFile: null, generated: [], applied: [] };
    }
    if (url === '/api/admin/content-types/plan') return { changed: true, summary: ['change'], warnings: [], sql: [] };
    const ct = /^\/api\/admin\/content-types\/(\w+)$/.exec(url);
    if (ct && method === 'GET') return { data: types.find((x) => x.apiId === ct[1]) };
    if (ct && method === 'DELETE') return { status: 'created', changed: true, summary: [], warnings: [], sql: [], schemaFile: null, migrationFile: null, generated: [], applied: [] };
    if (/^\/api\/admin\/content\/\w+\?/.test(url)) return { data: [], meta: { total: entryTotal } };
    if (url === '/api/admin/content-groups' && method === 'GET') return { groups, editable };
    if (url === '/api/admin/content-groups' && method === 'PUT') {
      groups = init!.json.groups;
      return { groups };
    }
    return { data: [] };
  });
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  api.mockReset();
  navigate.mockReset();
  editable = true;
  types = [structuredClone(post), structuredClone(order)];
  entryTotal = 0;
  groups = structuredClone(GROUPS);
  mockApi();
  params = {};
  search = {};
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
const button = (label: string, scope: ParentNode = document.body) =>
  buttons(scope).find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
const click = async (el: Element | null | undefined) => {
  expect(el, 'element to click').toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const posts = () => api.mock.calls.filter((c) => c[0] === '/api/admin/content-types' && c[1]?.method === 'POST');
const puts = () => api.mock.calls.filter((c) => c[0] === '/api/admin/content-groups' && c[1]?.method === 'PUT');
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const input = (sel: string) => document.querySelector<HTMLInputElement>(sel)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

describe('routes', () => {
  it('matches list, new, groups, detail and edit', () => {
    expect(matchRoute(['settings', 'content-types'])).toEqual({ id: 'settingsContentTypes', params: {}, guarded: true });
    expect(matchRoute(['settings', 'content-types', 'new'])).toEqual({ id: 'settingsContentTypeNew', params: {}, guarded: true });
    expect(matchRoute(['settings', 'content-types', 'groups'])).toEqual({ id: 'settingsContentGroups', params: {}, guarded: true });
    expect(matchRoute(['settings', 'content-types', 'post'])).toEqual({ id: 'settingsContentTypeDetail', params: { apiId: 'post' }, guarded: true });
    expect(matchRoute(['settings', 'content-types', 'post', 'edit'])).toEqual({ id: 'settingsContentTypeEdit', params: { apiId: 'post' }, guarded: true });
    expect(matchRoute(['settings', 'content-types', 'post', 'nope']).id).toBe('notFound');
    expect(matchRoute(['settings', 'content-types', 'post', 'edit', 'x']).id).toBe('notFound');
  });
  it('every page needs settings.content-types', () => {
    for (const id of ['settingsContentTypes', 'settingsContentTypeNew', 'settingsContentTypeDetail', 'settingsContentTypeEdit', 'settingsContentGroups'] as const) {
      expect(routePermission(id)).toBe('settings.content-types');
    }
  });
  it('redirects ?type=x to the detail page and ?tab=groups to the groups page', async () => {
    search = { type: 'post' };
    await render(createElement(TypeList));
    expect(navigate).toHaveBeenCalledWith('/settings/content-types/post', { replace: true });
    navigate.mockReset();
    act(() => root.unmount());
    root = createRoot(container);
    search = { tab: 'groups' };
    await render(createElement(TypeList));
    expect(navigate).toHaveBeenCalledWith('/settings/content-types/groups', { replace: true });
  });
  it('the content list "Edit schema" link points to the type detail page', async () => {
    params = { apiId: 'post' };
    await render(createElement(Content));
    expect(container.querySelector('a[href="/admin/settings/content-types/post"]')).not.toBeNull();
  });
});

describe('list', () => {
  it('shows types with group, field count, private and review; row click opens the detail page', async () => {
    await render(createElement(TypeList));
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Post');
    expect(rows[0]!.textContent).toContain('post');
    expect(rows[0]!.textContent).toContain('Blog');
    expect(rows[0]!.textContent).toContain('3');
    expect(rows[1]!.querySelector('[data-private-lock]')).not.toBeNull();
    await click(rows[0]);
    expect(navigate).toHaveBeenCalledWith('/settings/content-types/post');
    expect(container.querySelector('a[href="/admin/settings/content-types/new"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/settings/content-types/groups"]')).not.toBeNull();
  });
});

describe('read-only (production)', () => {
  beforeEach(() => {
    editable = false;
  });
  it('list has no New', async () => {
    await render(createElement(TypeList));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelector('a[href="/admin/settings/content-types/new"]')).toBeNull();
  });
  it('detail has no Edit or Archive', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeDetail));
    expect(container.textContent).toContain('title');
    expect(container.querySelector('a[href="/admin/settings/content-types/post/edit"]')).toBeNull();
    expect(button('Archive type')).toBeUndefined();
    expect(button('Edit title')).toBeUndefined();
  });
  it('edit and new redirect', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    expect(navigate).toHaveBeenCalledWith('/settings/content-types/post', { replace: true });
    act(() => root.unmount());
    root = createRoot(container);
    navigate.mockReset();
    await render(createElement(TypeNew));
    expect(navigate).toHaveBeenCalledWith('/settings/content-types', { replace: true });
  });
  it('groups page has no add, edit or delete', async () => {
    await render(createElement(GroupsPage));
    expect(container.textContent).toContain('Blog');
    expect(button('Add group')).toBeUndefined();
    expect(button('Edit group blog')).toBeUndefined();
  });
});

describe('detail', () => {
  it('shows the info card and the fields table, with Edit', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeDetail));
    expect(container.querySelector('h1')!.textContent).toContain('Post');
    expect(container.textContent).toContain('Blog posts');
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.querySelector('td:nth-child(2)')?.textContent ?? r.textContent)).toHaveLength(3);
    expect(container.querySelector('a[href="/admin/settings/content-types/post/edit"]')).not.toBeNull();
  });
});

describe('edit', () => {
  it('an unchanged type round-trips: editing one label sends today\'s payload with only that label changed', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    const save = button('Save and generate')!;
    expect(save.disabled).toBe(true);
    await click(button('Edit title'));
    expect(dialog().textContent).toContain('Edit field');
    type(input('#field-label'), 'Headline');
    await click(button('Apply', dialog()));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click(button('Save and generate'));
    expect(posts()).toHaveLength(1);
    const expected = structuredClone(post);
    expected.fields[0]!.label = 'Headline';
    expect(posts()[0]![1].json).toEqual({ definition: expected });
    expect(navigate).toHaveBeenCalledWith('/settings/content-types/post', { replace: true, skipGuard: true });
  });
  it('reorder changes the field order in the payload', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    await click(button('Move title down'));
    await click(button('Save and generate'));
    const sent = posts()[0]![1].json.definition as ContentTypeDefinition;
    expect(sent.fields.map((f) => f.name)).toEqual(['body', 'title', 'cover']);
    expect({ ...sent, fields: [] }).toEqual({ ...post, fields: [] });
  });
  it('drag and drop on a row reorders', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    const rows = () => [...container.querySelectorAll<HTMLElement>('tbody tr')];
    const fire = (el: HTMLElement, name: string) =>
      act(() => {
        const ev = new Event(name, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
        ev.dataTransfer = { setData: () => undefined, getData: () => '', effectAllowed: 'move', dropEffect: 'move' };
        el.dispatchEvent(ev);
      });
    fire(rows()[2]!, 'dragstart');
    fire(rows()[0]!, 'dragover');
    fire(rows()[0]!, 'drop');
    await flush();
    expect(rows().map((r) => r.getAttribute('data-field'))).toEqual(['cover', 'title', 'body']);
  });
  it('adds a field in the Sheet with readOnly and asset accept', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    await click(button('Add field'));
    expect(dialog().textContent).toContain('New field');
    // name is required (inline error)
    await click(button('Apply', dialog()));
    expect(dialog().textContent).toContain('camelCase');
    type(input('#field-name'), 'title');
    await click(button('Apply', dialog()));
    expect(dialog().textContent).toContain('Another field uses this name');
    type(input('#field-name'), 'serial');
    await click(dialog().querySelector('#field-readOnly'));
    await click(button('Apply', dialog()));
    await click(button('Edit cover'));
    type(input('#field-accept'), 'image/png, application/pdf');
    await click(button('Apply', dialog()));
    await click(button('Save and generate'));
    const sent = posts()[0]![1].json.definition as ContentTypeDefinition;
    const serial = sent.fields.find((f) => f.name === 'serial')!;
    expect(serial).toMatchObject({ kind: 'text', readOnly: true, required: false, localizable: false });
    expect(sent.fields.find((f) => f.name === 'cover')!.options).toEqual({ accept: ['image/png', 'application/pdf'] });
  });
  it('the private toggle disables review and localizable and clears them', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    const priv = input('#type-private') as unknown as HTMLButtonElement;
    const review = input('#type-review') as unknown as HTMLButtonElement;
    expect(priv.disabled).toBe(false);
    expect(review.disabled).toBe(false);
    await click(priv);
    expect((input('#type-review') as unknown as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('Private types cannot use review');
    await click(button('Edit body'));
    expect((dialog().querySelector('#field-localizable') as HTMLButtonElement).disabled).toBe(true);
    expect(dialog().textContent).toContain('document-level');
    await click(button('Apply', dialog()));
    await click(button('Save and generate'));
    const sent = posts()[0]![1].json.definition as ContentTypeDefinition;
    expect(sent.private).toBe(true);
    expect(sent.review).toBeUndefined();
    expect(sent.fields.every((f) => !f.localizable)).toBe(true);
  });
  it('the private toggle is disabled when the type has entries', async () => {
    entryTotal = 3;
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    expect((input('#type-private') as unknown as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('3 entries');
  });
  it('the API id is create-only', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    expect(input('#type-api-id').disabled).toBe(true);
  });
  it('asks before leaving with unsaved changes', async () => {
    params = { apiId: 'post' };
    await render(createElement(TypeEdit));
    type(input('#type-description'), 'Changed');
    const confirm = vi.fn().mockReturnValue(false);
    window.confirm = confirm;
    await click(container.querySelector('a[href="/admin/settings/content-types/post"]'));
    expect(confirm).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('new', () => {
  it('creates a type and lands on its detail page', async () => {
    await render(createElement(TypeNew));
    type(input('#type-api-id'), 'event');
    type(input('#type-display-name-en-US'), 'Event');
    await click(button('Add field'));
    type(input('#field-name'), 'name');
    await click(button('Apply', dialog()));
    await click(button('Save and generate'));
    expect(posts()).toHaveLength(1);
    const def = posts()[0]![1].json.definition as ContentTypeDefinition;
    expect(def).toMatchObject({ apiId: 'event', displayName: 'Event', fields: [{ name: 'name', kind: 'text' }] });
    expect(def.id).toMatch(/^ct_/);
    expect(def.private).toBeUndefined();
    expect(def.review).toBeUndefined();
    expect('group' in def).toBe(false);
    expect('description' in def).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/settings/content-types/event', { replace: true, skipGuard: true });
  });
  it('validates the API id and name inline', async () => {
    await render(createElement(TypeNew));
    type(input('#type-api-id'), 'Post');
    await click(button('Save and generate'));
    expect(posts()).toHaveLength(0);
    expect(container.textContent).toContain('camelCase');
    expect(container.textContent).toContain('Enter an English (en-US) name');
    type(input('#type-api-id'), 'post');
    await click(button('Save and generate'));
    expect(container.textContent).toContain('Another type uses this API id');
  });
});

describe('reference targets', () => {
  it('a public type cannot target private types; a private type can target any', () => {
    const all = [post, order];
    expect(referenceTargets(all, false).map((x) => x.apiId)).toEqual(['post']);
    expect(referenceTargets(all, true).map((x) => x.apiId)).toEqual(['post', 'order']);
  });
});

describe('groups page', () => {
  it('create, edit and delete in a dialog', async () => {
    await render(createElement(GroupsPage));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    await click(button('Add group'));
    type(input('#group-key'), 'news');
    type(input('#group-title-en-US'), 'News');
    type(input('#group-order'), '3');
    await click(button('Save group', dialog()));
    expect(puts()).toHaveLength(1);
    expect(puts()[0]![1].json.groups).toEqual([...GROUPS, { key: 'news', title: { 'en-US': 'News' }, order: 3 }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await click(button('Edit group shop'));
    expect(input('#group-key').disabled).toBe(true);
    type(input('#group-title-en-US'), 'Store');
    await click(button('Save group', dialog()));
    expect(puts()[1]![1].json.groups.find((g: { key: string }) => g.key === 'shop')).toEqual({ key: 'shop', title: { 'en-US': 'Store' } });

    await click(button('Delete group news'));
    await click(button('Delete', document.querySelector('[role="alertdialog"]')!));
    expect(puts()[2]![1].json.groups.map((g: { key: string }) => g.key)).toEqual(['blog', 'shop']);
  });
});
