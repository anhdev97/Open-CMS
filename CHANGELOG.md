# Changelog

## Unreleased

### Security

- Next.js raised to `^16.4.6` (core, my-store and the `opencloudcms init` scaffold) for the 16.4.4 and earlier advisories (cache leaks across root params, image-optimizer SVG bypass).
- `sharp` raised to `^0.35.5` (libvips, libheif and librsvg CVEs); vitest raised to `^4.1.12` (tinypool prototype-pollution RCE in the test runner).
- pnpm overrides pin patched transitive versions: `body-parser ^2.4.0`, `multer ^2.5.0`, `qs ^6.16.1`, `fast-xml-parser ^5.12.0`, `uuid ^11.1.1`.
- Known remaining: `zod` 3.x (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized constrained collections) has no 3.x fix; it needs the zod 4 migration.

### Fixed

- **Private files on S3/GCS can use their own bucket.** `assets.s3.privateBucket` / `assets.gcs.privateBucket`
  (optional) receive every private file (`put`, `get` and `delete` with `visibility: 'private'`). Without it private
  files share the media bucket under `private/`, and the provider sets no ACL: a bucket that serves public reads must
  deny them on `private/*` (see "Private files" in the core README).
- **Publishing no longer changes the draft's `updatedAt`.** Only its `publishedAt` moves (`hasUnpublishedChanges`
  stays `updatedAt > publishedAt`), so a save sent with the `If-Match` the editor saw before Publish succeeds
  instead of answering 409 `stale_draft`. The page editor also re-reads the draft version after publishing.
- **Rich text of pages is sanitized.** The website rendered `b.richText` HTML through a Puck Suspense fallback
  that wrote the stored HTML as is (event handlers, `javascript:` links). Rich text is now normalized with the
  editor's schema (`normalizeRichText`, `@tiptap/*` `3.35.0` pinned): on save by the server (`blockManifest` now lists
  each block's `richText` paths; projects passing `blockManifest(blocks)` get them without changes), when content is read
  (`readPageContent`), and rendered in place on the website (`richTextFieldTransforms`).
- A value that breaks a `unique` field on save or publish answers 409 `unique_violation` (with the field in
  `issues`) instead of a 500.
- **Core link buttons drop unsafe URLs.** The links of `Button`, `ButtonGroup`, `Card`, `Hero` and `CallToAction` go
  through `safeHref` (also exported as `ui.safeHref`): only `http(s):`, `mailto:`, `tel:`, root-relative paths, `#…`
  and `?…` stay links; anything else (`javascript:`, `data:`, `//host`, `/\host`) renders as plain text. Tab, CR
  and LF are removed before the check (browsers ignore them, so `/<TAB>/evil.com` is `//evil.com`).
- **Dev server shutdown on Ctrl+C.** Nest could hang on HTTP `server.close()` (HMR keep-alive) or
  `next.close()` when Turbopack/PostCSS workers died from the process-group SIGINT. `@opencloudcms/core`
  now drops open connections before dispose, times out Web UI close + `db.destroy()`, SIGKILLs remaining
  child processes, installs a hard exit deadline (~4s) on SIGINT/SIGTERM, and scaffold/`main.ts` use
  `enableShutdownHooks(['SIGINT', 'SIGTERM'], { useProcessExit: true })`.

### Breaking changes

- **`StorageProvider` gains `get(key, visibility?)`, and `put`/`delete` take an optional `visibility`**
  (`'public'` default, `'private'` for private files). Custom providers must implement `get`. The local provider
  stores private files in `assets.local.privateRoot` (default: `private-assets` next to `assets.local.root`; the two
  may not contain each other, symlinks included). **The local `/media` middleware now answers 404 for any path with
  a `private` or `private-assets` segment**: public files uploaded earlier into a media folder whose slug is
  `private` (key `private/…`) are no longer served there; upload them again (moving a file does not change its key;
  new uploads into such a folder get the key segment `private-folder`).

- **CORS preflight answers 404 for every `/api/content/<segment>` that is not served publicly.** Only public content
  types and the asset lookup `/api/content/assets` get CORS headers and a 204 preflight; an `OPTIONS` request for an
  unknown or private type **or for a custom route you mounted under `/api/content/<custom>`** now answers 404
  (`not_found`, no CORS headers), the same as a `GET` of an unknown type, so a private type cannot be told from a
  missing one. Move custom cross-origin routes out of `/api/content`.
- **A custom `ContentFetcher` that can read private entries must implement `privateApiIds()`**
  (`() => Promise<ReadonlySet<string>>`, the apiIds of private types). `resolvePage` drops bindings to those types
  before fetching; a fetcher without it makes the resolver fail open, so a block bound to a private type would render
  its entries (for example with an admin or draft fetcher of your own). The built-in `adminFetcher` implements it;
  `publicFetcher` needs none (the public API answers 404 for private types).
- **The my-store `StoreHeader` is one row at every width** (it was stacked on mobile): its nav links are hidden on
  mobile, where the new ☰ button opens the `menu-mobile` drawer, and a Contact button opens the `lien-he` modal.
  `StoreHeader` and `StoreFooter` moved from the pages into the base page "Store" (`pnpm seed:pages -- --force`
  rewrites the seeded pages).

- **Publishing a page without a path answers 422 `path_required`** (was 400 with a validation issue on `path`):
  `path` is now required by the page hooks for `kind: 'page'` only, since base pages have none.

- **Core link buttons drop links they used to render.** Because of `safeHref` (see Fixed), existing page content
  whose `Button`, `ButtonGroup`, `Card`, `Hero` or `CallToAction` links are relative without a leading `/`
  (`contact`, `./x`, `../x`, `www.example.com`) or use a scheme outside `http(s):`, `mailto:`, `tel:` (`sms:`,
  `whatsapp:`, `ftp:`, app deep links, …) now renders as plain text instead of a link. Edit those links to a
  root-relative path (`/contact`) or a full `https://` URL.
- **The content type API id `assets` is reserved** (the public asset lookup `GET /api/content/assets?ids=`). A project
  that has a content type with `apiId: 'assets'` no longer loads (`apiId "assets" is reserved by OpenCloudCMS`): rename
  its `apiId` (and migrate its tables) before upgrading.
- **`opencloudcms init` no longer writes a static home page.** `app/(site)/page.tsx` is replaced by the page-builder
  catch-all `app/(site)/[[...path]]/page.tsx`, which shows a welcome page at `/` until a page is published there.
  Existing projects keep their files; to adopt the page builder, copy from a fresh `opencloudcms init`:
  `src/blocks/`, `app/(site)/[[...path]]/page.tsx`, `app/(site)/%5F_opencloudcms/`, `app/(admin)/admin/AdminWithBlocks.tsx`
  (and make `[[...slug]]/page.tsx` re-export it), the `@source` lines of `app/globals.css`, `"jsx": "react-jsx"` in
  `tsconfig.server.json` and `pages: { blocks: blockManifest(blocks) }` in `src/app.module.ts`; then delete your
  `app/(site)/page.tsx` (a file route at `/` would hide the page built for `/`).
- **The content type API id `opencloudcmsPage` is reserved** for the core page content type (tables
  `ct_opencloudcms_page`, `ct_opencloudcms_page_l10n`, created by a core migration). A project content type cannot
  use it.
- **The project and npm packages are renamed to OpenCloudCMS and `@opencloudcms/*`.** Install
  `@opencloudcms/cli`, run the `opencloudcms` binary, use `opencloudcms.config.ts` / `.js`, rename environment
  variables to `OPENCLOUDCMS_*`, and update imports to the new package scope. No compatibility aliases are
  provided. Existing `opencms_*` SQL identifiers are intentionally unchanged to preserve deployed databases.
- **Roles became permission groups.** Migration `oauth2_0003_groups` (applied by `opencloudcms migrate:up`, run by
  `start`, or `autoMigrate`) renames the tables `auth_roles` → `auth_groups` and `auth_user_roles` →
  `auth_user_groups` (column `role_id` → `group_id`); the `super_admin` role becomes the system group
  `super-admin` and every existing user keeps it. Queries that read those tables directly must be updated.
- **`@RequireRole` is removed.** Use `@RequirePermission(...permissions)` from `@opencloudcms/oauth2` with the
  permission the route needs (`content.*`, `settings.*`); missing → 403 `forbidden`. `RequestUser` /
  `GET /api/auth/me` gain `groups`, `permissions` and `isSuperAdmin`. Every `/api/admin/**` route now checks a
  permission instead of "any signed-in user is super admin".
- **Users need groups.** `POST /api/admin/users` requires `groupIds` (at least one group id; unknown → 422);
  `PATCH /api/admin/users/:id` accepts `groupIds`. Users who are not Super Admins cannot grant permissions they
  lack nor modify a Super Admin user (403 `forbidden`).

- **Locale codes are region codes.** Supported: `en-US`, `vi-VN`, `fr-FR`, `id-ID` (`en-US` is the default and the
  fallback). Short codes such as `en` / `vi` are rejected when the config is resolved (the error lists the supported
  codes), and so are an empty or duplicated `locales` and a `defaultLocale` outside `locales`. Fix the config:
  move `defaultLocale` / `locales` into `src/locales.ts` (`export default defineLocales({ defaultLocale: 'en-US',
  locales: ['en-US', 'vi-VN'] })`) and spread it in `opencloudcms.config.ts` (`...locales`), or keep them inline with
  the new codes. Existing content is converted by the core migration `0002_region_locales`, applied by
  `opencloudcms migrate:up` (run by `start`) or `autoMigrate`; it rewrites
  `locale` in every `*_l10n` table (`en`→`en-US`, `vi`→`vi-VN`, `fr`→`fr-FR`, `id`→`id-ID`); a row whose new
  code would collide with an existing `(entry_id, locale)` is left as is and logged. API clients must send the
  new codes (`?locale=vi-VN&fallback=en-US`); a locale that is not enabled answers 400 `locale_not_enabled`.

- **The admin is Next App Router modules, not a Vite SPA.** One Next app in your project serves the admin
  (`/admin`) and your website (`/`) from inside the Nest process. Removed: `OPENCLOUDCMS_ADMIN_DEV`, the
  `admin.enabled` / `admin.distDir` options (use `web: { enabled, dir, dev }`; `admin.enabled: false`
  becomes `web.enabled: false`), `dist/admin` as a served SPA, and the `vite`, `@vitejs/plugin-react`,
  `@tailwindcss/vite`, `react-router` dependencies. `next ^16`, `react ^19`, `react-dom ^19` are optional
  peer dependencies of `@opencloudcms/core`. Production requires `NODE_ENV=production`, `OPENCLOUDCMS_PUBLIC_URL` and
  `build` before `start`; `.next/cache` is local, so run a single instance.
  Migrating a project created by an earlier `opencloudcms init`: run `opencloudcms init` into a new directory and copy
  `app/`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `tsconfig.server.json` and the
  `package.json` scripts/dependencies (`dev`, `build`, `start`; `next`, `react`, `react-dom`, `cross-env`,
  `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `@types/react`, `@types/react-dom`); add `.next/` to
  `.gitignore`; point `web.dir` at the project root if the process does not start there.

- **Request bodies are parsed only for backend paths** (`/api`, `/oauth2/interaction`). Nest controllers you add
  outside `/api` (e.g. `POST /webhooks/x`) get `req.body === undefined`: mount them under `/api`, or apply your
  own body parser to your own paths (the app is still created with `bodyParser: false`).

- **`adminToken` option and `OPENCLOUDCMS_ADMIN_TOKEN` are removed.** `/api/admin/*` is now protected by the
  session of a signed-in user (`@opencloudcms/oauth2`). Remove the option and the variable; create the first
  super_admin at `/admin` (or seed it with `OPENCLOUDCMS_ADMIN_EMAIL` / `OPENCLOUDCMS_ADMIN_PASSWORD`).
- **CORS for the admin API is removed.** The admin UI is served by the same origin, so `/api/admin/**` no
  longer sends CORS headers. To let a storefront on another origin read the delivery API, list its exact
  origin in `OpenCloudCmsModule.forRoot({ cors: { origins: [...] } })`; this applies to `GET`/`HEAD`/`OPTIONS` on
  `/api/content/**` only, without credentials.
- **`/api/**` error format.** Every failure now answers `{ "error": { "code": string, "message": string, "issues"?: unknown[] } }`
  (`issues` carries per-item details such as schema validation errors). Clients that read the old
  NestJS body (`statusCode`/`message`/`error`) must be updated.
- **`OPENCLOUDCMS_INTERNAL_URL` (and the `internalUrl` auth setting) is removed.** The BFF always calls its own
  provider at `http://127.0.0.1:${PORT ?? 4000}`. `OPENCLOUDCMS_PUBLIC_URL` is optional outside production
  (default `http://localhost:${PORT ?? 4000}`) and required when `NODE_ENV=production`. The default `PORT`
  is 4000 everywhere.
- Host apps must create the Nest app with `{ bodyParser: false }`; `@opencloudcms/core` parses request bodies
  itself (oidc-provider needs the raw `/oauth2` requests).
- **Asset API responses are camelCase.** `/api/admin/assets` rows now use `mimeType`, `storageKey`, `createdAt`,
  `variants`, … instead of the raw snake_case columns (`mime_type`, `created_at`); `GET /api/admin/assets` also
  returns `meta.uploadEnabled` (true when `assets` is configured). Clients reading the old fields must be updated.

### Added

- **Base pages.** Rows of the page type with `kind: 'base'` (core migration `0007_page_kind`: `kind`, `is_default`,
  `layout`), edited in **Page builder > Pages > Base pages** with drafts, publish, versions, locales and permissions.
  A base page's content is one **layout block** (a composed block with `Region` elements, slot fields
  `region__<name>`, and one `PageContent`, field `pageContent`); publish checks: 422 `invalid_base_root`,
  `layout_block_misplaced`, `base_has_path`. A page's `layout` (`null | { baseId?: string | null; regions?:
  Record<string, 'default' | 'replace' | 'hide'> }`, absent `baseId` = the default base, `null` = none) chooses its
  frame; replaced regions are the page's root props `region__<name>`. `PUT /api/admin/pages/bases/default`,
  `GET /api/admin/pages/bases`, `GET /api/admin/pages/bases/:id/usage`, `GET /api/content/opencloudcmsPage/base`;
  409 `base_is_default`, `base_in_use`, `base_not_published`. The website composes the page with its base
  (`composeWithBase` from `@opencloudcms/core/blocks`); a missing base renders the page alone with one warning.
  `PagesService` is exported from `@opencloudcms/core` and `OpenCloudCmsModule`.
- **Overlays (modal / drawer) and button actions.** Block Builder elements `Overlay` (root only: `variant`, `side`,
  `size`, `closeOnBackdrop`, `showClose`, `labelledBy`), `Region`, `PageContent`, and an `anchorId` prop on elements.
  Overlay blocks get a page-builder `name` field and render as `<dialog data-ocms-overlay>`. A `Button` (composed, and
  the library `Button` / `ButtonGroup` items) takes `action: { type: 'overlay', op: 'open' | 'close' | 'toggle',
  target? } | { type: 'scroll', target }`; without one the output is unchanged. Printer and Export as TSX support all
  three elements and actions.
- **Client overlay API** `@opencloudcms/core/blocks/client` (`'use client'`, ESM and CJS): `openOverlay`,
  `closeOverlay`, `toggleOverlay`, `closeAllOverlays`, `isOverlayOpen`, `subscribeOverlays`, `useOverlay`,
  `<OverlayTrigger>`, `ActionButton`. The page renderer mounts `OverlayRouteWatcher` (closes overlays on navigation)
  only on pages with an overlay or an action button.
- **Private content types.** `private: true` on a content type and `readOnly: true` on fields (`@opencloudcms/schema`;
  no `review`, no localizable fields, not a `reference` target of a public type, switchable only while empty).
  `/api/content` answers 404 for them (preflight included), builders and reference expansion leave them out, entries
  are never published (409 `private_type`) and have no version history, and the admin API refuses `readOnly` writes
  (422 `read_only`). Server code uses the injectable **`PrivateEntriesService`** (`create`, `update`, `get`, `list`,
  `remove`; may write `readOnly` fields; file values `{ buffer, filename, contentType }` for asset fields).
  `GET /api/admin/content/:apiId/:documentId/files` lists an entry's private files.
- **Private files** (`@opencloudcms/assets`, core migration `0008_private_assets`: `assets.visibility`). Asset fields
  of private types store files outside the public media (`assets.local.privateRoot`; `private/` key prefix on
  S3/GCS), with no URL and absent from the media library. Upload `POST /api/admin/content/:apiId/assets` (type sniffed
  against `accept`, `maxBytes`), download `GET /api/admin/assets/:id/file` (`content.read`, attachment, `no-store`),
  5-minute signed link `POST /api/admin/assets/:id/link`. Unattached uploads are swept after 24 h; deleting the entry
  deletes its files. `AssetsService` gains `uploadPrivate(file, { ownerApiId, accept, uploadedBy? })`,
  `openPrivate(id)` → `{ asset, stream }` and **`deletePrivate(id: string, expected: { ownerDocumentId: string | null
  }): Promise<boolean>`**: it deletes the row only while the file is still owned as the caller saw it
  (`ownerDocumentId`, `null` = unattached), then the storage object (`StorageProvider.delete(key, 'private')`; a
  storage failure is logged and the object orphaned), and returns whether the row was deleted.
- **Admin: separate pages for content and content type setup.** Content list / detail / new / edit pages and content
  type list / detail / new / edit pages (content groups in a modal); private types show a lock, no publish, review,
  locale or version controls, disabled `readOnly` fields and a Download button for private files.
- **examples/my-store: base page, overlays and private orders.** `StoreFrame` (layout: `header`, page content,
  `footer`), `ContactModal` (`lien-he`, md modal) and `MobileMenu` (`menu-mobile`, small left drawer) blocks;
  `seed:pages` publishes the default base page "Store" and `/landing` (header replaced, footer hidden); a private
  `order` type (`code`, `orderStatus`, readOnly `items` and `total`, PDF `invoice`) and `pnpm seed:orders` (two
  orders with a generated placeholder PDF, through `PrivateEntriesService`). The smoke test (`scripts/smoke-init.mjs`)
  covers the base frame, region replace/hide, the overlays and the private type with a private invoice.

- **`opencloudcms init` writes `src/theme.ts`** (one palette: `surface`, `ink`, `accent`, `accent-ink`) and renders
  `<ThemeStyle theme={theme} />` in the `<head>` of `app/(site)/layout.tsx`, whose body uses
  `bg-(--ocms-color-surface) text-(--ocms-color-ink)`. **Existing projects:** add `src/theme.ts` (or save once in
  Page builder > Theme) and the `ThemeStyle` line to use `brand:<name>` colors on the website.
- **Style system for composed blocks.** Every `ComposedNode` takes an optional `style` (`NodeStyle`, validated with
  the block: 422 `invalid_block` with the path of a bad value): `padding` / `margin` (per side `t`/`r`/`b`/`l`),
  `width`, `maxWidth`, `height`, `minHeight`, `background`, `color`, `borderWidth`, `borderSides`, `borderColor`,
  `radius`, `hidden` and, inside `Columns`/`Grid`, `span` (1–12 or `'full'`).
  - **Breakpoints** `base` (mobile) / `md` (≥ 768px) / `lg` (≥ 1024px), mobile-first: a value is plain (`'4'`) or
    per breakpoint (`{ base: '4', md: '12' }`), and a missing breakpoint inherits the smaller one. `hidden` is
    `{ base?, md?, lg?: true }`.
  - **Values:** lengths are a spacing token (`0`–`24`), a number with `px`, `rem`, `em`, `%`, `vw` or `vh` (at most
    10000; negative only for margin) or `auto` (width, height, margin); colors are a semantic token (`primary`, `muted`,
    …), `brand:<name>` (a color of `src/theme.ts`, through `var(--ocms-color-<name>)`) or hex; `radius` is
    `none`/`sm`/`md`/`lg`/`xl`/`full` or px; `borderWidth` `0`/`1`/`2`/`4` or px. Values reach the page as `--ocms-*`
    CSS variables on literal classes (no class interpolation, no free CSS); a style value replaces the element's
    token class for the same property.
  - **New element props:** `Columns` `tracks` (per breakpoint, `<n>fr` / `auto` / length, rendered as
    `minmax(0,<n>fr)` so content cannot widen a column), `alignY`, `gapX`, `gapY`; `Stack` `justify`, `wrap` and
    per-breakpoint `direction` and `align`; `Image` `fit` (`cover`/`contain`) and per-breakpoint `aspect`.
  - **Legacy props migrate on the first edit** in the Block Builder: Box/Card `padding` becomes `style.padding` and
    Columns `count` becomes `tracks` (same rendering); files change only when saved, and blocks never edited keep
    rendering byte-identical classes.
  - **For ejected and hand-written TSX blocks:** `ui.styleProps(style, display?)` (`{ className, style }`),
    `ui.cssLength`, `ui.cssColor`, `ui.cssTracks`, `ui.resolveTracks` and `ui.layoutStyle`; every `ui` primitive takes
    `style`. **Export as TSX** prints each node's `style` (valid properties only) as a `style={…}` literal and the new
    props (responsive values as object literals), so the ejected block renders the same HTML.
  - **Library `Columns`:** a `tracks` field (column-width presets per breakpoint, up to 6) and slots 5–6; stored
    `columns` still renders as before.
- **Brand themes.** `src/theme.ts` exports `defineTheme({ colors, palettes, activePalette })` (from
  `@opencloudcms/schema`): named colors and switchable palettes of hex values. `<ThemeStyle theme={theme} palette? />`
  (from `@opencloudcms/core/blocks`, server-safe) writes the active palette as `--ocms-color-<name>` variables.
  `GET /api/admin/theme` (permission `content.read`; `{ theme, editable }`) and `PUT /api/admin/theme` (permission
  `settings.content-types`, dev only like the schema; 422 with `issues` for an invalid theme) read and rewrite the
  file; the admin edits it in **Page builder > Theme** (`/admin/settings/theme`).
- **Builder canvas:** a device toggle (Mobile 375 / Tablet 768 / Desktop 1280) in the Block Builder and page editor
  headers resizes the canvas and sets the breakpoint the style panel edits (inherited values shown muted, with a
  reset); a palette select previews the theme's palettes without saving. The style panel shows the sections of each
  element (Spacing box model, Size, Colors & border, Visibility, column span).
- **examples/my-store storefront:** the editorial store mockup rebuilt with Block Builder files only
  (`StoreHeader`, `StoreHero`, `SectionHead` with a slot, `FeaturedProducts`, `StoryBand`, `StoreFooter`) and `src/theme.ts` (palettes `olive`, `clay`,
  `night` of `surface`, `feature`, `ink`, `accent`, `accent-ink`, `line`); serif display type in `app/globals.css`,
  scoped to the website with `.ocms-site`. `seed:pages` publishes it at `/` (en-US + vi-VN) and takes `--force` to
  replace the content of pages that already exist. The sample products get photos uploaded to the media library
  (also added to existing sample products with `--force`).
- **Block Builder:** an `Image` may show a `multiple` asset field of the bound entry (its first asset).
- **Admin sidebar:** Pages and Blocks now sit together in a top-level **Page builder** group (Blocks moved out of Settings; URLs unchanged).
- **Block Builder** (Page builder > Blocks, `/admin/settings/blocks`, permission `settings.content-types`): build page
  blocks with drag and drop from design-system elements (`Box`, `Stack`, `Columns`, `Grid`, `Card`, `Slot`, `Heading`,
  `Text`, `Image`, `Button`, `Badge`, `Price`, `Date`, `Divider`, `Spacer`), bound to nothing, to one entry or to a
  list of entries of a content type, with manual fields, a live canvas with sample entries, and four admin languages.
  Saving writes files (dev only, like the Content Type Builder); the page editor can use a saved block at once,
  production needs a rebuild.
  - Each block is `src/blocks/<name>/<name>.block.ts` exporting `defineComposedBlock({ id, name, label, category,
    version, binding?, fields, tree })` (new in `@opencloudcms/core/blocks`, with `ComposedBlockError` and the
    `ComposedBlockSpec` type). The builder keeps `src/blocks/composed.ts` (`composedBlocks`, sorted by name) and never
    edits `src/blocks/index.ts`. **Existing projects:** create `src/blocks/composed.ts` (or let the first save create
    it) and add to `src/blocks/index.ts`:

    ```ts
    import { composedBlocks } from './composed';

    export default defineBlocks([...coreBlocks, ...composedBlocks /* , your blocks */]);
    ```
  - List blocks take a **fixed filter** (equality on indexed or unique fields), sort, limit, grid/list layout and
    an empty text; the fixed filter is enforced when the page is resolved and wins over the page editor's filter on
    the same field. `b.entries` gains `baseFilter`, `defaultSort`, `lockLimit` and `default` for hand-written blocks
    too; the page editor shows fixed filters read-only and hides the controls a block turns off.
  - API `/api/admin/blocks` (list with `source` and page `usage`, get, save, delete, `POST …/eject`). Errors:
    422 `invalid_block`, 422 `name_immutable`, 409 `block_name_taken`, 409 `block_in_use` (resend with
    `confirmBreaking: true`), 409 `not_composed`, 409 `composed_blocks_broken`. Breaking changes bump `version`.
    Saving a content type warns when a composed block uses a field it removes.
  - **Export as TSX** turns a composed block into an ordinary `.block.tsx` file. New public exports for hand-written
    blocks: the `ui` primitives (`ui.Box`, `ui.Stack`, `ui.Columns`, `ui.Grid`, `ui.Card`, `ui.Heading`, `ui.Text`,
    `ui.Image`, `ui.Button`, `ui.Badge`, `ui.Price`, `ui.DateText`, `ui.Divider`, `ui.Spacer`, `ui.layoutClass`,
    `ui.safeHref`) and `composedHelpers`; `CORE_BLOCK_NAMES`.
  - Public **`GET /api/content/assets?ids=`** (1–100 ids; `{ id, url, alt, width, height, mimeType }`): an `Image`
    bound to an asset field renders the asset (one lookup per page; `ContentFetcher.assets` in the built-in fetchers).
  - `ui.DateText` takes `timeZone` (default UTC; date-only values never shift).
  - `opencloudcms init` writes the empty `src/blocks/composed.ts` and spreads it in `src/blocks/index.ts`.
    `examples/my-store` adds an indexed `product.active` field (migration with a backfill to `true`), the composed
    blocks `ProductCard` and `ActiveProducts` (`active = true`, 4-column grid) and a seeded `/shop` page. The smoke
    test builds a project with a composed block and checks that the fixed filter holds against page data that asks
    for `active = false`.
  - Limits: filters are equality only on indexed or unique fields; production needs a rebuild to see a new or
    changed block; the shared renderer has no arbitrary logic (export as TSX for that).
- **Page builder and website preview.** Pages are built with drag and drop in the admin (**Pages**, `/admin/pages`,
  Puck `0.24.1` pinned) and stored in the core content type `opencloudcmsPage` (`title`, `path`, `seo`, `content`,
  localizable, draft/published/versions through `/api/admin/content/opencloudcmsPage/**`).
  - New subpath **`@opencloudcms/core/blocks`** (isomorphic; ESM for bundlers, CommonJS for Nest): `defineBlock`,
    `defineBlocks`, field builders `b.*`, `coreBlocks` (layout, basic, marketing, `EntryList`), `blockManifest`,
    `resolvePage`, `readPageContent` / `writePageContent`. `typesVersions` maps it for `moduleResolution: node`.
  - New subpath **`@opencloudcms/core/blocks/next`** (Next only, ESM): `createCmsPage` (catch-all renderer +
    `generateMetadata`), `createPreviewRoute`, `createPreviewExitRoute`, `PreviewBar`, `Welcome`.
  - `AdminApp` takes `blocks`; option `pages: { blocks }` (manifest) makes publish fail with 422 `unknown_block`
    for blocks the project no longer has (`force: true` overrides).
  - API: `GET /api/content/opencloudcmsPage/by-path` (published), `GET /api/admin/content/opencloudcmsPage/by-path`
    (draft, `no-store`), `GET /api/admin/pages/blocks-check`, `GET /api/admin/pages/shadowed` (paths served by a
    file route of `app/(site)`, warned about in the editor and the create dialog), `filter[documentId][in]` on list
    APIs, `If-Match` on `PATCH` updates (409 `stale_draft`; checked per page document, not per locale). Page `path` errors: 422 `invalid_path`, 422 `path_reserved`.
  - Website preview for signed-in admins (`/__opencloudcms/preview?page=&locale=`, Next draft mode, drafts of the
    page and of the entries its blocks show, `Cache-Control: private, no-store`). The admin CSP is unchanged.
  - `opencloudcms init` writes `src/blocks/` (with a commented example block), the catch-all renderer, the
    preview routes, the admin wrapper, `blockManifest` in `src/app.module.ts`, `jsx` in `tsconfig.server.json` and
    the Tailwind sources. `examples/my-store` adds a `ProductGrid` block and `pnpm seed:pages`.
- `@opencloudcms/assets`: local, S3, and GCS storage providers; multipart upload with WebP `thumb` / `medium` /
  `large` variants; register-by-URL unchanged when `assets` is omitted. Core migration `0004_assets_storage`
  adds `storage_key`, `provider`, and `variants` on `opencms_assets`. Configure via `OpenCloudCmsModule.forRoot({
  assets: { provider: 'local' | 's3' | 'gcs', … } })`.
- Admin **Assets** page at `/admin/assets` (table + nested folders, drag-and-drop move, bulk move/delete,
  upload when configured, edit alt); sidebar link for users with `content.read`. Migration
  `0005_asset_folders` adds `opencms_asset_folders` and `opencms_assets.folder_id`.
- Permission groups: seed groups Super Admin (`super-admin`, system), Contenter and Reviewer; Settings > Groups
  (`/api/admin/groups`, `/api/admin/permissions`); groups on Settings > Users; sidebar and pages follow the
  user's permissions.
- Review workflow for content types with `review: true` (Builder switch "Require review before publishing"):
  `POST …/submit`, `/withdraw`, `/reject { note }`, `/approve`; direct `/publish` for `content.publish` holders;
  `?workflow=in_review` filter, `GET /api/admin/workflow/pending-count`; Status column, review buttons and a
  pending-review tile in the admin. State lives in the core table `opencms_workflow`.
- Admin Settings (Users, Content types with a Groups tab, Languages) and a two-level sidebar that groups content
  types by `src/content-groups.ts` (`defineContentGroups`, `group` on a content type, `contentGroups` option).
  Localized `displayName` (`string` or `{ 'en-US': …, … }`).
- Admin UI in English, Tiếng Việt, Français and Bahasa Indonesia (vi/fr/id machine-translated, to be reviewed);
  per-user language (`PATCH /api/auth/me { locale }`).
- Website languages managed from Settings > Languages (`src/locales.ts`, `GET/PUT /api/admin/locales`).
- Public i18n helpers from `@opencloudcms/core` (server) and `@opencloudcms/core/admin` (client + hooks). In server
  components `@opencloudcms/core` resolves (`react-server` condition) to a NestJS-free module.
- `opencloudcms init` writes `src/locales.ts` (`en-US`), an empty `src/content-groups.ts` and `app/(site)/messages.ts`.

- Admin UI embedded in `@opencloudcms/core`, served at `/admin` by the same Nest process (Vite + React +
  Tailwind, built into `packages/core/dist/admin`). Content, Content Type Builder, users and account screens.
  `apps/admin` (Next.js) is removed. `OPENCLOUDCMS_ADMIN_DEV=1` serves it through Vite with HMR; `admin.enabled: false` turns it off.
- Authentication through `@opencloudcms/oauth2` wired into core: embedded OAuth2/OIDC provider, server-side
  sessions (`oc_session` cookie), first-run setup, user management, `AuthGuard` on `/api/**`.
- `opencloudcms init <dir>`: scaffolds a project (config, `src/main.ts`, `.env` with a random `OPENCLOUDCMS_SECRET`),
  installs dependencies, flags `--pm`, `--no-install`, `--db-url`, `--port`, `--link`.
- Every `opencloudcms` command loads the project's `.env`.
- `scripts/smoke-init.mjs`, run in CI: scaffolds a project, adds a `review: true` content type, boots it and walks
  setup, login, logout and the groups + review workflow (Contenter submits, Reviewer rejects then approves) over HTTP.
  It also publishes a page, checks that drafts stay private, walks the website preview (with and without a
  session) and the editor's CSP nonce.

### Fixed

- With the default dev URL (`http://localhost:<port>`) the BFF's discovery call reached the provider on
  `127.0.0.1`, so the provider's endpoints (and the browser's login redirect) pointed at `127.0.0.1`.
  The provider now takes the public host from the BFF's loopback requests (`X-Forwarded-Host`); other
  clients' forwarded headers are still ignored for http public URLs.
