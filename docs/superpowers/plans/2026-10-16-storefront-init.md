# Storefront init + Nest → Next SSR proxy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `opencms init` so a new project has Nest (`src/`) plus a Next.js App Router storefront (`app/`), and add an `@opencms/core` reverse-proxy so Nest serves real Next SSR on `/` while `/admin`, `/api`, and `/oauth2` stay on Nest.

**Architecture:** No `@opencms/storefront` package. CLI templates gain `app/`, `next.config.ts`, Next deps, and concurrently-based scripts. `@opencms/core` resolves `storefront` options (+ env overrides), mounts a catch-all Express proxy (HTTP + optional WebSocket upgrade for HMR) to `targetUrl` when enabled, and returns a clear 502 when Next is down. Proxy is a fallback: excluded prefixes call `next()`.

**Tech Stack:** NestJS 11, Express 5 (via `@nestjs/platform-express`), `http-proxy` ^1.18, Next.js ^15.5 (App Router), React 19, concurrently ^9, TypeScript 5.6, vitest 3, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-10-16-roles-storefront-init-design.md` (Track B §4, §5.2–§5.3, §6 storefront rows) — also at `/cursor/stores/self/docs/2026-10-16-roles-storefront-init-design.md` until synced into the repo. Background: `docs/superpowers/specs/2026-10-15-embedded-admin-init-design.md` (init file set, fixed paths).

**Parallelism / dependency:** This plan is Track B only. It may proceed in parallel with the Track A (realm roles) plan. Do **not** assume unfinished roles work: no `/admin/roles`, no oauth2 role APIs, no changes to `@RequireRole` contracts. Content delivery stays `GET /api/content/:apiId` as today.

**Repo facts (verified, apply to every task):**
- Branch off current `main`. Monorepo pnpm; root `pnpm vitest run <path>`; `vitest.config.ts` includes `packages/*/test/**/*.test.ts`.
- Nest under vitest: every constructor param needs `@Inject(Token)`.
- `@opencms/core` consumers use built `dist/`: `pnpm --filter @opencms/core build` (or root `pnpm build`) after core source changes before CLI/example smoke that imports published shapes.
- Admin SPA: `packages/core/src/http/admin-spa.middleware.ts` → `createAdminSpaHandler`, mounted in `OpenCmsModule.onModuleInit` via `httpAdapter.getInstance().use('/admin', handler)` **before** Nest’s final 404 (same lifecycle as the new storefront proxy).
- Init templates live in `packages/cli/src/init/templates.ts` + `packages/cli/src/init/index.ts`; tests in `packages/cli/test/init.test.ts`.
- Example: `examples/my-store/` mirrors init Nest wiring (`src/main.ts`, `src/app.module.ts`); today no `app/` or Next.
- Test helper: `packages/core/test/support/core-app.ts` → `createCoreTestApp({ admin, cors, env, … })`.
- Fixed public paths already: `/admin`, `/api`, `/oauth2`, `/api/content`. Default Nest `PORT` = 4000.
- Content list JSON shape: `{ data: items, meta: { total, limit, offset } }`; get: `{ data: entry }` (`EntriesService`).

## Global Constraints

- Approach 1 only: extend CLI template + proxy in `@opencms/core`; **do not** create `@opencms/storefront`.
- Nest reverse-proxies to a **real Next runtime** (`next dev` / `next start`), not static-only file serving.
- One browser origin: `/` = storefront, `/admin` = embedded admin, `/api` + `/oauth2` = Nest/auth. Paths are not configurable.
- Proxy **must not** forward paths starting with `/admin`, `/api`, or `/oauth2` (covers BFF under `/api/auth`).
- `storefront.enabled: false` (or env equivalent): do not register the proxy; `/` and other non-Nest paths stay Nest 404.
- Upstream connection failure / `ECONNREFUSED` → **502** with body containing exactly: `Storefront is unavailable (Next.js did not respond at <target>). Is \`next dev\` / \`next start\` running?` (`<target>` = resolved `targetUrl`).
- Env overrides win over file/module options: `OPENCMS_STOREFRONT_ENABLED`, `OPENCMS_STOREFRONT_URL`, `OPENCMS_STOREFRONT_PORT` (port only when URL unset).
- Template defaults: `storefront.enabled = true`, port `3000`, `targetUrl = http://127.0.0.1:3000`. Nest listens on `PORT` (4000); Next listens on storefront port (localhost only); browsers talk only to Nest.
- Homepage hybrid: static welcome in `app/page.tsx` (no required CMS fetch); ship `app/lib/cms.ts` with `getEntries` calling same-origin `/api/content/:apiId`.
- Nest `tsconfig.json` `include` remains only `src` + `opencms.config.ts`. Next uses a separate `tsconfig.next.json` via `typescript.tsconfigPath` in `next.config.ts`.
- Scripts: `dev` = migrate then concurrently Nest + `next dev`; `build` = Nest `tsc` **and** `next build`; `start` = migrate then concurrently Nest prod + `next start`.
- No page builder. No mandatory CMS-driven homepage. No Playwright for this track (HTTP/unit + init smoke file asserts).
- Do not depend on Track A roles APIs or UI.

## Review Focus

1. **Exclude paths:** With storefront enabled + mock Next upstream, `/admin`, `/admin/…`, `/api/…`, `/oauth2/…` must **not** hit the upstream; `/` and `/_next/…` must.
2. **502 copy:** Upstream down → status 502 and stable substring `Storefront is unavailable (Next.js did not respond at`.
3. **`enabled: false`:** Proxy not registered; `GET /` → 404 (not 502).
4. **Init file set:** After `opencms init`, `app/layout.tsx`, `app/page.tsx`, `app/lib/cms.ts`, `next.config.ts`, `tsconfig.next.json` exist; `package.json` scripts match §4.5; Nest `tsconfig.json` still excludes `app/`.
5. **Boot logs:** When enabled, Nest logs both `OpenCMS ready at <publicUrl>/admin` and `Storefront proxied from <publicUrl>/ → <target>`.

---

## File structure (new / changed)

```
packages/core/src/options.ts                              (T1) storefront option types
packages/core/src/storefront/resolve-storefront.ts        (T1) resolve enabled + targetUrl from opts/env
packages/core/test/unit/resolve-storefront.test.ts        (T1)
packages/core/src/http/storefront-proxy.middleware.ts     (T2) createStorefrontProxyHandler + WS attach
packages/core/test/unit/storefront-proxy.test.ts          (T2) mock upstream
packages/core/src/opencms.module.ts                       (T3) mount proxy, boot log
packages/core/src/index.ts                                (T3) re-export resolve helpers if useful
packages/core/test/support/core-app.ts                    (T3) pass storefront opts
packages/core/test/integration/storefront-proxy.test.ts   (T3)
packages/core/package.json                                (T2) dependency http-proxy (+ types)
packages/core/README.md                                   (T6) storefront options + env
packages/cli/src/init/templates.ts                        (T4) Next files, scripts, README, env
packages/cli/src/init/index.ts                            (T4) write new files; Next/concurrently deps
packages/cli/test/init.test.ts                            (T4) assert app/ + scripts
examples/my-store/**                                      (T5) app/, Next config, scripts, storefront opts
scripts/smoke-init.mjs                                    (T6) assert storefront files (no full Next boot required)
CHANGELOG.md                                              (T6)
README.md                                                 (T6) quick start mentions / storefront
```

---

### Task 1: Resolve `storefront` config (opts + env)

**Files:**
- Create: `packages/core/src/storefront/resolve-storefront.ts`
- Create: `packages/core/test/unit/resolve-storefront.test.ts`
- Modify: `packages/core/src/options.ts` (add `storefront?` on `OpenCmsModuleOptions`)

**Interfaces:**
- Consumes: nothing from later tasks.
- Produces:
  ```ts
  export interface StorefrontModuleOptions {
    /** Register the Nest → Next proxy. Default true when resolving with no explicit false. */
    enabled?: boolean;
    /** Next listen port when `targetUrl` / `OPENCMS_STOREFRONT_URL` unset. Default 3000. */
    port?: number;
    /** Full upstream base URL. Default `http://127.0.0.1:${port}`. */
    targetUrl?: string;
  }

  export interface ResolvedStorefront {
    enabled: boolean;
    targetUrl: string; // no trailing slash
    port: number;
  }

  /** Env wins over `opts`. `OPENCMS_STOREFRONT_ENABLED` must be the strings `true` or `false` (case-insensitive) to override. */
  export function resolveStorefront(
    opts: StorefrontModuleOptions | undefined,
    env: NodeJS.ProcessEnv,
  ): ResolvedStorefront;
  ```
- Resolution rules (lock these in tests):
  1. `enabled`: if `env.OPENCMS_STOREFRONT_ENABLED` is `true`/`false` (trim, case-insensitive) use that; else `opts?.enabled ?? true`.
  2. `targetUrl`: if `env.OPENCMS_STOREFRONT_URL` non-empty after trim, use it (strip trailing `/`); else if `opts?.targetUrl` set, use it (strip trailing `/`); else `http://127.0.0.1:${port}`.
  3. `port`: if URL came from env or opts, parse port from that URL when present else 3000 for display/scripts; else `Number(env.OPENCMS_STOREFRONT_PORT) || opts?.port || 3000` (invalid/NaN/0 → 3000).
  4. Reject empty string `targetUrl` from opts the same as unset (fall through to port default).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/unit/resolve-storefront.test.ts
import { describe, expect, it } from 'vitest';
import { resolveStorefront } from '../../src/storefront/resolve-storefront';

describe('resolveStorefront', () => {
  it('defaults to enabled with http://127.0.0.1:3000', () => {
    expect(resolveStorefront(undefined, {})).toEqual({
      enabled: true,
      targetUrl: 'http://127.0.0.1:3000',
      port: 3000,
    });
  });

  it('uses opts.port when building the default URL', () => {
    expect(resolveStorefront({ port: 3100 }, {})).toMatchObject({
      enabled: true,
      targetUrl: 'http://127.0.0.1:3100',
      port: 3100,
    });
  });

  it('opts.targetUrl wins over port; strips trailing slash', () => {
    expect(resolveStorefront({ port: 3100, targetUrl: 'http://127.0.0.1:3999/' }, {})).toEqual({
      enabled: true,
      targetUrl: 'http://127.0.0.1:3999',
      port: 3999,
    });
  });

  it('OPENCMS_STOREFRONT_URL wins over opts.targetUrl and PORT', () => {
    expect(
      resolveStorefront(
        { targetUrl: 'http://127.0.0.1:1', port: 2 },
        { OPENCMS_STOREFRONT_URL: 'http://127.0.0.1:9/', OPENCMS_STOREFRONT_PORT: '8' },
      ),
    ).toEqual({ enabled: true, targetUrl: 'http://127.0.0.1:9', port: 9 });
  });

  it('OPENCMS_STOREFRONT_PORT applies only when URL unset', () => {
    expect(resolveStorefront({ port: 3000 }, { OPENCMS_STOREFRONT_PORT: '3200' })).toEqual({
      enabled: true,
      targetUrl: 'http://127.0.0.1:3200',
      port: 3200,
    });
  });

  it('OPENCMS_STOREFRONT_ENABLED overrides opts.enabled', () => {
    expect(resolveStorefront({ enabled: true }, { OPENCMS_STOREFRONT_ENABLED: 'false' }).enabled).toBe(false);
    expect(resolveStorefront({ enabled: false }, { OPENCMS_STOREFRONT_ENABLED: 'TRUE' }).enabled).toBe(true);
  });

  it('ignores garbage OPENCMS_STOREFRONT_ENABLED and keeps opts', () => {
    expect(resolveStorefront({ enabled: false }, { OPENCMS_STOREFRONT_ENABLED: 'maybe' }).enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/unit/resolve-storefront.test.ts`
Expected: FAIL (module / `resolveStorefront` not found).

- [ ] **Step 3: Write minimal implementation**

Add to `packages/core/src/options.ts` inside `OpenCmsModuleOptions`:

```ts
  /**
   * Nest → Next.js storefront reverse-proxy. When enabled, non-excluded paths are
   * forwarded to `targetUrl` (real `next dev` / `next start`). Default enabled=true.
   */
  storefront?: {
    enabled?: boolean;
    port?: number;
    targetUrl?: string;
  };
```

Create `packages/core/src/storefront/resolve-storefront.ts`:

```ts
export interface StorefrontModuleOptions {
  enabled?: boolean;
  port?: number;
  targetUrl?: string;
}

export interface ResolvedStorefront {
  enabled: boolean;
  targetUrl: string;
  port: number;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function portFromUrl(url: string): number {
  try {
    const p = new URL(url).port;
    if (p) return Number(p);
    return url.startsWith('https:') ? 443 : 80;
  } catch {
    return 3000;
  }
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveStorefront(
  opts: StorefrontModuleOptions | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedStorefront {
  const flag = env.OPENCMS_STOREFRONT_ENABLED?.trim().toLowerCase();
  const enabled = flag === 'true' ? true : flag === 'false' ? false : (opts?.enabled ?? true);

  const envUrl = env.OPENCMS_STOREFRONT_URL?.trim();
  const optUrl = opts?.targetUrl?.trim();
  let targetUrl: string;
  let port: number;

  if (envUrl) {
    targetUrl = stripSlash(envUrl);
    port = portFromUrl(targetUrl);
  } else if (optUrl) {
    targetUrl = stripSlash(optUrl);
    port = portFromUrl(targetUrl);
  } else {
    port = parsePort(env.OPENCMS_STOREFRONT_PORT, opts?.port ?? 3000);
    targetUrl = `http://127.0.0.1:${port}`;
  }

  return { enabled, targetUrl, port };
}
```

Keep `OpenCmsModuleOptions.storefront` typed as `StorefrontModuleOptions` by importing the interface from this file (or duplicate the structural type in `options.ts` and import `StorefrontModuleOptions` from options into resolve — prefer **single definition** in `resolve-storefront.ts` and `import type { StorefrontModuleOptions } from './storefront/resolve-storefront'` in `options.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/unit/resolve-storefront.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/options.ts packages/core/src/storefront/resolve-storefront.ts packages/core/test/unit/resolve-storefront.test.ts
git commit -m "feat(core): resolve storefront enabled/targetUrl from options and env"
```

---

### Task 2: Storefront reverse-proxy handler (HTTP + 502 + excludes)

**Files:**
- Create: `packages/core/src/http/storefront-proxy.middleware.ts`
- Create: `packages/core/test/unit/storefront-proxy.test.ts`
- Modify: `packages/core/package.json` (add `http-proxy` dependency; `@types/http-proxy` as `devDependency`)

**Interfaces:**
- Consumes: `ResolvedStorefront.targetUrl` string from Task 1 (passed in as `targetUrl`).
- Produces:
  ```ts
  export const STOREFRONT_UNAVAILABLE_MESSAGE = (target: string) =>
    `Storefront is unavailable (Next.js did not respond at ${target}). Is \`next dev\` / \`next start\` running?`;

  export interface StorefrontProxyOptions {
    targetUrl: string; // already resolved, no trailing slash
    /** Path prefixes that must call next() and never proxy. Default: /admin, /api, /oauth2 */
    excludePrefixes?: string[];
  }

  export interface StorefrontProxy {
    /** Express middleware: excluded → next(); else proxy; upstream errors → 502 text. */
    handler: (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void;
    /** Attach `upgrade` listener for Next HMR WebSockets. Call once with Nest's HTTP server. */
    attach(server: import('node:http').Server): void;
    /** Remove upgrade listener (onApplicationShutdown). */
    close(): void;
  }

  export function createStorefrontProxy(opts: StorefrontProxyOptions): StorefrontProxy;
  ```
- Default `excludePrefixes`: `['/admin', '/api', '/oauth2']`. Match if `pathname === prefix` or `pathname.startsWith(prefix + '/')`.
- Proxy all methods for non-excluded paths (including `/`, `/_next/*`).
- On proxy `error` / connection refused: if headers not sent, `res.status(502).type('text/plain; charset=utf-8').send(STOREFRONT_UNAVAILABLE_MESSAGE(targetUrl))`.
- WebSocket: `attach` registers `server.on('upgrade', …)` that skips excluded paths and proxies upgrade to `targetUrl`; `close` removes the listener. If HMR is flaky through the proxy, that is acceptable (README documents opening `targetUrl` directly) — still implement best-effort upgrade proxy.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/unit/storefront-proxy.test.ts
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontProxy, STOREFRONT_UNAVAILABLE_MESSAGE } from '../../src/http/storefront-proxy.middleware';

function listen(app: express.Express | http.Server): Promise<{ base: string; server: http.Server; close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = app instanceof http.Server ? app : http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        server,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

describe('createStorefrontProxy', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()!();
  });

  it('forwards / and /_next to the upstream and skips /admin /api /oauth2', async () => {
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`up:${req.url}`);
    });
    const up = await listen(upstream);
    closers.push(up.close);

    const proxy = createStorefrontProxy({ targetUrl: up.base });
    const app = express();
    app.use(proxy.handler);
    app.get('/admin/x', (_req, res) => res.status(200).send('admin-local'));
    app.get('/api/x', (_req, res) => res.status(200).send('api-local'));
    app.get('/oauth2/x', (_req, res) => res.status(200).send('oauth-local'));
    const front = await listen(app);
    closers.push(async () => {
      proxy.close();
      await front.close();
    });

    const r0 = await fetch(`${front.base}/`);
    expect(r0.status).toBe(200);
    expect(await r0.text()).toBe('up:/');

    const rNext = await fetch(`${front.base}/_next/static/chunks/main.js`);
    expect(rNext.status).toBe(200);
    expect(await rNext.text()).toBe('up:/_next/static/chunks/main.js');

    expect(await (await fetch(`${front.base}/admin/x`)).text()).toBe('admin-local');
    expect(await (await fetch(`${front.base}/api/x`)).text()).toBe('api-local');
    expect(await (await fetch(`${front.base}/oauth2/x`)).text()).toBe('oauth-local');
    expect(seen.some((s) => s.includes('/admin'))).toBe(false);
    expect(seen.some((s) => s.includes('/api'))).toBe(false);
    expect(seen.some((s) => s.includes('/oauth2'))).toBe(false);
  });

  it('returns 502 with the stable message when upstream is down', async () => {
    const targetUrl = 'http://127.0.0.1:1'; // closed port
    const proxy = createStorefrontProxy({ targetUrl });
    const app = express();
    app.use(proxy.handler);
    const front = await listen(app);
    closers.push(async () => {
      proxy.close();
      await front.close();
    });

    const r = await fetch(`${front.base}/`);
    expect(r.status).toBe(502);
    const body = await r.text();
    expect(body).toBe(STOREFRONT_UNAVAILABLE_MESSAGE(targetUrl));
    expect(body).toContain('Storefront is unavailable (Next.js did not respond at');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/test/unit/storefront-proxy.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Add dependency and implement**

```bash
pnpm --filter @opencms/core add http-proxy@^1.18.1
pnpm --filter @opencms/core add -D @types/http-proxy@^1.17.17
```

Implement `packages/core/src/http/storefront-proxy.middleware.ts`:

```ts
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import httpProxy from 'http-proxy';

export const STOREFRONT_UNAVAILABLE_MESSAGE = (target: string) =>
  `Storefront is unavailable (Next.js did not respond at ${target}). Is \`next dev\` / \`next start\` running?`;

export interface StorefrontProxyOptions {
  targetUrl: string;
  excludePrefixes?: string[];
}

export interface StorefrontProxy {
  handler: (req: Request, res: Response, next: NextFunction) => void;
  attach(server: HttpServer): void;
  close(): void;
}

const DEFAULT_EXCLUDE = ['/admin', '/api', '/oauth2'];

function pathnameOf(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function isExcluded(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

export function createStorefrontProxy(opts: StorefrontProxyOptions): StorefrontProxy {
  const targetUrl = opts.targetUrl.replace(/\/+$/, '');
  const excludePrefixes = opts.excludePrefixes ?? DEFAULT_EXCLUDE;
  const proxy = httpProxy.createProxyServer({ target: targetUrl, changeOrigin: true, ws: true, xfwd: true });

  const onError = (err: Error, _req: IncomingMessage, res: Socket | Response) => {
    if (res instanceof Socket) {
      res.destroy(err);
      return;
    }
    const expressRes = res as Response;
    if (expressRes.headersSent) return;
    expressRes.status(502).type('text/plain; charset=utf-8').send(STOREFRONT_UNAVAILABLE_MESSAGE(targetUrl));
  };
  proxy.on('error', onError);

  const handler: StorefrontProxy['handler'] = (req, res, next) => {
    const pathname = pathnameOf(req.originalUrl ?? req.url);
    if (isExcluded(pathname, excludePrefixes)) {
      next();
      return;
    }
    proxy.web(req, res, { target: targetUrl });
  };

  let upgrade: ((req: IncomingMessage, socket: Socket, head: Buffer) => void) | undefined;
  let attached: HttpServer | undefined;

  return {
    handler,
    attach(server) {
      if (attached) return;
      attached = server;
      upgrade = (req, socket, head) => {
        const pathname = pathnameOf(req.url);
        if (isExcluded(pathname, excludePrefixes)) return;
        proxy.ws(req, socket, head, { target: targetUrl });
      };
      server.on('upgrade', upgrade);
    },
    close() {
      if (attached && upgrade) attached.off('upgrade', upgrade);
      attached = undefined;
      upgrade = undefined;
      proxy.close();
    },
  };
}
```

Adjust `onError` typing as needed so TypeScript accepts `http-proxy`’s error callback (cast `res` when `writableEnded` / `headersSent` is present). Keep the 502 body **exact**.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/test/unit/storefront-proxy.test.ts`
Expected: PASS.

Also: `pnpm --filter @opencms/core typecheck` → PASS (or fix types).

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json packages/core/src/http/storefront-proxy.middleware.ts packages/core/test/unit/storefront-proxy.test.ts pnpm-lock.yaml
git commit -m "feat(core): Nest reverse-proxy to Next with excludes and 502"
```

---

### Task 3: Wire proxy into `OpenCmsModule` + integration tests

**Files:**
- Modify: `packages/core/src/opencms.module.ts`
- Modify: `packages/core/src/index.ts` (export `resolveStorefront`, `createStorefrontProxy`, types if useful for hosts — at minimum keep options public via `OpenCmsModuleOptions`)
- Modify: `packages/core/test/support/core-app.ts`
- Create: `packages/core/test/integration/storefront-proxy.test.ts`

**Interfaces:**
- Consumes: `resolveStorefront` (T1), `createStorefrontProxy` (T2), existing `mountAdmin` lifecycle.
- Produces: When `resolveStorefront(options.storefront, env).enabled === true`, `OpenCmsModule.onModuleInit` mounts `proxy.handler` on the Express instance (no path prefix) and `proxy.attach(httpServer)`; on shutdown `proxy.close()`. When disabled, neither mount nor attach.
- Boot log (use `this.logger.log`): after admin mount, if storefront enabled:
  `Storefront proxied from ${publicUrl}/ → ${targetUrl}`
  where `publicUrl = (env.OPENCMS_PUBLIC_URL ?? \`http://localhost:${env.PORT ?? 4000}\`).replace(/\/+$/, '')`.
- Host template `main.ts` still prints `OpenCMS ready at ${publicUrl}/admin` (unchanged location); core adds the storefront line so linked examples get it even if they forget — **also** update template `main.ts` in Task 4 to log the storefront line when env says enabled (duplicate is OK once; prefer **only** logging storefront from `OpenCmsModule` to avoid double logs). Decision for this plan: **storefront log only from `OpenCmsModule`**; keep `OpenCMS ready at …/admin` in host `main.ts` as today.
- `createCoreTestApp` accepts `storefront?: OpenCmsModuleOptions['storefront']` and passes it to `forRoot`.

Mount order note: register storefront proxy in `onModuleInit` **after** `mountAdmin` (admin is path-scoped; proxy calls `next()` for `/admin`). Excluded `/api`/`/oauth2` fall through to Nest/oauth handlers registered on the same Express app.

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/core/test/integration/storefront-proxy.test.ts
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { STOREFRONT_UNAVAILABLE_MESSAGE } from '../../src/http/storefront-proxy.middleware';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

describe('OpenCmsModule storefront proxy', () => {
  describe('enabled with mock Next', () => {
    let upstream: http.Server;
    let targetUrl: string;
    let t: CoreTestApp;
    const hits: string[] = [];

    beforeAll(async () => {
      upstream = http.createServer((req, res) => {
        hits.push(`${req.method} ${req.url}`);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('next-ok');
      });
      await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
      targetUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
      t = await createCoreTestApp({
        storefront: { enabled: true, targetUrl },
        admin: { enabled: false },
      });
    }, 60_000);

    afterAll(async () => {
      await t?.close();
      await new Promise<void>((r) => upstream.close(() => r()));
    });

    it('proxies / to Next', async () => {
      const r = await fetch(`${t.baseUrl}/`);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('next-ok');
      expect(hits.some((h) => h === 'GET /' || h.startsWith('GET /?'))).toBe(true);
    });

    it('does not proxy /api/auth/me', async () => {
      hits.length = 0;
      const r = await fetch(`${t.baseUrl}/api/auth/me`);
      expect(r.status).toBe(409); // setup_required on empty DB — Nest/oauth answered
      expect(hits.length).toBe(0);
    });

    it('does not proxy /oauth2/… to Next (Nest/provider or 404, not next-ok)', async () => {
      hits.length = 0;
      const r = await fetch(`${t.baseUrl}/oauth2/jwks`);
      const text = await r.text();
      expect(text).not.toBe('next-ok');
      expect(hits.length).toBe(0);
    });
  });

  describe('enabled with dead upstream', () => {
    let t: CoreTestApp;
    const targetUrl = 'http://127.0.0.1:1';
    beforeAll(async () => {
      t = await createCoreTestApp({ storefront: { enabled: true, targetUrl }, admin: { enabled: false } });
    }, 60_000);
    afterAll(async () => {
      await t?.close();
    });

    it('answers 502 with stable message', async () => {
      const r = await fetch(`${t.baseUrl}/`);
      expect(r.status).toBe(502);
      expect(await r.text()).toBe(STOREFRONT_UNAVAILABLE_MESSAGE(targetUrl));
    });
  });

  describe('disabled', () => {
    let t: CoreTestApp;
    beforeAll(async () => {
      t = await createCoreTestApp({ storefront: { enabled: false }, admin: { enabled: false } });
    }, 60_000);
    afterAll(async () => {
      await t?.close();
    });

    it('does not proxy; GET / is 404', async () => {
      const r = await fetch(`${t.baseUrl}/`);
      expect(r.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Extend `createCoreTestApp` and run — expect FAIL**

In `packages/core/test/support/core-app.ts`, add `storefront?: OpenCmsModuleOptions['storefront']` to `CoreTestAppOptions` and pass `storefront: opts.storefront` into `OpenCmsModule.forRoot({…})`.

Run: `pnpm vitest run packages/core/test/integration/storefront-proxy.test.ts`
Expected: FAIL (proxy not wired / `/` not proxied).

- [ ] **Step 3: Implement wiring in `OpenCmsModule`**

In `opencms.module.ts`:

1. Import `resolveStorefront` and `createStorefrontProxy`.
2. Add private field `private storefrontProxy?: ReturnType<typeof createStorefrontProxy>`.
3. In `onModuleInit`, after `await this.mountAdmin()`, call `this.mountStorefront()`.
4. Implement:

```ts
  private mountStorefront(): void {
    const env = this.options.env ?? process.env;
    const resolved = resolveStorefront(this.options.storefront, env);
    if (!resolved.enabled) return;
    const proxy = createStorefrontProxy({ targetUrl: resolved.targetUrl });
    this.storefrontProxy = proxy;
    const adapter = this.httpHost.httpAdapter;
    adapter.getInstance().use(proxy.handler);
    proxy.attach(adapter.getHttpServer());
    const port = env.PORT ?? '4000';
    const publicUrl = (env.OPENCMS_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
    this.logger.log(`Storefront proxied from ${publicUrl}/ → ${resolved.targetUrl}`);
  }
```

5. In `onApplicationShutdown`, `this.storefrontProxy?.close()` before destroying the DB.

6. Export from `packages/core/src/index.ts`:

```ts
export { resolveStorefront, type ResolvedStorefront, type StorefrontModuleOptions } from './storefront/resolve-storefront';
export {
  createStorefrontProxy,
  STOREFRONT_UNAVAILABLE_MESSAGE,
  type StorefrontProxy,
  type StorefrontProxyOptions,
} from './http/storefront-proxy.middleware';
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/core/test/unit/resolve-storefront.test.ts packages/core/test/unit/storefront-proxy.test.ts packages/core/test/integration/storefront-proxy.test.ts packages/core/test/integration/admin-spa.test.ts`
Expected: PASS (admin SPA still works; storefront excludes `/admin`).

Run: `pnpm --filter @opencms/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/opencms.module.ts packages/core/src/index.ts packages/core/test/support/core-app.ts packages/core/test/integration/storefront-proxy.test.ts
git commit -m "feat(core): mount storefront proxy from OpenCmsModule when enabled"
```

---

### Task 4: CLI init scaffolds Next `app/` + scripts + deps

**Files:**
- Modify: `packages/cli/src/init/templates.ts`
- Modify: `packages/cli/src/init/index.ts`
- Modify: `packages/cli/test/init.test.ts`

**Interfaces:**
- Consumes: resolved storefront defaults (port 3000, enabled true) — template only; no import from core required inside string templates.
- Produces: every `runInit` write set includes the files below; `package.json` scripts/deps as specified; `src/app.module.ts` passes `storefront: { enabled: true, port: 3000 }`.

**New template exports** (string builders in `templates.ts`):

| Rel path | Responsibility |
|---|---|
| `app/layout.tsx` | Root layout: `<html><body>{children}</body></html>`, metadata title = project name |
| `app/page.tsx` | Static welcome: project name, link to `/admin`, short “run pnpm dev” note — **no** `getEntries` call |
| `app/lib/cms.ts` | `getEntries(apiId, opts?)` → `fetch` same-origin `/api/content/${apiId}` |
| `next.config.ts` | `typescript.tsconfigPath: 'tsconfig.next.json'`; empty `images` ok |
| `tsconfig.next.json` | App Router TS config; include `app/**`, `next-env.d.ts`, `.next/types/**/*.ts` |
| `next-env.d.ts` | Standard Next triple-slash references |

**`package.json` scripts** (replace current):

```json
{
  "dev": "opencms migrate:up && concurrently -k -n nest,next -c blue,magenta \"tsx src/main.ts\" \"next dev -p 3000\"",
  "build": "tsc -p tsconfig.json && next build",
  "start": "opencms migrate:up && concurrently -k -n nest,next -c blue,magenta \"node dist/src/main.js\" \"next start -p 3000\"",
  "opencms": "opencms"
}
```

Pin storefront port `3000` in scripts to match template `storefront.port`. (If init later gains `--storefront-port`, substitute that number into scripts + `app.module`; **out of scope** — always 3000.)

**Dependencies to add** (ranges; pin majors in `RANGES` / `DEV_RANGES` or a new `NEXT_RANGES` const in `index.ts`):

```ts
const NEXT_RANGES = {
  next: '^15.5.0',
  react: '^19.0.0',
  'react-dom': '^19.0.0',
} as const;
const NEXT_DEV_RANGES = {
  concurrently: '^9.0.0',
  '@types/react': '^19.0.0',
  '@types/react-dom': '^19.0.0',
} as const;
```

Merge into `deps` / `devDeps` in both link and non-link branches of `runInit`.

**`app.module.ts` template** — add storefront block:

```ts
    OpenCmsModule.forRoot({
      root: findProjectRoot(__dirname),
      config,
      contentTypes,
      hooks,
      schemaEditable: process.env.NODE_ENV !== 'production',
      storefront: {
        enabled: true,
        port: 3000,
      },
    }),
```

**`.env` / `.env.example`** — append commented overrides:

```
# OPENCMS_STOREFRONT_ENABLED=true
# OPENCMS_STOREFRONT_URL=http://127.0.0.1:3000
# OPENCMS_STOREFRONT_PORT=3000
```

**`gitignore`** — add `.next\n`.

**README template** — after “Open …/admin”, add that `/` is the storefront (proxied Next); document that if HMR through the proxy is flaky, open `http://127.0.0.1:3000` while developing UI; document the three `OPENCMS_STOREFRONT_*` env vars; note `dev`/`start` run Nest + Next via concurrently; Nest public port vs Next localhost port.

- [ ] **Step 1: Write failing init tests**

Update `packages/cli/test/init.test.ts`:

1. In `writes exactly the files of the spec`, extend `expected` with:

```ts
      'app/layout.tsx',
      'app/lib/cms.ts',
      'app/page.tsx',
      'next-env.d.ts',
      'next.config.ts',
      'tsconfig.next.json',
```

2. Replace scripts assertion in `uses semver ranges without --link`:

```ts
    expect(pkg.scripts).toEqual({
      dev: 'opencms migrate:up && concurrently -k -n nest,next -c blue,magenta "tsx src/main.ts" "next dev -p 3000"',
      build: 'tsc -p tsconfig.json && next build',
      start: 'opencms migrate:up && concurrently -k -n nest,next -c blue,magenta "node dist/src/main.js" "next start -p 3000"',
      opencms: 'opencms',
    });
    expect(pkg.dependencies.next).toBe('^15.5.0');
    expect(pkg.dependencies.react).toBe('^19.0.0');
    expect(pkg.dependencies['react-dom']).toBe('^19.0.0');
    expect(pkg.devDependencies.concurrently).toBe('^9.0.0');
```

3. Add new cases:

```ts
  it('scaffolds a hybrid homepage and cms helper without calling the API from page.tsx', async () => {
    const dir = path.join(tmp, 'shop');
    await runInit(dir, base);
    expect(read(dir, 'app/page.tsx')).toContain('/admin');
    expect(read(dir, 'app/page.tsx')).not.toMatch(/getEntries/);
    expect(read(dir, 'app/lib/cms.ts')).toContain('/api/content/');
    expect(read(dir, 'app/lib/cms.ts')).toContain('export async function getEntries');
    expect(JSON.parse(read(dir, 'tsconfig.json')).include).toEqual(['src', 'opencms.config.ts']);
    expect(read(dir, 'next.config.ts')).toContain("tsconfigPath: 'tsconfig.next.json'");
    expect(read(dir, 'src/app.module.ts')).toContain('storefront:');
    expect(read(dir, 'src/app.module.ts')).toContain('enabled: true');
    expect(read(dir, '.gitignore')).toContain('.next');
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm vitest run packages/cli/test/init.test.ts`
Expected: FAIL (missing files / old scripts).

- [ ] **Step 3: Implement templates + `runInit` writes**

Complete template bodies:

```ts
// templates.ts — add:

export const nextConfigTs = (): string => `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: 'tsconfig.next.json',
  },
};

export default nextConfig;
`;

export const tsconfigNextJson = (): string =>
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'ES2022'],
        allowJs: false,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
      },
      include: ['next-env.d.ts', 'app/**/*.ts', 'app/**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    },
    null,
    2,
  ) + '\n';

export const nextEnvDts = (): string => `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`;

export const appLayoutTsx = (title: string): string => `import type { ReactNode } from 'react';

export const metadata = {
  title: ${JSON.stringify(title)},
  description: 'OpenCMS storefront',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

export const appPageTsx = (name: string): string => `export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: '40rem', padding: '0 1rem' }}>
      <h1>${name}</h1>
      <p>
        This is the storefront (Next.js App Router), served at <code>/</code> through the Nest reverse-proxy.
      </p>
      <p>
        Open the admin at <a href="/admin">/admin</a>. Use <code>app/lib/cms.ts</code> when you want to load
        published entries from <code>/api/content/&lt;apiId&gt;</code>.
      </p>
    </main>
  );
}
`;
```

```ts
export const appCmsTs = (): string => `/**
 * Same-origin helpers for the public delivery API.
 *
 * Example (Server Component on another route):
 *
 *   import { getEntries } from './lib/cms';
 *   const { data } = await getEntries('product', { limit: 10 });
 *
 * The default homepage does not call this — keep it static until you need CMS content.
 */

export type GetEntriesOptions = {
  locale?: string;
  fallback?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  /** Flat filters → \`filter[field]=value\` query params. */
  filter?: Record<string, string>;
  /** Absolute origin when calling from a context without a relative base. Defaults to same-origin. */
  origin?: string;
};

export async function getEntries(apiId: string, opts: GetEntriesOptions = {}) {
  const qs = new URLSearchParams();
  if (opts.locale) qs.set('locale', opts.locale);
  if (opts.fallback) qs.set('fallback', opts.fallback);
  if (opts.sort) qs.set('sort', opts.sort);
  if (opts.limit != null) qs.set('limit', String(opts.limit));
  if (opts.offset != null) qs.set('offset', String(opts.offset));
  if (opts.filter) {
    for (const [k, v] of Object.entries(opts.filter)) qs.set(\`filter[\${k}]\`, v);
  }
  const q = qs.toString();
  const path = \`/api/content/\${encodeURIComponent(apiId)}\${q ? \`?\${q}\` : ''}\`;
  const url = opts.origin ? new URL(path, opts.origin).toString() : path;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(\`getEntries(\${apiId}) failed: \${res.status} \${await res.text()}\`);
  }
  return res.json() as Promise<{ data: unknown[]; meta: { total: number; limit: number; offset: number } }>;
}
`;
```

Update `packageJson()` to accept scripts override **or** hardcode the new scripts object shown above.

Update `envFile` to append the three commented storefront lines.

Update `gitignore` to `node_modules\ndist\n.next\n.env\n*.log\n`.

Update `readme()` with storefront section (HMR note + env table + ports).

In `runInit`, add files to the `Map`:

```ts
    ['app/layout.tsx', t.appLayoutTsx(name)],
    ['app/page.tsx', t.appPageTsx(name)],
    ['app/lib/cms.ts', t.appCmsTs()],
    ['next.config.ts', t.nextConfigTs()],
    ['tsconfig.next.json', t.tsconfigNextJson()],
    ['next-env.d.ts', t.nextEnvDts()],
```

And merge `NEXT_RANGES` / `NEXT_DEV_RANGES` into deps.

- [ ] **Step 4: Run init tests**

Run: `pnpm vitest run packages/cli/test/init.test.ts`
Expected: PASS.

Run: `pnpm --filter opencms-cli typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/init/templates.ts packages/cli/src/init/index.ts packages/cli/test/init.test.ts
git commit -m "feat(cli): scaffold Next app/ storefront and Nest+Next scripts on init"
```

---

### Task 5: Align `examples/my-store` with the new template

**Files:**
- Create: `examples/my-store/app/layout.tsx`, `app/page.tsx`, `app/lib/cms.ts`, `next.config.ts`, `tsconfig.next.json`, `next-env.d.ts`
- Modify: `examples/my-store/package.json`, `src/app.module.ts`, `.gitignore` (create if missing), `.env.example` if present / README if present at example or root references

**Interfaces:**
- Consumes: same storefront option shape as Task 4 (`storefront: { enabled: true, port: 3000 }` in `OpenCmsModule.forRoot`).
- Produces: example can `pnpm --filter my-store dev` with Nest + Next (workspace deps). Keep existing `product` / `brand` content types and extensions unchanged (no store redesign).

- [ ] **Step 1: Write a small regression check (optional but preferred)**

No separate vitest package for examples. Instead, after editing, run:

```bash
pnpm --filter my-store typecheck
```

Expect FAIL until Next files/scripts exist and Nest tsconfig still excludes `app/`.

- [ ] **Step 2: Copy template semantics into the example**

`package.json` scripts/deps — match Task 4, but keep workspace protocol:

```json
{
  "scripts": {
    "opencms": "opencms",
    "dev": "opencms migrate:up && concurrently -k -n nest,next -c blue,magenta \"tsx src/main.ts\" \"next dev -p 3000\"",
    "build": "tsc -p tsconfig.json && next build",
    "start": "opencms migrate:up && concurrently -k -n nest,next -c blue,magenta \"node dist/src/main.js\" \"next start -p 3000\"",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@opencms/core": "workspace:*",
    "@opencms/schema": "workspace:*",
    "kysely": "^0.28.0",
    "next": "^15.5.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "concurrently": "^9.0.0",
    "opencms-cli": "workspace:*",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

Note: example `start` historically used `node dist/main.js` because `rootDir`/`outDir` layout differs (`include` src → `dist/main.js`). Keep **example’s existing emit paths**: if `tsc` emits `dist/main.js` (not `dist/src/main.js`), the start script must stay `node dist/main.js`. Verify with current `examples/my-store/tsconfig.json` (`rootDir: "."`, `include: ["src", "opencms.config.ts"]` → output `dist/src/main.js` if rootDir is `.` with `src/main.ts` → actually `dist/src/main.js`). Current script says `"start": "node dist/main.js"` which may already be wrong; **fix to the real emit path** when touching scripts:

```bash
pnpm --filter my-store build
# inspect dist/ and set start to node dist/src/main.js or node dist/main.js accordingly
```

Prefer matching init template if you also set example `rootDir`/`include` identical to init (`outDir: dist`, `rootDir: '.'`, include `src` + config → `dist/src/main.js`). Use `node dist/src/main.js` in `start` concurrently for consistency with init.

`src/app.module.ts` — add `storefront: { enabled: true, port: 3000 }`. Prefer switching `root: path.resolve(__dirname, '..')` to the init `findProjectRoot` snippet only if you are already editing the file for storefront; not required for this track.

Create `app/*` files branded `my-store` (same content as templates with name `my-store`).

- [ ] **Step 3: Install workspace deps and typecheck**

```bash
pnpm install
pnpm --filter my-store typecheck
pnpm --filter @opencms/core build
```

Expected: typecheck PASS. (Full `next build` in the example is optional in CI; run once locally if time permits: `pnpm --filter my-store exec next build`.)

- [ ] **Step 4: Commit**

```bash
git add examples/my-store
git commit -m "feat(example): add Next storefront app/ and proxy-enabled OpenCmsModule"
```

---

### Task 6: Smoke asserts, docs, CHANGELOG

**Files:**
- Modify: `scripts/smoke-init.mjs`
- Modify: `packages/core/README.md`
- Modify: `CHANGELOG.md`
- Modify: root `README.md` (quick start: mention `/` storefront + `/admin`)

**Interfaces:**
- Consumes: init file set from Task 4.
- Produces: smoke still boots Nest only (no mandatory Next process in CI). After init, assert filesystem + `package.json` scripts. Document options/env. CHANGELOG “Added” bullet for storefront proxy + init scaffold.

- [ ] **Step 1: Extend smoke-init file asserts (fail first if you run before Task 4 — should already pass after T4)**

After successful `opencms init` in `scripts/smoke-init.mjs`, before install:

```js
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
```

Import `existsSync` from `node:fs` (smoke already imports `readFileSync`).

Do **not** require booting Next in this smoke (spec §4.7 / §5.2).

- [ ] **Step 2: Update `packages/core/README.md`**

Add a **Storefront** section:

- Option `storefront.enabled` (default true), `port` (3000), `targetUrl`.
- Env overrides `OPENCMS_STOREFRONT_*`.
- Exclude prefixes `/admin`, `/api`, `/oauth2`.
- 502 behaviour when Next is down.
- Fixed URL map: `/` storefront, `/admin` admin.

- [ ] **Step 3: CHANGELOG + root README**

`CHANGELOG.md` under Unreleased → Added:

```markdown
- Storefront init: `opencms init` scaffolds a Next.js App Router app in `app/` beside Nest `src/`, with `lib/cms.ts` and scripts that run Nest + Next via `concurrently`.
- `@opencms/core` reverse-proxies non-excluded paths to a real Next.js server when `storefront.enabled` is true (`OPENCMS_STOREFRONT_*` env overrides). Upstream down → 502 with a clear message.
```

Root README quick start: after init/dev, open `http://localhost:4000/` (storefront) and `http://localhost:4000/admin`.

- [ ] **Step 4: Run verification suite**

```bash
pnpm vitest run packages/core/test/unit/resolve-storefront.test.ts packages/core/test/unit/storefront-proxy.test.ts packages/core/test/integration/storefront-proxy.test.ts packages/cli/test/init.test.ts
pnpm --filter @opencms/core typecheck
pnpm --filter opencms-cli typecheck
```

Expected: all PASS.

If Postgres is available and CI-equivalent smoke is desired:

```bash
node scripts/smoke-init.mjs
```

Expected: PASS including new storefront file asserts (Nest boot path unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-init.mjs packages/core/README.md CHANGELOG.md README.md
git commit -m "docs: storefront proxy options, init smoke asserts, changelog"
```

---

## Self-review (author checklist — completed against Track B spec)

| Spec item | Task |
|---|---|
| §4.1 `app/` + `src/` structure; no `@opencms/storefront` | T4, T5 |
| §4.2 hybrid homepage + `app/lib/cms.ts` | T4 |
| §4.3 proxy in core; excludes; 502; enabled false → no proxy | T2, T3 |
| §4.4 options + env overrides | T1, T4 env comments, T6 README |
| §4.5 scripts dev/build/start | T4, T5 |
| §4.6 Next/react/concurrently deps; Nest tsconfig excludes app | T4 |
| §4.7 smoke asserts + my-store update | T5, T6 |
| §5.2 init smoke files/scripts | T4, T6 |
| §5.3 proxy exclude / disabled / 502 tests | T2, T3 |
| §6 package boundaries | throughout |
| Parallel with roles; no roles assumptions | Global Constraints + Architecture |

Placeholder scan: no TBD/TODO; concrete code, commands, expected results.

Type consistency: `resolveStorefront` → `ResolvedStorefront.targetUrl` → `createStorefrontProxy({ targetUrl })` → `OpenCmsModule.mountStorefront`; `STOREFRONT_UNAVAILABLE_MESSAGE` shared by unit + integration tests.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-16-storefront-init.md` (and the agent-store copy). Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks (`superpowers:subagent-driven-development`)
2. **Inline Execution** — execute in-session with `superpowers:executing-plans` and checkpoints

Which approach?
