# Changelog

## Unreleased

### Breaking changes

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

### Fixed

- With the default dev URL (`http://localhost:<port>`) the BFF's discovery call reached the provider on
  `127.0.0.1`, so the provider's endpoints (and the browser's login redirect) pointed at `127.0.0.1`.
  The provider now takes the public host from the BFF's loopback requests (`X-Forwarded-Host`); other
  clients' forwarded headers are still ignored for http public URLs.
