# Admin on Next.js (embedded in NestJS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Vite admin SPA with admin modules for a single Next.js 16 App Router app that lives in the user's project and runs inside the NestJS process, alongside a static sample website.

**Architecture:** `@opencms/core` gains `src/web/`: a host that loads the project's own `next`, sends every non-backend path (`/api`, `/oauth2` excluded) to Next, and adds a per-request CSP nonce for `/admin/**`. The admin source becomes ESM modules built by `tsc` into `dist/admin` and exported as `@opencms/core/admin` (client catch-all page with a pure route matcher) and `@opencms/core/admin/layout` (server root layout). `opencms init` scaffolds `app/(admin)` re-export files, `app/(site)` and the Next config.

**Tech Stack:** NestJS 11 / Express 5 (CommonJS), Next.js 16 App Router, React 19, Tailwind v4 (`@tailwindcss/postcss`), shadcn/radix, vitest, PostgreSQL 16, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-21-admin-nextjs-design.md` (read it with this plan; § references below point to it).

## Global Constraints

- Base branch `feat/admin-nextjs` (from `main` 38061de). Never push to `main`, never merge.
- Backend paths: `/api`, `/api/*`, `/oauth2`, `/oauth2/*`, case-insensitive. `/apix`, `/oauth2x` are not backend.
- Admin paths for CSP: `/admin`, `/admin/*`, case-insensitive. `/administrator` is not admin.
- Admin CSP (prod): `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'`. Dev only: add `'unsafe-eval'` to `script-src` and append `; connect-src 'self' ws: wss:`.
- Admin extra headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex`.
- Nonce: 16 random bytes, base64.
- 503 body (exact copy): `Web UI chưa được build. Chạy \`pnpm build\` rồi khởi động lại.` — `text/html; charset=utf-8`, `Cache-Control: no-store`.
- Options: `web?: { enabled?: boolean /* default true */; dir?: string /* default process.cwd() */; dev?: boolean /* default NODE_ENV !== 'production' */ }`. `admin.*` options and `OPENCMS_ADMIN_DEV` are removed.
- `next`, `react`, `react-dom` are optional peerDependencies of core (`next ^16`, `react ^19`, `react-dom ^19`); core never `require`s `next` when `web.enabled === false`.
- `next` is loaded from the project: `require(require.resolve('next', { paths: [dir] }))`.
- No caching work of any kind (spec §1 out of scope), including no new `Cache-Control` on `/api/**`.
- No `type: module` in `dist/admin`; no `@/` alias in admin source (relative imports only).
- Commit trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01BTGSzeTt7egh9MPNhCcXmg`. Author email `anhnn97.it@gmail.com`.
- Postgres for tests: `pg_ctlcluster 16 main start` (password `postgres`). Full suite: `pnpm build && pnpm test`.

## Review Focus

- `/administrator`, `/admins` must reach Next without admin CSP; `/ADMIN`, `/admin?x=1` must get it — pinned in Task 1 `paths.test.ts`.
- A Next handler that rejects must answer 500 and log, never crash the process or hang the request — pinned in Task 1 `web-host.test.ts`.
- WebSocket upgrades for paths outside `/_next/` must be left untouched (not destroyed, not forwarded) — pinned in Task 1 `web-host.test.ts`.
- In-admin links must never produce `/admin/admin/...` or a trailing `/admin/`; `adminHref('/')` is `/admin` — pinned in Task 3 `nav.test.ts`.
- `GET /admin/` gets Next's trailing-slash 308 to `/admin` and the login/logout flow still lands on admin pages — pinned in Task 7 smoke.

---

### Task 1: Web host units (`packages/core/src/web/`)

**Files:**
- Create: `packages/core/src/web/paths.ts`, `packages/core/src/web/csp.ts`, `packages/core/src/web/web-host.ts`, `packages/core/src/web/index.ts`
- Test: `packages/core/test/unit/paths.test.ts`, `packages/core/test/unit/csp.test.ts`, `packages/core/test/unit/web-host.test.ts`

**Interfaces:**
- Produces:
  - `isBackendPath(path: string): boolean`, `isAdminPath(path: string): boolean` (paths.ts)
  - `createNonce(): string`, `adminCsp(nonce: string, dev: boolean): string`, `ADMIN_SECURITY_HEADERS: Record<string, string>` (csp.ts)
  - (web-host.ts):
    ```ts
    export interface NextAppLike {
      prepare(): Promise<void>;
      getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
      getUpgradeHandler(): (req: IncomingMessage, socket: Duplex, head: Buffer) => unknown;
      close?(): Promise<void>;
    }
    export type LoadNext = (opts: { dev: boolean; dir: string }) => NextAppLike;
    export interface WebHostOptions { dir: string; dev: boolean; logger: { log(m: string): void; warn(m: string): void; error(m: string): void }; loadNext?: LoadNext }
    export interface WebHost {
      prepare(): Promise<void>;                       // never rejects
      handler: (req: Request, res: Response, next: NextFunction) => void;  // Express middleware
      attachUpgrade(server: http.Server): void;
      close(): Promise<void>;
    }
    export function createWebHost(opts: WebHostOptions): WebHost;
    export const defaultLoadNext: LoadNext;           // require(require.resolve('next', { paths: [dir] }))({ dev, dir })
    ```

- [ ] **Step 1: Write failing tests**

`paths.test.ts`: `isBackendPath` true for `/api`, `/api/`, `/api/x`, `/API/x`, `/oauth2`, `/oauth2/auth`, `/OAuth2/x`; false for `/apix`, `/oauth2x`, `/`, `/admin`, `/_next/static/a.js`. `isAdminPath` true for `/admin`, `/admin/`, `/admin/content/x`, `/ADMIN`; false for `/administrator`, `/admins`, `/`, `/api/admin`.

`csp.test.ts`: `createNonce()` decodes from base64 to 16 bytes, two calls differ; `adminCsp('abc', false)` equals the prod string in Global Constraints with `<n>`=`abc` and contains no `unsafe-eval`/`ws:`; `adminCsp('abc', true)` contains `'unsafe-eval'` and ends with `connect-src 'self' ws: wss:`; `ADMIN_SECURITY_HEADERS` has exactly the four headers of Global Constraints.

`web-host.test.ts` (fake `loadNext` recording calls; a tiny Express app on an ephemeral port, or direct calls with mock req/res):
- `prepare()` calls `loadNext({ dev, dir })` once and `app.prepare()` once.
- backend path → Express `next()` called, Next handler not called.
- `/` → Next handler called, response has no `Content-Security-Policy`.
- `/admin/x` → request header `content-security-policy` and response `Content-Security-Policy` contain the same `'nonce-…'`; two requests get different nonces; response has the four security headers.
- `dev: false` and no `<dir>/.next/BUILD_ID` → `loadNext` never called; `/` answers 503 with the exact body/headers; `warn` called exactly once across `prepare()` + 3 requests.
- `loadNext` throws, or `app.prepare()` rejects → `prepare()` resolves, `error` logged with the original message, `/` answers 503.
- Next handler rejects → response 500, `error` logged, no unhandled rejection.
- `attachUpgrade`: an `upgrade` event for `/_next/webpack-hmr` reaches the fake upgrade handler; one for `/socket` does not, and the socket is not destroyed.
- `close()` calls `app.close()` when present; safe when prepare failed.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/test/unit/paths.test.ts packages/core/test/unit/csp.test.ts packages/core/test/unit/web-host.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement paths.ts, csp.ts, web-host.ts, index.ts**

`handler` checks `isBackendPath(req.path)` first. For admin paths set `req.headers['content-security-policy']` before calling Next. Upgrade listener only claims requests whose URL path starts with `/_next/`, and only when Next is ready. `defaultLoadNext` uses a variable specifier like the old Vite loader so tsc does not resolve next's types.

- [ ] **Step 4: Run tests to verify they pass** — same command, Expected: PASS.

- [ ] **Step 5: Commit** — `feat(core): web host that embeds the project's Next app, admin CSP nonce`

---

### Task 2: Wire the web host into `OpenCmsModule`, remove the Vite SPA server

**Files:**
- Modify: `packages/core/src/opencms.module.ts` (replace `mountAdmin`/`adminDev` with `mountWeb`/`webHost`), `packages/core/src/options.ts` (`web` replaces `admin`), `packages/core/src/http/body-parser.middleware.ts`, `packages/core/src/index.ts` (export `WebHost`-free public surface: only the `web` option type changes), `packages/core/test/support/core-app.ts` (`web` option replaces `admin`, default `{ enabled: false }`)
- Delete: `packages/core/src/http/admin-spa.middleware.ts`, `packages/core/test/integration/admin-spa.test.ts`, `packages/core/test/integration/admin-dev.test.ts`, `packages/core/test/fixtures/admin-dist/`
- Test: `packages/core/test/unit/body-parser.middleware.test.ts` (extend), `packages/core/test/integration/web-mount.test.ts` (new)

**Interfaces:**
- Consumes: `createWebHost`, `defaultLoadNext`, `LoadNext` from Task 1.
- Produces: `OpenCmsModuleOptions['web']` = `{ enabled?: boolean; dir?: string; dev?: boolean; /** Undocumented; for tests. */ loadNext?: LoadNext }`; `CoreTestAppOptions.web?: OpenCmsModuleOptions['web']`.

- [ ] **Step 1: Write failing tests**

Body parser: a `POST /` and a `POST /admin/x` with `content-type: application/json` leave `req.body` undefined and the stream unread; `POST /api/x` is still parsed; `/oauth2/token` still skipped; `/oauth2/interaction/x` still parsed.

`web-mount.test.ts` (Postgres, `createCoreTestApp({ web: { enabled: true, dev: true, dir: <tmp>, loadNext: fake } })`, fake handler writes `200 next:<path>`):
- `GET /` → `next:/`; `GET /admin/x` → `next:/admin/x` with CSP nonce header.
- `GET /api/nope` → 404 JSON `{ error: { code } }` from Nest (fake not called).
- `GET /api/auth/me` → 409 `setup_required` (auth wiring intact).
- `web: { enabled: false }` (the default) → `GET /` is Nest's 404 and `loadNext` is never called.
- Shutdown (`close()`) calls the fake `close`.

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run packages/core/test/unit/body-parser.middleware.test.ts packages/core/test/integration/web-mount.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`mountWeb()` runs in `onModuleInit` where `mountAdmin` ran: skip when `web.enabled === false`; `createWebHost({ dir: web.dir ?? process.cwd(), dev: web.dev ?? process.env.NODE_ENV !== 'production', logger: this.logger, loadNext: web.loadNext })`; `await host.prepare()`; `adapter.getInstance().use(host.handler)`; `host.attachUpgrade(adapter.getHttpServer())`. `onApplicationShutdown` awaits `webHost?.close()` before `db.destroy()`. Body parser: return `next()` early when `!isBackendPath(req.path)`. Remove every remaining reference to `admin.enabled`, `admin.distDir`, `OPENCMS_ADMIN_DEV`, `DEFAULT_ADMIN_DIST_DIR` (grep `packages/ examples/ scripts/`).

- [ ] **Step 4: Run** `pnpm --filter @opencms/core exec tsc -p tsconfig.json --noEmit && pnpm vitest run packages/core` → PASS (admin build test may still be the old one and skip; fine until Task 4).

- [ ] **Step 5: Commit** — `feat(core)!: serve the project's Next app from Nest; drop the Vite SPA middleware and admin.* options`

---

### Task 3: Admin router and navigation without React Router

**Files:**
- Create: `packages/core/admin/src/router/match.ts` (pure), `packages/core/admin/src/router/routes.ts`, `packages/core/admin/src/lib/nav.tsx`
- Modify: every file importing `react-router` (`components/AppLayout.tsx`, `auth/AuthGate.tsx`, `pages/{Setup,Home,Builder,Login,UiKit,Content,NotFound}.tsx`); every file importing `@/…` (17 files) → relative imports
- Delete: `packages/core/admin/src/routes.tsx` (after `router/` replaces it; `main.tsx` is deleted in Task 4)
- Test: `packages/core/test/admin/router.test.ts`, `packages/core/test/admin/nav.test.ts`

**Interfaces:**
- Produces:
  - (match.ts):
    ```ts
    export type RouteId = 'uikit' | 'setup' | 'login' | 'home' | 'content' | 'builder' | 'users' | 'account' | 'notFound';
    export interface RouteMatch { id: RouteId; params: Record<string, string>; guarded: boolean }
    export function matchRoute(slug: string[] | undefined, opts?: { dev?: boolean }): RouteMatch;
    ```
    `dev` defaults to `process.env.NODE_ENV !== 'production'`. Table = spec §5.2; `guarded` false only for `setup`, `login`, `uikit`. Slug segments are matched as given (Next already decodes them).
  - (routes.ts) `export const pages: Record<RouteId, ComponentType>` built with `next/dynamic(() => import('../pages/X').then((m) => m.X), { ssr: false })`.
  - (nav.tsx) `adminHref(to: string): string`; `Link` (props of `next/link` with `to` instead of `href`, so call sites keep `to=`); `useAdminNavigate(): (to: string, opts?: { replace?: boolean }) => void`; `AdminParamsContext` + `useAdminParams(): Record<string, string>`; `Redirect({ to }: { to: string })`; `useAdminSearch(): string` (`'?' + searchParams` or `''`, replacing `useLocation().search`); `useAdminPathname(): string` (pathname with the `/admin` prefix stripped, `'/'` for the root — what `AppLayout.isActive` compared before).
- `AuthGate` now takes `{ children }` instead of rendering `<Outlet />`.

- [ ] **Step 1: Write failing tests**

`router.test.ts`: `matchRoute([])` and `matchRoute(undefined)` → `home`, guarded; `['setup']`, `['login']` unguarded; `['content','posts']` → `content` with `{ apiId: 'posts' }`; `['content']` and `['content','a','b']` → `notFound`; `['builder']`, `['users']`, `['account']`; `['nope']` → `notFound`, guarded; `['_ui']` → `uikit` with `{ dev: true }`, `notFound` with `{ dev: false }`.

`nav.test.ts`: `adminHref('/')` = `/admin`; `adminHref('/content/x')` = `/admin/content/x`; `adminHref('/builder?type=a')` = `/admin/builder?type=a`; `adminHref('builder')` = `/admin/builder`; `adminHref('/admin/x')` = `/admin/x` (never doubled).

- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/admin/router.test.ts packages/core/test/admin/nav.test.ts` → FAIL.

- [ ] **Step 3: Implement match.ts, routes.ts, nav.tsx; port call sites per spec §5.3**

Pages keep their logic; only imports and router calls change. `UiKit` drops `MemoryRouter` (`next/link` needs no router). `Login` reads the query via `useAdminSearch()`.

- [ ] **Step 4: Run** the two tests → PASS; `pnpm vitest run packages/core/test/admin` → PASS; `grep -rn "react-router\|from '@/" packages/core/admin/src` → no output.

- [ ] **Step 5: Commit** — `refactor(admin): route matcher and next/navigation helpers instead of React Router`

---

### Task 4: Admin entries, theme, build output and package exports

**Files:**
- Create: `packages/core/admin/src/index.tsx` (`'use client'`, default export `AdminApp`), `packages/core/admin/src/Providers.tsx` (`'use client'`), `packages/core/admin/src/layout.tsx` (server), `packages/core/admin/src/styles/theme.css`
- Delete: `packages/core/admin/src/styles/globals.css`, `packages/core/admin/src/main.tsx`, `packages/core/admin/index.html`, `packages/core/admin/vite.config.mts`
- Modify: `packages/core/admin/tsconfig.json`, `packages/core/package.json`, `packages/core/admin/components.json` (css path), `packages/core/admin/DESIGN.md` (file paths, dev workflow), `pnpm-lock.yaml`
- Test: `packages/core/test/admin/build.test.ts` (rewrite)

**Interfaces:**
- Consumes: `matchRoute`, `pages`, `AdminParamsContext`, `AuthGate({ children })` from Task 3.
- Produces: package exports `@opencms/core/admin` (default `AdminApp`), `@opencms/core/admin/layout` (default `AdminLayout`, named `metadata`), `@opencms/core/admin/theme.css`.

- [ ] **Step 1: Rewrite `build.test.ts` (failing)**

Skipped unless `dist/admin/index.js` exists (keep the existing skip/hint pattern). Assertions: `dist/admin/index.js` and `dist/admin/layout.js` exist; `index.js` starts with `"use client"` (single or double quotes); `layout.js` does not contain `use client`; `dist/admin/styles/theme.css` matches `--primary:\s*#2f5bea` in `:root` and `--primary:\s*#7b9cff` in `.dark`; `dist/admin/index.d.ts` exists; no `dist/admin/package.json`; no file under `dist/admin` contains `react-router` or `from "@/`; `require('@opencms/core/package.json').exports` has keys `.`, `./admin`, `./admin/layout`, `./admin/theme.css`.

- [ ] **Step 2: Run** `pnpm --filter @opencms/core build; pnpm vitest run packages/core/test/admin/build.test.ts` → FAIL.

- [ ] **Step 3: Implement**

- `AdminApp`: `useParams<{ slug?: string[] }>()` → `matchRoute` → render `pages[id]` inside `AdminParamsContext`, wrapped in `<AuthGate>` when `guarded`.
- `Providers`: `TooltipProvider` + `Toaster`, runs `applyTheme()`/`watchSystemTheme()` in an effect.
- `AdminLayout`: async server component; reads `(await headers()).get('content-security-policy')`, extracts the nonce with `/'nonce-([^']+)'/`; renders `<html lang="en" suppressHydrationWarning><head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head><body data-opencms-admin=""><Providers>{children}</Providers></body></html>`; `THEME_SCRIPT` is the script from the deleted `index.html` verbatim. `metadata = { title: 'OpenCMS Admin', robots: { index: false, follow: false } }`.
- `theme.css` = old `globals.css` minus `@import "tailwindcss"` (keep `tw-animate-css` import, tokens, `@theme`, base).
- `admin/tsconfig.json`: `noEmit: false`, `outDir: ../dist/admin`, `rootDir: src`, `declaration: true`, `jsx: react-jsx`, `module: ESNext`, `moduleResolution: bundler`, `types: ["node"]`, drop `paths`/`baseUrl`/vite types, `include: ["src"]`.
- `package.json`: `exports` per spec §3.2 (`./admin/theme.css` with `style` and `default` conditions); scripts `build` = `tsc -p tsconfig.json && tsc -p admin/tsconfig.json && node -e "require('fs').cpSync('admin/src/styles/theme.css','dist/admin/styles/theme.css')"`, `dev:admin` = `tsc -w -p admin/tsconfig.json`, `typecheck` keeps both tsconfigs; move the UI runtime libs of spec §3.2 to `dependencies`; add `next` to devDependencies and optional peers `next`/`react`/`react-dom`; remove `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `react-router`. Run `pnpm install`.

- [ ] **Step 4: Run** `pnpm --filter @opencms/core build && pnpm --filter @opencms/core typecheck && pnpm vitest run packages/core` → PASS (build test not skipped).

- [ ] **Step 5: Commit** — `feat(admin)!: ship the admin as Next App Router modules from @opencms/core/admin`

---

### Task 5: `examples/my-store` runs the shared Next app (first end-to-end check)

**Files:**
- Create: `examples/my-store/app/(admin)/layout.tsx`, `examples/my-store/app/(admin)/admin/[[...slug]]/page.tsx`, `examples/my-store/app/(site)/layout.tsx`, `examples/my-store/app/(site)/page.tsx`, `examples/my-store/app/globals.css`, `examples/my-store/next.config.ts`, `examples/my-store/postcss.config.mjs`, `examples/my-store/next-env.d.ts`, `examples/my-store/tsconfig.server.json`
- Modify: `examples/my-store/tsconfig.json` (becomes the Next one), `examples/my-store/package.json`, `examples/my-store/src/main.ts`, `examples/my-store/.gitignore` (or root `.gitignore`: `.next/`), `.github/workflows/ci.yml` (`my-store typecheck` script now uses `tsconfig.server.json`), `pnpm-lock.yaml`

**Interfaces:**
- Consumes: package exports from Task 4; `web` option from Task 2.
- Produces: the exact file contents Task 6 turns into templates (layout re-export per spec §5.1, `globals.css` per §5.4, sample page per §6.1 with marker text `data-opencms-site` on `<main>`).

- [ ] **Step 1: Add the files and scripts**

`package.json`: deps `next`, `react`, `react-dom`, `cross-env`; devDeps `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `@types/react`, `@types/react-dom`; scripts `dev` = `opencms migrate:up && tsx --tsconfig tsconfig.server.json src/main.ts`, `build` = `tsc -p tsconfig.server.json && next build`, `start` = `cross-env NODE_ENV=production node dist/src/main.js`, `typecheck` = `tsc -p tsconfig.server.json --noEmit`. `main.ts` passes nothing new if `app.module.ts` sets `web: { dir: findProjectRoot(__dirname) }` — put `findProjectRoot` where `app.module.ts` can use it (export it from `main.ts`'s sibling `src/root.ts`). Boot log: `OpenCMS ready at <publicUrl>` and `Admin: <publicUrl>/admin`. `next.config.ts` sets `turbopack.root` and `outputFileTracingRoot` to the monorepo root (`path.resolve(__dirname, '../..')`).

- [ ] **Step 2: Verify the production build**

Run: `pnpm --filter @opencms/core build && pnpm --filter my-store build`
Expected: exit 0; `examples/my-store/.next/BUILD_ID` exists. If Next rejects the layout re-export, fix the template here (spec §9.3) before continuing.

- [ ] **Step 3: Verify the running app (prod)**

Run my-store with `NODE_ENV=production OPENCMS_PUBLIC_URL=http://localhost:4000 pnpm --filter my-store start` (DB migrated) and check with curl:
- `curl -si localhost:4000/` → 200, body contains `data-opencms-site`, no `content-security-policy` header.
- `curl -si localhost:4000/admin` → 200, `content-security-policy` contains `'nonce-N'`, `x-robots-tag: noindex`, body contains `data-opencms-admin`, and every `<script` tag in the body carries `nonce="N"` (spec §9.4 — if not, stop and report; do not switch mechanisms silently).
- `curl -si localhost:4000/api/auth/me` → 409 `setup_required`.
- An `/_next/static/…` URL from the admin HTML → 200 with `immutable`.

- [ ] **Step 4: Verify dev mode**

`pnpm --filter my-store dev`, then `curl -si localhost:4000/admin` → 200 with `'unsafe-eval'` in CSP; editing `app/(site)/page.tsx` text shows up on the next `curl localhost:4000/`.

- [ ] **Step 5: Commit** — `feat(example): my-store runs admin and website from one Next app inside Nest`

---

### Task 6: `opencms init` scaffolds the Next app

**Files:**
- Modify: `packages/cli/src/init/templates.ts`, `packages/cli/src/init/index.ts`, `packages/cli/test/init.test.ts`

**Interfaces:**
- Consumes: Task 5 file contents (as templates, `title` = project name).
- Produces: template functions `adminLayoutTsx()`, `adminPageTsx()`, `siteLayoutTsx(name: string)`, `sitePageTsx(name: string)`, `globalsCss()`, `nextConfigTs(link?: { root: string })`, `postcssConfig()`, `nextEnvDts()`, `tsconfigNextJson()`, `tsconfigServerJson()` (the current `tsconfigJson()` renamed); `packageJson` scripts per spec §6.2 (dev uses `tsx --tsconfig tsconfig.server.json`).

- [ ] **Step 1: Update `init.test.ts` (failing)**

- "writes exactly the files of the spec": add `app/(admin)/layout.tsx`, `app/(admin)/admin/[[...slug]]/page.tsx`, `app/(site)/layout.tsx`, `app/(site)/page.tsx`, `app/globals.css`, `next.config.ts`, `postcss.config.mjs`, `next-env.d.ts`, `tsconfig.server.json` to the expected list.
- `package.json`: deps include `next`, `react`, `react-dom`, `cross-env`; devDeps include `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `@types/react`, `@types/react-dom`; scripts equal spec §6.2.
- `tsconfig.server.json` has `experimentalDecorators: true` and `include: ['src', 'opencms.config.ts']`; `tsconfig.json` has `jsx: 'preserve'` and `moduleResolution: 'bundler'`.
- `.gitignore` contains `.next/`.
- `--link`: `next`, `react`, `react-dom` are `link:` paths resolved through `resolveFromCore`; `next.config.ts` contains `turbopack` and `outputFileTracingRoot` with the common ancestor of project and repo. Without `--link`, `next.config.ts` has neither.
- `src/main.ts` logs `Admin: ` and `app.module.ts` passes `web: { dir: … }`.

- [ ] **Step 2: Run** `pnpm vitest run packages/cli/test/init.test.ts` → FAIL.

- [ ] **Step 3: Implement templates and `runInit` changes** (add `next`/`react`/`react-dom` to the `--link` shared list; README template per spec §6.3).

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit** — `feat(cli): init scaffolds one Next app for admin and website`

---

### Task 7: Smoke test, CI and docs

**Files:**
- Modify: `scripts/smoke-init.mjs`, `.github/workflows/ci.yml` (if steps change), `README.md`, `packages/core/README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Update the smoke script**

After install: typecheck with `tsc -p tsconfig.server.json --noEmit --preserveSymlinks`; run the project's `build` script (`node node_modules/typescript/bin/tsc -p tsconfig.server.json` then `node node_modules/next/dist/bin/next build`); start `node dist/src/main.js` with `NODE_ENV=production`, `OPENCMS_PUBLIC_URL=http://localhost:<port>`. New assertions before the auth flow:
- `GET /` → 200 `text/html`, contains `data-opencms-site`, no `content-security-policy`.
- `GET /admin/` (redirect manual) → 308, `location` ends with `/admin`.
- `GET /admin` → 200, CSP has `'nonce-N'`, every `<script` has `nonce="N"`, `x-robots-tag: noindex`, contains `data-opencms-admin` (replaces the `<div id="root">` check).
- First `/_next/static/` URL in that HTML → 200, `cache-control` contains `immutable`.
Keep the existing setup → login → me → logout flow unchanged.

- [ ] **Step 2: Run** `pg_ctlcluster 16 main start; pnpm build && node scripts/smoke-init.mjs` → ends with PASS.

- [ ] **Step 3: Docs**

`CHANGELOG.md`: breaking changes (spec §7 list) and the migration steps. `README.md` + `packages/core/README.md`: architecture (one Next app inside Nest), `web` option, dev workflow for core contributors (spec §5.5), `NODE_ENV=production` + `build` before `start`, single-instance `.next/cache` limit. Remove every mention of Vite, `OPENCMS_ADMIN_DEV`, `admin.enabled`.

- [ ] **Step 4: Full verification**

Run: `pnpm build && pnpm test && node scripts/smoke-init.mjs && pnpm --filter my-store typecheck`
Expected: all exit 0; `grep -rn "vite\|react-router\|OPENCMS_ADMIN_DEV" --include=*.ts --include=*.tsx --include=*.json --include=*.md --include=*.mjs . | grep -v node_modules | grep -v docs/superpowers | grep -v CHANGELOG` → no output.

- [ ] **Step 5: Commit and push** — `test: smoke covers the embedded Next app; docs and changelog`; `git push`.
