# @opencms/oauth2

Authentication for the opencms admin: an embedded OAuth2/OIDC authorization server (`oidc-provider`) plus a
backend-for-frontend (BFF) that keeps all tokens on the server. The browser only ever holds an opaque,
httpOnly `oc_session` cookie.

- Authorization code + PKCE (S256 only), `refresh_token` grant, single client `opencms-admin`.
- Local email/password (argon2id) and an optional generic OIDC identity provider.
- Permission groups (`super-admin` system group, `contenter`, `reviewer`), `@RequirePermission(...)`, user management API, first-run setup, audit events.
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

Create the host app with `NestFactory.create(AppModule, { bodyParser: false })`. oidc-provider must read its
own request bodies, so Nest's default parser cannot run on `/oauth2`; `@opencms/core` registers the JSON and
urlencoded parsers for the rest of the app (it skips `/oauth2/*` except the `/oauth2/interaction/*`
controllers, which need JSON). Without `bodyParser: false`, oidc-provider warns "already parsed request body
detected" (once) and falls back to the body Nest already parsed. It keeps working, but set the option so
oidc-provider reads its own requests as designed.

### Migrations

Importing `@opencms/oauth2` registers its core migrations (`oauth2_0001_init`, `oauth2_0002_user_locale`,
`oauth2_0003_groups`) with `@opencms/db`'s
`coreMigrator()`. Any process that runs migrations must therefore load the package first:

- The `opencms` CLI and `@opencms/core` do this themselves (`import '@opencms/oauth2/migrations'`, a
  Nest-free side-effect entry), so `opencms migrate:up` / `migrate:status`, `autoMigrate` and the Content
  Type Builder all see `core/oauth2_0001_init`.
- In your own scripts that use `@opencms/db` without `@opencms/core`, import `@opencms/oauth2` (or
  `@opencms/oauth2/migrations`) **before** calling `coreMigrator(...)`, otherwise Kysely reports a missing
  migration.

## Configuration

`OPENCMS_SECRET` is mandatory. `OPENCMS_PUBLIC_URL` is optional outside production (default
`http://localhost:${PORT ?? 4000}`) and mandatory when `NODE_ENV=production`; the app refuses to start without them.
Env values override the `auth` section of `opencms.config.ts`.

| Key | Default | Env |
|---|---|---|
| `publicUrl` | dev: `http://localhost:${PORT ?? 4000}`; production: required | `OPENCMS_PUBLIC_URL` (issuer is `<publicUrl>/oauth2`; a trailing `/` is ignored) |
| secret | required, at least 32 bytes | `OPENCMS_SECRET` |
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

The BFF always calls its own provider at `http://127.0.0.1:${PORT ?? 4000}` (with the public URL's
`X-Forwarded-Proto`/`X-Forwarded-Host`; for an http public URL the provider applies that host only to
loopback peers, and only when it equals the public URL's host). There is no `internalUrl` setting and no `OPENCMS_INTERNAL_URL`
(removed; a leftover value is ignored).

The rate limiter is in memory, so limits are per instance. It tracks at most 10 000 keys and drops the
oldest when full.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/auth/setup`, `POST /api/auth/setup` | First-run state / create the first super admin (public) |
| `GET /api/auth/login`, `GET /api/auth/callback` | Start / finish the browser login (BFF) |
| `GET /api/auth/me`, `POST /api/auth/logout` | Current user / end the session |
| `POST /api/auth/password` | Change own password |
| `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/password`, `DELETE /api/admin/users/:id/identities/:identityId` | User management (`settings.users`); create needs `groupIds` (≥ 1), `PATCH` takes `groupIds?` |
| `GET /api/admin/groups` | Groups with `roles` and `userCount` (`settings.groups` or `settings.users`) |
| `POST /api/admin/groups`, `PATCH/DELETE /api/admin/groups/:id`, `GET /api/admin/permissions` | Group management (`settings.groups`) |
| `/oauth2/*` | The OIDC provider (discovery, auth, token, jwks, end_session) and login interaction (`/oauth2/interaction/:uid`) |
| `/oauth2/interaction/:uid/idp/:provider`, `/oauth2/idp/:provider/callback` | External IdP sign-in |

Errors under `/api/**` look like `{ "error": { "code", "message", "issues"? } }`; failures inside the redirect chain
answer `302 /admin/login?error=<code>`.

## Groups and permissions

Permissions are a fixed list (`PERMISSIONS` / `Permission`, defined in `@opencms/schema` and re-exported here):
`content.read`, `content.create`, `content.update`, `content.delete`, `content.submit`, `content.publish`,
`settings.users`, `settings.groups`, `settings.content-types`, `settings.languages`.

A **group** (`auth_groups`: `key`, `name`, `roles text[]`, `system`) holds a set of permissions; a user
(`auth_user_groups`) belongs to any number of groups and their effective permissions are the union, recomputed
on every request. Migration `oauth2_0003_groups` renames the former role tables to `auth_groups` and
`auth_user_groups` (`role_id` → `group_id`; see the root `CHANGELOG.md`), turns `super_admin` into the system group `super-admin` (existing
users keep it) and seeds two groups:

| Key | Name | Permissions |
|---|---|---|
| `super-admin` | Super Admin | all, including permissions added later (`system`: cannot be edited or deleted) |
| `contenter` | Contenter | `content.read`, `content.create`, `content.update`, `content.delete`, `content.submit` |
| `reviewer` | Reviewer | `content.read`, `content.update`, `content.publish` |

The setup wizard and the env admin seed put the user in `super-admin`. Removing the last active Super Admin
(removing the group, disabling or deleting the user) answers `409 last_super_admin`; the check holds row locks,
so two concurrent requests cannot both pass. Group keys match `^[a-z][a-z0-9-]{0,63}$` (taken → `409
group_key_taken`), names are 1–100 characters, unknown permissions → 422, changing a system group → `409
system_group`. Deleting a group removes it from its users.

Protect your own routes with `@RequirePermission(...)` (all listed permissions are required; on a class it
applies to every handler, and a method decorator adds to it). Missing → `403 { error: { code: 'forbidden',
message: 'Missing permission: <perm>' } }`; no session → 401. A route without the decorator needs only a
session. `@CurrentUser()` gives `{ id, email, name, locale, groups: { key, name }[], permissions, isSuperAdmin }`,
and `GET /api/auth/me` returns the same.

```ts
@RequirePermission('content.publish')
@Post('feeds/rebuild')
rebuild(@CurrentUser() user: RequestUser) { /* ... */ }
```

The former role decorator is removed (see the root `CHANGELOG.md`): guard each route with the permission it really needs.

**Escalation rules.** A user who is not a Super Admin (403 `forbidden` otherwise):

- cannot add to a group a permission they do not hold themselves (keeping or removing existing ones is fine);
- can only assign or remove (on create or `PATCH groupIds`) groups that are not `system` and whose permissions
  are all within their own;
- cannot modify a Super Admin user at all: no name/email/status/group change, password reset, identity unlink
  or delete.

These checks run before the last-Super-Admin rule. Group and user-group changes are audited (`group.create`,
`group.update`, `group.delete`, `user.groups.update`).

## Setup flow

1. Start the app against an empty database. `GET /api/auth/setup` returns `{ "required": true }` and every
   protected API answers `409 setup_required`.
2. `POST /api/auth/setup` with `{ email, name, password }` creates the first super admin (group `super-admin`). Afterwards it
   answers `409 setup_already_completed`.
3. Sign in through `GET /api/auth/login`. Access tokens refresh transparently on the server.

Alternatively seed the admin from env (`OPENCMS_ADMIN_EMAIL`, `OPENCMS_ADMIN_PASSWORD`, optional
`OPENCMS_ADMIN_NAME`) at boot.

> **Warning: the setup wizard has no token.** While `auth_users` is empty, whoever reaches
> `POST /api/auth/setup` first becomes super admin. The only mitigation is a WARN log on every boot.
> In production, seed the admin through the environment variables above so the endpoint is never exposed
> on an empty database.

## Running behind a reverse proxy

The package does not call `app.set('trust proxy', ...)`. Blindly trusting `X-Forwarded-For` would let any
client spoof its IP and dodge the per-IP login limit. If you terminate TLS in a proxy, set it yourself with
the exact number of proxy hops:

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
app.set('trust proxy', 1); // one proxy in front
```

Without it, every request appears to come from the proxy and shares one per-IP budget. Set
`OPENCMS_PUBLIC_URL` to the public https origin; the BFF reaches the provider on the loopback address by
itself, so nothing else is needed.

With an **http** public URL, the provider takes `Host` from `X-Forwarded-Host` only for loopback peers and
only when the value equals the public URL's host (that is how the BFF's own calls are handled). A client
header passed through by a same-host proxy is ignored, so no extra proxy configuration is needed.

## Public path prefixes

`AuthGuard` protects every `/api/**` route, except routes whose path starts with one of
`publicPathPrefixes` (default `['/api/content/']`, the published-content delivery API). Matching is
case-insensitive, like Express routing, and needs the trailing slash: `/api/content/x` is public,
`/api/contents` is not. Pass `publicPathPrefixes: []` to protect everything.

## Recovery

There is no password reset by email. Another super admin can reset the password, or set
`OPENCMS_ADMIN_EMAIL`, `OPENCMS_ADMIN_PASSWORD` and `OPENCMS_ADMIN_FORCE_RESET=true` for one boot to reset
that existing account's password and re-activate it (remove the flag and password variable afterwards, or it resets on every boot).

## Known limits

- The in-memory rate limiter is correct for a single instance only.
- Signing keys are not rotated automatically.
- The BFF assumes the admin UI and the API share one origin.
