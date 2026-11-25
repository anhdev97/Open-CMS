import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineContentType, f } from '@opencloudcms/schema';
import { loginAs } from '../../../oauth2/test/support/login';
import { defineHooks, PrivateEntriesService } from '../../src';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const ALLOWED = 'https://shop.example.com';

const orderDef = defineContentType({
  id: 'ct_pvorder',
  apiId: 'order',
  displayName: 'Order',
  private: true,
  fields: {
    code: f.text({ id: 'fld_pvcode', required: true, unique: true, indexed: true }),
    state: f.text({ id: 'fld_pvstat' }),
    items: f.json({ id: 'fld_pvitem', readOnly: true }),
    total: f.money({ id: 'fld_pvtotl', readOnly: true }),
  },
} as any);
const ticketDef = defineContentType({
  id: 'ct_pvtick',
  apiId: 'ticket',
  displayName: 'Ticket',
  private: true,
  fields: { subject: f.text({ id: 'fld_pvsubj' }), secret: f.text({ id: 'fld_pvsecr', required: true, readOnly: true }) },
} as any);
const productDef = defineContentType({ id: 'ct_pvprod', apiId: 'product', displayName: 'Product', fields: { title: f.text({ id: 'fld_pvtitl' }) } } as any);

const seen: string[] = [];

describe('private content types (spec §7)', () => {
  let t: CoreTestApp;
  let cookie = '';
  let orderId = '';
  let productId = '';

  const call = async (p: string, init: RequestInit = {}, auth = true) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { ...(auth ? { cookie, origin: t.url } : {}), 'content-type': 'application/json', ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  const anon = (p: string, init: RequestInit = {}) => call(p, init, false);
  const post = (p: string, body?: unknown) => call(p, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const patch = (p: string, body: unknown) => call(p, { method: 'PATCH', body: JSON.stringify(body) });
  const service = () => t.app.get(PrivateEntriesService);

  beforeAll(async () => {
    t = await createCoreTestApp({
      cors: { origins: [ALLOWED] },
      hooks: [
        defineHooks('order', {
          beforeCreate: (data) => {
            seen.push(`create:${String(data.code)}`);
            return { ...data, state: data.state ?? 'pending' };
          },
          beforeUpdate: (data, ctx) => {
            seen.push(`update:${ctx.documentId}`);
            return data;
          },
        }),
      ],
    });
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookie = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
    for (const def of [orderDef, ticketDef, productDef]) {
      const r = await post('/api/admin/content-types', { definition: def });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const order = await service().create('order', { code: 'A-1', items: [{ sku: 'x', qty: 2 }], total: { amount: 12.5, currency: 'EUR' } });
    orderId = order.data.documentId as string;
    const product = await post('/api/admin/content/product', { title: 'Mug' });
    productId = product.body.data.documentId;
    expect((await post(`/api/admin/content/product/${productId}/publish`)).status).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  describe('public API', () => {
    const unknownBody = (apiId: string) => ({ error: { code: 'not_found', message: `Unknown content type "${apiId}"` } });

    it('answers 404 on list and item exactly like an unknown apiId', async () => {
      const list = await anon('/api/content/order');
      const unknown = await anon('/api/content/nope');
      expect(list.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(list.body).toEqual(unknownBody('order'));
      expect(unknown.body).toEqual(unknownBody('nope'));
      const item = await anon(`/api/content/order/${orderId}`);
      expect(item.status).toBe(404);
      expect(item.body).toEqual(unknownBody('order'));
      expect((await anon(`/api/content/nope/${orderId}`)).body).toEqual(unknownBody('nope'));
      // Query strings and the admin's status param change nothing.
      expect((await anon('/api/content/order?status=draft&filter[code]=A-1')).status).toBe(404);
    });

    it('answers a preflight with 404 and no CORS headers, like an unknown apiId; public types keep CORS', async () => {
      for (const p of ['/api/content/order', `/api/content/order/${orderId}`, '/api/content/nope']) {
        const pre = await anon(p, { method: 'OPTIONS', headers: { origin: ALLOWED, 'access-control-request-method': 'GET' } });
        expect(pre.status).toBe(404);
        expect(pre.headers.get('access-control-allow-origin')).toBeNull();
        expect(pre.headers.get('access-control-allow-methods')).toBeNull();
        expect(pre.body).toEqual(unknownBody(p.split('/')[3]!));
        const get = await anon(p, { headers: { origin: ALLOWED } });
        expect(get.headers.get('access-control-allow-origin')).toBeNull();
      }
      const ok = await anon('/api/content/product', { method: 'OPTIONS', headers: { origin: ALLOWED } });
      expect(ok.status).toBe(204);
      expect(ok.headers.get('access-control-allow-origin')).toBe(ALLOWED);
      const list = await anon('/api/content/product', { headers: { origin: ALLOWED } });
      expect(list.status).toBe(200);
      expect(list.headers.get('access-control-allow-origin')).toBe(ALLOWED);
      const pages = await anon('/api/content/opencloudcmsPage/by-path?path=/x', { method: 'OPTIONS', headers: { origin: ALLOWED } });
      expect(pages.status).toBe(204);
      const assets = await anon('/api/content/assets?ids=', { method: 'OPTIONS', headers: { origin: ALLOWED } });
      expect(assets.status).toBe(204);
    });
  });

  describe('admin API', () => {
    it('lists types with private: true (public types without it)', async () => {
      const r = await call('/api/admin/content-types');
      const byId = Object.fromEntries((r.body.data as { apiId: string; private?: boolean }[]).map((d) => [d.apiId, d]));
      expect(byId.order.private).toBe(true);
      expect(byId.product.private).toBeUndefined();
    });

    it('reads and lists private entries with the usual permissions', async () => {
      const one = await call(`/api/admin/content/order/${orderId}`);
      expect(one.status).toBe(200);
      expect(one.body.data).toMatchObject({ code: 'A-1', state: 'pending', items: [{ sku: 'x', qty: 2 }], total: { amount: 12.5, currency: 'EUR' } });
      const list = await call('/api/admin/content/order');
      expect(list.body.data.map((e: { documentId: string }) => e.documentId)).toEqual([orderId]);
    });

    it('create: any non-null readOnly value is 422 read_only with the path; null or absent is fine', async () => {
      const bad = await post('/api/admin/content/order', { code: 'B-1', total: { amount: 1, currency: 'EUR' } });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('read_only');
      expect(bad.body.error.issues).toEqual([{ path: 'total', message: expect.any(String) }]);
      const ok = await post('/api/admin/content/order', { code: 'B-1', items: null });
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({ code: 'B-1', items: null, total: null, state: 'pending' });
      // A type with a required readOnly field: only the server API can fill it.
      const tick = await post('/api/admin/content/ticket', { subject: 'Hi', secret: 's' });
      expect(tick.status).toBe(422);
      expect(tick.body.error.issues[0].path).toBe('secret');
    });

    it('update: an unchanged readOnly value is ignored (200), a changed one is 422 read_only with the path', async () => {
      const same = await patch(`/api/admin/content/order/${orderId}`, {
        state: 'paid',
        items: [{ qty: 2, sku: 'x' }],
        total: { amount: 12.5, currency: 'EUR' },
      });
      expect(same.status).toBe(200);
      expect(same.body.data).toMatchObject({ state: 'paid', total: { amount: 12.5, currency: 'EUR' } });
      const changed = await patch(`/api/admin/content/order/${orderId}`, { state: 'shipped', total: { amount: 1, currency: 'EUR' } });
      expect(changed.status).toBe(422);
      expect(changed.body.error).toMatchObject({ code: 'read_only', issues: [{ path: 'total' }] });
      const cleared = await patch(`/api/admin/content/order/${orderId}`, { items: null });
      expect(cleared.status).toBe(422);
      expect(cleared.body.error.issues[0].path).toBe('items');
      expect((await call(`/api/admin/content/order/${orderId}`)).body.data).toMatchObject({ state: 'paid', total: { amount: 12.5, currency: 'EUR' } });
    });

    it('publish, approve, unpublish, submit, withdraw and reject answer 409 private_type', async () => {
      for (const action of ['publish', 'approve', 'unpublish', 'submit', 'withdraw']) {
        const r = await post(`/api/admin/content/order/${orderId}/${action}`);
        expect(r.status, action).toBe(409);
        expect(r.body.error.code, action).toBe('private_type');
      }
      const rej = await post(`/api/admin/content/order/${orderId}/reject`, { note: 'no' });
      expect(rej.status).toBe(409);
      expect(rej.body.error.code).toBe('private_type');
      const rows = await t.db.selectFrom('ct_order' as any).select(['status']).where('document_id', '=', orderId).execute();
      expect(rows).toEqual([{ status: 'draft' }]);
      expect((await call(`/api/admin/content/order/${orderId}/versions`)).body.data).toEqual([]);
    });

    it('public types are unchanged: readOnly-free writes and publish work', async () => {
      expect((await anon(`/api/content/product/${productId}`)).status).toBe(200);
    });
  });

  describe('PrivateEntriesService', () => {
    it('writes readOnly fields and runs validation and hooks', async () => {
      const r = await service().create('ticket', { subject: 'Help', secret: 'k-1' });
      expect(r.data).toMatchObject({ subject: 'Help', secret: 'k-1', status: 'draft' });
      const before = seen.length;
      const c = await service().create('order', { code: 'S-1', total: { amount: 3, currency: 'USD' } });
      expect(seen.slice(before)).toEqual(['create:S-1']);
      expect(c.data).toMatchObject({ code: 'S-1', state: 'pending', total: { amount: 3, currency: 'USD' } });
      const id = c.data.documentId as string;
      const u = await service().update('order', id, { total: { amount: 4, currency: 'USD' }, items: [1] }, { user: { id: randomUUID(), permissions: [] } as never });
      expect(u.data).toMatchObject({ total: { amount: 4, currency: 'USD' }, items: [1] });
      expect(seen.at(-1)).toBe(`update:${id}`);
      await expect(service().create('order', { code: 42 })).rejects.toMatchObject({ status: 400 });
      await expect(service().create('order', { code: 'S-1' })).rejects.toMatchObject({ status: 409 });
    });

    it('get, list and remove', async () => {
      expect((await service().get('order', orderId)).data.code).toBe('A-1');
      const list = await service().list('order', { filter: { code: 'A-1' } });
      expect(list.data.map((e) => e.documentId)).toEqual([orderId]);
      const tmp = await service().create('order', { code: 'DEL' });
      expect(await service().remove('order', tmp.data.documentId as string)).toEqual({ ok: true });
      await expect(service().get('order', tmp.data.documentId as string)).rejects.toMatchObject({ status: 404 });
    });

    it('refuses types that are not private', async () => {
      await expect(service().create('product', { title: 'x' })).rejects.toThrow(/not a private content type/);
      await expect(service().list('nope', {})).rejects.toMatchObject({ status: 404 });
    });
  });
});
