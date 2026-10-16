# Changelog

## Unreleased

### Breaking changes

- **`adminToken` option and `OPENCMS_ADMIN_TOKEN` are removed.** `/api/admin/*` is now protected by the
  session of a signed-in user (`@opencms/oauth2`). Remove the option and the variable; create the first
  super_admin at `/admin` (or seed it with `OPENCMS_ADMIN_EMAIL` / `OPENCMS_ADMIN_PASSWORD`).
- **CORS for the admin API is removed.** The admin UI is served by the same origin, so `/api/admin/**` no
  longer sends CORS headers. To let a storefront on another origin read the delivery API, list its exact
  origin in `OpenCmsModule.forRoot({ cors: { origins: [...] } })`; this applies to `GET`/`HEAD`/`OPTIONS` on
  `/api/content/**` only, without credentials.
- **`/api/**` error format.** Every failure now answers `{ "error": { "code": string, "message": string, "issues"?: unknown[] } }`
  (`issues` carries per-item details such as schema validation errors). Clients that read the old
  NestJS body (`statusCode`/`message`/`error`) must be updated.
- **`OPENCMS_INTERNAL_URL` (and the `internalUrl` auth setting) is removed.** The BFF always calls its own
  provider at `http://127.0.0.1:${PORT ?? 4000}`. `OPENCMS_PUBLIC_URL` is optional outside production
  (default `http://localhost:${PORT ?? 4000}`) and required when `NODE_ENV=production`. The default `PORT`
  is 4000 everywhere.
- Host apps must create the Nest app with `{ bodyParser: false }`; `@opencms/core` parses request bodies
  itself (oidc-provider needs the raw `/oauth2` requests).

### Added

- Admin UI embedded in `@opencms/core`, served at `/admin` by the same Nest process (Vite + React +
  Tailwind, built into `packages/core/dist/admin`). Content, Content Type Builder, users and account screens.
  `apps/admin` (Next.js) is removed. `OPENCMS_ADMIN_DEV=1` serves it through Vite with HMR; `admin.enabled: false` turns it off.
- Authentication through `@opencms/oauth2` wired into core: embedded OAuth2/OIDC provider, server-side
  sessions (`oc_session` cookie), first-run setup, user management, `AuthGuard` on `/api/**`.
- `opencms init <dir>`: scaffolds a project (config, `src/main.ts`, `.env` with a random `OPENCMS_SECRET`),
  installs dependencies, flags `--pm`, `--no-install`, `--db-url`, `--port`, `--link`.
- Every `opencms` command loads the project's `.env`.
- `scripts/smoke-init.mjs`, run in CI: scaffolds a project, boots it and walks setup, login and logout over HTTP.
- Storefront init: `opencms init` scaffolds a Next.js App Router app in `app/` beside Nest `src/`, with `lib/cms.ts` and scripts that run Nest + Next via `concurrently`.
- `@opencms/core` reverse-proxies non-excluded paths to a real Next.js server when `storefront.enabled` is true (`OPENCMS_STOREFRONT_*` env overrides). Upstream down → 502 with a clear message.

### Fixed

- With the default dev URL (`http://localhost:<port>`) the BFF's discovery call reached the provider on
  `127.0.0.1`, so the provider's endpoints (and the browser's login redirect) pointed at `127.0.0.1`.
  The provider now takes the public host from the BFF's loopback requests (`X-Forwarded-Host`); other
  clients' forwarded headers are still ignored for http public URLs.
