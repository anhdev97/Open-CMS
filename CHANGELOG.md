# Changelog

## Unreleased

### Fixed

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

- **Block Builder** (Settings > Blocks, `/admin/settings/blocks`, permission `settings.content-types`): build page
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
