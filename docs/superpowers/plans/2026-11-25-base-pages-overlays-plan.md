# Base pages, overlays, button actions, private content types and admin page split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Base pages with regions and per-page overrides, named modal/drawer overlays opened by button actions or code, private content types with private files, and the admin content / content-type screens split into separate pages.

**Architecture:** New composed elements (`Region`, `PageContent`, `Overlay`) make layout and overlay blocks; a base page is a page row with `kind: 'base'` whose single layout block is merged with each page's content into one Puck tree before rendering (editor and site share that merge). Overlays are server-rendered `<dialog>`s driven by a module-level client store in a new `@opencloudcms/core/blocks/client` entry. Private types are a `private` flag enforced in core controllers/pickers and an assets visibility with permission-checked streaming. Admin screens move to list/detail/new/edit routes styled like the Account page.

**Tech Stack:** TypeScript, React 19, Next.js 16, NestJS 11, Kysely/PostgreSQL 16, Puck 0.24.1 (pinned), Tailwind v4, react-hook-form + zod, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-25-base-pages-overlays-design.md` (sections 1–8 and decisions 1–15 are binding).

## Global Constraints

- Region / overlay / action target names: `^[a-z][a-z0-9-]{0,31}$`; scroll targets and `anchorId`: `^[A-Za-z][\w-]{0,63}$`.
- Specs, pages, buttons and content types without the new props/flags behave and render byte-identically.
- Literal Tailwind classes in lookup tables only (no interpolated class names); theme colors via `--ocms-color-*`.
- `@opencloudcms/schema` imports no `node:*`; blocks `ui` stays isomorphic; client code only in `@opencloudcms/core/blocks/client` (ESM + CJS, no browser globals at import time); Next-only code in `blocks/next`.
- Native `<dialog>` + `showModal()`; no polyfill. jsdom tests stub `HTMLDialogElement.prototype.showModal/close`.
- Core migrations: `0007_page_kind` (page `kind`, `is_default`, `layout`), `0008_private_assets` (assets `visibility`, `owner_api_id`, `owner_document_id`); page type drift test stays green.
- A private entry or private file never reaches an unauthenticated request (public API, CORS, builder pickers/binding, references, `/media`).
- Theme/schema/block writes stay dev-only (`schemaEditable`) through `SchemaWriteQueue`.
- All new admin strings in en-US, vi-VN (accented), fr-FR, id-ID.
- Admin split (section 8) is UI only: same APIs and permissions; old `/settings/content-types?type=x` and `?tab=groups` links redirect.
- my-store demo uses placeholder copy only.

## Review Focus

1. A page with no `layout` while a default base exists is framed by it; `layout.baseId: null` → no frame; the default base unpublished/deleted is refused, never a 500 on the site (test in Task 6).
2. Draft base content never reaches the public site; draft mode shows the draft base (test in Task 6).
3. Overlay opened then a link inside it navigates → overlay closed, `<html>` scroll class removed (test in Task 2/6).
4. Anonymous probes: `/api/content/order`, `/api/content/order/<id>`, OPTIONS preflight, page block binding to `order`, guessed private file paths → 404/nothing (test in Tasks 9–10).
5. A Button with `action` inside a collection item and inside a base region works; a Button without `action` renders the same HTML as before (tests in Tasks 3 and 6).

---

### Task 1: Schema — new elements, button action, block kinds

**Files:**
- Modify: `packages/schema/src/composed-block.ts`, `packages/schema/src/index.ts`
- Create: `packages/schema/src/actions.ts`
- Test: `packages/schema/test/composed-block.test.ts`, `packages/schema/test/actions.test.ts`

**Interfaces:**
- Produces:
  - `COMPOSED_ELEMENTS` gains `'Region' | 'PageContent' | 'Overlay'`.
  - `OVERLAY_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/`, `ANCHOR_ID_RE = /^[A-Za-z][\w-]{0,63}$/`.
  - `type ButtonAction = { type: 'overlay'; op: 'open'|'close'|'toggle'; target?: string } | { type: 'scroll'; target: string }`; `validateButtonAction(v: unknown, path): ComposedIssue[]` (open/toggle require `target`).
  - `type ComposedBlockKind = 'block' | 'layout' | 'overlay'`; `composedKind(spec): ComposedBlockKind` (root `Overlay` → overlay; any `Region`/`PageContent` → layout; else block).
  - `regionNames(spec): string[]` (tree order).
  - Validation rules: `Region` props `name` (regex, unique), `label?`, `allow?`; exactly one `PageContent` when any `Region`/`PageContent` exists; `Region`/`PageContent` not inside a collection binding and not in an overlay block; `Overlay` only at root, props `variant` (`modal`|`drawer`), `side` (`left`|`right`|`top`|`bottom`, drawer only), `size` (`sm`|`md`|`lg`|`xl`|`full`), `closeOnBackdrop`/`showClose` booleans, `labelledBy?: 'first-heading'`; `Button` prop `action` via `validateButtonAction`; any element prop `anchorId` matches `ANCHOR_ID_RE`.
  - `isBreakingChange` also returns true when `composedKind` changes or the region name list changes.

- [ ] **Step 1: Failing tests** — layout spec (Box > Region header, PageContent, Region footer) valid and `composedKind` = 'layout', `regionNames` = ['header','footer']; duplicate region name → issue at the second Region `props.name`; two `PageContent` → issue; Region without PageContent → issue; Region inside collection binding → issue; `Overlay` not at root → issue; overlay spec `kind` 'overlay'; `{type:'overlay', op:'open'}` without target → issue; `{type:'overlay', op:'close'}` valid; `{type:'scroll', target:'1bad'}` → issue; `anchorId: 'gioi-thieu'` valid, `'a b'` invalid; kind change block→overlay → `isBreakingChange` true; existing my-store specs still valid.
- [ ] **Step 2: Run** `pnpm vitest run packages/schema` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(schema): layout and overlay elements, button actions`

### Task 2: Overlay client runtime (`@opencloudcms/core/blocks/client`)

**Files:**
- Create: `packages/core/blocks/src/client/index.ts`, `client/overlay-store.ts`, `client/ActionButton.tsx`, `client/OverlayTrigger.tsx`, `client/useOverlay.ts`
- Modify: `packages/core/package.json` (exports `./blocks/client` with `import` and `require`), blocks tsconfigs / build script so the entry is in `dist/blocks/client` and `dist/blocks-cjs/client`
- Test: `packages/core/test/blocks/overlay-client.test.ts` (jsdom)

**Interfaces:**
- Produces: `openOverlay(name)`, `closeOverlay(name?)`, `toggleOverlay(name)`, `useOverlay(name) → { open, close, toggle, isOpen }`, `OverlayTrigger({ name, op?, children })` (clones the child with `onClick`), `ActionButton({ action, className, style, children })` (renders `<button type="button">`; `close` without target closes the closest ancestor `dialog[data-ocms-overlay]`, else top-most; `scroll` → `document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' })`), `subscribeOverlays(cb)`, `closeAllOverlays()`.
- Store: finds `dialog[data-ocms-overlay="<name>"]` (first match), `showModal()`, keeps a stack, restores focus to the opener on close, toggles literal class `overflow-hidden` on `document.documentElement` while the stack is non-empty, backdrop click closes when the dialog has `data-close-on-backdrop="true"`, listens to the dialog `close` event to keep the stack in sync (Esc). All DOM access inside functions/effects.

- [ ] **Step 1: Failing tests** (stub `showModal`/`close` to toggle `open` and dispatch `close`): open → dialog open, html has `overflow-hidden`; open second → stack 2, Esc-close (dispatch `close`) on top removes it only; `closeOverlay()` closes top; `closeAllOverlays()` clears class; ActionButton close inside dialog A while B is on top closes A; unknown name → no throw, console.warn once; focus returns to opener; `require('@opencloudcms/core/blocks/client')` in node (no DOM) does not throw.
- [ ] **Step 2–4:** FAIL → implement → PASS; build: `pnpm --filter @opencloudcms/core build` and both `dist/blocks/client/index.js` and `dist/blocks-cjs/client/index.js` exist.
- [ ] **Step 5: Commit** `feat(blocks): overlay client runtime and ActionButton`

### Task 3: Rendering — Overlay, Region/PageContent, actions; library Button; codegen

**Files:**
- Modify: `packages/core/blocks/src/ui/tokens.ts`, `ui/content.tsx` (Button `action`, `anchorId` passthrough), create `ui/overlay.tsx`; `composed/render.tsx`, `composed/define.ts`; `library/basic.tsx` (Button, ButtonGroup items `action`), `fields.ts`/`types.ts` (new block field kind `action` → `b.action()`), `puck-config.ts` (action field metadata for admin), manifest kind; `packages/codegen/src/blocks.ts` (printer key order for new props), `packages/codegen/src/eject.ts`
- Test: `packages/core/test/blocks/{ui,composed,library}.test.ts`, `packages/codegen/test/{blocks,eject}.test.ts`

**Interfaces:**
- Consumes: Task 1 validators/kinds; Task 2 `ActionButton`.
- Produces:
  - `UiOverlay({ name, variant, side, size, closeOnBackdrop, showClose, style, children })` → `<dialog data-ocms-overlay={name} data-close-on-backdrop aria-labelledby>` with literal class tables `OVERLAY_VARIANT`, `OVERLAY_SIDE`, `OVERLAY_SIZE` (Tailwind `backdrop:bg-black/50`, `open:`/`starting:` fade/slide), a × `ActionButton` when `showClose`; `aria-labelledby` points to the first Heading (renderer assigns it an id).
  - `defineComposedBlock` sets `kind` on the definition; overlay blocks get a page-builder field `name` (text, default `kebab(spec.name)`); layout blocks get one slot field per Region `region__<name>` and one slot field `pageContent`; `BlockManifest` entries carry `kind`.
  - Composed `Region` renders its slot field; `PageContent` renders the `pageContent` slot; Button with valid `action` renders `ActionButton` (same classes/style), without → unchanged; `anchorId` → `id`.
  - Library `b.action()` field kind (value `ButtonAction | null`), on `Button` and each `ButtonGroup` item.
  - Printer handles `Region`/`PageContent`/`Overlay` props and `action`/`anchorId`; eject prints `UiOverlay`, imports `ActionButton` from `@opencloudcms/core/blocks/client` only when used, and renders layout slots as props.
- [ ] **Step 1: Failing tests** — overlay spec renders a `<dialog data-ocms-overlay="lien-he">` containing children and a close button; drawer `side:'left'` has the left class from the table; layout spec renders `region__header` content before `pageContent` content; Button `action` open → HTML has `<button type="button"` and no `href`; Button without action → snapshot identical to today; library Button with `action` same; printer round-trip byte-identical for a layout and an overlay spec; eject ↔ composed HTML equality for both; every new class is a literal in a table (extend the compiled-CSS order test with Overlay).
- [ ] **Step 2–4:** FAIL → implement → PASS; full `pnpm vitest run`.
- [ ] **Step 5: Commit** `feat(blocks): overlay, region and page-content rendering; button actions`

### Task 4: Block builder — new elements and the action field

**Files:**
- Modify: `packages/core/admin/src/block-builder/{element-config.ts,tree-puck.ts,Canvas.tsx,BlockPanel.tsx,ElementPanel.tsx}`, `style/StylePanel.tsx` (Overlay sections), `pages/BlockEditor.tsx` (kind-change confirm text), i18n files
- Create: `block-builder/ActionField.tsx`
- Test: `packages/core/test/admin/{block-builder,builder-canvas,style-fields}.test.ts`, `packages/core/test/admin/action-field.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: palette entries Region / PageContent (shown only when the block is not an overlay) and "Overlay" (offered only for an empty root or via "New overlay block"); canvas: Region = labelled dashed drop area, PageContent = hatched placeholder, Overlay root = framed preview at its size/side (not a real modal); `ActionField` (Action select Link / Open / Close / Toggle / Scroll; target combobox; free text allowed with a warning) used for composed Button and registered as the page-editor custom field for `b.action()`; `anchorId` text field (regex error inline); breaking-change dialog names the kind change.
- [ ] **Step 1: Failing tests** — tree-puck round trip of Region/PageContent/Overlay and `action`; ActionField writes `{type:'overlay',op:'open',target:'lien-he'}`, rejects target `Bad Name` with an error and writes nothing; Overlay palette entry hidden when root has children; i18n keys in 4 locales.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(admin): layout and overlay elements and the action field in the block builder`

### Task 5: Base pages — data and API

**Files:**
- Modify: `packages/db/src/index.ts` (`0007_page_kind`), `packages/core/src/pages/{page.type.ts,page.hooks.ts,pages.service.ts,pages.controller.ts,shadowed.ts}`, `packages/schema/src/pages.ts` (types)
- Test: `packages/core/test/integration/{pages-type,base-pages}.test.ts`, `packages/core/test/pages-hooks.test.ts`

**Interfaces:**
- Produces:
  - Page type fields (non-localizable): `kind` (text, default 'page'), `isDefault` (boolean), `layout` (json); migration adds `kind varchar(16) not null default 'page'`, `is_default boolean not null default false`, `layout jsonb` to `ct_opencloudcms_page`.
  - `type PageLayout = { baseId: string | null; regions?: Record<string, 'default'|'replace'|'hide'> } | null` (schema).
  - Hooks: publish of `kind:'page'` requires `path`; publish of `kind:'base'` requires content root = exactly one layout block (manifest kind) and no path; publish of a page with a layout block anywhere → 422 `layout_block_misplaced`; `kind` cannot change after create (422).
  - `PagesService`: `bases(status)`, `defaultBase(status)`, `setDefault(documentId | null)` (base must be published; transaction clears others), `usage(baseDocumentId) → { count, pages: {documentId,title,path}[] }` (pages with `layout->>'baseId'` = id, plus `layout is null` when default), guard delete (409 `base_in_use`, any usage) and unpublish (409 unless `force`), unpublish/delete of the default → 409 `base_is_default`.
  - `byPath` and shadowed paths ignore `kind = 'base'`.
  - Admin endpoints: `GET /api/admin/pages/bases`, `PUT /api/admin/pages/bases/default` `{ documentId | null }`, `GET /api/admin/pages/bases/:documentId/usage`.
  - Public endpoint: `GET /api/content/opencloudcmsPage/base?id=<uuid|default>&locale=` → published base translation (locale, fallback default) or 404; admin twin under `/api/admin/content/opencloudcmsPage/base` returns the draft.
- [ ] **Step 1: Failing tests** — drift test with new columns; create base (no path) and publish with a layout root → ok, with a normal block root → 422; page publish without path → 422; setDefault on a draft base → 409; usage counts explicit + implicit (default); delete used base → 409 with pages; unpublish default → 409; `by-path` never returns a base; public `base?id=default` returns the published default, never the draft.
- [ ] **Step 2: Run** `pg_ctlcluster 16 main start; pnpm vitest run packages/core/test/integration/base-pages.test.ts` — FAIL.
- [ ] **Step 3–4:** implement → PASS; full suite.
- [ ] **Step 5: Commit** `feat(core): base pages data, default base and usage guards`

### Task 6: Base pages — merge and website render

**Files:**
- Create: `packages/core/blocks/src/base-page.ts`, `packages/core/blocks/src/next/overlay-route-watcher.tsx`
- Modify: `packages/core/blocks/src/next/page.tsx`, `next/index.ts`, `blocks/src/index.ts`
- Test: `packages/core/test/blocks/base-page.test.ts`, `packages/core/test/blocks/next-page.test.tsx` (or the existing next page test file)

**Interfaces:**
- Consumes: Task 3 (layout slot fields `region__<name>`, `pageContent`), Task 5 endpoints.
- Produces:
  - `composeWithBase(base: StoredPageContent | null, page: StoredPageContent, layout: PageLayout, manifest): StoredPageContent` — pure: returns base's tree with the layout item's `pageContent` = page content, each `region__<name>` = base default / page `root.props.region__<name>` / `[]` by mode; page root props (title/seo) kept; null base → page unchanged.
  - `containsInteractive(data, manifest): boolean` (any overlay-kind block or any Button/action prop).
  - `OverlayRouteWatcher` (client; `usePathname` change → `closeAllOverlays()`).
  - `next/page.tsx`: fetch base (explicit id → that base; absent layout → `default`; `baseId:null` → none) in the same mode (published/draft), compose, `resolvePage` once on the composed data, render; mount `OverlayRouteWatcher` when `containsInteractive`; base fetch failure → render page alone + one `console.warn`.
- [ ] **Step 1: Failing tests** — compose: default/replace/hide per region, unknown region keys ignored, page content in `pageContent`; `baseId:null` → no frame; data blocks inside base regions are resolved (resolvePage on composed data); public render uses published base even when a draft exists; draft mode uses draft base; base 404 → page renders, no throw; `containsInteractive` true for overlay or action, false otherwise; watcher closes overlays on pathname change.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(blocks): compose pages with their base page on the website`

### Task 7: Base pages — Page builder

**Files:**
- Modify: `packages/core/admin/src/pages/{Pages.tsx,PageEditor.tsx}`, `page-editor/{editor-config.ts,EditorHeader.tsx,data.ts,hooks.ts}`, router (`router/match.ts`, `routes.tsx`), i18n files
- Create: `page-editor/BaseFrame.tsx`, `page-editor/base-fields.tsx`
- Test: `packages/core/test/admin/{pages,page-editor,base-frame}.test.ts`

**Interfaces:**
- Consumes: Task 5 endpoints, Task 6 `composeWithBase`.
- Produces:
  - Pages list tabs "Pages" / "Base pages" (`/pages?tab=base`); base list shows default badge, "Set as default", usage count; "New base page" creates `kind:'base'`.
  - Base page editor: root `DropZone` allows only layout blocks and at most one; no path/SEO fields.
  - Page editor root fields: `Base page` select (Default (name) / bases / None) and a radio per region (Default / Replace for this page / Hide), stored in the entry's `layout` field (page-level, saved with the entry); root `resolveFields` adds slot fields `region__<name>` for replaced regions.
  - Root `render` = `BaseFrame`: draws the composed tree with default regions rendered read-only and dimmed (`pointer-events-none opacity-60`), replaced regions as the root slot fields, hidden regions as a thin labelled marker, page content as `children`.
  - Overlay name duplicates across base + page → warning banner in the editor header (not blocking).
  - Publishing a base shows "Used by N pages" in the confirm dialog (from usage endpoint).
  - All strings in 4 locales.
- [ ] **Step 1: Failing tests** — region radio "Replace" adds `region__header` root field; saving writes `layout` `{ baseId, regions:{header:'replace'} }`; base editor rejects a second root block; frame renders default region content with the dimmed class; duplicate overlay names show the warning; base publish confirm shows the count.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(admin): base pages in the page builder`

### Task 8: Private types and readOnly — schema and codegen

**Files:**
- Modify: `packages/schema/src/{types.ts,define.ts,validate.ts,validator.ts}`, `packages/codegen/src/{snapshot.ts,diff.ts,plan.ts,migration-file.ts,printer.ts}`
- Test: `packages/schema/test/private.test.ts`, `packages/codegen/test/{diff,printer,migration-file}.test.ts`

**Interfaces:**
- Produces: `ContentTypeDefinition.private?: true` (stored only when true), `FieldDefinition.readOnly: boolean` (input `readOnly?: boolean`, stored only when true in printed files); validation: private + `review` → issue, private + localizable field → issue, public type `reference` to a private type → issue; snapshot keeps both; diff: `private` change → plan step `assertTableEmpty(<table>)` emitted into the migration before other steps (throws `Cannot change "private" on <apiId>: the type has entries`); `readOnly` change → no DDL; printer round-trips both.
- [ ] **Step 1: Failing tests** — the cases above; printed schema file byte-identical round trip; generated migration for a private flip contains the guard and fails against a table with a row (integration via existing migration test harness).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(schema): private content types and readOnly fields`

### Task 9: Private types — core API and builders

**Files:**
- Modify: `packages/core/src/{content.controllers.ts,entries.service.ts,registry.service.ts,workflow.service.ts,schema-builder.ts,index.ts,opencloudcms.module.ts}`, content CORS middleware, `packages/core/blocks/src/{resolve.ts,puck-config.ts}`, block builder binding type list, page-editor `ContentTypeField`/`EntriesField`
- Create: `packages/core/src/private-entries.service.ts`
- Test: `packages/core/test/integration/private-types.test.ts`, `packages/core/test/blocks/resolve.test.ts`

**Interfaces:**
- Produces:
  - Public `GET /api/content/:apiId[...]` and OPTIONS → 404 for private types; any public expansion of references/assets skips private targets.
  - Admin create/update: readOnly rule (unchanged value ignored, changed → 422 `read_only` with path; create with non-null readOnly → 422); publish/approve/unpublish/submit/withdraw/reject/version-publish on private → 409 `private_type`.
  - `/api/admin/meta` types carry `private: true`; builder and page-editor type pickers exclude them; `resolve.ts` returns empty for a stored binding to a private type (editor shows a warning).
  - `PrivateEntriesService` (injectable, exported): `create(apiId, data, opts?: { user? })`, `update(apiId, documentId, data, opts?)`, `get(apiId, documentId)`, `list(apiId, params)`, `remove(apiId, documentId)`; may write readOnly fields; same validation and hooks; asset field values may be `{ buffer, filename, contentType }` (stored via Task 10's private upload with owner set).
- [ ] **Step 1: Failing tests** — anonymous GET list/item/OPTIONS on a private type → 404; admin PATCH changing readOnly → 422, unchanged → 200; publish → 409; service create writes readOnly; meta flags private; page block bound to the private type resolves to nothing.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(core): private content types in the API, builders and PrivateEntriesService`

### Task 10: Private files

**Files:**
- Modify: `packages/db/src/index.ts` (`0008_private_assets`), `packages/assets/src/provider/{storage-provider.ts,local.provider.ts,s3.provider.ts,gcs.provider.ts,create-provider.ts}`, `packages/assets/src/nest/{assets.service.ts,assets.controller.ts,local-static.middleware.ts,assets.module.ts}`, core entries service hooks for delete/replace, `packages/core/src/content.controllers.ts` (private upload route)
- Create: `packages/assets/src/sniff.ts`, `packages/assets/src/nest/signed-link.ts`
- Test: `packages/assets/test/{sniff,signed-link,private-storage}.test.ts`, `packages/core/test/integration/private-files.test.ts`

**Interfaces:**
- Produces:
  - Assets columns `visibility varchar(16) not null default 'public'`, `owner_api_id varchar(64)`, `owner_document_id uuid`; private rows store `url = ''`.
  - `StorageProvider.get(key): Promise<Readable>`; private keys under `private/`; local provider stores private files in `<root>/private-assets` (outside the static dir) and the static middleware refuses any path containing `private`.
  - `sniffMime(buf): string | null` (PDF, PNG, JPEG, GIF, WEBP, DOCX/XLSX/ZIP, DOC/OLE, plain text heuristic); upload into a private field checks sniffed type ∈ field `accept` and size ≤ `maxBytes`.
  - `POST /api/admin/content/:apiId/assets` (multipart, `content.update` on the type) → private asset owned by uploader (`owner_document_id` null) until the entry save attaches it; sweeper deletes unattached private assets older than 24 h (runs on module start and hourly via `setInterval`, unref'd).
  - `GET /api/admin/assets/:id/file` streams with `Content-Disposition: attachment`, `nosniff`, `Cache-Control: private, no-store` after `content.read` on `owner_api_id`; `POST /api/admin/assets/:id/link` → `{ url, expiresAt }` (HMAC-SHA256 over id|exp|userId with a key derived via HKDF from the existing auth secret; 5 min); `GET /api/admin/assets/:id/file?token=` works without a session.
  - Private assets excluded from `GET /api/admin/assets`, folders, bulk, public `assets` endpoints; asset fields of public types reject private ids (422); entry delete deletes its private files; replacing a file deletes the old one.
- [ ] **Step 1: Failing tests** — sniff detects PDF from bytes and rejects an `.pdf`-named PNG; private upload not listed in media library; anonymous GET of a guessed local path → 404; download without `content.read` → 403; tampered/expired token → 403; valid token → 200 stream; public type field set to a private id → 422; delete entry removes file; sweeper removes a 25 h old unattached upload.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(assets): private files with permission-checked download and signed links`

### Task 11: Admin — content pages split

**Files:**
- Modify: `packages/core/admin/src/pages/Content.tsx` (becomes the list), router (`router/match.ts`, `routes.tsx`, `lib/can.ts` route ids), `components/FieldInput.tsx` (readOnly prop), i18n files
- Create: `pages/content/{ContentList.tsx,ContentNew.tsx,ContentDetail.tsx,ContentEdit.tsx,EntryFieldsCards.tsx,ReviewActions.tsx,useEntry.ts}`
- Test: `packages/core/test/admin/content-pages.test.ts`, router match tests

**Interfaces:**
- Consumes: existing admin content API (unchanged); Task 9 meta `private`; Task 10 private upload/download for private asset fields.
- Produces: routes `/content/:apiId`, `/content/:apiId/new`, `/content/:apiId/:documentId`, `/content/:apiId/:documentId/edit` (route ids `content`, `contentNew`, `contentDetail`, `contentEdit`); pages styled like Account (`PageHeader`, `Card` per field group, `react-hook-form` + `zod`, inline errors, breadcrumbs, sticky save bar on edit, unsaved-changes guard via `beforeunload` + in-app navigation confirm); detail shows status, locale select, versions, Publish / Submit / Approve / Reject (dialog) / Unpublish / Delete / Edit as the user's permissions and the type's `review` allow; private types hide publish/review/locale controls, readOnly fields disabled, private asset fields upload via `POST /api/admin/content/:apiId/assets` and show filename/size/Download (signed link); required-readOnly types hide "New"; private types show a lock icon in the sidebar content groups and list header.
- [ ] **Step 1: Failing tests** — router matches the four routes; list row click navigates to detail; edit saves via PATCH and returns to detail; reject dialog sends the note; private type detail has no Publish button and a disabled readOnly field; required-readOnly type list has no New; i18n keys in 4 locales.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(admin): content list, detail, new and edit pages`

### Task 12: Admin — content type setup pages split

**Files:**
- Modify: `packages/core/admin/src/pages/Builder.tsx` (becomes the list or is split), `components/ContentGroupsTab.tsx` → groups page with modal, router, `lib/can.ts`, i18n files
- Create: `pages/content-types/{TypeList.tsx,TypeNew.tsx,TypeDetail.tsx,TypeEdit.tsx,FieldSheet.tsx,FieldsTable.tsx,GroupsPage.tsx,GroupDialog.tsx}`
- Test: `packages/core/test/admin/content-type-pages.test.ts`

**Interfaces:**
- Consumes: existing schema-builder API (unchanged); Task 8 `private` and `readOnly` (shown and editable in the type and field forms).
- Produces: routes `/settings/content-types`, `/new`, `/:apiId`, `/:apiId/edit`, `/groups` (route ids `settingsContentTypes`, `settingsContentTypeNew`, `settingsContentTypeDetail`, `settingsContentTypeEdit`, `settingsContentGroups`); redirects `?type=x` → `/:x`, `?tab=groups` → `/groups`; type edit: info Card (name, apiId (create only), group, description, review, private) + FieldsTable (name, kind, required, localizable, readOnly; drag to reorder) with add/edit in a right-side `Sheet` (`FieldSheet`, same options as today's FieldOptions); groups page: table + create/edit/delete in a `Dialog`; production (`schemaEditable` false): no New/Edit buttons, detail read-only.
- [ ] **Step 1: Failing tests** — routes and redirects; edit a field in the Sheet and save sends the same payload shape as today's Builder; reorder changes field order in the payload; private toggle disables localizable/review controls; groups dialog create/edit/delete; read-only mode hides New/Edit.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(admin): content type list, detail, new and edit pages; groups modal`

### Task 13: my-store demo, smoke and docs

**Files:**
- Create: `examples/my-store/src/blocks/{store-frame,contact-modal,mobile-menu}/*.block.ts` (builder format), `examples/my-store/src/content-types/order/order.schema.ts` (+ generated migration via `pnpm cms:generate` or the project's codegen command), `examples/my-store/scripts/seed-orders.ts`
- Modify: `examples/my-store/src/blocks/composed.ts`, `store-header`/`store-footer` blocks (☰ toggle button `menu-mobile` hidden on desktop, "Contact" button and footer link opening `lien-he`), `examples/my-store/scripts/seed-pages.ts` (base page "Store" default; `/`, `/shop`, `/about` without header/footer blocks; `/landing` replacing header with a simple header and hiding footer; `--force` aware), `scripts/smoke-init.mjs` (base page and private type steps), README.md, packages/core/README.md (base pages, overlays, actions, client API, private types, private files, "skip private types" note), CHANGELOG.md
- Test: my-store composed spec tests (validate + printer + eject equality), seed run, smoke

**Interfaces:**
- Consumes: all tasks.
- Produces: StoreFrame layout block (Region `header`, PageContent, Region `footer`); ContactModal overlay (`lien-he`, modal md: heading, text, email/phone links, close button); MobileMenu overlay (`menu-mobile`, drawer left sm: nav links); `order` private type (`code` text required unique, `status` text required, `items` json readOnly, `total` money readOnly, `invoice` asset accept PDF) and `seed-orders.ts` creating 2 orders with a generated placeholder PDF via `PrivateEntriesService`.
- [ ] **Step 1:** spec tests for the three blocks and the order type validation — FAIL → implement → PASS.
- [ ] **Step 2:** `pnpm build`, `pnpm vitest run`, `pnpm -r typecheck`, `cd examples/my-store && pnpm seed:pages -- --force && pnpm tsx scripts/seed-orders.ts`, `node scripts/smoke-init.mjs`.
- [ ] **Step 3: Commit** `feat(my-store): base page, contact modal, mobile menu drawer and private orders`

### Task 14: Verification

**Files:** none (controller task).

- [ ] **Step 1:** Run my-store; screenshots at 375 / 1280 of `/`, `/landing`; open `lien-he` (header button, footer link) and `menu-mobile` (375) in headless Chrome via a small script (click, screenshot, Esc, check `<html>` class removed); navigate from a link inside the drawer and confirm it closes.
- [ ] **Step 2:** Anonymous probes with curl: `/api/content/order`, `/api/content/order/<id>`, `OPTIONS /api/content/order`, `/media/private/...`, `/api/admin/assets/<id>/file` without session/token → all 401/403/404; signed link works then expires.
- [ ] **Step 3:** Admin walkthrough screenshots: content list/detail/edit, type list/detail/edit with field Sheet, groups modal, base page editor with region modes, private order detail with download.
- [ ] **Step 4:** Record differences; fix or ledger them.
