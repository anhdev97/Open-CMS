#!/usr/bin/env node
// Smoke test for `opencloudcms init` (spec §8): scaffold a project linked to this repo, install, migrate,
// add a review-workflow content type (generate + migrate:create), build it, run it in production and walk the site/admin checks,
// the setup/login/logout chain and the groups + review workflow (Contenter submits, Reviewer rejects then approves) over HTTP.
// Exit code 0 = pass, 1 = fail.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpmVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).packageManager?.split('@')[1] ?? '10.28.0';
const { Client } = createRequire(join(repo, 'packages/db/package.json'))('pg');

const adminUrl = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres');
const dbName = `oc_smoke_${randomBytes(4).toString('hex')}`;
const dbUrl = new URL(adminUrl);
dbUrl.pathname = `/${dbName}`;

let step = 0;
const log = (msg) => console.log(`[smoke] ${msg}`);
const ok = (msg) => console.log(`[smoke] step ${++step} ok: ${msg}`);
function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status ?? r.signal}`);
}

async function withAdminDb(fn) {
  const c = new Client({ connectionString: adminUrl.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

/** Path-aware cookie jar (single host), same rules as packages/oauth2/test/support/interaction.ts. */
class CookieJar {
  cookies = new Map();
  store(res, url) {
    const reqPath = new URL(url).pathname;
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((p) => p.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      let path = reqPath.slice(0, reqPath.lastIndexOf('/')) || '/';
      let expired = value === '';
      for (const a of attrs) {
        const [k, v = ''] = a.split('=');
        const key = k.toLowerCase();
        if (key === 'path') path = v || '/';
        if (key === 'max-age' && Number(v) <= 0) expired = true;
        if (key === 'expires' && new Date(v).getTime() < Date.now()) expired = true;
      }
      const id = `${name}\0${path}`;
      if (expired) this.cookies.delete(id);
      else this.cookies.set(id, { name, value, path });
    }
  }
  header(url) {
    const p = new URL(url).pathname;
    return [...this.cookies.values()]
      .filter((c) => p === c.path || p.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }
  has(name) {
    return [...this.cookies.values()].some((c) => c.name === name);
  }
  async fetch(url, init = {}) {
    const headers = new Headers(init.headers);
    const cookie = this.header(url);
    if (cookie) headers.set('cookie', cookie);
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    this.store(res, url);
    return res;
  }
}

let tmp;
let server;
let serverLog = '';

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const exited = new Promise((r) => server.once('exit', r));
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  const timer = setTimeout(() => {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }, 5000);
  await exited;
  clearTimeout(timer);
}

async function main() {
  const pw = 'smoke-test-password-1';
  const email = 'admin@example.com';

  // 1. scaffold, DB, install, migrate, boot
  tmp = mkdtempSync(join(tmpdir(), 'opencloudcms-smoke-'));
  const app = join(tmp, 'app');
  await withAdminDb((c) => c.query(`CREATE DATABASE "${dbName}"`));
  log(`created database ${dbName}`);
  const port = await freePort();
  run('node', [join(repo, 'packages/cli/bin/opencloudcms.js'), 'init', app, '--link', repo, '--no-install', '--db-url', dbUrl.toString(), '--port', String(port)]);
  ok('opencloudcms init (linked, --no-install)');
  for (const f of ['src/locales.ts', 'src/content-groups.ts', 'app/(site)/messages.ts']) assert(existsSync(join(app, f)), `init did not write ${f}`);
  assert(readFileSync(join(app, 'src/locales.ts'), 'utf8').includes("locales: ['en-US']"), 'src/locales.ts is not en-US only');
  ok('src/locales.ts (en-US), src/content-groups.ts, app/(site)/messages.ts present');

  // pnpm: use the repo's pinned version via corepack; plain `pnpm` outside the repo may try another version
  const corepack = spawnSync('corepack', ['--version'], { stdio: 'ignore' });
  if (corepack.status === 0) run('corepack', [`pnpm@${pnpmVersion}`, 'install', '--ignore-workspace'], { cwd: app });
  else run('npm', ['install'], { cwd: app });
  ok('dependencies installed');

  // A content type with the review workflow, written as a user would, then generate + migrate:create (before building).
  const articleDir = join(app, 'src/content-types/article');
  mkdirSync(articleDir, { recursive: true });
  writeFileSync(
    join(articleDir, 'article.schema.ts'),
    `import { defineContentType, f } from '@opencloudcms/schema';

export default defineContentType({
  id: 'ct_smokearticle',
  apiId: 'article',
  displayName: 'Article',
  review: true,
  fields: {
    title: f.text({ id: 'fld_art_title', required: true }),
    body: f.longText({ id: 'fld_art_body' }),
  },
});
`,
  );
  const cli = join(app, 'node_modules/@opencloudcms/cli/bin/opencloudcms.js');
  run('node', [cli, 'generate'], { cwd: app });
  run('node', [cli, 'migrate:create', 'add-article'], { cwd: app });
  assert(readFileSync(join(app, 'src/generated/registry.ts'), 'utf8').match(/"?review"?: true/), 'generated registry lacks review: true for article');
  assert(readFileSync(join(app, 'migrations/_snapshot.json'), 'utf8').includes('"article"'), 'migrations/_snapshot.json lacks article');
  ok('article schema (review: true) -> opencloudcms generate + opencloudcms migrate:create');

  // Registry-install approximation: with symlinks preserved, @types/node must come from the project's own devDependencies.
  run('node', [join(app, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.server.json', '--noEmit', '--preserveSymlinks'], { cwd: app });
  ok('generated project type-checks (tsc -p tsconfig.server.json --noEmit --preserveSymlinks)');

  const env = { ...process.env, PORT: String(port) };
  delete env.NODE_ENV;
  delete env.OPENCLOUDCMS_PUBLIC_URL;
  delete env.DATABASE_URL;
  // the project's `build` script: Nest (tsc) then Next
  run('node', [join(app, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.server.json'], { cwd: app, env });
  run('node', [join(app, 'node_modules/next/dist/bin/next'), 'build'], { cwd: app, env });
  ok('project build (tsc -p tsconfig.server.json + next build)');
  run('node', [cli, 'migrate:up'], { cwd: app, env });
  ok('opencloudcms migrate:up');

  const publicUrl = `http://localhost:${port}`;
  const prodEnv = { ...env, NODE_ENV: 'production', OPENCLOUDCMS_PUBLIC_URL: publicUrl };
  server = spawn('node', ['dist/src/main.js'], { cwd: app, env: prodEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const s of [server.stdout, server.stderr]) s.on('data', (d) => (serverLog += d));
  let exitedEarly = false;
  server.once('exit', () => (exitedEarly = true));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exitedEarly) throw new Error('server exited during startup');
    try {
      const r = await fetch(`${publicUrl}/api/auth/me`);
      if (r.status === 409) break;
    } catch {}
    if (Date.now() > deadline) throw new Error('server did not become ready within 60 s');
    await new Promise((r) => setTimeout(r, 500));
  }
  ok(`server listening on port ${port}`);

  // One browser = one cookie jar. Requests go to the public URL (the server derives redirects from the Host header),
  // anything off-origin is a failure.
  const redirect = (res, what) => {
    assert(res.status >= 300 && res.status < 400 && res.headers.get('location'), `${what}: expected redirect, got ${res.status}`);
    return new URL(res.headers.get('location'), publicUrl);
  };
  const browser = () => {
    const jar = new CookieJar();
    const send = (href, init = {}) => {
      const u = new URL(href, publicUrl);
      assert(u.origin === new URL(publicUrl).origin, `browser left the app origin: ${u.href}`);
      return jar.fetch(u.href, init);
    };
    const json = (method) => (path, body) =>
      send(path, { method, headers: { 'content-type': 'application/json', origin: publicUrl }, body: JSON.stringify(body ?? {}) });
    const startLogin = async () => {
      const toProvider = redirect(await send('/api/auth/login'), '/api/auth/login');
      assert(toProvider.pathname === '/oauth2/auth', `login went to ${toProvider.href}`);
      return redirect(await send(toProvider.href), '/oauth2/auth');
    };
    /** Full OIDC login chain: /api/auth/login -> provider -> /admin/login?uid -> interaction login -> callback (oc_session). */
    const login = async (who, password) => {
      const interaction = await startLogin();
      const uid = interaction.searchParams.get('uid');
      assert(interaction.pathname === '/admin/login' && uid, `unexpected interaction redirect ${interaction.href}`);
      const res = await json('POST')(`/oauth2/interaction/${uid}/login`, { email: who, password });
      const body = await res.json();
      assert(res.status === 200 && body.redirectTo, `interaction login (${who}) -> ${res.status} ${JSON.stringify(body)}`);
      let next = new URL(body.redirectTo, publicUrl);
      for (let hop = 0; next.pathname !== '/api/auth/callback'; hop++) {
        assert(hop < 10, 'too many redirects');
        assert(next.pathname.startsWith('/oauth2/'), `redirected outside the provider: ${next.href}`);
        next = redirect(await send(next.href), next.pathname);
      }
      const callback = await send(next.href);
      assert(callback.status === 302, `callback (${who}) -> ${callback.status}`);
      assert(jar.has('oc_session'), `callback did not set oc_session (${who})`);
    };
    return { jar, send, post: json('POST'), patch: json('PATCH'), startLogin, login };
  };
  const admin = browser();
  const { send, post, startLogin } = admin;

  // 2. website, admin shell (CSP nonce, noindex), static assets, setup_required
  const siteRes = await send('/');
  const siteHtml = await siteRes.text();
  assert(siteRes.status === 200, `GET / -> ${siteRes.status}`);
  assert((siteRes.headers.get('content-type') ?? '').startsWith('text/html'), 'GET / is not text/html');
  assert(siteHtml.includes('data-opencloudcms-site'), 'GET / lacks data-opencloudcms-site');
  assert(!siteRes.headers.has('content-security-policy'), 'GET / must not carry a Content-Security-Policy');
  const tagline = 'A website and its OpenCloudCMS admin, served by one Next.js app.';
  assert(readFileSync(join(app, 'app/(site)/messages.ts'), 'utf8').includes(tagline), 'messages.ts lacks the en-US tagline');
  assert(siteHtml.includes(tagline), 'GET / lacks the en-US string of app/(site)/messages.ts');

  const slashRes = await send('/admin/');
  assert(slashRes.status === 308, `GET /admin/ -> ${slashRes.status} (expected 308)`);
  assert((slashRes.headers.get('location') ?? '').endsWith('/admin'), `GET /admin/ location: ${slashRes.headers.get('location')}`);

  const adminRes = await send('/admin');
  const html = await adminRes.text();
  assert(adminRes.status === 200, `GET /admin -> ${adminRes.status}`);
  assert((adminRes.headers.get('content-type') ?? '').startsWith('text/html'), 'GET /admin is not text/html');
  const csp = adminRes.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  assert(nonce, `GET /admin CSP has no nonce: ${csp}`);
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  assert(scripts.length > 0, 'GET /admin has no <script>');
  for (const tag of scripts) assert(tag.includes(`nonce="${nonce}"`), `script without the CSP nonce: ${tag}`);
  assert((adminRes.headers.get('x-robots-tag') ?? '').includes('noindex'), 'GET /admin lacks X-Robots-Tag: noindex');
  assert(html.includes('data-opencloudcms-admin'), 'GET /admin lacks data-opencloudcms-admin');

  const asset = /\/_next\/static\/[^"'\s)\\]+/.exec(html)?.[0];
  assert(asset, 'GET /admin references no /_next/static/ URL');
  const assetRes = await send(asset);
  await assetRes.arrayBuffer();
  assert(assetRes.status === 200, `GET ${asset} -> ${assetRes.status}`);
  assert((assetRes.headers.get('cache-control') ?? '').includes('immutable'), `GET ${asset} cache-control: ${assetRes.headers.get('cache-control')}`);
  const me0 = await send('/api/auth/me');
  const me0Body = await me0.json();
  assert(me0.status === 409 && me0Body.error?.code === 'setup_required', `GET /api/auth/me before setup -> ${me0.status} ${JSON.stringify(me0Body)}`);
  ok('/ site (en-US messages), /admin/ -> 308, /admin nonce+noindex, static immutable; GET /api/auth/me -> 409 setup_required');

  // 3. first super_admin
  const setup = await post('/api/auth/setup', { email, name: 'Smoke Admin', password: pw });
  assert(setup.status === 201, `POST /api/auth/setup -> ${setup.status} ${await setup.text()}`);
  ok('POST /api/auth/setup -> 201');

  // 4. login chain
  await admin.login(email, pw);
  const me1 = await send('/api/auth/me');
  const me1Body = await me1.json();
  assert(me1.status === 200, `GET /api/auth/me after login -> ${me1.status} ${JSON.stringify(me1Body)}`);
  ok('login chain complete; GET /api/auth/me -> 200');

  const loc = await send('/api/admin/locales');
  const locBody = await loc.json();
  assert(loc.status === 200, `GET /api/admin/locales -> ${loc.status} ${JSON.stringify(locBody)}`);
  assert(JSON.stringify(locBody.locales) === JSON.stringify(['en-US']) && locBody.defaultLocale === 'en-US', `GET /api/admin/locales -> ${JSON.stringify(locBody)}`);
  assert(locBody.editable === false, `GET /api/admin/locales in production must not be editable: ${JSON.stringify(locBody)}`);
  ok("GET /api/admin/locales -> locales: ['en-US'], not editable in production");

  // 5. groups + review workflow: the super admin creates a Contenter and a Reviewer from the seed groups
  const call = async (b, method, path, body) => {
    const res = method === 'GET' ? await b.send(path) : await b[method.toLowerCase()](path, body);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    return { status: res.status, body: data, text };
  };
  const expect = (r, status, what) => {
    assert(r.status === status, `${what} -> ${r.status} (expected ${status}) ${r.text}`);
    return r.body;
  };
  const groups = expect(await call(admin, 'GET', '/api/admin/groups'), 200, 'GET /api/admin/groups').data;
  const groupId = (key) => {
    const g = groups.find((x) => x.key === key);
    assert(g, `seed group ${key} missing: ${JSON.stringify(groups.map((x) => x.key))}`);
    return g.id;
  };
  assert(groups.find((g) => g.key === 'super-admin')?.system === true, 'super-admin seed group is not a system group');
  const people = {
    contenter: { email: 'contenter@example.com', name: 'Smoke Contenter', group: 'contenter' },
    reviewer: { email: 'reviewer@example.com', name: 'Smoke Reviewer', group: 'reviewer' },
  };
  for (const p of Object.values(people)) {
    const created = expect(
      await call(admin, 'POST', '/api/admin/users', { email: p.email, name: p.name, password: pw, groupIds: [groupId(p.group)] }),
      201,
      `POST /api/admin/users (${p.group})`,
    );
    assert(created.data.groups?.some((g) => g.key === p.group), `created user lacks group ${p.group}: ${JSON.stringify(created.data)}`);
  }
  ok('super admin: GET /api/admin/groups (seed groups), POST /api/admin/users Contenter + Reviewer (groupIds)');

  const contenter = browser();
  await contenter.login(people.contenter.email, pw);
  const reviewer = browser();
  await reviewer.login(people.reviewer.email, pw);
  const meC = expect(await call(contenter, 'GET', '/api/auth/me'), 200, 'GET /api/auth/me (contenter)');
  assert(JSON.stringify(meC).includes('content.submit') && !JSON.stringify(meC).includes('content.publish'), `contenter permissions: ${JSON.stringify(meC)}`);
  expect(await call(contenter, 'GET', '/api/admin/groups'), 403, 'GET /api/admin/groups (contenter)');
  ok('Contenter and Reviewer log in; Contenter has content.submit, not content.publish; groups API -> 403 for Contenter');

  const art = '/api/admin/content/article';
  const draft = expect(await call(contenter, 'POST', art, { title: 'Hello review', body: 'First draft' }), 201, `POST ${art} (contenter)`).data;
  const doc = `${art}/${draft.documentId}`;
  const submitted = expect(await call(contenter, 'POST', `${doc}/submit`), 200, 'submit (contenter)').data;
  assert(submitted.workflow?.state === 'in_review', `after submit workflow = ${JSON.stringify(submitted.workflow)}`);
  const direct = await call(contenter, 'POST', `${doc}/publish`);
  assert(direct.status === 403 && direct.body?.error?.code === 'forbidden', `direct publish (contenter) -> ${direct.status} ${direct.text}`);
  ok('Contenter creates + submits an article (in_review); direct publish -> 403 forbidden');

  const pending = expect(await call(reviewer, 'GET', '/api/admin/workflow/pending-count'), 200, 'pending-count (reviewer)');
  assert(pending.count === 1 && pending.byType?.article === 1, `pending-count: ${JSON.stringify(pending)}`);
  const queue = expect(await call(reviewer, 'GET', `${art}?workflow=in_review`), 200, 'in_review list (reviewer)');
  assert(queue.data.some((e) => e.documentId === draft.documentId), `in_review list lacks the article: ${JSON.stringify(queue)}`);
  const note = 'Please add a stronger intro.';
  const rejected = expect(await call(reviewer, 'POST', `${doc}/reject`, { note }), 200, 'reject (reviewer)').data;
  assert(rejected.workflow?.state === 'draft', `after reject workflow = ${JSON.stringify(rejected.workflow)}`);
  const seen = expect(await call(contenter, 'GET', doc), 200, 'GET draft (contenter)').data;
  assert(seen.workflow?.note === note, `Contenter does not see the reject note: ${JSON.stringify(seen.workflow)}`);
  ok('Reviewer: pending-count + ?workflow=in_review list the article, reject with a note; Contenter sees the note');

  expect(await call(contenter, 'PATCH', doc, { title: 'Hello review', body: 'Second draft, stronger intro' }), 200, 'PATCH after reject (contenter)');
  const resubmitted = expect(await call(contenter, 'POST', `${doc}/submit`), 200, 'resubmit (contenter)').data;
  assert(resubmitted.workflow?.state === 'in_review', `after resubmit workflow = ${JSON.stringify(resubmitted.workflow)}`);
  const approved = expect(await call(reviewer, 'POST', `${doc}/approve`), 200, 'approve (reviewer)').data;
  assert(approved.documentId === draft.documentId, `approve returned ${JSON.stringify(approved)}`);
  const again2 = await call(reviewer, 'POST', `${doc}/approve`);
  assert(again2.status === 409 && again2.body?.error?.code === 'invalid_transition', `second approve -> ${again2.status} ${again2.text}`);
  const delivered = expect(await call(browser(), 'GET', '/api/content/article'), 200, 'GET /api/content/article (anonymous)');
  const pub = delivered.data.find((e) => e.documentId === draft.documentId);
  assert(pub && pub.body === 'Second draft, stronger intro', `GET /api/content/article lacks the approved article: ${JSON.stringify(delivered)}`);
  ok('Contenter edits + resubmits; Reviewer approves (/approve, second approve -> 409); GET /api/content/article returns it');

  // 6. logout; the next login must ask for the password again
  const logout = await post('/api/auth/logout', {});
  const logoutBody = await logout.json();
  assert(logout.status === 200 && logoutBody.redirectTo === '/admin/login', `logout -> ${logout.status} ${JSON.stringify(logoutBody)}`);
  let again = await startLogin();
  for (let hop = 0; again.pathname.startsWith('/oauth2/') || again.pathname === '/api/auth/callback'; hop++) {
    assert(hop < 10, 'too many redirects after logout');
    again = redirect(await send(again.href), again.pathname);
  }
  assert(again.pathname === '/admin/login' && again.searchParams.get('uid'), `after logout the chain ended at ${again.href}`);
  ok('after logout GET /api/auth/login ends at /admin/login?uid=…');
}

let failed = false;
try {
  await main();
  log('PASS');
} catch (err) {
  failed = true;
  console.error(`[smoke] FAIL at step ${step + 1}: ${err instanceof Error ? err.stack : err}`);
  if (serverLog) console.error(`[smoke] server output:\n${serverLog}`);
} finally {
  // 7. stop server, drop DB, remove temp dir
  try {
    await stopServer();
    log('server stopped');
  } catch (e) {
    console.error('[smoke] could not stop server:', e);
  }
  try {
    await withAdminDb((c) => c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`));
    log(`dropped database ${dbName}`);
  } catch (e) {
    console.error('[smoke] could not drop database:', e);
  }
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    log('removed temp dir');
  }
}
process.exit(failed ? 1 : 0);
