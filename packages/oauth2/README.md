# @opencms/oauth2

Authentication for the opencms admin: an embedded OAuth2/OIDC authorization server (`oidc-provider`) plus a
backend-for-frontend (BFF) that keeps all tokens on the server. The browser only ever holds an opaque,
httpOnly `oc_session` cookie.

- Authorization code + PKCE (S256 only), `refresh_token` grant, single client `opencms-admin`.
- Local email/password (argon2id) and an optional generic OIDC identity provider.
- Roles (`super_admin`, ...), user management API, first-run setup, audit events.
- Global `AuthGuard` on every `/api/**` route (opt out per handler with `@Public()`).
- Hourly cleanup of expired sessions and provider payloads.

## Wiring

```ts
import { OPENCMS_DB } from '@opencms/core';
import { OAuth2Module } from '@opencms/oauth2';

@Module({
  imports: [
    OpenCmsModule.forRoot({ /* ... */ }),
    OAuth2Module.forRoot({
      dbToken: OPENCMS_DB,          // DI token of the app's Kysely instance
      auth: { /* non-secret `auth` section of opencms.config.ts */ },
      publicPathPrefixes: ['/api/content/'], // default, see below
    }),
  ],
})
export class AppModule {}
```

The package does not depend on `@opencms/core`; you hand it the Kysely token.

### Migrations

Importing `@opencms/oauth2` registers its core migration (`oauth2_0001_init`) with `@opencms/db`'s
`coreMigrator()`. Any process that runs migrations must therefore load the package first:

- The `opencms` CLI and `@opencms/core` do this themselves (`import '@opencms/oauth2/migrations'`, a
  Nest-free side-effect entry), so `opencms migrate:up` / `migrate:status`, `autoMigrate` and the Content
  Type Builder all see `core/oauth2_0001_init`.
- In your own scripts that use `@opencms/db` without `@opencms/core`, import `@opencms/oauth2` (or
  `@opencms/oauth2/migrations`) **before** calling `coreMigrator(...)`, otherwise Kysely reports a missing
  migration.

## Configuration

`OPENCMS_SECRET` and `OPENCMS_PUBLIC_URL` are mandatory; the app refuses to start without them.
Env values override the `auth` section of `opencms.config.ts`.

| Key | Default | Env |
|---|---|---|
| `publicUrl` | required | `OPENCMS_PUBLIC_URL` (issuer is `<publicUrl>/oauth2`; a trailing `/` is ignored) |
| secret | required, at least 32 bytes | `OPENCMS_SECRET` |
| `internalUrl` | `http://127.0.0.1:${PORT}` | `OPENCMS_INTERNAL_URL` (address the BFF uses to call its own provider for code exchange, refresh and revoke; set it when running behind a TLS reverse proxy where `publicUrl` is not reachable from inside the container) |
| `ttl.accessToken` | 900 s | `OPENCMS_AUTH_TTL_ACCESS` |
| `ttl.refreshToken` | 30 days | `OPENCMS_AUTH_TTL_REFRESH` (clamped to the absolute session TTL) |
| `ttl.sessionIdle` | 7 days | `OPENCMS_AUTH_TTL_SESSION_IDLE` |
| `ttl.sessionAbsolute` | 30 days | `OPENCMS_AUTH_TTL_SESSION_ABSOLUTE` |
| `ttl.authorizationCode` | 60 s | config only |
| `ttl.interaction` | 10 min | config only |
| `password.minLength` | 12 (max 256) | config only |
| `rateLimit.login` | 5 / 15 min per email, 20 / 15 min per IP | config only |
| `idp.oidc` | disabled | `OPENCMS_IDP_OIDC_ISSUER`, `OPENCMS_IDP_OIDC_CLIENT_ID`, `OPENCMS_IDP_OIDC_CLIENT_SECRET`, `OPENCMS_IDP_OIDC_LABEL` |
| admin seed | none | `OPENCMS_ADMIN_EMAIL`, `OPENCMS_ADMIN_PASSWORD`, `OPENCMS_ADMIN_NAME`, `OPENCMS_ADMIN_FORCE_RESET` |

The rate limiter is in memory, so limits are per instance.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/auth/setup`, `POST /api/auth/setup` | First-run state / create the first super_admin (public) |
| `GET /api/auth/login`, `GET /api/auth/callback` | Start / finish the browser login (BFF) |
| `GET /api/auth/me`, `POST /api/auth/logout` | Current user / end the session |
| `POST /api/auth/password` | Change own password |
| `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/password`, `DELETE /api/admin/users/:id/identities/:identityId` | User management (super_admin) |
| `/oauth2/*` | The OIDC provider (discovery, auth, token, jwks, end_session) and login interaction (`/oauth2/interaction/:uid`) |
| `/oauth2/interaction/:uid/idp/:provider`, `/oauth2/idp/:provider/callback` | External IdP sign-in |

Errors under `/api/**` look like `{ "error": { "code", "message" } }`; failures inside the redirect chain
answer `302 /admin/login?error=<code>`.

## Setup flow

1. Start the app against an empty database. `GET /api/auth/setup` returns `{ "required": true }` and every
   protected API answers `409 setup_required`.
2. `POST /api/auth/setup` with `{ email, name, password }` creates the first super_admin. Afterwards it
   answers `409 setup_already_completed`.
3. Sign in through `GET /api/auth/login`. Access tokens refresh transparently on the server.

Alternatively seed the admin from env (`OPENCMS_ADMIN_EMAIL`, `OPENCMS_ADMIN_PASSWORD`, optional
`OPENCMS_ADMIN_NAME`) at boot.

> **Warning: the setup wizard has no token.** While `auth_users` is empty, whoever reaches
> `POST /api/auth/setup` first becomes super_admin. The only mitigation is a WARN log on every boot.
> In production, seed the admin through the environment variables above so the endpoint is never exposed
> on an empty database.

## Running behind a reverse proxy

The package does not call `app.set('trust proxy', ...)`. Blindly trusting `X-Forwarded-For` would let any
client spoof its IP and dodge the per-IP login limit. If you terminate TLS in a proxy, set it yourself with
the exact number of proxy hops:

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.set('trust proxy', 1); // one proxy in front
```

Without it, every request appears to come from the proxy and shares one per-IP budget. Also set
`OPENCMS_INTERNAL_URL` so the BFF can reach the provider without going through the proxy.

## Public path prefixes

`AuthGuard` protects every `/api/**` route, except routes whose path starts with one of
`publicPathPrefixes` (default `['/api/content/']`, the published-content delivery API). Matching is
case-insensitive, like Express routing, and needs the trailing slash: `/api/content/x` is public,
`/api/contents` is not. Pass `publicPathPrefixes: []` to protect everything.

## Recovery

There is no password reset by email. Another super_admin can reset the password, or set
`OPENCMS_ADMIN_EMAIL`, `OPENCMS_ADMIN_PASSWORD` and `OPENCMS_ADMIN_FORCE_RESET=true` for one boot to reset
that existing account's password and re-activate it (remove the flag and password variable afterwards, or it resets on every boot).

## Known limits

- The in-memory rate limiter is correct for a single instance only.
- Signing keys are not rotated automatically.
- The BFF assumes the admin UI and the API share one origin.
