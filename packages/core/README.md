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
      contentGroups,    // src/content-groups.ts (optional)
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
bodies and the login flow breaks. The parsers only run for backend paths (`/api`, `/oauth2/interaction`):
host-added controllers must live under `/api`, or the host applies its own body parser to its own paths,
otherwise `req.body` is `undefined`.

Fixed paths, none configurable: UI `/admin`, API `/api`, auth `/oauth2`, delivery API `/api/content`.

## Options

| Option | Default | |
|---|---|---|
| `root`, `config`, `contentTypes`, `hooks` | | project root, resolved config, generated registry, entry hooks |
| `contentGroups` | none | `import contentGroups from './content-groups'`: sidebar groups; a content type's `group` must name one of them |
| `schemaEditable` | `NODE_ENV !== 'production'` | Content Type Builder writes schema files and migrations; Settings may rewrite `src/locales.ts` and `src/content-groups.ts` |
| `autoMigrate` | `false` | apply pending migrations at startup instead of refusing to start |
| `auth` | `{}` | non-secret auth settings (`@opencms/oauth2`: TTLs, password policy, rate limit, OIDC IdP) |
| `web` | `{ enabled: true, dir: process.cwd(), dev: NODE_ENV !== 'production' }` | serve the project's Next app (admin at `/admin`, website at `/`) from Nest. `enabled: false` is API-only and never loads `next`; `/admin` is then 404, and the auth flow still redirects to `/admin/login`, so the host must serve its own UI there |
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
| `OPENCMS_ADMIN_EMAIL`, `OPENCMS_ADMIN_PASSWORD` | seed the first Super Admin without the setup page |

## Admin and website (Next inside Nest)

The project runs one Next app (`app/(admin)` + `app/(site)`) inside the Nest process. Nest handles `/api/**`
and `/oauth2/**`; everything else goes to Next, loaded from the project (`next`, `react`, `react-dom` are
optional peer dependencies, not needed with `web.enabled: false`). The admin ships as `@opencms/core/admin`,
`@opencms/core/admin/layout` and `@opencms/core/admin/theme.css` (ESM in `dist/admin`, bundled by the
project's Next). `/admin/**` is served with a CSP using a per-request nonce plus `X-Robots-Tag: noindex`;
`/` gets no CSP.

Production needs `NODE_ENV=production`, `OPENCMS_PUBLIC_URL` and a built `.next` (`pnpm build` in the project,
before `pnpm start`). Without a build, web routes answer 503 (`Web UI chưa được build. Chạy \`pnpm build\` rồi khởi động lại.`).
`.next/cache` is on local disk, so run a single instance.

Working on the admin inside this monorepo: `pnpm --filter @opencms/core dev:admin` (`tsc -w`) next to
`pnpm --filter my-store dev`. `dev:admin` does not copy `theme.css`; run `pnpm --filter @opencms/core build`
once on a fresh checkout first.

## i18n

One API, two entries. Server code (Nest, server components of the website) imports from `@opencms/core`;
client components (`'use client'`) import from `@opencms/core/admin`. A client component must never import
`@opencms/core`: its main entry is the Nest module. In a server component Next resolves `@opencms/core` with
the `react-server` condition to a small module that has only the functions below, so NestJS is not bundled
(no `serverExternalPackages` needed).

| | `@opencms/core` | `@opencms/core/admin` |
|---|---|---|
| `SUPPORTED_LOCALES` (`{ code, name }[]`, native names), `Locale`, `isLocale(v)` | ✓ | ✓ |
| `matchLocale(input)`: exact code, then language (`vi` → `vi-VN`), case-insensitive, `Accept-Language` with `q=`; otherwise `en-US` | ✓ | ✓ |
| `localizedText(value, locale, fallback?)`: string or `{ 'en-US': …, … }` → locale, then `en-US`, then `fallback` | ✓ | ✓ |
| `defineMessages({ 'en-US': {...}, 'vi-VN': {...} })`: typing helper, `en-US` required, others partial | ✓ | ✓ |
| `createTranslator(messages, locale)` → `t(key, vars?)`: locale → `en-US` → the key; `{name}` placeholders | ✓ | ✓ |
| `formatDateTime(value, locale, opts?)`, `formatNumber(value, locale, opts?)`: `Intl` wrappers | ✓ | ✓ |
| `useLocale()`, `useTranslator(messages)`, `useFormat()`: bound to the admin's current language | | ✓ |

```ts
// app/(site)/messages.ts
import { defineMessages } from '@opencms/core';
export const messages = defineMessages({
  'en-US': { home: { title: 'Welcome, {name}' } },
  'vi-VN': { home: { title: 'Chào mừng, {name}' } },
});

// app/(site)/page.tsx (server component)
import { createTranslator } from '@opencms/core';
import locales from '../../src/locales';
import { messages } from './messages';
const t = createTranslator(messages, locales.defaultLocale);
t('home.title', { name: 'Ann' });
```

Project strings are added next to the core's; they do not override the admin's own strings.

Website languages: `GET /api/admin/locales` → `{ supported, locales, defaultLocale, editable, entryCounts }`;
`PUT /api/admin/locales` `{ locales, defaultLocale, confirmDisable? }` rewrites `src/locales.ts` (only with
`schemaEditable` and an existing `src/locales.ts`, else 403). Disabling a locale that still has entries
answers 409 `locale_has_entries` until it is listed in `confirmDisable`; its rows are kept, not deleted.
Content groups: `GET/PUT /api/admin/content-groups` rewrites `src/content-groups.ts`; removing a group still
used by a content type answers 409 `group_in_use`. Content APIs reject a `locale`/`fallback` that is not
enabled with 400 `locale_not_enabled`.

## Breaking changes

- `adminToken` and `OPENCMS_ADMIN_TOKEN` are removed; `/api/admin/*` needs a signed-in session whose groups grant the matching permission (`content.*`, `settings.*`); `GET /api/admin/meta` and content type reads need only a session.
- CORS on the admin API is removed; use `cors.origins` for `/api/content/**`.
- Errors under `/api/**` are `{ "error": { "code", "message", "issues"? } }`.
- `OPENCMS_INTERNAL_URL` is removed (the BFF calls `http://127.0.0.1:${PORT ?? 4000}`).
- The Nest app must be created with `bodyParser: false`.
- The admin is now Next modules and the old admin options and dev variable are replaced by `web` (migration steps in the changelog).
- Locale codes are `en-US`, `vi-VN`, `fr-FR`, `id-ID`; short codes (`en`) fail config validation. Content rows are migrated by the core migration `0002_region_locales`.

See the root `CHANGELOG.md`.
