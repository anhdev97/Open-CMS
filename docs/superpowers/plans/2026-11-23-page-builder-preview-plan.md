# Page Builder (drag & drop), Data Binding and Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Developers (and non-technical editors) build website pages in the admin by dragging OpenCloudCMS design-system blocks, binding block props to CMS content, and previewing drafts both inside the editor and on the real website.

**Architecture:** Pages are data: a core-owned content type `opencloudcmsPage` (tables from the core migration stream) reuses draft/publish/versions/l10n of `EntriesService`. Blocks are code: `defineBlock` + `b.*` in a new isomorphic subpath `@opencloudcms/core/blocks`, compiled to a Puck (`@puckeditor/core`) config. One pure `resolvePage()` resolves data-bound props with a pluggable fetcher — admin API (draft) in the editor and in website preview, public API (published) otherwise. Website preview is Next draft mode gated on the admin session cookie, never a bearer token.

**Tech Stack:** NestJS 11, Kysely, PostgreSQL 16, zod v3, Next.js 16 App Router (React 19, Tailwind v4, shadcn), `@puckeditor/core` (exact-pinned 0.x), vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-23-page-builder-preview-design.md` (also in the Project as `claude/specs/2026-11-23-page-builder-preview-design.md`). `§n` refers to it. Builds on Spec A/B (`2026-10-21-settings-i18n-design.md`, `2026-10-21-groups-permissions-review-design.md`) and `2026-10-21-admin-nextjs-design.md`.

## Global Constraints

- Branch `feat/page-builder` from `main` (base `3c579cf`). Never push to `main`, never merge.
- Brand (rebrand spec 2026-10-25): packages `@opencloudcms/*`, module `OpenCloudCmsModule` in `packages/core/src/opencloudcms.module.ts`, DI symbols `OPENCLOUDCMS_*`, env `OPENCLOUDCMS_*`, CLI `opencloudcms`, config `opencloudcms.config.ts`, product string "OpenCloudCMS". Existing SQL identifiers `opencms_*` (e.g. `opencms_core_migrations`) stay unchanged; new identifiers use `opencloudcms`.
- Spec A/B are merged: use `@RequirePermission` from `@opencloudcms/oauth2`, `useCan` in admin, `localizedText`, 4-locale bundles.
- Paths follow the current repo (`packages/core/src/**`, `packages/core/admin/src/**`, `packages/core/src/web/**`, core migrations in `packages/db/src/index.ts`). If a file differs, keep the responsibility and record the real path in the task report.
- Puck package: `@puckeditor/core`, version pinned exactly (no `^`) to `pnpm view @puckeditor/core version` at Task 3; record it in `packages/core/package.json` and in `PUCK_FORMAT_VERSION` (= its minor for 0.x, e.g. `0.22.x` → `22`).
- Content type: `apiId = 'opencloudcmsPage'`, tables `ct_opencloudcms_page`, `ct_opencloudcms_page_l10n`. Fields exactly: `title` (text, localizable, required), `path` (text, localizable, required, unique, indexed), `seo` (json, localizable), `content` (json, localizable).
- `path` rule: `^/$|^(/[a-z0-9]+(-[a-z0-9]+)*)+$`; reserved prefixes (case-insensitive) `/_next`, `/admin`, `/api`, `/oauth2`, `/__opencloudcms`.
- Stored page content: `{ format: 'puck', formatVersion: number, data: PuckData }`; every block item's props carry `_v: number` (block `version`, default `1`).
- Block `name`: PascalCase `^[A-Z][A-Za-z0-9]{0,63}$`, unique across `defineBlocks`.
- Error codes (body format `{ error: { code, message, issues? } }`): `unknown_block` (422, `issues: [{ path: [blockName], message: 'count' }]`), `stale_draft` (409), `invalid_path` (422), `path_reserved` (422).
- Preview URLs: `/__opencloudcms/preview?page=<documentId>&locale=<Locale>` and `/__opencloudcms/preview/exit`. Cookie `opencloudcms_preview_locale` (`HttpOnly`, `SameSite=Lax`, `Path=/`, session). Draft-mode responses: `Cache-Control: private, no-store`.
- Public API never returns draft data. Draft only via `/api/admin/**` with a valid session + `content.read`.
- `render` of every block is isomorphic: no server-only APIs, no data fetching, no CSS file imports (Tailwind classes only — block files are also imported by Nest through `app.module.ts` for `blockManifest`, Task 9).
- Admin CSP from admin-nextjs §4.4 unchanged unless Task 7 proves Puck needs more; any addition only for `/admin/pages/*`, commented, in CHANGELOG.
- Admin copy goes into all 4 bundles (`en-US`, `vi-VN`, `fr-FR`, `id-ID`); server errors stay English.
- Commit trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_018gJQhot4kQh5wt1a3XMZLZ`.
- Postgres: `pg_ctlcluster 16 main start` (postgres/postgres). Full check: `pnpm build && pnpm test`.

## Review Focus

- A page whose stored `formatVersion` is older/newer than the running Puck, or whose `content` is `null`/`{}` (fresh draft, manual DB edit), must open as an empty canvas or a clear "needs migration" notice, never crash editor or website — pinned in Task 3 (`readPageContent`).
- A `b.entries` query on a field that is no longer `indexed` (dev changed schema after the page was built) must resolve to `[]` with one WARN, not 400 the whole page — pinned in Task 4.
- Website preview for a user whose session lacks `content.read` (logged in, wrong group) must render published content, not draft and not 500 — pinned in Task 8.
- Two tabs autosaving the same page: the second save gets 409 `stale_draft` and must not silently overwrite — pinned in Task 1 (server) and Task 7 (client keeps local data and offers reload).
- Path collisions with real Next routes the dev wrote in `app/(site)` (e.g. `/blog` exists as a file route): the file route wins; the admin must warn when saving such a path — pinned in Task 9 (`GET /api/admin/pages/shadowed` + editor warning + README note).

---

### Task 1: Core-owned content type `opencloudcmsPage`

**Files:**
- Create: `packages/schema/src/pages.ts` (pure, no `node:*` imports — shared by Nest, admin client and `@opencloudcms/core/blocks`; export from the schema entry the admin already uses for i18n), `packages/core/src/pages/page.type.ts` (the `ContentTypeDefinition`, stable ids `ct_opencloudcms_page`, `fld_page_title|path|seo|content`), `packages/core/src/pages/page.hooks.ts`
- Modify: `packages/db/src/index.ts` (core migration `000N_pages` creating both tables + unique index on `(status, locale, path)` the same way codegen DDL would — generate the SQL with `packages/codegen/src/ddl.ts` from `page.type.ts` and inline it so it never drifts), `packages/core/src/registry.service.ts` (`registerCore(def, { hidden: true, editable: false })`; `get()` finds core types; `list({ includeHidden? })`; Builder/meta exclude hidden), `packages/core/src/schema-builder.ts` (reject writes/plan for core apiIds → 409 `core_type`), `packages/codegen/src/pipeline.ts` + `loader.ts` (project apiId `opencloudcmsPage` → error `apiId "opencloudcmsPage" is reserved by OpenCloudCMS`), `packages/core/src/entries.service.ts` (optimistic check: `update(apiId, id, body, locale, opts?: { expectedUpdatedAt?: string })`)
- Test: `packages/schema/test/pages.test.ts`, `packages/core/test/integration/pages-type.test.ts`

**Interfaces — Produces:**
```ts
// @opencloudcms/schema (pages.ts)
export const PAGE_API_ID = 'opencloudcmsPage';
export function validatePagePath(path: string): { ok: true } | { ok: false; code: 'invalid_path' | 'path_reserved'; message: string };
export function slugToPath(title: string): string; // 'Giới thiệu' → '/gioi-thieu'
export type StoredPageContent = { format: 'puck'; formatVersion: number; data: { root: unknown; content: unknown[]; zones?: Record<string, unknown[]> } };
export type BlockManifest = { name: string; version: number }[];
export function collectBlockNames(c: StoredPageContent | null | undefined): Map<string, number>; // name → occurrences, walks content, zones and slot props
// @opencloudcms/core (page.type.ts)
export const pageType: ContentTypeDefinition;
```
`PUT /api/admin/content/opencloudcmsPage/:id` accepts header `If-Match: <updatedAt ISO>`; mismatch → 409 `stale_draft`. Draft responses include `updatedAt`.

- [ ] **Step 1: Failing tests**
  - `validatePagePath`: `/`, `/about`, `/a/b-c` ok; `/About`, `/a/`, `a`, `/a//b`, `/a_b` → `invalid_path`; `/admin`, `/Admin/x`, `/api`, `/__opencloudcms/x`, `/_next/x` → `path_reserved`; `/adminx` ok.
  - `slugToPath('Giới thiệu')` → `/gioi-thieu`; `'  Hello, World! '` → `/hello-world`; `''` → `/`.
  - `collectBlockNames`: two `Heading` at root + one inside a `Section` slot prop → `Heading: 3, Section: 1`; `null` → empty map.
  - Integration: core migration creates `ct_opencloudcms_page` and `_l10n`; `GET /api/admin/meta` content types do not include `opencloudcmsPage`; CRUD + publish via `/api/admin/content/opencloudcmsPage` works; same `path` twice in one locale → existing unique error; same path in two locales OK; `path: '/admin'` → 422 `path_reserved`; PUT with stale `If-Match` → 409 `stale_draft`, with current → 200, without header → 200; schema builder POST with apiId `opencloudcmsPage` → 409 `core_type`; a project schema file with apiId `opencloudcmsPage` fails load with the exact message.
- [ ] **Step 2: Run** `pnpm vitest run packages/schema packages/core packages/codegen` → FAIL.
- [ ] **Step 3: Implement.** Hooks: `beforeCreate`/`beforeUpdate` validate `path` (422 with code); `beforePublish` unknown-block check is added in Task 2.
- [ ] **Step 4: Run** same → PASS; `pnpm vitest run packages/codegen` still green (core type absent from `_snapshot.json`).
- [ ] **Step 5: Commit** — `feat(core): core-owned opencloudcmsPage content type`

### Task 2: Pages API — by-path, `documentId[in]`, block manifest checks

**Files:**
- Create: `packages/core/src/pages/pages.controller.ts`, `packages/core/src/pages/pages.service.ts`
- Modify: `packages/core/src/entry.repository.ts` + `entries.service.ts` (filter `documentId[in]=a,b` — max 100 ids, uuid-validated, allowed regardless of `indexed`), `packages/core/src/options.ts` (`pages?: { blocks?: BlockManifest }`), `packages/core/src/pages/page.hooks.ts` (`beforePublish` unknown-block check), `packages/core/src/opencloudcms.module.ts`
- Test: `packages/core/test/integration/pages-api.test.ts`

**Interfaces:**
- Consumes: Task 1 `PAGE_API_ID`, `BlockManifest`, `collectBlockNames` (from `@opencloudcms/schema`).
- Produces:
  - `GET /api/content/opencloudcmsPage/by-path?path=&locale=` → `{ data }` published only; 404 JSON.
  - `GET /api/admin/content/opencloudcmsPage/by-path?path=&locale=` → draft, `content.read`, `Cache-Control: no-store`.
  - `GET /api/admin/pages/blocks-check` → `{ data: [{ documentId, locale, title, unknown: string[] }] }`; `manifest: null` when the option is absent.
  - `POST …/opencloudcmsPage/:id/publish` with unknown blocks → 422 `unknown_block`; body `{ force: true }` bypasses. Option absent → no check, WARN once at boot.

- [ ] **Step 1: Failing tests** — published vs draft by-path (draft change not visible on public; visible on admin); admin by-path 401 without session, 403 for a user without `content.read` (skip with TODO if Spec B absent); `?filter[documentId][in]=` (use the repo's real filter syntax) returns exactly those ids in any order, 101 ids → 400, non-uuid → 400; publish with a block missing from manifest → 422 issue path `['Ghost']` message `'2'` (2 occurrences); `force: true` → 200; blocks-check lists it.
- [ ] **Step 2–4:** `pnpm vitest run packages/core` FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(core): pages by-path API, documentId filter, block checks`

### Task 3: `@opencloudcms/core/blocks` — definitions, fields, Puck config, stored format

**Files:**
- Create: `packages/core/blocks/tsconfig.json` (ESM like `admin/`, `jsx: react-jsx`, outDir `../dist/blocks`), `packages/core/blocks/src/index.ts`, `define.ts`, `fields.ts` (`b.*`), `puck-config.ts`, `content.ts` (stored format, versions, migrate), `types.ts`
- Modify: `packages/core/package.json` (`exports["./blocks"]` → `dist/blocks/index.js` + types; dependency `@puckeditor/core` exact; build script adds `tsc -p blocks/tsconfig.json`)
- Test: `packages/core/test/blocks/define.test.ts`, `packages/core/test/blocks/puck-config.test.ts`, `packages/core/test/blocks/content.test.ts`

**Interfaces — Produces:**
```ts
export const b: {
  text(o?), longText(o?), richText(o?), number(o?), boolean(o?), select<T>(o: { options: T[]; default?: T }), radio(o),
  link(o?), image(o?), color(o?), spacing(o?),
  entry(apiId: string, o?: { displayField?: string }),
  entries(apiId: string, o?: { limit?: number; sortable?: boolean; filterable?: boolean }),
  list(fields: Record<string, BlockField>, o?), slot(o?: { allow?: string[]; max?: number }),
};
export function defineBlock<F extends Record<string, BlockField>>(d: BlockDefinition<F>): BlockDefinition<F>;
// BlockDefinition: { name; label: string | LocalizedText; category: string; icon?: string; version?: number;
//   fields: F; migrate?: { from: number; up(props: Record<string, unknown>): Record<string, unknown> }[];
//   render(props: ResolvedProps<F>): ReactNode }
export function defineBlocks(list: BlockDefinition<any>[]): BlockRegistry; // throws Error on invalid
export function blockManifest(r: BlockRegistry): BlockManifest;
export function toPuckConfig(r: BlockRegistry, opts: { locale: Locale; customFields: CustomFieldRenderers }): PuckConfig;
export const PUCK_FORMAT_VERSION: number;
// StoredPageContent, BlockManifest, collectBlockNames: re-exported from @opencloudcms/schema (Task 1)
export function readPageContent(raw: unknown, r: BlockRegistry): { status: 'ok' | 'empty' | 'needs-migration'; data: PuckData };
export function writePageContent(data: PuckData, r: BlockRegistry): StoredPageContent; // strips undeclared props, stamps _v
```
Color tokens: `primary, secondary, muted, accent, background, foreground, destructive`; spacing tokens: `0, 2, 4, 6, 8, 12, 16, 24`. Data fields (`entry`, `entries`, `link`, `image`) map to Puck `type: 'custom'` rendered by `customFields` (Task 7 supplies them).

- [ ] **Step 1: Failing tests**
  - `defineBlocks`: duplicate name, `'productGrid'` (not PascalCase), `b.select({ options:[2,3], default: 5 })` → each throws a message naming the block and field.
  - `toPuckConfig`: label picked by locale with en-US fallback; categories grouped; `b.slot` → Puck slot field; `b.entries` → `type: 'custom'`; defaults land in `defaultProps`.
  - `readPageContent`: `null`/`{}` → `empty`; `formatVersion` ≠ current → `needs-migration` (data untouched); props with `_v: 1` and block `version: 2` + `migrate [{ from: 1, up }]` → migrated props; unknown block kept as-is.
  - `writePageContent`: undeclared prop removed; `_v` stamped; round-trip `read(write(x))` equals `x` minus undeclared props.
  - `pnpm --filter @opencloudcms/core build` → `dist/blocks/index.js` exists, no `'use client'` on first line, no `@nestjs` string inside.
- [ ] **Step 2–4:** `pnpm vitest run packages/core/test/blocks` FAIL → implement → PASS; build check above.
- [ ] **Step 5: Commit** — `feat(blocks): block definitions, field builders and Puck config`

### Task 4: `resolvePage` and fetchers

**Files:**
- Create: `packages/core/blocks/src/resolve.ts`, `packages/core/blocks/src/fetchers.ts`
- Test: `packages/core/test/blocks/resolve.test.ts`

**Interfaces:**
- Consumes: Task 3 registry/types; Task 2 `documentId[in]`, by-path.
- Produces:
```ts
export interface ContentFetcher {
  byIds(apiId: string, ids: string[], locale: Locale): Promise<Entry[]>;
  query(apiId: string, q: { filter?: Record<string, string>; sort?: string; limit: number }, locale: Locale): Promise<Entry[]>;
  pagePaths(ids: string[], locale: Locale, defaultLocale: Locale): Promise<Record<string, string | null>>;
}
export function resolvePage(content: StoredPageContent, r: BlockRegistry, f: ContentFetcher, o: { locale: Locale; defaultLocale: Locale }): Promise<PuckData>;
export function publicFetcher(baseUrl: string): ContentFetcher;                      // /api/content/**
export function adminFetcher(baseUrl: string, init?: { cookie?: string }): ContentFetcher; // /api/admin/content/** status=draft, credentials include / forwarded cookie
```
Batching: one `byIds` per apiId across the whole tree (pick mode + `b.entry`); one `query` per distinct `(apiId, filter, sort, limit)`; one `pagePaths` call.

- [ ] **Step 1: Failing tests** (fake fetcher counting calls)
  - Tree with 2 `b.entry('product')` and 1 `b.entries('product', pick)` → exactly 1 `byIds('product', [3 ids])`.
  - Two identical queries → 1 call; pick order preserved in output.
  - Missing id → `entry` prop `null`, dropped from `entries`.
  - `query` rejects (400 not indexed) → `[]` + one `console.warn` per (apiId, filter) (Review Focus).
  - `link` to page: vi-VN path exists → used; missing → defaultLocale path; both missing → `{ href: null }`.
  - Nested slots and `b.list` items resolved; unknown blocks passed through untouched.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(blocks): resolve data-bound props with batched fetchers`

### Task 5: Core block library (`coreBlocks`)

**Files:**
- Create: `packages/core/blocks/src/library/{layout,basic,marketing,data}.tsx`, `packages/core/blocks/src/library/index.ts` (`coreBlocks`)
- Test: `packages/core/test/blocks/library.test.ts`

**Interfaces — Produces:** `coreBlocks: BlockDefinition[]` with names exactly: `Section, Columns, Grid, Spacer, Divider, Heading, Text, Image, Button, ButtonGroup, Card, Badge, Hero, FeatureList, CallToAction, FAQ, EntryList`. Labels in 4 locales. Use the shared design-system primitives (Button, Card, Badge, Accordion from the admin shadcn set re-used via relative import or moved to a shared folder — no admin-only deps like router/i18n provider). `EntryList` fields: `apiId` (select of content types — custom field, Task 7), `source: b.entries` bound dynamically, `layout: 'list'|'grid'|'table'`, `fields: string[]`.

- [ ] **Step 1: Failing tests** — `defineBlocks(coreBlocks)` does not throw; every block renders with its default props via `react-dom/server` `renderToString` without throwing and without `window` access; `Heading` with `level: 2` renders `<h2`; `Section` with `background: 'muted'` contains the `bg-muted` class; `Button` link with `{ href: null }` renders a `<span>` not `<a>`.
- [ ] **Step 2–4:** FAIL → implement → PASS; Tailwind `@source` in templates already scans `dist/` — confirm `dist/blocks` is covered (Task 9 adjusts globals.css if not).
- [ ] **Step 5: Commit** — `feat(blocks): core block library from the design system`

### Task 6: Admin — Pages list, routes, navigation

**Files:**
- Create: `packages/core/admin/src/pages/Pages.tsx`, `packages/core/admin/src/lib/pages.ts` (API client)
- Modify: `router/routes.ts` + `router/match.ts` (`pages` → Pages, `pages/:documentId` → PageEditor full-screen flag), `navigation.ts` (top-level "Pages" item above content groups, permission `content.read`), `components/AppLayout.tsx` (routes with `fullScreen` skip sidebar), i18n bundles
- Test: `packages/core/test/admin/router.test.ts` (extend), `packages/core/test/admin/pages.test.ts`

**Interfaces — Produces:** `RouteId` adds `pages`, `pageEditor` (`fullScreen: true`); `pageStatus(draft, published): 'draft' | 'published' | 'changed'`; client fns `listPages(locale)`, `createPage({ title, path, locale })`, `duplicatePage(id, locale)` (create from draft data with `path + '-copy'`, title `+ ' (copy)'`), `deletePage(id)`.

- [ ] **Step 1: Failing tests** — `matchRoute(['pages'])`, `matchRoute(['pages','<uuid>'])` → params; `pageStatus` three cases; create dialog derives path via `slugToPath` from `@opencloudcms/schema` (Task 1).
- [ ] **Step 2–4:** FAIL → implement page (table columns per §9.1, create/duplicate/delete with `ConfirmDialog`) → PASS; typecheck.
- [ ] **Step 5: Commit** — `feat(admin): pages list and navigation`

### Task 7: Admin — Page editor (Puck), data fields, autosave, CSP check

**Files:**
- Create: `packages/core/admin/src/pages/PageEditor.tsx`, `packages/core/admin/src/page-editor/{EditorHeader,EntryPicker,EntriesField,LinkField,ImageField,TokenField,UnknownBlock}.tsx` (`ImageField` reuses the existing asset picker/upload from the admin's asset field, backed by `@opencloudcms/assets` `/api/admin/assets`; stores `{ assetId, src, alt }`), `page-editor/autosave.ts` (pure state machine), `page-editor/blocks-context.ts`
- Modify: `packages/core/admin/src/index.ts` (`AdminApp` accepts optional `blocks?: BlockRegistry` prop; absent → `defineBlocks(coreBlocks)`), `packages/core/src/web/*` CSP only if proven necessary, i18n bundles, admin `DESIGN.md` (editor section)
- Test: `packages/core/test/admin/autosave.test.ts`, `packages/core/test/admin/editor-fields.test.ts`

**Interfaces:**
- Consumes: Task 3 `toPuckConfig`, `readPageContent`, `writePageContent`; Task 4 `resolvePage`, `adminFetcher`; Task 1 `If-Match`/`stale_draft`; Task 2 by-path not needed here.
- Produces: `createAutosave({ save(data, ifMatch): Promise<{ updatedAt }>, debounceMs: 1500 })` → `{ change(data), flush(), state: 'idle'|'dirty'|'saving'|'saved'|'conflict'|'error' }`; on 409 `stale_draft` → `conflict`, keeps last local data, no retry.

- [ ] **Step 1: Failing tests**
  - autosave: two quick changes → one save after debounce; save in flight + change → second save after first resolves with new `If-Match`; 409 → `conflict`, further `change` does not call save; `flush` saves immediately.
  - `EntriesField` filter builder offers only `indexed`/`unique` fields of the target type (from `/api/admin/meta`); `TokenField` offers exactly the Global Constraints tokens.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/admin` → FAIL.
- [ ] **Step 3: Implement** editor per §9.2: Puck in iframe mode; header (back, title, path, locale select with "Copy from <defaultLocale>" when the locale has no translation, undo/redo, viewports, "View on website" → opens `/__opencloudcms/preview?page=&locale=` in a new tab, Save, Publish gated by `useCan` per §7); field panel overrides with design-system inputs; unknown blocks via `UnknownBlock` (delete only); `needs-migration` → read-only banner; preview resolution via `resolvePage(adminFetcher(''))` debounced 300 ms on data-field changes; leaving the page calls `flush()`.
- [ ] **Step 4: Verify** unit tests PASS; then in `examples/my-store` prod build (`pnpm --filter my-store build && NODE_ENV=production pnpm --filter my-store start`), open `/admin/pages/<id>` in a browser: drag `Heading` into the canvas, no CSP violations in the console. If violations appear, add the minimal directive for `/admin/pages/*` only, with a unit test in `packages/core/test/unit/csp.test.ts` that `/admin/users` is unchanged. Record the result in the task report.
- [ ] **Step 5: Commit** — `feat(admin): drag-and-drop page editor with data-bound fields`

### Task 8: Website renderer and draft-mode preview

**Files:**
- Create: `packages/core/blocks/src/next/page.tsx` (server component `CmsPage` + `generateCmsMetadata`), `packages/core/blocks/src/next/preview-route.ts` (`GET` handler), `packages/core/blocks/src/next/exit-route.ts`, `packages/core/blocks/src/next/PreviewBar.tsx`, `packages/core/blocks/src/next/Welcome.tsx`; export as `@opencloudcms/core/blocks/next` (add to `exports`)
- Modify: `packages/core/package.json` exports (the session cookie is already `Path=/` in `packages/oauth2/src/bff/auth.controller.ts`; no change)
- Test: `packages/core/test/blocks/preview-route.test.ts`, `packages/core/test/blocks/cms-page.test.ts`

**Interfaces:**
- Consumes: Task 4 fetchers; Task 2 by-path endpoints; Task 5 library.
- Produces:
```ts
export function createCmsPage(o: { blocks: BlockRegistry; baseUrl?: string /* default `http://127.0.0.1:${process.env.PORT}` */ }): {
  Page(props: { params: Promise<{ path?: string[] }> }): Promise<ReactNode>;
  generateMetadata(props): Promise<Metadata>;
};
export function createPreviewRoute(o: { baseUrl?: string }): { GET(req: Request): Promise<Response> };
export function createPreviewExitRoute(): { GET(req: Request): Promise<Response> };
```
Behavior exactly §8.2 steps 1–5; draft mode + `opencloudcms_preview_locale` decides locale; admin API 401/403 while in draft mode → published render + `PreviewBar` variant `expired`; no page at `/` → `Welcome`; other missing path → `notFound()`.

- [ ] **Step 1: Failing tests** (mock `fetch`, mock `next/headers` `draftMode`/`cookies`)
  - preview route: 200 from admin API → draft mode enabled, cookie set with exact attributes, 307 to draft path; 401 → 307 to `/admin/login?next=<encoded preview url>`; 403/404 → 403/404 HTML; missing `page` → 400.
  - `CmsPage`: draft mode off → public by-path; on → admin by-path with forwarded `cookie` header and `adminFetcher`; on + admin 403 → public by-path + expired bar (Review Focus); `/` with 404 → Welcome; `/x` 404 → `notFound` called; `seo.noindex` → metadata robots noindex; a stored block `Ghost` not in the registry renders nothing and `console.warn` is called once for `Ghost` across two renders (§6.5).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(blocks): website renderer and session-gated draft preview`

### Task 9: `init`, my-store, smoke, docs

**Files:**
- Modify: `packages/cli/src/init/templates.ts` + `index.ts` — generate `src/blocks/index.ts` (`defineBlocks([...coreBlocks])`), `src/blocks/example/example.block.tsx` (commented), `app/(site)/[[...path]]/page.tsx` (`createCmsPage({ blocks })` re-exported as `default` + `generateMetadata`), `app/(site)/__opencloudcms/preview/route.ts`, `app/(site)/__opencloudcms/preview/exit/route.ts`, `app/(admin)/admin/[[...slug]]/page.tsx` passes `blocks` to `AdminApp` (thin client wrapper file `app/(admin)/admin/AdminWithBlocks.tsx` with `'use client'`), remove `app/(site)/page.tsx`, `tsconfig.server.json` adds `jsx: react-jsx`, `app.module.ts` passes `pages: { blocks: blockManifest(blocks) }`, `app/globals.css` `@source` covers `dist/blocks` and `src/blocks`; `packages/cli/test/init.test.ts`; `examples/my-store` (same files, block `ProductGrid` per §5.1, `scripts/seed-pages.ts` creating published `/` = Hero + ProductGrid query newest products, and `/about`)
- Modify: `packages/core/src/pages/pages.controller.ts` — `GET /api/admin/pages/shadowed` → `{ data: string[] }`: static paths of file routes under `<web.dir>/app/(site)/**/page.tsx` (route groups stripped, any segment with `[` ignored, the catch-all itself excluded), computed once at boot; `[]` when `web.enabled` is false. Admin editor header and create dialog warn when the page path is in this list (Review Focus).
- Modify: `scripts/smoke-init.mjs`, `README.md`, `packages/core/README.md` (blocks API, field table, isomorphic rule, no CSS imports in blocks, preview, limits), `CHANGELOG.md` (new subpaths `@opencloudcms/core/blocks`, `/blocks/next`; reserved apiId `opencloudcmsPage`; static home replaced)
- Test: `packages/cli/test/init.test.ts`, `packages/core/test/integration/pages-shadowed.test.ts`

- [ ] **Step 1: Failing tests** — init produces the listed files with expected contents and no `app/(site)/page.tsx`; shadowed: a tmp `web.dir` with `app/(site)/blog/page.tsx` and `app/(site)/[[...path]]/page.tsx` → `GET /api/admin/pages/shadowed` = `['/blog']` (dynamic segments ignored).
- [ ] **Step 2: Implement** → tests PASS.
- [ ] **Step 3: Smoke** additions exactly §12 Smoke: seed `/` with `Heading` → `GET /` contains it and no `Content-Security-Policy`; draft edit → public unchanged; login → preview URL → redirect `/` → draft heading + preview bar marker; preview URL without session → redirect to `/admin/login`; `GET /` with only the draft-mode cookies (no session) → published; draft edit of a `product` shows in preview only; `GET /admin/pages/<id>` CSP nonce matches scripts.
- [ ] **Step 4: Run** `pnpm build && pnpm test && node scripts/smoke-init.mjs && pnpm --filter my-store typecheck && pnpm --filter my-store build` → all PASS.
- [ ] **Step 5: Commit** — `feat: page builder in init and example, smoke and docs`
