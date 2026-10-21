import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineContentType, f } from '@opencms/schema';
import { UserService } from '@opencms/oauth2';
import { loginAs } from '../../../oauth2/test/support/login';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';

const articleDef = defineContentType({ id: 'ct_wfartc', apiId: 'article', displayName: 'Article', review: true, fields: { title: f.text({ id: 'fld_wfartc', required: true }) } } as any);
const noteDef = defineContentType({ id: 'ct_wfnote', apiId: 'note', displayName: 'Note', fields: { title: f.text({ id: 'fld_wfnote', required: true }) } } as any);
const pageDef = defineContentType({ id: 'ct_wfpage', apiId: 'page', displayName: 'Page', review: true, fields: { title: f.text({ id: 'fld_wfpage', required: true }) } } as any);

describe('review workflow (spec B §5)', () => {
  let t: CoreTestApp;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const as = (who: string) => async (p: string, init: RequestInit = {}) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { cookie: cookies[who], 'content-type': 'application/json', origin: t.url, ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const admin = as('admin');
  const contenter = as('contenter');
  const contenter2 = as('contenter2');
  const reviewer = as('reviewer');
  const nobody = as('nobody');
  const post = (who: typeof admin, p: string, body?: unknown) =>
    who(p, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  async function mkUser(email: string, groupKey: string | null) {
    const name = email.split('@')[0]!;
    const u = await t.app.get(UserService).create({ email, name, password: PW });
    ids[name] = u.id;
    await t.db.deleteFrom('auth_user_groups' as any).where('user_id', '=', u.id).execute();
    if (groupKey) await sql`insert into auth_user_groups (user_id, group_id) select ${u.id}, id from auth_groups where key = ${groupKey}`.execute(t.db);
    cookies[name] = `oc_session=${(await loginAs(t, email, PW)).sessionCookie}`;
  }

  const wfRows = async (documentId: string) =>
    (await sql<{ state: string }>`select state from opencms_workflow where document_id = ${documentId}`.execute(t.db)).rows;

  beforeAll(async () => {
    t = await createCoreTestApp();
    const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
    });
    expect(setup.status).toBeLessThan(300);
    cookies.admin = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
    await mkUser('contenter@example.com', 'contenter');
    await mkUser('contenter2@example.com', 'contenter');
    await mkUser('reviewer@example.com', 'reviewer');
    await mkUser('nobody@example.com', null);
    for (const def of [articleDef, noteDef, pageDef]) {
      expect((await admin('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: def }) })).status).toBe(200);
    }
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('runs the §7 scenario: submit, lock, reviewer edit, reject with note, resubmit, approve', async () => {
    const created = await post(contenter, '/api/admin/content/article', { title: 'first' });
    expect(created.status).toBe(201);
    expect(created.body.data.workflow).toBeNull();
    const id = created.body.data.documentId as string;
    const p = `/api/admin/content/article/${id}`;

    const sub = await post(contenter, `${p}/submit`);
    expect(sub.status).toBe(200);
    expect(sub.body.data.workflow).toMatchObject({ state: 'in_review', submittedBy: { id: ids.contenter, name: 'contenter' }, note: null });
    expect(typeof sub.body.data.workflow.submittedAt).toBe('string');

    const locked = await contenter(p, { method: 'PATCH', body: JSON.stringify({ title: 'sneaky' }) });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('in_review_locked');

    const edited = await reviewer(p, { method: 'PATCH', body: JSON.stringify({ title: 'fixed by reviewer' }) });
    expect(edited.status).toBe(200);
    expect(edited.body.data.title).toBe('fixed by reviewer');
    expect(edited.body.data.workflow.state).toBe('in_review');

    // Contenters cannot approve or publish a review type; a second submit is not a transition.
    expect((await post(contenter, `${p}/publish`)).status).toBe(403);
    const cApprove = await post(contenter, `${p}/approve`);
    expect(cApprove.status).toBe(403);
    expect(cApprove.body).toEqual({ error: { code: 'forbidden', message: 'Missing permission: content.publish' } });
    const twice = await post(contenter, `${p}/submit`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('invalid_transition');

    for (const body of [{}, { note: '' }, { note: '   ' }, { note: 'x'.repeat(1001) }]) {
      const r = await post(reviewer, `${p}/reject`, body);
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    expect((await post(contenter, `${p}/reject`, { note: 'no' })).status).toBe(403);
    const rejected = await post(reviewer, `${p}/reject`, { note: 'Needs a better title' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.workflow).toMatchObject({ state: 'draft', note: 'Needs a better title' });

    const seen = await contenter(p);
    expect(seen.body.data.workflow).toMatchObject({ state: 'draft', note: 'Needs a better title' });
    expect((await contenter(p, { method: 'PATCH', body: JSON.stringify({ title: 'better title' }) })).status).toBe(200);
    const again = await post(contenter, `${p}/submit`);
    expect(again.status).toBe(200);
    expect(again.body.data.workflow).toMatchObject({ state: 'in_review', note: null });

    const approved = await post(reviewer, `${p}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('published');
    expect(approved.body.data.title).toBe('better title');
    expect(await wfRows(id)).toEqual([]);
    expect((await contenter(p)).body.data.workflow).toBeNull();
    expect((await fetch(`${t.baseUrl}/api/content/article/${id}`)).status).toBe(200);
  });

  it('approve needs In review; a content.publish holder may publish directly (R11)', async () => {
    const id = (await post(contenter, '/api/admin/content/article', { title: 'direct' })).body.data.documentId;
    const p = `/api/admin/content/article/${id}`;
    const early = await post(reviewer, `${p}/approve`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('invalid_transition');
    // Direct publish from draft by a reviewer.
    const direct = await post(reviewer, `${p}/publish`);
    expect(direct.status).toBe(200);
    expect(direct.body.data.status).toBe('published');
    expect(await wfRows(id)).toEqual([]);
    // Direct publish of an In review entry by a super admin clears the row.
    expect((await post(contenter, `${p}/submit`)).status).toBe(200);
    expect((await post(admin, `${p}/publish`)).status).toBe(200);
    expect(await wfRows(id)).toEqual([]);
    expect((await contenter(p)).body.data.workflow).toBeNull();
    // approve on a type without review is not a transition.
    const nid = (await post(contenter, '/api/admin/content/note', { title: 'n' })).body.data.documentId;
    expect((await post(reviewer, `/api/admin/content/note/${nid}/approve`)).body.error.code).toBe('invalid_transition');
  });

  it('submit on a review:false type is not a transition', async () => {
    const id = (await post(contenter, '/api/admin/content/note', { title: 'n' })).body.data.documentId;
    const r = await post(contenter, `/api/admin/content/note/${id}/submit`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('invalid_transition');
    expect((await contenter(`/api/admin/content/note/${id}`)).body.data.workflow).toBeNull();
    expect((await post(contenter, `/api/admin/content/note/${id}/publish`)).status).toBe(200);
  });

  it('withdraw: submitter or content.publish only, and only from In review', async () => {
    const id = (await post(contenter, '/api/admin/content/article', { title: 'w' })).body.data.documentId;
    const p = `/api/admin/content/article/${id}`;
    const early = await post(contenter, `${p}/withdraw`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('invalid_transition');
    expect((await post(contenter, `${p}/submit`)).status).toBe(200);

    const forbiddenPublish = { error: { code: 'forbidden', message: 'Missing permission: content.publish' } };
    const other = await post(contenter2, `${p}/withdraw`);
    expect(other.status).toBe(403);
    expect(other.body).toEqual(forbiddenPublish);
    const none = await post(nobody, `${p}/withdraw`);
    expect(none.status).toBe(403);
    expect(none.body).toEqual(forbiddenPublish);

    const mine = await post(contenter, `${p}/withdraw`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.workflow).toMatchObject({ state: 'draft', note: null });
    expect((await contenter(p, { method: 'PATCH', body: JSON.stringify({ title: 'editable again' }) })).status).toBe(200);

    expect((await post(contenter, `${p}/submit`)).status).toBe(200);
    expect((await post(reviewer, `${p}/withdraw`)).status).toBe(200);
  });

  it('two concurrent approvals: one 200, one 409 invalid_transition', async () => {
    const id = (await post(contenter, '/api/admin/content/article', { title: 'race' })).body.data.documentId;
    const p = `/api/admin/content/article/${id}`;
    expect((await post(contenter, `${p}/submit`)).status).toBe(200);
    const results = await Promise.all([post(reviewer, `${p}/approve`), post(admin, `${p}/approve`)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('invalid_transition');
    expect(await wfRows(id)).toEqual([]);
  });

  it('two concurrent submits: one 200, one 409', async () => {
    const id = (await post(contenter, '/api/admin/content/article', { title: 'race2' })).body.data.documentId;
    const p = `/api/admin/content/article/${id}/submit`;
    const statuses = (await Promise.all([post(contenter, p), post(contenter2, p)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('?workflow=in_review filters the list; pending-count needs content.publish', async () => {
    const before = await reviewer('/api/admin/workflow/pending-count');
    expect(before.status).toBe(200);
    const a = (await post(contenter, '/api/admin/content/page', { title: 'p1' })).body.data.documentId;
    const b = (await post(contenter, '/api/admin/content/page', { title: 'p2' })).body.data.documentId;
    await post(contenter, '/api/admin/content/page', { title: 'p3' });
    expect((await post(contenter, `/api/admin/content/page/${a}/submit`)).status).toBe(200);
    expect((await post(contenter, `/api/admin/content/page/${b}/submit`)).status).toBe(200);

    const list = await reviewer('/api/admin/content/page?workflow=in_review');
    expect(list.status).toBe(200);
    expect(list.body.data.map((e: any) => e.documentId).sort()).toEqual([a, b].sort());
    expect(list.body.meta.total).toBe(2);
    expect(list.body.data.every((e: any) => e.workflow.state === 'in_review')).toBe(true);
    const all = await reviewer('/api/admin/content/page');
    expect(all.body.data).toHaveLength(3);
    expect(all.body.data.filter((e: any) => e.workflow === null)).toHaveLength(1);
    expect((await reviewer('/api/admin/content/page?workflow=bogus')).status).toBe(400);

    const after = await reviewer('/api/admin/workflow/pending-count');
    expect(after.body.count).toBe(before.body.count + 2);
    expect(after.body.byType.page).toBe(2);

    const denied = await contenter('/api/admin/workflow/pending-count');
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: { code: 'forbidden', message: 'Missing permission: content.publish' } });

    // An orphan In review row (its draft is gone) is not counted.
    await sql`insert into opencms_workflow (api_id, document_id, state) values ('page', gen_random_uuid(), 'in_review')`.execute(t.db);
    expect((await reviewer('/api/admin/workflow/pending-count')).body.byType.page).toBe(2);

    expect((await post(reviewer, `/api/admin/content/page/${a}/reject`, { note: 'no' })).status).toBe(200);
    expect((await reviewer('/api/admin/workflow/pending-count')).body.byType.page).toBe(1);
  });

  it('deleting an entry removes its workflow row', async () => {
    const id = (await post(contenter, '/api/admin/content/article', { title: 'del' })).body.data.documentId;
    expect((await post(contenter, `/api/admin/content/article/${id}/submit`)).status).toBe(200);
    expect(await wfRows(id)).toHaveLength(1);
    expect((await admin(`/api/admin/content/article/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await wfRows(id)).toEqual([]);
  });

  it('a type flipped to review:false treats In review as draft', async () => {
    const id = (await post(contenter, '/api/admin/content/page', { title: 'flip' })).body.data.documentId;
    const p = `/api/admin/content/page/${id}`;
    expect((await post(contenter, `${p}/submit`)).status).toBe(200);
    const before = (await reviewer('/api/admin/workflow/pending-count')).body.byType.page as number;

    const { review: _r, ...plain } = pageDef as any;
    expect((await admin('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: plain }) })).status).toBe(200);

    expect((await contenter(p)).body.data.workflow).toBeNull();
    expect((await reviewer('/api/admin/content/page?workflow=in_review')).body.data).toEqual([]);
    expect((await reviewer('/api/admin/workflow/pending-count')).body.byType.page ?? 0).toBe(0);
    expect(before).toBeGreaterThan(0);
    const w = await post(contenter, `${p}/withdraw`);
    expect(w.status).toBe(409);
    const edit = await contenter(p, { method: 'PATCH', body: JSON.stringify({ title: 'edited' }) });
    expect(edit.status).toBe(200);
    expect(await wfRows(id)).toEqual([]); // removed on the next write
    expect((await post(contenter, `${p}/publish`)).status).toBe(200);
  });
});
