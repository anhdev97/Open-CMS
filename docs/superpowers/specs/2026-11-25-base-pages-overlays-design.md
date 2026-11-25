# Base pages, overlays (modal / drawer) and button actions — design

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

Why: today the header/footer must be dropped on every page, and nothing interactive (contact popup, mobile menu)
can be built without hand-written client code.

Test target: in `examples/my-store`, a base page "Store" (StoreHeader in `header`, StoreFooter in `footer`) used by
`/`, `/shop`, `/about`; a contact modal `lien-he` opened from a header button and a footer link; a mobile menu
drawer `menu-mobile` opened by a ☰ button that is hidden on desktop; a landing page `/landing` that replaces the
header and hides the footer.

## Goals

- Base pages edited in the Page builder, stored with pages (drafts, publish, versions, locales, permissions).
- Page settings: base page select (default / a named base / none) and per-region mode default / replace / hide.
- Layout blocks (block builder) define the regions and the page-content outlet of a base page.
- Overlay blocks (block builder): modal or drawer, named, accessible (focus kept inside, Esc, background inert,
  focus returned), scroll locked while open, closed on navigation, stackable (Esc closes the top one).
- Button action field in the block builder and on the library Button block: open / close / toggle overlay, link,
  scroll to section.
- Client API for code: `openOverlay`, `closeOverlay`, `toggleOverlay`, `useOverlay`, `<OverlayTrigger>`.
- All markup styled with literal Tailwind classes (same rule as the style system), CSS variables for theme colors.

## Non-goals (code-side or a later phase, agreed)

- Auto-open rules (delay, exit intent, once per session), custom animations, project-registered actions
  (`defineActions`, add to cart…). The action field is designed so these can be added later; code can already call
  the client API for its own triggers.
- Base page rules by slug pattern; nested base pages; per-region data binding beyond what blocks already do.
- Forms, menus/navigation data, page templates per content type (separate specs).

## Anti-goals

- A page that renders differently from its editor preview.
- An overlay that traps the user (no way to close) or leaves the page scroll-locked.
- A base page change silently breaking pages: publishing a base page shows how many pages use it.
- New JS on pages that use no overlay or action (they stay JS-free as today).

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
  | { type: 'overlay'; op: 'open' | 'close' | 'toggle'; target?: string } // close without target = top-most
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
closeOverlay(name?: string): void        // no name: top-most
toggleOverlay(name: string): void
useOverlay(name: string): { open(): void; close(): void; toggle(): void; isOpen: boolean }
OverlayTrigger: (props: { name: string; op?: 'open'|'close'|'toggle'; children: ReactElement }) => ReactElement
ActionButton  // used by the renderers
```

- Overlays render as `<dialog data-ocms-overlay="<name>" aria-labelledby=…>` with literal Tailwind classes
  (`backdrop:` variant for the dim layer, `open:` and `starting:` for the default fade/slide); content is
  server-rendered.
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

## Left to the builder

File layout of the new admin pieces, the exact Tailwind classes of the default modal/drawer look, how the Page
builder draws the base frame around Puck's content area, the transaction details of the default flag, and the
my-store demo content (placeholder copy).
