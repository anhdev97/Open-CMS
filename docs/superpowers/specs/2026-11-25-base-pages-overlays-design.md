# Base pages, overlays (modal / drawer), button actions and private content types — design

Date: 2026-11-25 · Status: draft for approval · Branch: `feat/base-page-overlays` (from `main` 6dfa9bc)

## Intent

Enrich the block builder flow so a site's shared frame and its interactive layers are built by drag and drop:

1. **Base pages.** A base page is a frame (header / page content / footer / any other region) that pages sit in.
   Each region holds default blocks. Every page uses a base page (the default one unless it picks another or none)
   and, in its page settings, keeps each region's default, replaces it for that page (drag blocks in), or hides it.
2. **Overlays.** Modals and drawers are built in the block builder like any block, have a name, and open from
   anywhere on the page.
3. **Actions.** A button opens / closes / toggles an overlay by name, chosen in the builder; code does the same with
   a small client API.
4. **Private content types.** Data the admin must see but the public must never reach (orders, customers, CVs):
   `private: true` types that no public API, builder picker or reference exposes, with server-only (`readOnly`)
   fields, a server API for project modules, and private files (asset fields of private types) downloadable only by
   signed-in users with permission.

Why: today the header/footer must be dropped on every page, and nothing interactive (contact popup, mobile menu)
can be built without hand-written client code.

Test target: in `examples/my-store`, a base page "Store" (StoreHeader in `header`, StoreFooter in `footer`) used by
`/`, `/shop`, `/about`; a contact modal `lien-he` opened from a header button and a footer link; a mobile menu
drawer `menu-mobile` opened by a ☰ button that is hidden on desktop; a landing page `/landing` that replaces the
header and hides the footer; a private `order` type (readOnly `total` and `items`, an `invoice` PDF in private storage)
seeded through the server API and managed in the admin, and absent from `/api/content`, the builders' type pickers
and `/media`.

## Goals

- Base pages edited in the Page builder, stored with pages (drafts, publish, versions, locales, permissions).
- Page settings: base page select (default / a named base / none) and per-region mode default / replace / hide.
- Layout blocks (block builder) define the regions and the page-content outlet of a base page.
- Overlay blocks (block builder): modal or drawer, named, accessible (focus kept inside, Esc, background inert,
  focus returned), scroll locked while open, closed on navigation, stackable (Esc closes the top one).
- Button action field in the block builder and on the library Button block: open / close / toggle overlay, link,
  scroll to section.
- Client API for code: `openOverlay`, `closeOverlay`, `toggleOverlay`, `useOverlay`, `<OverlayTrigger>`.
- Private content types: never served publicly, no draft/publish/review/locales, `readOnly` fields, server API,
  private files with permission-checked download.
- All markup styled with literal Tailwind classes (same rule as the style system), CSS variables for theme colors.

- Admin content and content type setup split into separate list / detail / create / edit pages (section 8).

## Non-goals (code-side or a later phase, agreed)

- Auto-open rules (delay, exit intent, once per session), custom animations, project-registered actions
  (`defineActions`, add to cart…). The action field is designed so these can be added later; code can already call
  the client API for its own triggers.
- Base page rules by slug pattern; nested base pages; per-region data binding beyond what blocks already do.
- Forms, menus/navigation data, page templates per content type (separate specs).
- A public submission endpoint (anonymous create into a private type, spam protection) — comes with the Form element.
- Retention / auto-delete policies and download audit log for private data (later phase).

## Anti-goals

- A page that renders differently from its editor preview.
- An overlay that traps the user (no way to close) or leaves the page scroll-locked.
- A base page change silently breaking pages: publishing a base page shows how many pages use it.
- New JS on pages that use no overlay or action (they stay JS-free as today).
- Any path (public API, CORS, builder pickers, reference expansion, media URL, page data binding) through which a
  private entry or private file reaches an unauthenticated request.

## Approaches

**Base page storage**
- **A (picked).** Base pages are rows of the core page type with `kind: 'base'`; they reuse the Page builder,
  drafts/publish, versions, locales and permissions. A page's base choice is a page-level column; replacement blocks
  live in the page's own localized content.
- B. A separate `basePage` type with its own table, API and screens: cleaner split, but rebuilds editor, publishing
  and versions that pages already have.

**Overlay runtime**
- **A (picked).** Native `<dialog>` rendered on the server like any block, plus one small client module that finds
  dialogs by name and calls `showModal()` / `close()`; `showModal()` gives inert background, focus containment, Esc
  and top-layer stacking for free; a drawer is a dialog pinned to one edge.
- B. Popover API only: no JS, but no inert background or focus containment (not a proper modal), hard to drive from
  code, no scroll lock.
- C. React portal modals: client-rendered content, heavier, unlike how every other block renders.

**Private data**
- **A (picked).** A `private` flag on content types and private storage for asset fields of those types, enforced in
  the core (registry, controllers, binding pickers, reference expansion) and in the assets package (separate storage
  area, no static serving, streamed download after a permission check).
- B. Keep private data in project-specific Nest modules and tables: full control, but every project rebuilds admin
  lists, filters, permissions and file handling.

## Design

### 1. Block builder: new elements

| Element | Where allowed | Props | Purpose |
|---|---|---|---|
| `Region` | layout blocks only, not inside a collection | `name` (`^[a-z][a-z0-9-]{0,31}$`, unique in the block), `label`, `allow?` (block names) | a named region of a base page; the base page fills it with default blocks |
| `PageContent` | layout blocks only, exactly one, not inside a collection | — | where each page's own blocks go |
| `Overlay` | only as the root node of an overlay block | `variant: 'modal'\|'drawer'`, `side: 'left'\|'right'\|'top'\|'bottom'` (drawer), `size: 'sm'\|'md'\|'lg'\|'xl'\|'full'`, `closeOnBackdrop: boolean` (default true), `showClose: boolean` (default true), `labelledBy?: 'first-heading'` | the dialog frame; children are any elements |

- A block whose tree contains `Region`/`PageContent` is a **layout block** (`kind: 'layout'` derived, written to the
  block file). It can only be placed as the single root block of a base page, never on a normal page.
- A block whose root is `Overlay` is an **overlay block** (`kind: 'overlay'`). It is placed on pages or base pages
  (any region or the page content); it takes no space in the layout.
- Overlay blocks get one extra page-builder field `name` (default: the block name in kebab case, same regex as
  Region names). Names must be unique across a rendered page (base page + page); the editor warns on duplicates and
  the runtime uses the first.
- Builder canvas: a layout block shows its regions as labelled drop areas and `PageContent` as a hatched area; an
  overlay block is edited inside a frame of its size/side (not as a real modal).
- All existing style sections apply to children; `Overlay` itself gets spacing, size (width/max-width for modal,
  width or height for drawer), colors & border, radius.
- Validation, printer, Export as TSX and the composed renderer support the three elements; specs without them are
  unchanged.

### 2. Button action

Button (composed element and library `Button`/`ButtonGroup` items) gets an optional `action`:

```ts
type ButtonAction =
  | { type: 'overlay'; op: 'open' | 'close' | 'toggle'; target?: string } // close without target: the overlay
                                                                           // containing the button, else top-most
  | { type: 'scroll'; target: string };                                    // element id on the page, smooth scroll
```

- No `action` → today's link button (byte-identical output). With `action`, the button renders as `<button
  type="button">` inside a client `ActionButton` that calls the overlay runtime; `href`/link binding is ignored.
- Builder: "Action" select (Link / Open overlay / Close overlay / Toggle overlay / Scroll to) and a target select
  listing overlay names found on the page and its base page (free text allowed with a warning if not found).
- Validation: `target` names match the Region/overlay name regex; scroll targets `^[A-Za-z][\w-]{0,63}$`.
- Elements get an optional `anchorId` prop (same regex) so Box/Stack/Heading can be a scroll target.

### 3. Overlay runtime (client)

New client entry `@opencloudcms/core/blocks/client` (`'use client'`, ESM and CJS, no browser globals at import time;
see decision 6):

```ts
openOverlay(name: string): void
closeOverlay(name?: string): void        // no name: top-most (code has no containing overlay)
toggleOverlay(name: string): void
useOverlay(name: string): { open(): void; close(): void; toggle(): void; isOpen: boolean }
OverlayTrigger: (props: { name: string; op?: 'open'|'close'|'toggle'; children: ReactElement }) => ReactElement
ActionButton  // used by the renderers
```

- Overlays render as `<dialog data-ocms-overlay="<name>" aria-labelledby=…>` with literal Tailwind classes
  (`backdrop:` variant for the dim layer, `open:` and `starting:` for the default fade/slide); content is
  server-rendered.
- The built-in × (`showClose`) always closes its own overlay.
- Module-level store (no provider): open → `showModal()`; tracks a stack for Esc/close-top; returns focus to the
  opener; adds/removes a literal `overflow-hidden` class on `<html>` while any overlay is open; backdrop click closes
  when `closeOnBackdrop`.
- The page renderer mounts one tiny `OverlayRouteWatcher` (closes all on pathname change) only when the rendered page
  contains an overlay or an action button.
- Code use: `useOverlay('menu-mobile')` in a client component, or `<OverlayTrigger name="lien-he"><button>…`
  inside a code block.

### 4. Base pages: data

- Core migration `0007_page_kind` on `ct_opencloudcms_page` (document level, not localized):
  `kind varchar(16) not null default 'page'`, `is_default boolean not null default false`, and `layout jsonb` (a
  page's base choice, see below). At most one base document is default (enforced in the service, inside a
  transaction). `page.type.ts` gains matching non-localizable fields (drift test updated).
- `path` stays required for `kind = 'page'` at publish (hook) and is absent for base pages; base pages are never
  served by `by-path`, never listed in shadowed paths, sitemap or public listings.
- A base page's content is one layout block at root; the Region contents are its default blocks (localized like any
  page content).
- A page's base choice is page-level (same for every locale), in the `layout` column:

```ts
layout: null                                     // absent/null = use the default base page
      | { baseId: string | null;                 // a base document id; null = no base page
          regions?: Record<string, 'default' | 'replace' | 'hide'> }  // absent region = 'default'
```

- Replacement blocks are localized page content: root props `region__<name>` (one Puck slot field per replaced
  region, top level of `root.props`). `collectBlockNames` already visits root props, so unknown-block checks cover
  them.
- Deleting a base page that pages reference is refused (409 with the list of pages); unpublishing it too, unless
  forced.
- Publishing a base page shows "used by N pages" in the confirm dialog.

### 5. Base pages: admin

- **Page builder › Pages** gets a "Base pages" tab (same list UI): create, edit, publish, set as default.
- Editing a base page: the Page builder with the layout block picker as the only allowed root block; regions are drop
  zones; `PageContent` shows a placeholder.
- **Page settings** (root fields shown when no block is selected): `Base page` select (Default (name) / each base /
  None) and, for each region of the chosen base, a radio Default / Replace for this page / Hide.
- Page canvas: the base frame is drawn around the page content; default regions render the base page's content
  dimmed and not editable; replaced regions are editable drop zones (stored in `root.props.region__<name>`); hidden
  regions show a thin "hidden" marker.
- Strings in en-US, vi-VN, fr-FR, id-ID.

### 6. Base pages: website render

- `next/page.tsx`: load the page, then its base (explicit id, else the default base, else none). Published site: the
  base's published version in the page's locale (fallback default locale); draft mode: the base's draft.
- Render the layout block with each Region filled by mode (default → base content, replace → page's
  `region__<name>`, hide → nothing) and `PageContent` → the page content. Data blocks in both base and page content
  are resolved (`resolvePage` on both).
- A missing or unpublished base renders the page without a frame and logs one warning (never a 500).

### 7. Private content types

**Definition**

```ts
defineContentType({
  apiId: 'order',
  private: true,                       // stored in the snapshot; default false (omitted)
  fields: {
    code:    f.text({ required: true, unique: true }),
    status:  f.select({ options: ['pending', 'paid', 'shipped', 'cancelled'] }),
    items:   f.json({ readOnly: true }),       // readOnly: only the server API writes it
    total:   f.money({ readOnly: true }),
    invoice: f.asset({ accept: ['application/pdf'] }), // asset fields of a private type store private files
  },
});
```

- Validation: a private type cannot have `review: true` or localizable fields (all fields are document-level); a
  public type cannot reference a private type (`reference` target check); `readOnly` is allowed on any type.
- Switching `private` on or off is allowed only while the type has no entries (decision 10).

**Storage and API**

- A private entry has exactly one row, `status = 'draft'` (the working copy); it is never published. Publish,
  approve, unpublish and version-publish endpoints answer 409 for private types.
- `GET /api/content/:apiId[/...]` answers 404 for private types (as if the type did not exist), including CORS
  preflight; reference expansion on public reads never includes private entries (the id is kept, no data).
- Admin API (`/api/admin/content/:apiId`) works as for other types with the usual permissions; writes to `readOnly`
  fields through it are rejected (422 with the field path); the UI shows them disabled.
- Server API for project modules: the injectable `PrivateEntriesService` from `@opencloudcms/core` (decision 13) with
  `create(apiId, data)`, `update(apiId, documentId, data)`, `get`, `list`, `remove` — may write
  `readOnly` fields, runs the same field validation and hooks, never publishes, and accepts files as
  `{ buffer, filename, contentType }` for asset fields (stored privately).
- Builders: private types are absent from `b.entry`/`b.entries` type lists, the block builder's binding type list and
  any page data binding; a stored binding to a private type resolves to nothing (and the editor shows a warning).

**Private files (`@opencloudcms/assets`)**

- `assets` table gains `visibility varchar(16) not null default 'public'` (core migration `0008_private_assets`).
- Private files live under a separate storage area (local: a directory outside the static root, never served by the
  local-static middleware; S3/GCS: a `private/` key prefix without public ACL), so no `/media/...` URL exists.
  `StorageProvider` gains `get(key): Promise<Readable>`.
- Download: `GET /api/admin/assets/:id/file` streams the file after checking the user may read an entry of the type
  that references it (`content.read` on that type); `Content-Disposition: attachment`, `X-Content-Type-Options:
  nosniff`, `Cache-Control: private, no-store`. For links that cannot send headers, the admin gets a short-lived
  signed URL (`?token=`, HMAC, 5 minutes, bound to asset id and user).
- Upload into a private asset field (admin or server API): size limit (assets `maxBytes`), type checked by content
  sniffing against the field's `accept` (extension and declared type alone are not trusted).
- Private files never appear in the media library, folders or the public asset pickers; deleting the entry deletes
  its private files.

**Admin**

- Private types are listed under their content group with a lock icon; their entry screen has no publish, review,
  locale or version-publish controls; `readOnly` fields are shown but disabled; private asset fields show filename,
  size and a Download button.

### 8. Admin UI: separate pages for content and content type setup (UI only)

Today `/content/:apiId` (`Content.tsx`) holds list + side editor + review on one page, and
`/settings/content-types` (`Builder.tsx`) holds type picker (`?type=`), type form, field options and a Groups tab on
one page. Split them into separate pages, styled like the Account page (`PageHeader`, one `Card` per section with
title/description, `react-hook-form` + `zod` with inline errors). APIs, permissions, dev-only schema edits, review
workflow and locales are unchanged; only routes and screens change.

| Route | Page |
|---|---|
| `/content/:apiId` | List: table, status filter (incl. "pending review"), locale select, pagination, "New" |
| `/content/:apiId/new` | Create: field cards, Save (lands on the detail page) |
| `/content/:apiId/:documentId` | Detail: read-only field cards; status, versions; Publish / Approve / Reject / Delete / Edit |
| `/content/:apiId/:documentId/edit` | Edit: field cards, locale select, sticky Save bar, unsaved-changes guard |
| `/settings/content-types` | List of types: name, apiId, group, field count, private, review; "New" |
| `/settings/content-types/new` | Create type |
| `/settings/content-types/:apiId` | Detail: type info card + fields table |
| `/settings/content-types/:apiId/edit` | Edit: type info card + fields table; add/edit a field in a right-side Sheet; drag to reorder |
| `/settings/content-types/groups` | Content groups (moved out of the tab): one list page; create / edit / delete in a modal `Dialog` (small entity, no separate pages) |

- Old links redirect: `/settings/content-types?type=x` → `/settings/content-types/x`, `?tab=groups` → `/groups`.
- Private types (section 7) use the same pages without publish/review/locale/version-publish controls; readOnly
  fields are disabled on edit; required-readOnly types have no "New".
- In production (`schemaEditable` false) the type pages are read-only: no New/Edit, detail only.
- Sidebar entries stay as they are (content groups → `/content/:apiId`, Settings › Content types); breadcrumbs on
  every sub-page.
- Not touched: Pages / Page builder, Blocks, Theme, Users, Groups (users), Languages, Assets.

## Decisions settled during review (builder's calls)

1. **Editor frame:** Puck root config takes `fields` (incl. `slot`) and `render`. The page editor's root `render`
   draws the chosen base's layout block with its real published-or-draft content: default regions rendered read-only
   and dimmed, replaced regions as the root slot fields `region__<name>` (added by root `resolveFields` per replaced
   region), hidden regions as a marker, and `children` (the page content) in `PageContent`. Same renderer as the
   website, so preview = render.
2. **Kind changes of a placed block:** a block becoming or ceasing to be a layout/overlay block is a breaking change
   (existing breaking-change confirm in the block builder). Block pickers filter by kind (base page root: layout
   blocks only; pages and regions: no layout blocks). Page publish rejects a layout block outside a base page root
   and a base page whose root is not a layout block (422, like unknown blocks).
3. **Locales:** base choice and region modes are page-level (`layout` column); region default contents and
   replacement blocks are localized content. A base page missing the page's locale falls back to the default locale.
4. **Usage count** ("used by N pages", 409 on delete/unpublish): page documents of kind `page` (any status) whose
   `layout.baseId` is the base, plus, for the default base, those with `layout` null. Unpublish may be forced; delete
   may not. A plain query on the `layout` column, no extra index.
5. **Default base:** only a published base can be set as default; unpublishing or deleting the default is refused
   until another base is default or the default is cleared. Clearing the default leaves unframed pages unframed.
6. **Client entry:** `@opencloudcms/core/blocks/client` is built ESM and CJS, has no browser globals at import time;
   the composed renderer and library Button import `ActionButton` statically — Next ships its JS only to pages that
   render it, so JS-free pages stay JS-free. Export as TSX imports from the same entry.
7. **Route watcher:** `OverlayRouteWatcher` lives in `@opencloudcms/core/blocks/next` (Next-specific) and is mounted
   by `next/page.tsx` when the resolved base+page data contains an overlay block or an action button.
8. **Overlay names:** two placements of the same overlay block get the same default name; the page editor shows a
   warning (not a publish blocker) and the runtime opens the first. Overlay blocks cannot be placed inside a
   collection item template (they are blocks, not elements).

9. **Private file ownership:** `assets` also gains `owner_api_id` and `owner_document_id` (in `0008_private_assets`).
   A private file belongs to exactly one private entry (no sharing); asset fields of public types reject private
   asset ids. Server API uploads happen inside the create/update call, so the owner is set at once. Admin uploads into
   a private field go to `POST /api/admin/content/:apiId/assets` and are owned by the uploader until the entry saves;
   unattached uploads are deleted after 24 h. Replacing a file deletes the old one on save; deleting the entry deletes
   its files. The download check is `content.read` on `owner_api_id`.
10. **Switching `private` on a type with entries is refused:** the generated migration aborts with a clear message
    if the table has rows (empty the type or export first). No file moves, no row promotion; new types and empty types
    switch freely.
11. **Versions:** private entries keep recording versions like drafts do today (admin-only history of edits); there is
    no publish of versions. Retention/purge is a later phase (non-goal).
12. **`readOnly` in the admin API:** on update, a readOnly field whose value equals the stored one is ignored, a
    changed value is rejected (422 with the path); on create, any non-null readOnly value is rejected. The admin hides
    "Create" for a type that has a required readOnly field (only the server API can create those). `readOnly` is new
    in the field schema and snapshot; adding or removing it is not a breaking change (no DDL).
13. **`PrivateEntriesService`:** an injectable Nest service exported from `@opencloudcms/core` (project modules inject
    it). Same field validation and registered entry hooks as the admin API; actor `system` (no `createdBy`) unless the
    caller passes `{ user }`; each call runs in its own transaction (sharing the caller's transaction is a later
    addition).
14. **Other exposure paths checked:** public content controllers and CORS, page/block data binding and the editor
    pickers, reference expansion, static media. Admin-only endpoints (`/api/admin/meta`, schema builder) may list
    private types. Core has no webhooks, search or sitemap today; whoever adds them must skip private types (noted in
    the core README).
15. **Signed links:** `POST /api/admin/assets/:id/link` (same permission as download) returns `{ url, expiresAt }`;
    the token is an HMAC over asset id, expiry and user id, keyed by a key derived from the existing auth secret; it is
    checked without a session and expires after 5 minutes.

## Constraints

- Puck 0.24.1 pinned; Tailwind v4 literal classes only; `@opencloudcms/schema` has no `node:*`; blocks `ui` stays
  isomorphic, client code only in the new `client` entry; dual ESM/CJS for the existing entries.
- Specs, pages and buttons without the new props render byte-identical output.
- Native `<dialog>`/`showModal()` (all current browsers); no polyfill.
- 4 admin locales; existing suites green.

## Review focus (for the plan)

1. Page with no `base` while a default base exists → framed by the default; `layout.baseId: null` → no frame.
2. Base page edited (region content changed) and published → every page using it shows the change; draft base never
   leaks to the public site.
3. Two overlays with the same name on page + base → editor warning, runtime opens the first; no crash.
4. Overlay open, user navigates (link inside the overlay) → overlay closed, scroll unlocked.
5. Button with `action` inside a collection item and inside a base region → works; without `action` → unchanged HTML.
6. Private type: `/api/content/order`, `/api/content/order/:id`, a public type's reference expansion, a page block
   binding and a guessed `/media/private/...` URL all return nothing to an anonymous request.
7. Private file download by a signed-in user without `content.read` on the type → 403; expired or tampered token →
   403.

## Left to the builder

File layout of the new admin pieces, the exact Tailwind classes of the default modal/drawer look, how the Page
builder draws the base frame around Puck's content area, the transaction details of the default flag, and the
my-store demo content (placeholder copy).
