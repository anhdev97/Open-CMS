// Shapes the content list API returns for asset/money/date/datetime/boolean fields, and string filter coercion
// for indexed boolean/number columns. Composed blocks (blocks/src/composed/values.ts) read exactly these shapes and
// send fixed filters as strings through ContentFetcher.query.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineContentType, f } from '@opencloudcms/schema';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const EMAIL = 'admin@example.com';

describe('content API value shapes and filter coercion', () => {
  let t: CoreTestApp;
  let call: (p: string, init?: RequestInit) => Promise<Response>;
  let assetId: string;

  beforeAll(async () => {
    t = await createCoreTestApp();
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: EMAIL, name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    const cookie = `oc_session=${(await loginAs(t, EMAIL, PW)).sessionCookie}`;
    call = (p, init = {}) =>
      fetch(`${t.baseUrl}${p}`, { ...init, headers: { cookie, 'content-type': 'application/json', origin: t.url, ...(init.headers as object) } });

    const def = defineContentType({
      id: 'ct_valprb',
      apiId: 'gadget',
      displayName: 'Gadget',
      fields: {
        name: f.text({ id: 'fld_vname1' }),
        active: f.boolean({ id: 'fld_vactv1', indexed: true }),
        stock: f.number({ id: 'fld_vstck1', indexed: true }),
        price: f.money({ id: 'fld_vprce1', currencyMode: 'fixed', currency: 'USD' }),
        released: f.date({ id: 'fld_vrels1' }),
        at: f.datetime({ id: 'fld_vdtme1' }),
        image: f.asset({ id: 'fld_vimge1' }),
      },
    } as any);
    const saved = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) });
    expect(saved.status).toBe(200);
    const asset = await call('/api/admin/assets', { method: 'POST', body: JSON.stringify({ filename: 'a.png', url: 'https://x.example/a.png', alt: 'A' }) });
    expect(asset.status).toBe(201);
    assetId = (await asset.json()).data.id;
    for (const [name, active, stock] of [['on', true, 3], ['off', false, 0]] as const) {
      const res = await call('/api/admin/content/gadget', {
        method: 'POST',
        body: JSON.stringify({
          name, active, stock,
          price: { amount: 19.5, currency: 'USD' },
          released: '2026-11-23',
          at: '2026-11-23T02:00:00+07:00',
          image: assetId,
        }),
      });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }
  }, 90_000);
  afterAll(async () => {
    await t?.close();
  });

  it('returns money as {amount:number,currency}, date as YYYY-MM-DD, datetime as ISO UTC, boolean, asset as its id', async () => {
    const all = (await (await call('/api/admin/content/gadget?status=draft&limit=10')).json()).data as Record<string, unknown>[];
    const on = all.find((e) => e.name === 'on')!;
    expect(on.price).toEqual({ amount: 19.5, currency: 'USD' });
    expect(on.released).toBe('2026-11-23');
    expect(on.at).toBe('2026-11-22T19:00:00.000Z');
    expect(on.active).toBe(true);
    expect(on.stock).toBe(3);
    expect(on.image).toBe(assetId);
  });

  it('coerces filter[active]=true|false and filter[stock]=0 for indexed boolean/number columns', async () => {
    const names = async (q: string) =>
      ((await (await call(`/api/admin/content/gadget?status=draft&${q}`)).json()).data as { name: string }[]).map((e) => e.name).sort();
    expect(await names('filter[active]=true')).toEqual(['on']);
    expect(await names('filter[active]=false')).toEqual(['off']);
    expect(await names('filter[stock]=0')).toEqual(['off']);
    expect(await names('filter[stock]=3')).toEqual(['on']);
  });
});
