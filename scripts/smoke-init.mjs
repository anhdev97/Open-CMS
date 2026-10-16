#!/usr/bin/env node
// Smoke test for `opencms init` (spec §8): scaffold a project linked to this repo, install, migrate,
// boot it and walk the admin setup/login/logout chain over HTTP. Exit code 0 = pass, 1 = fail.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
  tmp = mkdtempSync(join(tmpdir(), 'opencms-smoke-'));
  const app = join(tmp, 'app');
  await withAdminDb((c) => c.query(`CREATE DATABASE "${dbName}"`));
  log(`created database ${dbName}`);
  const port = await freePort();
  run('node', [join(repo, 'packages/cli/bin/opencms.js'), 'init', app, '--link', repo, '--no-install', '--db-url', dbUrl.toString(), '--port', String(port)]);
  ok('opencms init (linked, --no-install)');

  const required = ['app/layout.tsx', 'app/page.tsx', 'app/lib/cms.ts', 'next.config.ts', 'tsconfig.next.json', 'src/main.ts', 'src/app.module.ts'];
  for (const f of required) {
    assert(existsSync(join(app, f)), `missing ${f}`);
  }
  const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  assert(pkg.scripts.dev.includes('next dev'), 'dev script must start next');
  assert(pkg.scripts.build.includes('next build'), 'build script must run next build');
  assert(pkg.scripts.start.includes('next start'), 'start script must start next');
  assert(pkg.dependencies.next, 'next dependency missing');
  ok('storefront scaffold files + scripts present');

  // pnpm: use the repo's pinned version via corepack; plain `pnpm` outside the repo may try another version
  const corepack = spawnSync('corepack', ['--version'], { stdio: 'ignore' });
  if (corepack.status === 0) run('corepack', [`pnpm@${pnpmVersion}`, 'install', '--ignore-workspace'], { cwd: app });
  else run('npm', ['install'], { cwd: app });
  ok('dependencies installed');

  // Registry-install approximation: with symlinks preserved, @types/node must come from the project's own devDependencies.
  run('node', [join(app, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit', '--preserveSymlinks'], { cwd: app });
  ok('generated project type-checks (tsc --noEmit --preserveSymlinks)');

  const env = { ...process.env, PORT: String(port) };
  delete env.NODE_ENV;
  delete env.OPENCMS_PUBLIC_URL;
  delete env.DATABASE_URL;
  run('node', [join(app, 'node_modules/opencms-cli/bin/opencms.js'), 'migrate:up'], { cwd: app, env });
  ok('opencms migrate:up');

  server = spawn('node', [join(app, 'node_modules/tsx/dist/cli.mjs'), 'src/main.ts'], { cwd: app, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const s of [server.stdout, server.stderr]) s.on('data', (d) => (serverLog += d));
  let exitedEarly = false;
  server.once('exit', () => (exitedEarly = true));

  const publicUrl = `http://localhost:${port}`;
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

  const jar = new CookieJar();
  // browser-like: requests go to the public URL (the server derives redirects from the Host header), anything off-origin is a failure
  const send = (href, init = {}) => {
    const u = new URL(href, publicUrl);
    assert(u.origin === new URL(publicUrl).origin, `browser left the app origin: ${u.href}`);
    return jar.fetch(u.href, init);
  };
  const post = (path, body) =>
    send(path, { method: 'POST', headers: { 'content-type': 'application/json', origin: publicUrl }, body: JSON.stringify(body) });
  const redirect = (res, what) => {
    assert(res.status >= 300 && res.status < 400 && res.headers.get('location'), `${what}: expected redirect, got ${res.status}`);
    return new URL(res.headers.get('location'), publicUrl);
  };

  // 2. admin shell + setup_required
  const adminRes = await send('/admin/');
  const html = await adminRes.text();
  assert(adminRes.status === 200, `GET /admin/ -> ${adminRes.status}`);
  assert((adminRes.headers.get('content-type') ?? '').startsWith('text/html'), 'GET /admin/ is not text/html');
  assert(html.includes('<div id="root">'), 'GET /admin/ lacks <div id="root">');
  const me0 = await send('/api/auth/me');
  const me0Body = await me0.json();
  assert(me0.status === 409 && me0Body.error?.code === 'setup_required', `GET /api/auth/me before setup -> ${me0.status} ${JSON.stringify(me0Body)}`);
  ok('GET /admin/ is the SPA shell; GET /api/auth/me -> 409 setup_required');

  // 3. first super_admin
  const setup = await post('/api/auth/setup', { email, name: 'Smoke Admin', password: pw });
  assert(setup.status === 201, `POST /api/auth/setup -> ${setup.status} ${await setup.text()}`);
  ok('POST /api/auth/setup -> 201');

  // 4. login chain
  const startLogin = async () => {
    const toProvider = redirect(await send('/api/auth/login'), '/api/auth/login');
    assert(toProvider.pathname === '/oauth2/auth', `login went to ${toProvider.href}`);
    return redirect(await send(toProvider.href), '/oauth2/auth');
  };
  const interaction = await startLogin();
  const uid = interaction.searchParams.get('uid');
  assert(interaction.pathname === '/admin/login' && uid, `unexpected interaction redirect ${interaction.href}`);
  const login = await post(`/oauth2/interaction/${uid}/login`, { email, password: pw });
  const loginBody = await login.json();
  assert(login.status === 200 && loginBody.redirectTo, `interaction login -> ${login.status} ${JSON.stringify(loginBody)}`);
  let next = new URL(loginBody.redirectTo, publicUrl);
  for (let hop = 0; next.pathname !== '/api/auth/callback'; hop++) {
    assert(hop < 10, 'too many redirects');
    assert(next.pathname.startsWith('/oauth2/'), `redirected outside the provider: ${next.href}`);
    next = redirect(await send(next.href), next.pathname);
  }
  const callback = await send(next.href);
  assert(callback.status === 302, `callback -> ${callback.status}`);
  assert(jar.has('oc_session'), 'callback did not set oc_session');
  const me1 = await send('/api/auth/me');
  const me1Body = await me1.json();
  assert(me1.status === 200, `GET /api/auth/me after login -> ${me1.status} ${JSON.stringify(me1Body)}`);
  ok('login chain complete; GET /api/auth/me -> 200');

  // 5. logout; the next login must ask for the password again
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
  // 6. stop server, drop DB, remove temp dir
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
