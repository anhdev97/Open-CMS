# Embedded admin + auth wiring + design system + `opencms init` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the admin UI as a Vite + React SPA inside `@opencms/core`, served at `/admin` by the project's NestJS server, with `@opencms/oauth2` wired in, a shadcn/ui + Tailwind v4 design system, and an `opencms init` command that produces a project which runs UI + API from one URL.

**Architecture:** `packages/core/admin/` is a Vite project built into `packages/core/dist/admin`. `OpenCmsModule` imports `OAuth2Module`, serves the SPA through an Express middleware (Vite middleware mode in dev), owns the JSON body parser (skipping `/oauth2`), adds CORS for `/api/content` only, and signals `CORE_READY` to the auth provider after the migration check. `opencms init` writes a standalone project modelled on `examples/my-store`.

**Tech Stack:** NestJS 11, Kysely, Postgres 16, `@opencms/oauth2` (this branch), Vite, React 19, React Router, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (Radix), lucide-react, sonner, react-hook-form + zod, vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-embedded-admin-init-design.md` (binding; `§` numbers below point there). Background: `docs/superpowers/specs/2026-10-14-auth-oauth2-design.md` (auth spec).

**Repo facts (verified, apply to every task):**
- Branch `feat/oauth2`. Monorepo pnpm, TypeScript CommonJS (`tsconfig.base.json`). Tests: from repo root `pnpm vitest run <path>`; root `vitest.config.ts` includes `packages/*/test/**/*.test.ts`. Postgres 16 local `postgres:postgres@localhost:5432`, no Docker; `packages/oauth2/test/support/db.ts` `startTestDb()` creates/drops a temp DB.
- NestJS under vitest has no decorator metadata → every constructor param uses explicit `@Inject(Token)` (existing convention).
- `packages/core` and `packages/cli` consume `@opencms/db`/`@opencms/oauth2` through their built `dist/`: run `pnpm build` after changing db/oauth2 before testing core/cli.
- `@opencms/oauth2`: `OAuth2Module.forRoot({ dbToken, auth?, env?, publicPathPrefixes? })` (`src/oauth2.module.ts`); config in `src/config/schema.ts` (`loadConfig(env, file)`, currently requires `OPENCMS_PUBLIC_URL`, has `internalUrl` from `OPENCMS_INTERNAL_URL`/file/`http://127.0.0.1:${PORT ?? 3000}`); `ApiExceptionFilter` + `AuthExceptionFilter` in `src/errors.ts` (APP_FILTER); `ProviderService.onModuleInit` (`src/provider/provider.service.ts`) builds keys/client/provider, runs bootstrap and mounts `provider.callback()` with `http.getInstance().use('/oauth2', …)`; decorators `@Public()`, `@RequireRole()`, `@CurrentUser()` in `src/guard/*`; test helper `createTestApp(env, opts)` in `test/support/app.ts`, `loginAs(app, email, pw)` in `test/support/login.ts`.
- `@opencms/core`: `OpenCmsModule.forRoot(OpenCmsModuleOptions)` (`src/opencms.module.ts`, `global: true`, provides `OPENCMS_DB`, `onModuleInit` checks pending migrations / autoMigrate); legacy `AdminGuard` in `src/content.controllers.ts`, used by `AdminContentController`, `SchemaController`, `SystemController`; option `adminToken` in `src/options.ts`.
- `apps/admin`: Next.js app (pages `app/page.tsx`, `app/content/[apiId]/page.tsx`, `app/builder/page.tsx`, components `Sidebar.tsx`, `FieldInput.tsx`, `lib/api.ts`, `app/globals.css`); all client components; only `next/link` and `next/navigation` are Next-specific.
- `packages/cli/src/index.ts`: commander program; first line imports `@opencms/oauth2/migrations`; `findProjectRoot`/`loadConfig` from `@opencms/codegen`; `@opencms/codegen` exports `generateCode`, `writeGeneratedFiles`, `writeSnapshot`, `emptySnapshot`.
- Frontend package versions available on the registry today (use caret ranges of these majors; if two of them are incompatible at install time, pin the older compatible major and note it in the report): `vite@^8` (fallback `^7`), `@vitejs/plugin-react@^6`, `react@^19.3`, `react-dom@^19.3`, `react-router@^8` (verify `createBrowserRouter`/`RouterProvider`/`Link`/`useNavigate` exports of the installed major), `tailwindcss@^4.3`, `@tailwindcss/vite@^4.3`, `shadcn@^4` (CLI, run via `pnpm dlx`), `lucide-react`, `sonner@^2`, `react-hook-form@^7`, `@hookform/resolvers@^5`, `tw-animate-css@^1`, `class-variance-authority`, `clsx`, `tailwind-merge`.

## Global Constraints

- One user-facing URL. Fixed paths: UI `/admin`, API `/api`, auth `/oauth2`, delivery API `/api/content`. No setting changes them.
- `OPENCMS_PUBLIC_URL` optional when `NODE_ENV !== 'production'` (default `http://localhost:${PORT ?? 4000}`); required in production (refuse to start). `OPENCMS_INTERNAL_URL` and the `internalUrl` config key are removed; the BFF always calls `http://127.0.0.1:${PORT ?? 4000}`. Default `PORT` is 4000 everywhere.
- Error body for every `/api/**` failure: `{ "error": { "code": string, "message": string, "issues"?: unknown[] } }`.
- `/admin` serving (§3.3): `GET /admin` → 308 `/admin/`; `/admin/assets/<existing file>` → `Cache-Control: public, max-age=31536000, immutable`; missing asset → 404; any other GET/HEAD under `/admin/` → `index.html` with `Cache-Control: no-store`, `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`; other methods → 405; path traversal (`..`, encoded, symlink out) blocked; missing build → WARN once + 503 HTML "Admin UI chưa được build. Chạy `pnpm build` trong `@opencms/core`."; `admin.enabled: false` → not registered (404).
- CORS (`cors.origins`, exact origins, no wildcard): only `/api/content/**`, only `GET, HEAD, OPTIONS`, no credentials; no CORS headers anywhere else.
- Dev UI mode: `OPENCMS_ADMIN_DEV=1` → Vite middleware mode inside Nest at `/admin`; `vite` loaded by dynamic `import()` only in this mode; `/admin/_ui` exists only in this mode.
- Frontend libraries are `devDependencies` of `@opencms/core` (bundled into `dist/admin`).
- UI text is English and lives only in `admin/src/i18n/en.ts`. No hex/`rgb()` colours outside `admin/src/styles/globals.css`. Icons only `lucide-react`. Every interactive element keyboard-usable with visible focus ring.
- Colour tokens: exactly the table in spec §6.2 (light and dark values, `--radius: 0.5rem`). Font stacks as §6.1.
- `opencms init` flags/defaults exactly §7.1; generated files exactly §7.2; `OPENCMS_SECRET` = 32 random bytes base64url; never overwrite a non-empty directory.
- Breaking changes (README + CHANGELOG): `adminToken`/`OPENCMS_ADMIN_TOKEN` removed, admin CORS removed, `/api/**` error format, `OPENCMS_INTERNAL_URL` removed.
- No Playwright. Browser rendering is checked by typecheck, build and the dev-only `/admin/_ui` page.

## Review Focus

1. **Deep-link reload** (`/admin/content/product?status=draft` typed into the address bar, or refreshed): must serve `index.html` and its asset URLs must resolve under `/admin/assets/…`, not `/content/assets/…`. Test in Task 5 (fallback for nested path) and Task 6 (build emits absolute `/admin/assets/` URLs).
2. **`init` with a directory name that is not a valid npm/DB name** (`My Shop`, `shop-2026`, `./sites/Shop`): package `name` must be a valid lowercase npm name and the default DB name `[a-z0-9_]`. Test in Task 13.
3. **Running an `opencms` command from a sub-directory of the project** (`src/content-types`): `.env` is loaded from the project root found by `findProjectRoot`, and existing env vars win. Test in Task 13.
4. **Opening `/admin/login` from a bookmark (no `uid`) or with an unknown `?error=` code**: the app must redirect to `/api/auth/login` / show the generic message, never a blank page. Test in Task 9 (pure helpers `loginPageAction(search)` and `errorMessage(code)`).
5. **Dev with a non-default `PORT`** (`PORT=5000`, no `OPENCMS_PUBLIC_URL`): public URL, issuer, cookie and Origin check all use `:5000`. Test in Task 1.

---

## File structure (new / changed)

```
packages/oauth2/src/config/schema.ts            (T1) URL defaults, drop internalUrl config
packages/oauth2/src/errors.ts                   (T2) keep issues, scope
packages/oauth2/src/constants.ts                (T2) CORE_READY token
packages/oauth2/src/provider/provider.service.ts(T2) await CORE_READY
packages/core/src/opencms.module.ts             (T3,T4,T5) wiring
packages/core/src/options.ts                    (T3) auth/admin/cors options, drop adminToken
packages/core/src/content.controllers.ts        (T3) drop AdminGuard, @RequireRole
packages/core/src/schema-builder.ts, system.controller.ts (T3)
packages/core/src/http/body-parser.middleware.ts(T4)
packages/core/src/http/content-cors.middleware.ts(T4)
packages/core/src/http/admin-spa.middleware.ts  (T5, T7)
packages/core/test/support/core-app.ts          (T3) test app helper
packages/core/admin/**                          (T6–T11) SPA
packages/core/package.json, tsconfig.json, admin/tsconfig.json (T6)
packages/cli/src/env.ts, src/init/*.ts, src/index.ts (T13)
scripts/smoke-init.mjs, .github/workflows/ci.yml (T14)
apps/admin/** deleted, pnpm-workspace.yaml, examples/my-store/** (T12)
README.md, packages/oauth2/README.md, packages/core/README.md, CHANGELOG.md, auth spec §5/§8 (T14)
```

---

### Task 1: oauth2 URL configuration (E3/E4)

**Files:** Modify `packages/oauth2/src/config/schema.ts`, `packages/oauth2/src/bff/oidc-client.ts` (only if it reads env), `packages/oauth2/test/support/app.ts`, `packages/oauth2/test/unit/config.test.ts`, `packages/oauth2/test/integration/bff-login.test.ts`.

**Interfaces:**
- `OAuth2Config.publicUrl: string` and `OAuth2Config.internalUrl: string` stay as fields of the resolved config (internal use), but `AuthFileConfig` loses `internalUrl` and `OPENCMS_INTERNAL_URL` is no longer read.
- `loadConfig(env, file)` rules: `port = Number(env.PORT) || 4000`; `internalUrl = http://127.0.0.1:${port}`; `publicUrl = env.OPENCMS_PUBLIC_URL || file.publicUrl || (env.NODE_ENV === 'production' ? throw ConfigError('OPENCMS_PUBLIC_URL is required when NODE_ENV=production') : http://localhost:${port})`.

- [ ] **Step 1: tests (config.test.ts)** — replace the old internalUrl tests with: no PUBLIC_URL, no NODE_ENV → `publicUrl === 'http://localhost:4000'`, `internalUrl === 'http://127.0.0.1:4000'`; `PORT='5000'` → both use `:5000`; `NODE_ENV='production'` without PUBLIC_URL → throws `ConfigError` whose message contains `OPENCMS_PUBLIC_URL`; `OPENCMS_INTERNAL_URL='http://app:8080'` is ignored (`internalUrl` stays loopback); trailing-slash normalisation of PUBLIC_URL still works.
- [ ] **Step 2:** `pnpm vitest run packages/oauth2/test/unit/config.test.ts` → FAIL.
- [ ] **Step 3:** implement. `createTestApp` stops passing `OPENCMS_INTERNAL_URL` (PORT already equals the listen port). The bff-login test "BFF with an unreachable internalUrl" now sets `PORT` to a closed port while listening elsewhere (pass the listen port separately through a new optional `opts.listenPort` of `createTestApp`, default = PORT) — keep its assertion (callback → `/admin/login?error=login_failed`).
- [ ] **Step 4:** `pnpm vitest run packages/oauth2` → all pass; `pnpm --filter @opencms/oauth2 typecheck`.
- [ ] **Step 5:** commit `feat(oauth2): one public URL, dev default from PORT, drop OPENCMS_INTERNAL_URL`.

### Task 2: oauth2 error filter keeps `issues`; `CORE_READY`

**Files:** Modify `packages/oauth2/src/errors.ts`, `src/constants.ts`, `src/provider/provider.service.ts`, `src/oauth2.module.ts`, `src/index.ts`; Test `packages/oauth2/test/integration/api-errors.test.ts`, new `test/integration/core-ready.test.ts`.

**Interfaces:**
- `sendError(host, status, code, message, issues?)`; JSON omits `issues` when undefined.
- For an `HttpException` whose `getResponse()` is an object: `issues = Array.isArray(body.issues) ? body.issues : undefined`; if `body.message` is an array → `message = body.message.join('; ')` and `issues = issues ?? body.message`.
- Non-HTTP host or non-`/api` path: delegate to `BaseExceptionFilter` (unchanged). Verify with a test that an app filter registered with `app.useGlobalFilters(AppCatchAll)` after `createNestApplication` receives errors from a non-`/api` route; if Nest gives the module's APP_FILTER precedence and the app filter never runs, change the delegation so it does (e.g. rethrow is impossible in a filter — instead export `ApiExceptionFilter` and stop registering it as APP_FILTER when `OAuth2ModuleOptions.registerErrorFilter === false`; report which mechanism you used).
- `export const CORE_READY = Symbol('CORE_READY')` (in `constants.ts`, exported from `src/index.ts`). `OAuth2Module` provides `{ provide: CORE_READY, useValue: Promise.resolve() }` only when `OAuth2ModuleOptions.coreReady` is not given; `OAuth2ModuleOptions.coreReady?: InjectionToken` → `{ provide: CORE_READY, useExisting: opts.coreReady }`. `ProviderService.onModuleInit` first does `await this.moduleRef.get(CORE_READY, { strict: false })`.

- [ ] **Step 1: tests** — api-errors: a test controller throwing `new BadRequestException({ message: 'Invalid schema', issues: ['a: bad'] })` under `/api/x` → 400 `{ error: { code: 'bad_request', message: 'Invalid schema', issues: ['a: bad'] } }`; one throwing `BadRequestException(['x must be string','y missing'])` → `message: 'x must be string; y missing'`, `issues` equal to the array; existing four mappings still pass; non-`/api` route error reaches an app-level catch-all filter (assert the app filter's marker response). core-ready: `createTestApp` variant with `coreReady` token whose promise rejects `new Error('run opencms migrate:up')` → `createTestApp` rejects with that message and `auth_signing_keys` was never queried (DB has no rows / spy on adapter not needed: assert table empty).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `pnpm vitest run packages/oauth2` pass + typecheck. **Step 5:** commit `feat(oauth2): keep error issues, CORE_READY gate before provider init`.

### Task 3: Wire OAuth2Module into OpenCmsModule; drop AdminGuard

**Files:** Modify `packages/core/src/opencms.module.ts`, `src/options.ts`, `src/content.controllers.ts`, `src/schema-builder.ts`, `src/system.controller.ts`, `src/index.ts`; Create `packages/core/test/support/core-app.ts`, `packages/core/test/integration/auth-wiring.test.ts`.

**Interfaces:**
- `OpenCmsModuleOptions` adds `auth?: Partial<AuthFileConfig>`, `admin?: { enabled?: boolean; distDir?: string }` (`distDir` undocumented, for tests), `cors?: { origins: string[] }`, `env?: NodeJS.ProcessEnv` (default `process.env`, passed to OAuth2Module); removes `adminToken`.
- `OpenCmsModule.forRoot` imports `OAuth2Module.forRoot({ dbToken: OPENCMS_DB, coreReady: CORE_READY_CORE, publicPathPrefixes: ['/api/content/'], auth: input.auth, env: input.env })`; core provides `CORE_READY_CORE` (Symbol) as a deferred promise resolved/rejected by `OpenCmsModule.onModuleInit` after the existing pending-migration check (reject with the existing "Run `opencms migrate:up`…" Error).
- Admin controllers: class-level `@RequireRole('super_admin')` replaces `@UseGuards(AdminGuard)`. `ContentController` (`/api/content`) untouched (public via prefix).
- `createCoreTestApp(opts)` in `test/support/core-app.ts`: creates a temp project root (`opencms.config` not needed — pass `config` object), temp DB via oauth2's `startTestDb` (import from `../../../oauth2/test/support/db`), runs `migrateUp` (core stream) unless `opts.migrate === false`, boots `OpenCmsModule.forRoot({ root, config: { database: { url } }, contentTypes: opts.contentTypes ?? [], env, admin: opts.admin, cors: opts.cors, schemaEditable: true })` on a free port with `PORT`/`OPENCMS_SECRET` env; returns `{ app, url, db, close }`.

- [ ] **Step 1: tests (auth-wiring.test.ts)** — `GET /api/admin/content-types` without cookie → 401 `{ error: { code: 'unauthenticated' } }`; after setup + `loginAs` (reuse oauth2 `test/support/login.ts`) → 200; `GET /api/content/<type>` (define one content type `article` with a migration applied — or assert 404 `not_found` for an unknown type, proving the route is public: must NOT be 401) → not 401; `POST /api/admin/content-types` with an invalid definition (logged in) → 400 body `error.issues` non-empty array; fresh DB with `migrate: false` → `createCoreTestApp` rejects with a message containing `opencms migrate:up` and not containing `relation`.
- [ ] **Step 2:** `pnpm build` (oauth2 dist) then `pnpm vitest run packages/core/test/integration/auth-wiring.test.ts` → FAIL.
- [ ] **Step 3:** implement; remove `adminToken` everywhere in core; `pnpm --filter @opencms/core typecheck`.
- [ ] **Step 4:** run core tests + `packages/core/test/core-migrations.test.ts` → pass.
- [ ] **Step 5:** commit `feat(core): wire OAuth2Module, require super_admin on admin APIs, drop adminToken`.

### Task 4: Body parser owned by core (skip `/oauth2`); CORS for `/api/content`

**Files:** Create `packages/core/src/http/body-parser.middleware.ts`, `packages/core/src/http/content-cors.middleware.ts`; Modify `src/opencms.module.ts` (implement `NestModule.configure`); Test `packages/core/test/integration/http.test.ts`.

**Interfaces:**
- `OpenCmsModule implements NestModule`; `configure(consumer)` applies `JsonBodyParserMiddleware` (express.json `{ limit: '1mb' }` + urlencoded `{ extended: false, limit: '1mb' }`) to all routes **except** paths starting `/oauth2/` (check `req.path` inside the middleware rather than relying on Nest exclude patterns; skip when `req.body` is already set by a host parser), and `ContentCorsMiddleware` for `api/content/*`.
- Hosts create the app with `NestFactory.create(AppModule, { bodyParser: false })` (templates in Task 12/13); `createCoreTestApp` does the same.
- CORS: request `Origin` in `cors.origins` → `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Max-Age: 600`; `OPTIONS` → 204; never `Access-Control-Allow-Credentials`; unknown origin or no `cors` → no CORS headers (OPTIONS still 204 without headers). Non-`/api/content` paths: middleware not applied.

- [ ] **Step 1: tests** — JSON POST to `/api/admin/content-types/plan` (logged in) parses; malformed JSON → 422 `validation_failed`; a 2 MB JSON body → 413 `payload_too_large`; the oidc-provider token endpoint still works (full `loginAs` succeeds) and no "already parsed request body" warning is printed (spy on `console.warn`/`process.emitWarning` during login); CORS: allowed origin on `GET /api/content/x` gets the headers above; disallowed origin none; `OPTIONS /api/admin/content-types` with allowed origin has no `Access-Control-Allow-Origin`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** pass + typecheck. **Step 5:** commit `feat(core): own JSON body parser outside /oauth2, CORS for delivery API`.

### Task 5: `AdminSpaMiddleware` (production serving)

**Files:** Create `packages/core/src/http/admin-spa.middleware.ts`; Modify `src/opencms.module.ts`; Test `packages/core/test/integration/admin-spa.test.ts` (fixture dir `packages/core/test/fixtures/admin-dist/` with `index.html` containing `<div id="root"></div>` and `assets/app-abc123.js`).

**Interfaces:**
- `createAdminSpaHandler(opts: { distDir: string; logger: { warn(msg: string): void } }): (req, res, next) => void` (pure Express handler, unit-testable), mounted by `OpenCmsModule` via `http.getInstance().use('/admin', handler)` inside `onModuleInit` **before** returning (after CORE_READY resolution is fine). Default `distDir = path.join(__dirname, '..', 'admin')` (tsc emits `dist/http/admin-spa.middleware.js`, so this is `dist/admin`, which contains only Vite's output — no compiled server code ever lives in `dist/admin`).
- Behaviour exactly as Global Constraints. Resolve files with `fs.realpathSync` and require the result to start with `realpath(distDir) + path.sep`.

- [ ] **Step 1: tests** — every row of §3.3 table and Global Constraints: 308 `/admin` → `/admin/`; `/admin/assets/app-abc123.js` 200 + immutable + JS content-type; `/admin/assets/nope.js` 404; `/admin/content/product?status=draft` → index.html + no-store + all five security headers; `/admin/%2e%2e/package.json` and `/admin/assets/../../package.json` → not the file (404 or index.html, never file content); a symlink in fixture `assets/` pointing outside → 404; `POST /admin/x` → 405; `distDir` without index.html → 503 HTML containing `pnpm build` and the WARN logged once across two requests; `admin.enabled: false` → `/admin/` 404.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** pass. **Step 5:** commit `feat(core): serve the admin SPA at /admin`.

### Task 6: Admin SPA scaffold + design-system foundation

**Files:** Create `packages/core/admin/{index.html,vite.config.ts,tsconfig.json,components.json}`, `admin/src/main.tsx`, `admin/src/routes.tsx` (placeholder routes), `admin/src/styles/globals.css`, `admin/src/lib/utils.ts`, `admin/src/lib/theme.ts`, `admin/src/i18n/en.ts`, `admin/src/components/ui/*` (shadcn: button, input, textarea, label, select, checkbox, switch, form, card, table, badge, alert, separator, skeleton, tooltip, dialog, alert-dialog, dropdown-menu, tabs, sonner, sidebar — the sidebar generator also adds sheet/use-mobile etc.; keep what it adds); Modify `packages/core/package.json` (scripts, devDependencies), `packages/core/tsconfig.json` (exclude `admin`); Test `packages/core/test/admin/build.test.ts`.

**Interfaces / decisions:**
- `vite.config.ts`: `root: __dirname`, `base: '/admin/'`, plugins `react()`, `tailwindcss()`, `resolve.alias['@'] = admin/src`, `build.outDir = ../dist/admin`, `build.emptyOutDir = true` (safe: `dist/admin` holds only the SPA), `build.assetsDir = 'assets'`.
- `packages/core/package.json` scripts: `"build": "tsc -p tsconfig.json && vite build --config admin/vite.config.ts"`, `"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p admin/tsconfig.json --noEmit"`. Frontend deps go to `devDependencies` (versions per repo facts).
- `globals.css`: `@import "tailwindcss"; @import "tw-animate-css"; @custom-variant dark (&:where(.dark, .dark *));` then `:root` / `.dark` blocks with **exactly** the spec §6.2 tokens (hex values), `@theme inline` mapping every token to `--color-*` (including `success`, `success-soft`, `warning`, `warning-soft`, `destructive-soft`, `sidebar-*`, `chart-1..5`), radius scale `--radius-sm: calc(var(--radius) - 4px)`, `md: -2px`, `lg: var(--radius)`, `xl: +4px`, font stacks §6.1 as `--font-sans`/`--font-mono`, and a base layer (`border-border`, `bg-background text-foreground`, `outline-ring/50` focus).
- `components.json` exactly §6.1. Add components with `pnpm dlx shadcn@latest add <names> --cwd packages/core/admin` (if the CLI cannot run offline, write the components from the shadcn new-york source for React 19 + Tailwind v4 by hand; report which). Then extend `badge` and `alert` with variants `success` and `warning` (`bg-success-soft text-success`, `bg-warning-soft text-warning`), `alert` variant `destructive` uses `bg-destructive-soft text-destructive`.
- `theme.ts`: `type Theme = 'light' | 'dark' | 'system'`, `getTheme()`, `setTheme(t)`, `applyTheme()`; storage key `opencms-theme`; every `localStorage` access in try/catch. `index.html` has an inline script (same logic, minimal) setting `.dark` before paint, and `<div id="root"></div>`.
- `main.tsx`: `RouterProvider` with `createBrowserRouter(routes, { basename: '/admin' })`, `<Toaster />` (sonner), `TooltipProvider`.
- `en.ts`: `export const en = {...}` and `t(key: string, vars?: Record<string,string|number>): string` (dot path, `{name}` interpolation, returns the key when missing).

- [ ] **Step 1: test (build.test.ts)** — after `pnpm --filter @opencms/core build`: `dist/admin/index.html` exists, contains `<div id="root">` and `src="/admin/assets/` (absolute base, Review Focus 1); `dist/http/admin-spa.middleware.js` exists; the built CSS contains `--primary:#2f5bea` or `--primary: #2f5bea` (light) and `#7b9cff` (dark). Test reads files; it is skipped (`it.skipIf`) when `dist/admin/index.html` is missing, with a message telling to run the build — CI runs build before tests.
- [ ] **Step 2:** build fails/absent → FAIL. **Step 3:** implement. **Step 4:** `pnpm --filter @opencms/core build && pnpm --filter @opencms/core typecheck && pnpm vitest run packages/core/test/admin/build.test.ts` → pass; check that no hex colour appears in `admin/src` outside `styles/globals.css` (`grep -rnE "#[0-9a-fA-F]{3,8}\b" packages/core/admin/src --include=*.tsx --include=*.ts` → empty). **Step 5:** commit `feat(admin): Vite SPA scaffold, Tailwind v4 tokens, shadcn components`.

### Task 7: Dev UI mode (Vite middleware inside Nest)

**Files:** Modify `packages/core/src/http/admin-spa.middleware.ts`, `src/opencms.module.ts`; Test `packages/core/test/integration/admin-dev.test.ts`.

**Interfaces:** `createAdminDevHandler(opts: { root: string; httpServer: import('http').Server }): Promise<Handler>` — `const { createServer } = await import('vite')`; `createServer({ root, configFile: path.join(root, 'vite.config.ts'), base: '/admin/', server: { middlewareMode: true, hmr: { server: opts.httpServer } }, appType: 'spa' })`; returns `vite.middlewares`; closes the Vite server on app shutdown. `OpenCmsModule` chooses it when `env.OPENCMS_ADMIN_DEV === '1'`; `root` = `path.resolve(__dirname, '../../admin')` (from `dist/http/` → `packages/core/admin`). If `vite` cannot be imported (installed package without devDependencies) → log error "OPENCMS_ADMIN_DEV requires the @opencms/core source checkout" and fall back to the production handler.

- [ ] **Step 1: test** — `createCoreTestApp({ env: { OPENCMS_ADMIN_DEV: '1' } })` → `GET /admin/` 200 HTML containing `/@vite/client`; `GET /admin/src/main.tsx` 200 JS; without the flag `/admin/` has no `/@vite/client`. **Step 2–4:** FAIL → implement → pass (allow up to 30 s timeout for Vite startup). **Step 5:** commit `feat(core): OPENCMS_ADMIN_DEV runs Vite in middleware mode`.

### Task 8: OpenCMS components, `/_ui`, `DESIGN.md`

**Files:** Create `admin/src/components/{AppLayout,PageHeader,EmptyState,ErrorAlert,ConfirmDialog,StatusBadge,ThemeToggle}.tsx`, `admin/src/pages/UiKit.tsx`, `admin/DESIGN.md`; Modify `admin/src/routes.tsx` (`/_ui` route only when `import.meta.env.DEV`), `admin/src/i18n/en.ts`.

**Interfaces:**
- `AppLayout({ user, children })`: shadcn `SidebarProvider` + `Sidebar` (nav items: Content types `/`, Builder `/builder`, Users `/users`; content types list under "Content" loaded via `api` — fetch in layout and re-fetch on `window` event `opencms:schema-changed`), header with `PageHeader` slot and account `DropdownMenu` (user name/email, Account `/account`, theme submenu `ThemeToggle`, Log out). Mobile (<768px) uses the sidebar's sheet.
- `PageHeader({ title, description?, actions? })`; `EmptyState({ icon, title, description?, action? })`; `ErrorAlert({ error: ApiError | Error | null })` lists `issues` as `path: message` (string issues printed as-is; object issues `{path,message,locale?}` formatted like old `formatIssue`); `ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive?, onConfirm })`; `StatusBadge({ status: 'draft'|'published'|'changed'|'active'|'disabled' })` → badge variants (published/active `success`, changed `warning`, disabled `destructive`, draft `secondary`); `ThemeToggle` radio items Light/Dark/System using `theme.ts`.
- `UiKit` shows every ui component and variant plus the components above, with a light/dark toggle.
- `DESIGN.md`: token table (copy §6.2), how to add a component (`pnpm dlx shadcn@latest add <name>` from `packages/core/admin`), the rules of §6.5, the Tailwind note for plugins.
- `ApiError` type is defined in Task 9; for this task create `admin/src/lib/api-error.ts` with `export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public issues: unknown[] = []) }` (Task 9 imports it).

- [ ] **Step 1:** unit test `packages/core/test/admin/error-format.test.ts` for the pure `formatIssue(issue: unknown): string` exported from `ErrorAlert.tsx`'s sibling `admin/src/lib/format-issue.ts` (string, `{path,message}`, `{locale,path,message}`, unknown object → JSON). **Step 2–4:** FAIL → implement → pass; `pnpm --filter @opencms/core typecheck && pnpm --filter @opencms/core build`. **Step 5:** commit `feat(admin): layout and OpenCMS components, dev-only UI kit, DESIGN.md`.

### Task 9: API client, `AuthGate`, Setup, Login, Logout

**Files:** Create `admin/src/lib/api.ts`, `admin/src/lib/auth-flow.ts`, `admin/src/auth/AuthGate.tsx`, `admin/src/auth/AuthContext.tsx`, `admin/src/pages/{Setup,Login,NotFound}.tsx`; Modify `admin/src/routes.tsx`, `admin/src/i18n/en.ts`; Test `packages/core/test/admin/api.test.ts`, `packages/core/test/admin/auth-flow.test.ts`.

**Interfaces:**
- `api<T>(path: string, init?: RequestInit & { json?: unknown }, deps?: { fetch?: typeof fetch; location?: Pick<Location,'assign'|'pathname'|'search'> }): Promise<T>` — relative URL, `credentials: 'same-origin'`, JSON body from `json`, `Content-Type: application/json` when body; `204` → `undefined`; error → `throw new ApiError(status, body.error?.code ?? 'error', body.error?.message ?? statusText, body.error?.issues ?? [])`; on `401` with code `unauthenticated` and option `redirectOn401 !== false` (default true) → `location.assign(loginUrl(location))` and throw.
- `auth-flow.ts` pure helpers: `loginUrl(loc)` = `/api/auth/login?returnTo=` + encodeURIComponent(`/admin` + pathname-without-`/admin`-prefix + search) (`pathname` given as the browser path `/admin/...`); `loginPageAction(search: string): { kind: 'restart' } | { kind: 'show'; uid: string; error?: string }` (no `uid` → restart); `errorMessage(code: string | null): string` mapping `login_expired`, `login_failed`, `invalid_state`, `idp_account_not_found`, `idp_email_unverified`, `account_disabled` to `en.ts` strings, anything else → generic; `validateSetup({ email, name, password, confirm }): Record<string, string>` (password 12–256, ≠ email case-insensitive trimmed, confirm equal, email/name required).
- `AuthGate` per §5.2 (uses `api('/api/auth/me', { redirectOn401: false })` and handles 401 itself with `loginUrl`); `AuthContext` gives `{ user, logout() }` where `logout` = `POST /api/auth/logout` then `location.assign(redirectTo)`.
- `Setup` page per §5.3 using `form` (react-hook-form + zod schema mirroring `validateSetup`), `GET /api/auth/setup` first (`required:false` → navigate `/`), `POST`, 201 → `location.assign('/api/auth/login?login_hint=' + encodeURIComponent(email))`, 409 → `/`, 422 → field errors.
- `Login` page per §5.3: `loginPageAction(location.search)`; restart → `location.assign('/api/auth/login')`; `GET /oauth2/interaction/:uid` (`redirectOn401:false`); form `POST /oauth2/interaction/:uid/login` with `{ email, password }` → `location.assign(redirectTo)`; errors 401/403/429 inline (429 shows `Retry-After` seconds read from the response header — `api` must expose headers on `ApiError` as `retryAfterSec?: number`); `?error=` → `Alert` with `errorMessage(code)` + "Try again" link `/api/auth/login`; SSO buttons link to `/oauth2/interaction/:uid/idp/<id>`.
- routes: `/setup`, `/login` outside `AuthGate`; everything else inside `AuthGate` + `AppLayout`; `*` → `NotFound`.

- [ ] **Step 1: tests** — api.test: success JSON; 204 → undefined; error body → ApiError fields (status, code, message, issues); `Retry-After: 30` → `retryAfterSec === 30`; 401 unauthenticated → `assign` called with `/api/auth/login?returnTo=%2Fadmin%2Fbuilder%3Ftype%3Dproduct` for location `/admin/builder?type=product`; `redirectOn401:false` → no assign. auth-flow.test: `loginPageAction('')` restart, `('?uid=abc')` show, `('?uid=abc&error=login_expired')` with error; `errorMessage('weird')` = generic, `errorMessage('login_expired')` specific; `validateSetup` cases (11-char pw, 257-char, pw equal to email with different case/spaces, mismatch confirm, valid).
- [ ] **Step 2–4:** FAIL → implement → pass; typecheck + build. **Step 5:** commit `feat(admin): API client, auth gate, setup and login screens`.

### Task 10: Port Home, Content, Builder and FieldInput

**Files:** Create `admin/src/pages/{Home,Content,Builder}.tsx`, `admin/src/components/FieldInput.tsx`, `admin/src/lib/types.ts` (move the type definitions from `apps/admin/lib/api.ts`: `FieldKind`, `FieldDefinition`, `ContentTypeDefinition`, `Meta`, `PlanResponse`, `ApplyResponse`, and `newId`); Modify `admin/src/routes.tsx`, `en.ts`.

**Decisions:** behaviour and API calls identical to `apps/admin` pages (read them as the source of truth), rebuilt with design-system components: lists use `Table`, panels `Card`, actions `Button`, inputs `Input/Select/Checkbox/Textarea`, statuses `StatusBadge`, errors `ErrorAlert` (now reading `ApiError.issues`), destructive actions (archive type, delete entry) `ConfirmDialog`, success notices `toast` (sonner), migration preview SQL in a `<pre>` with `bg-muted font-mono`. Routes: `/` Home, `/content/:apiId` Content, `/builder` Builder (`?type=`). `next/link` → `Link`, `useRouter().push/replace` → `useNavigate()`, `useParams`, `useSearchParams` from react-router. Dispatch `opencms:schema-changed` after builder save/archive (AppLayout listens).

- [ ] **Step 1:** unit test `packages/core/test/admin/types.test.ts` for `newId('fld')` format `/^fld_[a-z0-9]{6}$/` and `newId('ct')`. **Step 2–4:** FAIL → implement → pass; typecheck + build; manual check in dev mode is the controller's job. **Step 5:** commit `feat(admin): content types, content manager and builder on the design system`.

### Task 11: Users and Account pages

**Files:** Create `admin/src/pages/{Users,Account}.tsx`, `admin/src/lib/users.ts`; Modify `routes.tsx`, `en.ts`; Test `packages/core/test/admin/users.test.ts`.

**Interfaces:** `users.ts` thin API wrappers over `/api/admin/users*` and `/api/auth/password` (response shapes from `packages/oauth2/src/users/users.controller.ts` — `{ data: [...] }`, fields `id, email, name, status, roles, lastLoginAt, identities[{id,provider,subject,email}]`); pure `userActions(row, me): { canDelete: boolean; canDisable: boolean; canEnable: boolean }` (no delete on own row; disable only when active; enable only when disabled). Pages per §5.3: Users table + Create dialog (email, name, optional password with note "leave empty for SSO-only"), Reset password dialog, Disable/Enable/Delete via `ConfirmDialog`, Unlink SSO; error codes `last_super_admin`, `email_taken`, `forbidden`, `not_found`, `weak_password` shown with `en.ts` messages. Account: name/email/roles read-only, change-password form (current, new, confirm; client validation like `validateSetup` for the new password vs own email), `204` → toast "Password changed. Other sessions were signed out.", `401 invalid_credentials` → error on current-password field; theme radio (`ThemeToggle`).

- [ ] **Step 1: test** — `userActions` for own row, active other, disabled other. **Step 2–4:** FAIL → implement → pass; typecheck + build. **Step 5:** commit `feat(admin): user management and account screens`.

### Task 12: Remove `apps/admin`; update `examples/my-store`

**Files:** Delete `apps/admin/**`; Modify `pnpm-workspace.yaml` (drop `apps/*` if empty), `.github/workflows/ci.yml` (drop `pnpm --filter @opencms/admin build`), `examples/my-store/src/main.ts` (`NestFactory.create(AppModule, { bodyParser: false })`, no `enableCors`, log `OpenCMS ready at ${publicUrl}/admin` where publicUrl = `process.env.OPENCMS_PUBLIC_URL ?? http://localhost:${port}`), `examples/my-store/src/app.module.ts` (drop `adminToken`), `examples/my-store/.env.example` (`OPENCMS_SECRET=`, comments per §7.2, drop `OPENCMS_ADMIN_TOKEN`), `examples/my-store/package.json` (`dev` unchanged), `pnpm-lock.yaml` (`pnpm install`).

- [ ] **Step 1:** `pnpm install && pnpm build && pnpm --filter my-store typecheck && pnpm -C examples/my-store opencms migrate:check` → pass; `grep -rn "OPENCMS_ADMIN_TOKEN\|adminToken\|apps/admin" --exclude-dir=node_modules --exclude-dir=.git . | grep -v "docs/superpowers\|CHANGELOG"` → empty.
- [ ] **Step 2:** start my-store against a fresh `mystore` DB (`DATABASE_URL`, `OPENCMS_SECRET` set, `PORT` free) for 10 s: `curl -s localhost:<port>/admin/` contains `<div id="root">`, `curl -s localhost:<port>/api/auth/me` → `409`. Report outputs. **Step 3:** commit `chore: remove apps/admin, my-store uses the embedded admin`.

### Task 13: CLI `.env` loading and `opencms init`

**Files:** Create `packages/cli/src/env.ts`, `packages/cli/src/init/{index,templates,names}.ts`; Modify `packages/cli/src/index.ts`, `packages/cli/package.json` (deps `@opencms/codegen` already; no new runtime deps); Test `packages/cli/test/init.test.ts`, `packages/cli/test/env.test.ts`.

**Interfaces:**
- `loadProjectEnv(root: string, env = process.env): void` — if `<root>/.env` exists, parse with `node:util` `parseEnv` (Node ≥ 20.12) and set only keys not already defined in `env`. Called in `project()` right after `findProjectRoot` (so it applies to every command).
- `names.ts`: `packageNameFor(dir: string): string` (basename, lowercase, chars outside `[a-z0-9._-]` → `-`, collapse/trim `-`, empty → `opencms-project`); `dbNameFor(dir: string): string` (basename lowercase, non `[a-z0-9]` → `_`, collapse, trim `_`, prefix `db_` if it starts with a digit, empty → `opencms`).
- `runInit(dir: string, opts: { pm?: 'pnpm'|'npm'|'yarn'; install?: boolean; dbUrl?: string; port?: number; link?: string; cliVersion: string; userAgent?: string; spawn?: (cmd, args, cwd) => Promise<number> }): Promise<{ files: string[]; installed: boolean }>` — validation (non-empty dir → throw `Error('Directory <dir> is not empty')`), writes the files of §7.2 using `templates.ts` (pure functions returning strings; `generateCode([], <dir>/src/generated)` + `writeGeneratedFiles`, `writeSnapshot(<dir>/migrations, emptySnapshot())`), `OPENCMS_SECRET = randomBytes(32).toString('base64url')`, deps: with `link` → `link:<abs link>/packages/<core|schema|cli>` for `@opencms/core`, `@opencms/schema`, `opencms-cli`; else `^<cliVersion>`. `pm` from `opts.pm` ?? `userAgent` prefix (`pnpm/`, `yarn/`, `npm/`) ?? `pnpm`. Install via `spawn(pm, ['install'], dir)` unless `install === false`; non-zero → keep files, throw `Error` with rerun hint.
- Template `src/main.ts`: loads `.env` with `process.loadEnvFile` when the file exists (try/catch), `NestFactory.create(AppModule, { bodyParser: false })`, `enableShutdownHooks()`, `listen(Number(process.env.PORT ?? 4000))`, log `OpenCMS ready at ${process.env.OPENCMS_PUBLIC_URL ?? 'http://localhost:' + port}/admin`. `src/app.module.ts`: `OpenCmsModule.forRoot({ root: path.resolve(__dirname, '..'), config, contentTypes, hooks, schemaEditable: process.env.NODE_ENV !== 'production' })`. Other files exactly §7.2. Template package versions for Nest/rxjs/reflect-metadata/kysely/tsx/typescript = the ranges in `examples/my-store/package.json`.
- Command: `program.command('init <dir>')` with options `--pm <pm>`, `--no-install`, `--db-url <url>`, `--port <n>`, `--link <path>`; prints the next steps of §7.3 (`<pm> run dev`, URL with port). `init` must not call `project()` (no config exists yet).

- [ ] **Step 1: tests** — init.test (temp dirs, `install:false`): file list equals §7.2 set; `package.json` name for `My Shop` → `my-shop`, for `shop-2026` stays; default DB URL for `My Shop` ends `/my_shop`, for `2026shop` → `/db_2026shop`; `.env` secret decodes to 32 bytes and differs between two runs; `.env.example` secret empty; `--link /x` → deps `link:/x/packages/core` etc.; non-empty dir → throws, file untouched; `userAgent: 'npm/10 node/22'` → npm; spawn returning 1 → throws, files kept. env.test: root `.env` with `DATABASE_URL=a`, process env `DATABASE_URL=b` → stays `b`; missing key set from file; command run from `src/content-types` sub-dir finds root `.env` (call the exported helper used by `project()`).
- [ ] **Step 2–4:** FAIL → implement → pass; `pnpm build && pnpm --filter opencms-cli typecheck`; manual: `node packages/cli/bin/opencms.js init /tmp/<scratch>/demo --link $PWD --no-install` prints next steps. **Step 5:** commit `feat(cli): opencms init, load project .env in every command`.

### Task 14: Smoke test, CI, docs

**Files:** Create `scripts/smoke-init.mjs`, `CHANGELOG.md` (if absent), `packages/core/README.md`; Modify `.github/workflows/ci.yml`, root `README.md`, `packages/oauth2/README.md`, `docs/superpowers/specs/2026-10-14-auth-oauth2-design.md` (§5 URL rules, §8 error format with `issues`).

**Smoke script (§8 smoke):** Node ESM script, no test framework. Steps exactly spec §8 smoke list 1–6: create temp dir under `os.tmpdir()`; `node packages/cli/bin/opencms.js init <tmp>/app --link <repo> --no-install --db-url <admin url>/<oc_smoke_rand>` ; create that DB (`pg` from the workspace); `pnpm install --ignore-workspace` in the app (if pnpm refuses `link:` outside workspace, use `npm install`; report); `opencms migrate:up`; spawn `node --import tsx src/main.ts` (or `npx tsx src/main.ts`) with `PORT=<free>`; poll `/api/auth/me` up to 60 s; then the HTTP assertions with a tiny cookie jar (`fetch` + manual `Set-Cookie` handling, `redirect: 'manual'`, `Origin` header on POSTs); finally kill server, drop DB, remove temp dir (also on failure). Exit code 0/1 with a step-by-step log.

**CI:** after `pnpm build` and `pnpm test`, run `node scripts/smoke-init.mjs` with `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`.

**Docs:** root README Quick start becomes `npx opencms-cli init my-cms` flow (+ monorepo dev: `OPENCMS_ADMIN_DEV=1`); remove the separate admin app instructions and `OPENCMS_ADMIN_TOKEN`; core README: options `auth`, `admin`, `cors`, `bodyParser: false` requirement, breaking changes; oauth2 README: URL rules, no `OPENCMS_INTERNAL_URL`; CHANGELOG `Unreleased` lists the four breaking changes of Global Constraints.

- [ ] **Step 1:** run `node scripts/smoke-init.mjs` → passes (attach full log in report). **Step 2:** `pnpm build && pnpm test` full → pass. **Step 3:** `grep -rn "OPENCMS_INTERNAL_URL" --exclude-dir=node_modules --exclude-dir=.git . | grep -v "CHANGELOG\|docs/superpowers/plans"` → only removal notes. **Step 4:** commit `test: init smoke test in CI; docs for embedded admin and breaking changes`.

---

## Out of this plan
- Next.js storefront website, Playwright E2E, UI i18n beyond English, exporting components for plugins, interactive `init`.
