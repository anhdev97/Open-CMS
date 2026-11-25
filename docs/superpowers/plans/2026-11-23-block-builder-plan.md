# Block Builder (drag & drop blocks saved as code) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Developers (and non-technical users) compose new page-builder blocks by dragging design-system elements in the admin, optionally bind them to a content type (one entry or a filtered collection), and save them as `defineComposedBlock` files in the project.

**Architecture:** A composed block is data (`ComposedBlockSpec`) stored in `src/blocks/<kebab>/<kebab>.block.ts`, printed/loaded by `@opencloudcms/codegen` like `*.schema.ts`. One renderer (`defineComposedBlock`) in `@opencloudcms/core/blocks` turns a spec into a normal `BlockDefinition` built on a new public `ui` primitive set, so page builder, preview, website and manifest work unchanged. Nest gets a mutable block manifest plus a dev-only blocks API (write queue + file rollback); the admin gets Settings → Blocks with a Puck canvas.

**Tech Stack:** NestJS 11, Next.js 16 (React 19, Tailwind v4), `@puckeditor/core` 0.24.1 (pinned), jiti, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-23-block-builder-design.md` (§n). Builds on `docs/superpowers/specs/2026-11-23-page-builder-preview-design.md` (PB§n) — already merged (PR #12).

## Global Constraints

- Branch `feat/block-builder` from `main` (`8136fba`). Never push to `main`, never merge.
- Brand: packages `@opencloudcms/*`, CLI `opencloudcms`, product string "OpenCloudCMS".
- File per block: `src/blocks/<kebab>/<kebab>.block.ts` exporting default `defineComposedBlock({...})`; managed index `src/blocks/composed.ts` exporting `composedBlocks` sorted by `name`. Builder never edits `src/blocks/index.ts`.
- Spec keys (exact): `id` (`^blk_[a-z0-9]{6,}$`), `name` (PascalCase `^[A-Z][A-Za-z0-9]{0,63}$`, immutable after first save), `label` (LocalizedText, en-US required), `category`, `icon?`, `version` (int ≥ 1), `binding?` `{ apiId, mode: 'single' | 'collection', filter?: {field, value}[], sort?: {field, direction: 'asc'|'desc'}, limit?: 1–100 (default 12), layout?: { kind: 'grid' | 'list', columns?: 2–6 }, urlPattern?, options?: { editorFilter=false, editorSort=false, editorLimit=false, editorLayout=false, emptyText?: LocalizedText } }`, `fields` `{ [name]: { kind, label?, default? } }`, `tree` (Node).
- Node: `{ el, props?, bind?, showIf?, children? }`. Elements exactly: `Box, Stack, Columns, Grid, Card, Slot, Heading, Text, Image, Button, Badge, Price, Date, Divider, Spacer`.
- Bind sources: `{ from: 'entry', path }`, `{ from: 'entryUrl' }`, `{ from: 'field', name }`, `{ from: 'const', value }`. `showIf`: `{ from: 'entry' | 'field', path | name, is: 'present' | 'absent' }`.
- Manual field kinds: `text, longText, richText, number, boolean, select, image, link` → the matching `b.*`.
- `props` take design-system tokens only (`COLOR_TOKENS`, `SPACING_TOKENS`, plus enumerated sizes/variants); class names via literal lookup tables.
- Filters: equality only, only on `indexed`/`unique` fields; fixed `filter` is enforced at resolve time and wins over editor filters on the same field.
- `Slot` not allowed inside a collection item template; `editor*` options only in collection mode.
- Reserved item prop `_locale` (like `_v`): stamped at resolve/canvas time, never stored (stripped by `writePageContent`).
- Version auto-bump (compared to the file on disk) on breaking changes: manual field removed/renamed or kind changed, `binding.apiId` or `mode` changed, binding added/removed.
- Error codes: `not_composed` (409), `block_name_taken` (409), `name_immutable` (422), `block_in_use` (409, `issues: [{ path: [name], message: '<pages>' }]`), spec invalid 422 with `issues`; not editable → same `ForbiddenException` as the Content Type Builder.
- API base `/api/admin/blocks`, permission `settings.content-types`; writes only when `schemaEditable`.
- Admin route `/admin/settings/blocks` (list) and `/admin/settings/blocks/:name` | `new` (full screen); copy in `en-US`, `vi-VN`, `fr-FR`, `id-ID`.
- Commit author `anhdev97 <anhnn97.it@gmail.com>`; trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_018gJQhot4kQh5wt1a3XMZLZ`.
- Postgres: `pg_ctlcluster 16 main start` (postgres/postgres). Full check: `pnpm build && pnpm test`.

## Review Focus

- A composed block file hand-edited into an invalid shape (or referencing a deleted content type) must not crash Nest boot, the admin or the website: load errors list the file and the block renders nothing — pinned in Task 4 (loader) and Task 3 (renderer).
- Stored page data that tries to override the fixed filter (`filter: { active: 'false' }`) or the locked limit must still render only matching entries / the block's limit — pinned in Task 3.
- Saving a block whose `name` collides with a core or hand-written block (e.g. `Hero`) must be refused, never shadow it — pinned in Task 5.
- A failed save midway (e.g. printer throws for the index) must leave every project file exactly as before — pinned in Task 5.
- Two blocks saved quickly one after another must both end up in `composed.ts` (no lost write) — pinned in Task 5 (write queue).

---

### Task 1: Composed block spec — types, validation, manifest entry, breaking-change rules

**Files:**
- Create: `packages/schema/src/composed-block.ts` (pure, no `node:*`), export from `packages/schema/src/index.ts`
- Test: `packages/schema/test/composed-block.test.ts`

**Interfaces — Produces:**
```ts
export type ComposedElement = 'Box'|'Stack'|'Columns'|'Grid'|'Card'|'Slot'|'Heading'|'Text'|'Image'|'Button'|'Badge'|'Price'|'Date'|'Divider'|'Spacer';
export type BindSource = { from: 'entry'; path: string } | { from: 'entryUrl' } | { from: 'field'; name: string } | { from: 'const'; value: unknown };
export interface ComposedNode { el: ComposedElement; props?: Record<string, unknown>; bind?: Record<string, BindSource>; showIf?: { from: 'entry' | 'field'; path?: string; name?: string; is: 'present' | 'absent' }; children?: ComposedNode[] }
export interface ComposedBlockSpec { id; name; label: LocalizedText; category: string; icon?: string; version: number; binding?: ComposedBinding; fields: Record<string, ComposedField>; tree: ComposedNode }
export const COMPOSED_ELEMENTS: readonly ComposedElement[];
export const ELEMENT_BINDABLE: Record<ComposedElement, readonly string[]>; // e.g. Heading: ['text'], Image: ['src','alt'], Button: ['label','href'], Price: ['value'], Date: ['value'], Text: ['text','html'], Badge: ['text']
export function validateComposedSpec(spec: unknown): { path: (string|number)[]; message: string }[]; // structural only, [] when valid
export function composedManifestEntry(spec: ComposedBlockSpec): { name: string; version: number; richText?: string[] };
export function isBreakingChange(prev: ComposedBlockSpec, next: ComposedBlockSpec): boolean;
export function withAutoVersion(prev: ComposedBlockSpec | null, next: ComposedBlockSpec): ComposedBlockSpec; // prev.version + 1 when breaking, else prev.version (new block: 1)
```

- [ ] **Step 1: Failing tests** — valid single/collection/unbound specs → `[]`; each rule from Global Constraints produces one issue with a path: bad `id`, non-PascalCase `name`, missing `label['en-US']`, unknown `el`, bind key not in `ELEMENT_BINDABLE`, `{from:'field', name:'x'}` with no field `x`, `{from:'entry'}`/`entryUrl` without `binding`, `entryUrl` without `urlPattern`, `Slot` under a collection template, `editorFilter` in single mode, `limit: 0`/`101`, `columns: 7`, duplicate field name with different kinds is impossible (record) but field kind outside the list → issue, `showIf` with `from:'entry'` and no binding. `composedManifestEntry` lists `richText` field names (manual `richText` fields). `isBreakingChange`: field removed → true, label changed → false, field added → false, kind changed → true, mode changed → true, apiId changed → true, binding added/removed → true. `withAutoVersion(null, spec)` → version 1; breaking → prev+1; non-breaking → prev.
- [ ] **Step 2:** `pnpm vitest run packages/schema/test/composed-block.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** same → PASS; `pnpm --filter @opencloudcms/schema exec tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(schema): composed block spec, validation and versioning`

### Task 2: Public `ui` primitives

**Files:**
- Create: `packages/core/blocks/src/ui/` (`index.ts`, `layout.tsx` (Box, Stack, Columns, Grid, Card), `content.tsx` (Heading, Text, Image, Button, Badge, Price, DateText, Divider, Spacer), `tokens.ts` (lookup tables moved/re-exported from `library/ui.tsx`))
- Modify: `packages/core/blocks/src/index.ts` (`export * as ui from './ui'`), `packages/core/blocks/src/library/ui.tsx` (re-export from `ui/tokens.ts`, keep existing names), core library blocks may switch to `ui` where it removes duplication (no visual change — `library.test.ts` must stay green)
- Test: `packages/core/test/blocks/ui.test.ts`

**Interfaces — Produces:** `ui.Box({ padding?, background?, children })`, `ui.Stack({ direction: 'vertical'|'horizontal', gap?, align?, children })`, `ui.Columns({ count: 2|3|4, gap?, children })`, `ui.Grid({ columns: 2..6, gap?, children })`, `ui.Card({ padding?, background?, bordered?, children })`, `ui.Heading({ level: 1|2|3|4, text, align? })`, `ui.Text({ text?, html?, size?, color? })` (html via `RichTextHtml` sanitized path from PB), `ui.Image({ src, alt?, ratio?, rounded? })` (src null → nothing), `ui.Button({ label, href: string|null, variant?, size? })` (href null → `<span>`), `ui.Badge({ text, variant? })`, `ui.Price({ value, locale, currency? })` (Intl.NumberFormat; currency → style currency), `ui.DateText({ value, locale, format: 'short'|'long' })`, `ui.Divider()`, `ui.Spacer({ size })`. Element `Date` maps to `ui.DateText`.

- [ ] **Step 1: Failing tests** (`renderToString`) — Grid `columns: 4` contains the literal 4-column class from the lookup table; Heading level 3 → `<h3`; Text with html `<img src=x onerror=1>` emits no `onerror`; Image `src: null` renders `''`; Button `href: null` → `<span`; `Price({ value: 1200000, locale: 'vi-VN', currency: 'VND' })` equals `new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(1200000)` inside the output; `DateText` same for `dateStyle`; unknown token → falls back to the default class (never `"undefined"`); the CJS build still requires (`build.test.ts` green).
- [ ] **Step 2–4:** `pnpm vitest run packages/core/test/blocks` FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(blocks): public ui primitives`

### Task 3: `defineComposedBlock` renderer, fixed filters, `_locale`

**Files:**
- Create: `packages/core/blocks/src/composed/define.ts`, `composed/render.tsx`, `composed/values.ts` (reading entry values: text, asset → `{src, alt}`, money → `{value, currency}`, date), `composed/index.ts`
- Modify: `types.ts` + `fields.ts` (`EntriesBlockField.baseFilter?: Record<string,string>`, `defaultSort?: string`, `lockLimit?: boolean`), `resolve.ts` (merge `baseFilter` over stored filter — base wins; `lockLimit` → field `limit`; stamp `_locale` on every item whose block is composed — mark via `BlockDefinition.composed?: true`), `content.ts` (`writePageContent` strips `_locale`), `index.ts` (export `defineComposedBlock`, `type ComposedBlockSpec`)
- Test: `packages/core/test/blocks/composed.test.ts`

**Interfaces:**
- Consumes: Task 1 types/`validateComposedSpec`; Task 2 `ui`.
- Produces: `defineComposedBlock(spec: ComposedBlockSpec): BlockDefinition` (throws with the file-agnostic issue list when invalid); field names on the produced definition: manual fields by their names, `entry` (single), `entries` (+ `layout` when `editorLayout`), `slot` per `Slot` node (`slot`, `slot2`, … in tree order).
- Before writing code, check what `/api/admin/content/:apiId` returns for `asset`, `money`, `date`, `boolean` fields (read the repository serializer + an existing integration test) and record it in the report; `values.ts` follows it. Check that the list API coerces `filter[active]=true` correctly for a boolean indexed column; if it does not, fix the coercion in `entry.repository.ts` with an integration test.

- [ ] **Step 1: Failing tests**
  - single: spec bound to `product` renders name/price/image from a fake resolved entry; no entry → editor placeholder only when `_editor` canvas flag present, otherwise `''`.
  - collection: 3 entries render 3 item templates inside the layout grid; empty → `emptyText` in `_locale`.
  - unbound: manual field values and `const` render; `showIf present/absent`.
  - `entryUrl`: `urlPattern '/products/{slug}'` → `href="/products/abc"`; missing slug → `<span>`.
  - missing entry path (field deleted) → empty value, one `console.warn` per (block, path).
  - resolvePage: stored `filter: { active: 'false' }` + `baseFilter { active: 'true' }` → fetcher receives `active: 'true'` (Review Focus); `lockLimit` with stored `limit: 50` → fetcher receives the spec limit; `_locale` present in resolved props, absent after `writePageContent`.
  - invalid spec (hand-edited) → `defineComposedBlock` throws; `defineBlocks` error message names the block (Review Focus — the loader in Task 4 turns this into a reported error).
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm vitest run packages/core/test/blocks`).
- [ ] **Step 5: Commit** — `feat(blocks): defineComposedBlock renderer with fixed filters`

### Task 4: Codegen — print, load and index composed blocks

**Files:**
- Create: `packages/codegen/src/blocks.ts`
- Modify: `packages/codegen/src/pipeline.ts` (`captureProjectFiles`/`restoreProjectFiles` accept `extraDirs?: string[]`), `packages/codegen/src/index.ts`
- Test: `packages/codegen/test/blocks.test.ts`

**Interfaces — Produces:**
```ts
export function blocksDir(config: ResolvedConfig): string;                        // <root>/src/blocks
export function composedBlockFile(config: ResolvedConfig, name: string): string;  // src/blocks/<kebab>/<kebab>.block.ts
export function printComposedBlockFile(spec: ComposedBlockSpec): string;          // header + import + export default defineComposedBlock({...}), stable key order
export function printComposedIndex(entries: { name: string; importPath: string }[]): string; // sorted by name
export function loadComposedBlocks(config: ResolvedConfig): Promise<{ specs: { spec: ComposedBlockSpec; file: string }[]; errors: { file: string; message: string }[] }>;
export function isComposedIndexWired(config: ResolvedConfig): boolean;            // src/blocks/index.ts imports composedBlocks
export function writeComposedBlocks(config: ResolvedConfig, change: { upsert?: ComposedBlockSpec; removeName?: string }): Promise<string[]>; // files written/removed
```
`loadComposedBlocks` reads every `src/blocks/**/*.block.ts` whose source contains `defineComposedBlock` via a fresh jiti that maps `@opencloudcms/core/blocks` to a stub exporting `defineComposedBlock = (s) => s` (so Nest/codegen do not load React), then runs `validateComposedSpec`.

- [ ] **Step 1: Failing tests** — print → load → print is byte-identical; keys in fixed order (`id, name, label, category, icon, version, binding, fields, tree`); `printComposedIndex` sorted and importable; tmp project: invalid file → appears in `errors` with its path, other blocks still load (Review Focus); hand-written `*.block.tsx` (no `defineComposedBlock`) ignored; `writeComposedBlocks` upsert creates folder + regenerates `composed.ts`, remove deletes the folder; `isComposedIndexWired` true/false.
- [ ] **Step 2–4:** `pnpm vitest run packages/codegen` FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(codegen): composed block files and index`

### Task 5: Backend — mutable manifest and blocks API

**Files:**
- Create: `packages/core/src/blocks/page-blocks-manifest.ts` (`PageBlocksManifest` service), `packages/core/src/blocks/blocks.service.ts`, `packages/core/src/blocks/blocks.controller.ts`, `packages/core/src/blocks/blocks-checks.ts` (pure: content-type cross-checks)
- Modify: `registry.service.ts` + `pages/page.hooks.ts` + `pages/pages.service.ts` + `pages/richtext.ts` (read the manifest through `PageBlocksManifest.current()` instead of the captured array), `opencloudcms.module.ts`, `schema-builder.ts` (preview/apply add warnings from `blocks-checks.ts`)
- Test: `packages/core/test/integration/blocks-api.test.ts`, `packages/core/test/unit/blocks-checks.test.ts`

**Interfaces — Produces:**
- `PageBlocksManifest.current(): BlockManifest | undefined`, `.upsert(entry)`, `.remove(name)`.
- `checkSpecAgainstTypes(spec, registry): Issue[]` — every `entry` path / filter / sort / urlPattern placeholder exists on `binding.apiId`, kind compatible with the element prop (spec §5.4 table), filter/sort only `indexed`/`unique`, no `multiple`/reference fields.
- `composedBlockProblems(specs, registry): Record<name, string[]>` (used by GET and schema-builder warnings).
- Routes per Global Constraints / spec §7.1: `GET /api/admin/blocks` (`{ editable, composedIndexWired, data: [{ name, label, category, source, file?, version, usage, problems }], loadErrors }`), `GET /:name`, `PUT /:name` `{ spec, confirmBreaking? }` → `{ spec, files }`, `DELETE /:name?force=1` → `{ files }`. Writes run in `SchemaWriteQueue` with capture/restore including `blocksDir`. `source`: `core` (in `coreBlocks`), `composed` (loaded spec), else `code`.

- [ ] **Step 1: Failing tests** — GET lists core/code/composed with usage counts; PUT new block → file + `composed.ts` written, manifest updated so publishing a page using it immediately returns 200 (no restart); PUT invalid → 422 issues; filter on non-indexed field → 422; `name: 'Hero'` → 409 `block_name_taken` (Review Focus); renaming existing → 422 `name_immutable`; breaking change on a block used by a page → 409 `block_in_use` (message = page count), then 200 with `confirmBreaking` and `version` bumped; DELETE used → 409, `?force=1` → 200 and manifest entry removed; `schemaEditable: false` → 403 for PUT/DELETE, GET 200; failure injected in index printing (spy throws) → all files identical to before (Review Focus); two PUTs fired with `Promise.all` → both blocks in `composed.ts` (Review Focus); schema-builder preview of removing `product.active` returns a warning naming the block. Unit tests for `checkSpecAgainstTypes`.
- [ ] **Step 2–4:** `pnpm vitest run packages/core` FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(core): blocks API and live block manifest`

### Task 6: Eject to TSX

**Files:**
- Create: `packages/codegen/src/eject.ts` (`printEjectedBlockTsx(spec): string`)
- Modify: `blocks.controller.ts`/`blocks.service.ts` (`POST /api/admin/blocks/:name/eject` → `{ file, importLine, files }`)
- Test: `packages/codegen/test/eject.test.ts`, extend `blocks-api.test.ts`

**Interfaces:** Consumes Task 1–5. Produces a `defineBlock` TSX using `b.*` fields and `ui.*` components with literal props, `name`/`version`/`label`/`category` preserved, `baseFilter`/`lockLimit` carried on `b.entries`.

- [ ] **Step 1: Failing tests** — for three fixture specs (single, collection, unbound) the ejected TSX transpiles (`typescript.transpileModule`), loads via jiti with the real blocks package, and `renderToString` of both definitions with the same resolved props is identical; API: eject removes the `.block.ts`, writes `.block.tsx`, regenerates `composed.ts`, manifest unchanged (same name/version); eject in production → 403.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat: eject composed blocks to TSX`

### Task 7: Admin — Blocks list, routes, navigation

**Files:**
- Create: `packages/core/admin/src/pages/Blocks.tsx`, `packages/core/admin/src/lib/blocks.ts` (API client)
- Modify: `navigation.ts` (`{ to: '/settings/blocks', label: 'nav.blocks', permission: 'settings.content-types' }`), `router/match.ts` + `routes.tsx` (`settingsBlocks`, `blockEditor` with `fullScreen: true`, placeholder `pages/BlockEditor.tsx`), `lib/can.ts` route permissions, 4 i18n bundles
- Test: `packages/core/test/admin/router.test.ts` (extend), `packages/core/test/admin/blocks.test.ts`

**Interfaces — Produces:** `listBlocks()`, `getBlock(name)`, `saveBlock(name, spec, { confirmBreaking? })`, `deleteBlock(name, { force? })`, `ejectBlock(name)`; `RouteId` `settingsBlocks`, `blockEditor`.

- [ ] **Step 1: Failing tests** — `matchRoute(['settings','blocks'])`, `(['settings','blocks','ProductCard'])`, `(['settings','blocks','new'])`; client fns hit exact URLs/methods; `blockActions(source, editable)` → composed+editable: edit/eject/delete, code/core: none.
- [ ] **Step 2–4:** FAIL → implement page per spec §8.1 (table, usage, problems badge, `loadErrors` alert, `composedIndexWired` banner with the exact line `import { composedBlocks } from './composed';` + `...composedBlocks`, ConfirmDialog with page count, read-only notice) → PASS; typecheck.
- [ ] **Step 5: Commit** — `feat(admin): blocks settings list`

### Task 8: Admin — Block builder (Puck canvas, panels, save)

**Files:**
- Create: `packages/core/admin/src/block-builder/` — `tree-puck.ts` (pure `treeToPuck(spec)` / `puckToTree(data)`), `element-config.ts` (Puck config for the 15 elements from `ui`), `SourcePicker.tsx`, `BlockPanel.tsx` (label ×4, name, category, icon, manual fields editor, binding: content type, mode, fixed filter rows, sort, limit, layout, option switches, urlPattern, emptyText), `ElementPanel.tsx`, `sample-data.ts`
- Modify: `pages/BlockEditor.tsx` (replace placeholder), i18n bundles, admin `DESIGN.md`
- Test: `packages/core/test/admin/tree-puck.test.ts`, `packages/core/test/admin/block-builder.test.ts`

**Interfaces:** Consumes Task 1 (`validateComposedSpec`, `isBreakingChange`, `ELEMENT_BINDABLE`), Task 3 (`defineComposedBlock` for canvas preview), Task 7 client. Reuses page editor pieces where they fit (autosave is NOT used — explicit Save; `useCan`; asset picker for const images).

- [ ] **Step 1: Failing tests** — `puckToTree(treeToPuck(spec).data)` deep-equals `spec.tree` for the three fixture specs; `sourceOptions(prop, entryFields)` returns only kind-compatible content fields (spec §5.4 table) and no multiple/reference; `filterableFields(typeDef)` returns only indexed/unique; `suggestName('Thẻ sản phẩm' en-US label 'Product card')` → `ProductCard`; save flow reducer: 409 `block_in_use` → `confirm` state with page count, confirm → resend with `confirmBreaking`.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/admin` → FAIL.
- [ ] **Step 3: Implement** the screen of spec §8.2: Puck iframe canvas previewing through `defineComposedBlock` with sample entries (`/api/admin/content/:apiId?status=draft` with the same filter/sort/limit; single → first entry, picker to change); collection mode shows the item template repeated over samples; `name` editable only before first save; Save shows changed files; read-only in production.
- [ ] **Step 4: Verify** unit tests PASS; prod build of my-store + headless Chrome: create a collection block bound to `product` with `active = true`, save (dev server), drag it into a page in the page builder, no CSP violations. Record in report.
- [ ] **Step 5: Commit** — `feat(admin): drag-and-drop block builder`

### Task 9: `init`, my-store, smoke, docs

**Files:**
- Modify: `packages/cli/src/init/templates.ts` + `index.ts` (`src/blocks/composed.ts` with `export const composedBlocks = []`; `src/blocks/index.ts` spreads `...composedBlocks`), `packages/cli/test/init.test.ts`; `examples/my-store` (`composed.ts`, `ProductCard` (single) and `ActiveProducts` (collection, `active = true`, grid 4) block files; add `active` boolean indexed field to `product` via the normal schema + migration flow if missing; seed page uses both), `scripts/smoke-init.mjs`, `README.md`, `packages/core/README.md`, `CHANGELOG.md`

- [ ] **Step 1: Failing tests** — init produces `composed.ts` and the wired index.
- [ ] **Step 2: Implement** → PASS.
- [ ] **Step 3: Smoke** (generated project, composed block file written before build): page with the collection block shows only `active = true` products; PATCH the page content to set the block's stored filter `active: 'false'` via the admin API → published page still shows only active products; `GET /api/admin/blocks` lists the composed block with `usage: 1`.
- [ ] **Step 4: Run** `pnpm build && pnpm test && node scripts/smoke-init.mjs && pnpm --filter my-store typecheck && pnpm --filter my-store build` → PASS.
- [ ] **Step 5: Commit** — `feat: block builder in init and example, smoke and docs`
