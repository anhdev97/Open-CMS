# Collection list, slug modes and entry detail pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `CollectionList` builder element (static content + a repeating list in one block), real slug fields (four modes, SEO slugify, unique), and opt-in entry detail pages (`/products/{slug}`) rendered from one template page per content type, with automatic entry links.

**Architecture:** Schema gains the element, slug options and `detailPage`; the server generates and checks slugs in the entry write path and resolves `by-path` against detail patterns after exact page paths; pages gain kind `detail`. The blocks layer renders CollectionLists from generated `b.entries` fields resolved in `resolvePage`, fills single-entry blocks from the route entry and resolves `entryUrl` from a per-type detail-path map. Admin adds the element to the block builder, a "Detail page" section and slug mode to content types, and detail templates to Pages.

**Tech Stack:** TypeScript, NestJS 11, Kysely/Postgres 16, Next.js 16, React 19, Puck 0.24.1, Tailwind v4, vitest + happy-dom, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-27-collection-list-detail-pages-design.md` (sections 1–5 and decisions 1–14 are binding).

## Global Constraints

- Literal Tailwind classes in lookup tables only; theme colors via `--ocms-color-*`.
- `@opencloudcms/schema` imports no `node:*`, React or lucide; blocks `ui` stays isomorphic; client code only in `@opencloudcms/core/blocks/client`; Next-only code in `blocks/next`.
- Existing specs, pages, content types and entries behave and render byte-identically; existing specs keep today's validation results; the render baseline test stays green.
- A private or unpublished entry never reaches an anonymous request through a detail URL, `entryUrl` or a CollectionList.
- Exact page paths always win over detail patterns.
- Schema writes stay dev-only through `SchemaWriteQueue`; new migrations only add columns or indexes.
- CollectionList: `key` `^[a-z][a-zA-Z0-9]{0,31}$` unique in the block; limit 1–50 (default 12); grid columns 2–6; carousel per view 1–6; max 4 lists per block; no CollectionList inside a CollectionList.
- Slug: no pattern → value is the `documentId` (read-only); optional `pattern` with `{field}`, `{id}`, `{id6}` (first 6 hex, 8 on collision); legacy `from: 'x'` = `pattern: '{x}'`; format `^[a-z0-9]+(?:-[a-z0-9]+)*$`; default `maxLength` 75; typed duplicate → 422 `slug_taken`; publish conflict → 409 `slug_taken`.
- `detailPage.path`: starts with `/`, exactly one `{slug}` or `{id}` as the last segment; not on private types; no overlapping patterns.
- All new admin strings in en-US, vi-VN (accented), fr-FR, id-ID. my-store uses placeholder copy only.

## Review Focus

1. Two entries created concurrently from the same title get distinct slugs (test in Task 2).
2. A page at `/products/sale` with `product` at `/products/{slug}`: the page renders, not a product (test in Task 3).
3. A product unpublished after being cached: detail URL becomes 404, never shows draft data (tests in Tasks 3–4; checked in Task 9).
4. Slug field renamed/deleted or detail page disabled while a template exists: admin explains, website 404s, nothing crashes (tests in Tasks 3, 7).
5. Two CollectionLists of the same type with different filters in one block: both resolve, keys/ids distinct, editor options apply to the right list (test in Task 4).

---

### Task 1: Schema — CollectionList, slug options, detailPage, page kind

**Files:**
- Modify: `packages/schema/src/composed-block.ts`, `packages/schema/src/types.ts`, `packages/schema/src/validate.ts`, `packages/schema/src/pages.ts`, `packages/schema/src/index.ts`, `packages/core/admin/src/block-builder/element-config.ts` (placeholder entry only, for typecheck)
- Create: `packages/schema/src/slug.ts`
- Test: `packages/schema/test/collection-list.test.ts`, `packages/schema/test/slug.test.ts`, `packages/schema/test/detail-page.test.ts`

**Interfaces:**
- Produces:
  - `ComposedElement` gains `'CollectionList'`; props per spec §1 table; `ELEMENT_BINDABLE.CollectionList = []`; `INTERACTIVE_ELEMENTS` unchanged.
  - `collectionListsOf(spec): { key: string; node: ComposedNode }[]`; generated field names `list`, `list2`, … added to the reserved generated names.
  - `FieldOptions.slug` gains `pattern?: string`; `slugify(text: string, locale: string, maxLength = 75): string`; `SLUG_RE`; `slugPattern(field): string | null` (legacy `from` mapped); `parseSlugPattern(pattern, def): { parts; issues }`; `renderSlugPattern(pattern, values, documentId, locale, maxLength): string`.
  - `ContentTypeDefinition.detailPage?: { path: string; slugField?: string }`; `parseDetailPath(path): { prefix: string; param: 'slug' | 'id' } | null`; `matchDetailPath(defs, path): { apiId; value; param } | null`; `detailPatternsOverlap(a, b): boolean`.
  - `PageKind` gains `'detail'`.
- Rules: spec §1 (children = item template with collection rules; outside entry sources only with a single binding; no CollectionList with a block-level collection binding; ≤ 4; no nesting); spec §3 path rules; `slugField` must be a slug field; private types refuse `detailPage`; the `entryUrl` rule from spec §4 (pure validator rejects only when neither a `urlPattern` nor a type context can apply — accept a `detailTypes?: Set<string>` option).
- [ ] **Step 1: Failing tests:**
  - a block Heading + CollectionList{key:'list', apiId:'question'} > Card(entry.question) is valid; `entry.*` outside the list without a single binding → issue; CollectionList inside a CollectionList → issue; 5 lists → issue; duplicate `key` → issue; CollectionList in a collection-bound block → issue; `limit: 51` → issue; existing my-store specs keep their issues;
  - `slugify('Áo Thun Trắng & Đen — Mùa Hè 2026!', 'vi')` = `'ao-thun-trang-va-den-mua-he-2026'`; `renderSlugPattern('{name}-{id6}', …)` = `'ao-thun-trang-3f9a2c'`; `{category}-{name}` joins parts; unknown placeholder `{nope}` → schema issue; legacy `from: 'name'` → `{name}`; `'and'` for `en`; a 90-char title cuts at a dash ≤ 75; emoji/`₫` dropped; `'---'` → `''`;
  - `parseDetailPath('/products/{slug}')` ok; `'/products/{slug}/x'`, `'products/{slug}'`, `'/a/{slug}/{id}'` → null; `{id}` ok; overlap of `/products/{slug}` and `/products/{id}` → true; `detailPage` on a private type → issue; `slugField` naming a text field → issue.
- [ ] **Step 2: Run** `pnpm vitest run packages/schema` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(schema): collection list element, slug modes, detail pages`

### Task 2: Server — slug generation and uniqueness

**Files:**
- Modify: `packages/core/src/entries.service.ts`, `packages/core/src/entry.repository.ts`, `packages/core/src/content.controllers.ts` (error mapping), `packages/core/src/private-entries.service.ts` (same rules), `packages/db/src/index.ts` (index migration only if needed)
- Create: `packages/core/src/slugs.ts`
- Test: `packages/core/test/slugs.test.ts` (integration, Postgres)

**Interfaces:**
- Consumes: Task 1 `slugify`, `slugPattern`, `renderSlugPattern`, `SLUG_RE`.
- Produces: `applySlugs(trx, def, documentId, data, previous): data` called inside the create/update transaction under `pg_advisory_xact_lock(hashtext('opencloudcms.slug.' || apiId))`; uniqueness per type and locale across other documents' draft and published rows; publish re-check (409 `slug_taken`); `{ code: 'slug_taken', path }` 422 on typed duplicates; grandfathering (format checked only when the value changes; empty filled on update); localized/non-localized generation per spec §2.
- [ ] **Step 1: Failing tests:** no pattern → slug = documentId and typed values ignored/rejected; pattern `{name}`: create "Áo thun" → `ao-thun`; second create → `ao-thun-2`; pattern `{name}-{id6}` never suffixes and routing by id part; two concurrent creates (Promise.all) → distinct; edit title when slug untouched → follows; after manual edit → kept; typed duplicate → 422 slug_taken with path; draft of A changes slug to B's published slug → 422; publish after another doc took it → 409; an old entry with slug `Old Value` saves another field without error; empty slug filled on update; localized slug per locale from that locale's title.
- [ ] **Step 2–4:** FAIL → implement → PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(core): slug generation and uniqueness`

### Task 3: Server — detail pages and routing

**Files:**
- Modify: `packages/core/src/pages/pages.service.ts`, `pages.controller.ts`, `page.hooks.ts`, `page.type.ts`, `packages/core/src/registry.service.ts` (detail patterns), `packages/core/src/web/*` (CORS/route tables if they list page routes), `packages/db/src/index.ts` (migration `0009_detail_pages`: page column `detail_api_id text null` + index)
- Test: `packages/core/test/detail-pages.test.ts` (integration)

**Interfaces:**
- Consumes: Task 1 path helpers, Task 2 slugs.
- Produces:
  - Page kind `detail` with `detailApiId`; guards: ≤ 1 template per type (409 `detail_template_exists`), type must have `detailPage` (422 `detail_not_enabled`), no `path` on templates; templates excluded from public lists.
  - `byPath(status, path, locale)`: exact page first; else `matchDetailPath`; entry lookup by slug (or documentId; `titleId` by id suffix) in the locale, published only for public, drafts with a session; returns `{ page: template, routeEntry, detail: { apiId } }`; 404 for missing entry, missing template, misconfigured type, private type.
  - `GET /api/content/opencloudcmsPage/detail-paths` (public): `{ [apiId]: { path, slugField? } }` for enabled non-private types.
  - Admin warnings: `GET` content type status includes `detailTemplate: boolean`, `misconfigured: boolean`, `duplicateSlugs: number`; page save warns when an ordinary page path matches a pattern.
- [ ] **Step 1: Failing tests:** `/products/sale` page wins over the pattern; `/products/ao-thun` returns the template + entry; unknown slug 404; draft-only entry 404 anonymously, 200 with session in draft mode; unpublish → 404; private type cannot enable; second template → 409; template without detailPage → 422; slug field removed in code → 404 + `misconfigured`; detail-paths excludes private and disabled types; templates absent from public lists.
- [ ] **Step 2–4:** FAIL → implement → PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(core): entry detail pages and routing`

### Task 4: Blocks — CollectionList render, route entry, automatic entry links

**Files:**
- Modify: `packages/core/blocks/src/composed/define.ts`, `render.tsx`, `helpers.tsx`, `values.ts`, `packages/core/blocks/src/resolve.ts`, `packages/core/blocks/src/next/page.tsx`, `packages/core/blocks/src/types.ts`
- Test: `packages/core/test/blocks/collection-list.test.ts`, `packages/core/test/blocks/detail-render.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3.
- Produces:
  - `defineComposedBlock` generates one `b.entries` field per CollectionList (`key`) with base filter/sort/limit locks and editor options like block-level collections; render puts each list's entries in its place (grid/list/carousel markup reused), `emptyText`/placeholder when empty.
  - `resolvePage(content, r, f, o & { routeEntry?, detailPaths? })`: resolves list queries in the batch; stamps reserved `_detailPaths`; single-binding blocks whose type equals the route entry's type and whose `entry` is empty get the route entry.
  - `entryUrl` resolution order per spec §4 (CollectionList `urlPattern`, block `urlPattern`, type detail path with `{slug}`/`{id}`, else none).
  - `next/page.tsx`: handles the detail response (template + route entry), 404 via `notFound()`, SEO title/description from the entry (spec §3), caches like pages.
- [ ] **Step 1: Failing tests:** Questions block renders the Heading once and N cards; two lists of one type with different filters resolve separately and editor `limit` on list2 only changes list2; empty list shows `emptyText`; route entry fills an empty single block, a picked entry wins; `entryUrl` uses the type detail path when no urlPattern, `{id}` paths use documentId, no link when neither; render baseline green; anonymous ContentFetcher never returns drafts for lists.
- [ ] **Step 2–4:** FAIL → implement → PASS; `pnpm build`, `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(blocks): collection list rendering, detail route entry, automatic entry links`

### Task 5: Codegen — print/eject CollectionList; detailPage and slug options in schema files

**Files:**
- Modify: `packages/codegen/src/eject.ts`, `packages/codegen/src/blocks.ts`, `packages/codegen/src/printer.ts` (content type printing), `packages/codegen/src/pipeline.ts`
- Test: existing printer/eject tests (extend), `packages/codegen/test/detail-page.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4.
- Produces: round-trip of specs with CollectionLists; eject equality; content type files print `detailPage` and slug `mode` and round-trip; schema writes for these go through the existing pipeline (no DB rewrite).
- [ ] **Steps:** failing round-trip/eject/printer tests → implement → PASS → commit `feat(codegen): collection list eject and detail page schema printing`

### Task 6: Block builder — CollectionList element

**Files:**
- Modify: `packages/core/admin/src/block-builder/element-config.ts`, `Canvas.tsx`, `logic.ts`, `sample-data.ts`, `BlockPanel.tsx`, `templates.ts`, `packages/core/admin/src/pages/BlockEditor.tsx`, admin locale files
- Test: `packages/core/test/admin/collection-list-builder.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4.
- Produces: palette "Data" entry (hidden in collection-bound blocks; respects palette search and Enter-insert rules); keys auto-assigned on drop; props panel (type picker without private types, filter/sort/limit/layout, empty text, urlPattern, editor toggles); bindings inside the list offer that type's fields, outside follow the block binding; canvas fills the list with sample data; template "List with heading".
- [ ] **Step 1: Failing tests:** dropping two lists gives keys `list`, `list2`; item-template binding picker shows the list type's fields; outside the list `entry.*` is not offered; Collection list absent from the palette in a collection-bound block; the template validates in all 4 locales; private types absent from the picker.
- [ ] **Steps 2–5:** FAIL → implement → PASS (+ typecheck) → commit `feat(admin): collection list in the block builder`

### Task 7: Admin — content type Detail page section, slug modes, entry form

**Files:**
- Modify: `packages/core/admin/src/pages/content-types/TypeEdit.tsx`, `FieldSheet.tsx`, `TypeDetail.tsx`, `packages/core/admin/src/pages/content/*` (entry form slug field), admin locale files
- Test: `packages/core/test/admin/detail-page-settings.test.ts`, `packages/core/test/admin/slug-field.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: "Detail page" section (switch off by default, slug field picker, path with live example, hidden for private types, validation messages); refusal to delete/retype the slug field while enabled; status badges (no template, misconfigured, duplicate slugs); slug field Sheet gets "Pattern" (placeholder chips for the type's fields, `{id}`, `{id6}`, live example; empty = id) and `maxLength`; entry form slug input: read-only without a pattern, generated preview, "Regenerate" action, inline `slug_taken`.
- [ ] **Steps:** failing tests (switch writes `detailPage`; `{slug}` without slug field blocked; delete slug field blocked with message; entry form shows slug_taken inline; regenerate fills slugify(title)) → implement → PASS → commit `feat(admin): detail page settings and slug modes`

### Task 8: Admin — detail templates in Pages and the page editor

**Files:**
- Modify: `packages/core/admin/src/pages/Pages.tsx`, `PageEditor.tsx`, `packages/core/admin/src/page-editor/*` (entry picker, field label, preview entry), admin locale files
- Test: `packages/core/test/admin/detail-templates.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 7.
- Produces: "New detail template" listing enabled types without one; templates listed with their type and URL pattern; page editor "Preview entry" picker (default latest published) feeding the canvas route entry; single-entry block fields show "Page entry (from URL)" when empty on templates; warning on ordinary pages whose path matches a pattern.
- [ ] **Steps:** failing tests → implement → PASS → commit `feat(admin): detail templates in pages and the page editor`

### Task 9: my-store, smoke, docs and verification

**Files:**
- Modify: `examples/my-store/src/schema/*` (product slug `pattern: '{name}'`, `detailPage`, new `question` type), `examples/my-store/src/blocks/*` (Questions block; ProductStrip/ProductGrid drop `urlPattern`), `examples/my-store/scripts/seed-pages.ts` (template instead of per-product pages, questions seed), `scripts/smoke-init.mjs`, `README.md`, `packages/core/README.md`, `CHANGELOG.md`
- Test: my-store spec tests, seeds, smoke

- [ ] **Step 1:** spec tests for changed/new blocks — FAIL → implement → PASS.
- [ ] **Step 2:** smoke steps per spec §5 (new product's page renders; unknown slug 404; Questions title once; draft product 404 anonymously).
- [ ] **Step 3:** `pnpm build`, `pnpm vitest run`, `pnpm -r typecheck`, seeds, `node scripts/smoke-init.mjs`.
- [ ] **Step 4:** headless browser: Questions block on home (title once), product card → detail page, detail page at 375/1280, page editor template with preview entry, content type Detail page section, slug Regenerate and slug_taken.
- [ ] **Step 5: Commit** `feat(my-store): questions block, product detail template`
