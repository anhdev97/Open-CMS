# @opencms/core

NestJS module of opencms: the content engine, the delivery and admin APIs, the Content Type Builder, login
(via `@opencms/oauth2`) and the embedded admin UI at `/admin`. Most projects get a working setup from
`npx opencms-cli init my-cms`; this page describes what that setup does.

## Usage

```ts
// src/app.module.ts
@Module({
  imports: [
    OpenCmsModule.forRoot({
      root: path.resolve(__dirname, '..'),
      config,           // opencms.config.ts
      contentTypes,     // src/generated
      hooks,            // src/extensions
    }),
  ],
})
export class AppModule {}

// src/main.ts
const app = await NestFactory.create(AppModule, { bodyParser: false });
await app.listen(Number(process.env.PORT ?? 4000));
```

**`bodyParser: false` is required.** `@opencms/core` registers the JSON and urlencoded parsers itself and
leaves `/oauth2` (the OIDC provider) alone; Nest's built-in parser would consume the provider's request
bodies and the login flow breaks.

Fixed paths, none configurable: UI `/admin`, API `/api`, auth `/oauth2`, delivery API `/api/content`.

## Options

| Option | Default | |
|---|---|---|
| `root`, `config`, `contentTypes`, `hooks` | | project root, resolved config, generated registry, entry hooks |
| `schemaEditable` | `NODE_ENV !== 'production'` | Content Type Builder writes schema files and migrations |
| `autoMigrate` | `false` | apply pending migrations at startup instead of refusing to start |
| `auth` | `{}` | non-secret auth settings (`@opencms/oauth2`: TTLs, password policy, rate limit, OIDC IdP) |
| `admin.enabled` | `true` | serve the admin UI at `/admin`; `false` leaves `/admin` unregistered (404). The auth flow still redirects to `/admin/login` (and `/admin/setup`), so with `false` the host must serve its own UI there |
| `cors.origins` | none | exact origins (no wildcard) allowed to read `/api/content/**` cross-origin |
| `env` | `process.env` | environment for the auth module (tests) |

CORS applies to `GET`, `HEAD`, `OPTIONS` on `/api/content/**` only, without credentials. No other route
sends CORS headers; the admin UI is same-origin.

The browser must reach the admin at the public URL (`OPENCMS_PUBLIC_URL`, default `http://localhost:PORT`). Opening it at another address (`127.0.0.1`, a LAN IP) makes setup and login fail with `origin_mismatch`; open the configured URL or set `OPENCMS_PUBLIC_URL` to the address you use.

## Environment

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres connection (read by `opencms.config.ts`) |
| `PORT` | default `4000` |
| `OPENCMS_SECRET` | required, at least 32 bytes (`opencms init` generates one) |
| `OPENCMS_PUBLIC_URL` | optional in dev (default `http://localhost:${PORT ?? 4000}`), required when `NODE_ENV=production` |
| `OPENCMS_ADMIN_EMAIL`, `OPENCMS_ADMIN_PASSWORD` | seed the first super_admin without the setup page |
| `OPENCMS_ADMIN_DEV` | `1` serves the admin through Vite (HMR) instead of `dist/admin`; for working on the UI inside this monorepo |

## Admin build

`pnpm build` runs `tsc` and then `vite build`, which writes the admin to `dist/admin` (served with immutable
caching for `/admin/assets/*`, `index.html` as the SPA fallback). If `dist/admin` is missing the server logs
one warning and `/admin` answers 503 until the package is built. Frontend libraries are `devDependencies`:
they are bundled, not installed by consumers.

## Breaking changes

- `adminToken` and `OPENCMS_ADMIN_TOKEN` are removed; `/api/admin/*` needs a signed-in `super_admin` session.
- CORS on the admin API is removed; use `cors.origins` for `/api/content/**`.
- Errors under `/api/**` are `{ "error": { "code", "message", "issues"? } }`.
- `OPENCMS_INTERNAL_URL` is removed (the BFF calls `http://127.0.0.1:${PORT ?? 4000}`).
- The Nest app must be created with `bodyParser: false`.

See the root `CHANGELOG.md`.
