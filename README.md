# opencms-cli

A storefront-first headless CMS on **NestJS + Next.js + PostgreSQL**, built around **schema-as-code**:
every content type is a TypeScript file in your repo, and each one gets **its own Postgres tables**.
Whether you add a content type from the CLI or from the admin UI, the same pipeline runs and writes three things:

- a **migration file** (Kysely, reviewable, reversible)
- **generated code** (TS types, Kysely table types, zod validators, registry)
- an updated **snapshot**, the diff baseline, so CI can detect drift

```
schema files ──► validate ──► diff with migrations/_snapshot.json ──► migrations/<stamp>_<name>.ts
 (CLI or UI)                   (match by stable ids)                 src/generated/*
                                                                     migrations/_snapshot.json
```

> Status: v0.1, early. The APIs will change.

## Two layers

| Layer | What | Who owns it |
|---|---|---|
| **Core** (`packages/*`) | `@opencms/schema`: DSL, field registry, physical mapping · `@opencms/codegen`: diff engine, migration + code generator · `@opencms/db`: system migrations, migrator · `@opencms/core`: NestJS module (content engine, APIs, builder) and the admin UI as Next App Router modules (`@opencms/core/admin`), served at `/admin` by a Next app embedded in the Nest process · `@opencms/oauth2`: login and user management · `opencms-cli`: the `opencms` command, incl. `opencms init` | this repo, published to npm |
| **Implementation** (`examples/my-store`) | `src/content-types/**/*.schema.ts` (source of truth), `src/generated/*` (generated, never edit), `src/extensions/*` (your hooks, never overwritten), `migrations/*` | your project |

## Quick start

You need Node 22+ and a Postgres database.

```bash
npx opencms-cli init my-cms --pm pnpm
cd my-cms
docker compose up -d                      # Postgres 16 with the database init configured (skip if you pass your own --db-url)
pnpm run dev                              # migrates, then serves on http://localhost:4000
```

`init` writes the project (config, `src/main.ts`, `.env` with a random `OPENCMS_SECRET`), installs
dependencies (`--no-install` to skip, `--pm pnpm|npm|yarn` to choose) and never overwrites a non-empty
directory. Open <http://localhost:4000/admin>: on a fresh database it asks you to create the first
super_admin. Open it at the public URL (`OPENCMS_PUBLIC_URL`, default `http://localhost:4000`): another address such as `127.0.0.1` fails with `origin_mismatch`. One origin serves everything: UI `/admin`, API `/api`, auth `/oauth2`, delivery API `/api/content`.

Working on this monorepo instead:

```bash
pnpm install && pnpm build
docker compose up -d                      # Postgres 16 on :5432

cd examples/my-store
cp .env.example .env                      # then set OPENCMS_SECRET, e.g. (32 random bytes):
                                          #   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
pnpm opencms migrate:up                   # core system tables + project tables
pnpm dev                                  # http://localhost:4000/admin (website at /)

# editing the admin UI (packages/core/admin/src): in a second terminal
pnpm --filter @opencms/core dev:admin     # tsc -w into packages/core/dist/admin; Next dev hot-reloads it
```

`dev:admin` does not copy `theme.css`, so on a fresh checkout run `pnpm --filter @opencms/core build` once
before it.

### Architecture

One Next.js app lives in your project (`app/(admin)` for the admin, `app/(site)` for your website) and runs
inside the same NestJS process: Nest answers `/api/**` and `/oauth2/**`, and hands every other path to Next.
The admin is shipped by `@opencms/core` as modules your `app/` re-exports; `/admin/**` gets a per-request CSP
nonce and `X-Robots-Tag: noindex`, `/` gets no CSP. Turn the Next side off with
`OpenCmsModule.forRoot({ web: { enabled: false } })` (API-only).

### Production

```bash
pnpm build                                # tsc (Nest) + next build
NODE_ENV=production OPENCMS_PUBLIC_URL=https://cms.example.com pnpm start
```

`NODE_ENV=production` and `OPENCMS_PUBLIC_URL` are required, and `build` must run before `start`; without a
build, web routes answer 503. `.next/cache` lives on local disk, so run a single instance (several instances
need a shared `cacheHandler`).
See [`packages/core/README.md`](packages/core/README.md) for the module options.

## Defining a content type

```ts
// src/content-types/product/product.schema.ts
import { defineContentType, f } from '@opencms/schema';

export default defineContentType({
  id: 'ct_product01',            // stable: never change it
  apiId: 'product',              // -> table ct_product, REST /api/content/product
  displayName: { 'en-US': 'Product', 'vi-VN': 'Sản phẩm' }, // or a plain string (= en-US)
  group: 'shop',                 // optional: sidebar group from src/content-groups.ts
  fields: {
    name:   f.text({ id: 'fld_prod_name', required: true, localizable: true, indexed: true }),
    slug:   f.slug({ id: 'fld_prod_slug', required: true, unique: true, from: 'name' }),
    price:  f.money({ id: 'fld_prod_price', currencyMode: 'market' }),
    images: f.asset({ id: 'fld_prod_images', multiple: true }),
    brand:  f.reference({ id: 'fld_prod_brand', target: 'brand', indexed: true }),
  },
});
```

The `id`s let the diff engine tell a **rename** from a drop + add: renaming `slug` to `handle` generates
`RENAME COLUMN` (plus index renames), not a new empty column.

Field kinds: `text longText richText slug email url number boolean date datetime json money asset reference taxonomy`.
Flags: `required` (checked at publish, so drafts can be incomplete), `localizable`, `indexed` (required for filtering/sorting), `unique`.

## Physical layout

```
ct_product                    id, document_id, status (draft|published), timestamps, shared fields
ct_product_l10n               entry_id, locale, status, localizable fields         PK (entry_id, locale)
ct_product__rel__images       entry_id, target_id, sort_order                      one per multiple relation
```

- Draft and published are separate rows. Publishing copies the draft (with translations and relations) into a fresh published row in one transaction and writes a version snapshot.
- `money` → `<name>_amount numeric(19,4)` + `<name>_currency char(3)`. `richText`/`json` → `jsonb`.
- `asset`/`taxonomy` → FK to system tables. `reference` → `<name>_document_id` (no FK, since it points at a document that has both draft and published rows).
- `unique` means unique per status (and per locale for localizable fields).

## Safe migrations

| Change | Generated SQL |
|---|---|
| add field / type | `ADD COLUMN` / `CREATE TABLE` (+ indexes) |
| rename field / type | `RENAME COLUMN` / `RENAME TABLE` + index renames |
| remove field / type | **archived**: renamed to `_del<stamp>_<name>`, data kept, `down()` restores it |
| widen (`varchar(100)→(255)`, `varchar→text`, `integer→numeric`, `date→timestamptz`) | `ALTER COLUMN … TYPE … USING` |
| toggle `indexed` / `unique` | `CREATE/DROP INDEX` |
| narrowing, kind change with a different layout, toggling `localizable` / `multiple` | **refused**, with a message telling you to add a new field and migrate data |

Every migration runs in a transaction. Kysely's migrator lock keeps concurrent instances from applying the same migration twice.
Core system migrations (`opencms_core_migrations`) always run before project migrations (`opencms_migrations`).
The API **refuses to start** while any migration is pending (unless `autoMigrate: true`).

## CLI

| Command | |
|---|---|
| `opencms content-type:add article -f title:text:required:localizable -f cover:asset -f related:reference(product)[]` | write a schema file + migration |
| `opencms field:add product color:text(64):indexed` | add field(s) to a type |
| `opencms plan` | show the SQL the next migration would contain |
| `opencms migrate:create [name]` | diff → migration + generated code + snapshot |
| `opencms migrate:up` / `migrate:down [-s n]` / `migrate:status` | apply / revert / list |
| `opencms migrate:check` | CI gate: fails on schema drift or stale generated code |
| `opencms generate` | regenerate `src/generated` only |
| `opencms dev` | watch schema files, create + apply migrations on change |

## Admin UI (Content Type Builder)

The admin is part of `@opencms/core` and runs inside your project's Next app (no separate app to deploy) and requires a signed-in user
(see [`@opencms/oauth2`](packages/oauth2/README.md)). With `schemaEditable: true` (the default outside production) the builder calls
`POST /api/admin/content-types`, which:

1. writes `src/content-types/<apiId>/<apiId>.schema.ts`
2. generates the migration and code (same pipeline as the CLI)
3. applies the migration and reloads the in-memory registry
4. on any failure, restores every file it touched (the DB migration rolled back in its transaction)

`POST /api/admin/content-types/plan` is a dry run that returns the summary, warnings and SQL.
The UI never runs DDL directly. Everything ends up as files you commit.
In production, set `schemaEditable: false`: schema changes go through git and `opencms migrate:up` in the deploy pipeline.

## HTTP API

| | |
|---|---|
| `GET /api/content/:type?locale=vi-VN&fallback=en-US&filter[featured]=true&sort=name:asc&limit=20` | published entries (storefront) |
| `GET /api/content/:type/:documentId?locale=` | one published entry |
| `GET/POST /api/admin/content/:type` · `PATCH/DELETE /api/admin/content/:type/:id` | drafts |
| `POST /api/admin/content/:type/:id/publish` · `/unpublish` · `GET …/versions` | publishing |
| `GET/POST /api/admin/content-types` · `POST …/plan` · `DELETE …/:id` | schema builder |
| `GET/POST /api/admin/assets` · `/api/admin/taxonomies[/:slug/terms]` | system data |
| `GET/PUT /api/admin/locales` | website languages (`src/locales.ts`; `PUT` only with `schemaEditable`) |
| `GET/PUT /api/admin/content-groups` | sidebar groups of content types (`src/content-groups.ts`; `PUT` only with `schemaEditable`) |
| `PATCH /api/auth/me` `{ locale }` | admin language of the signed-in user (`null` = follow the browser) |

A `locale` or `fallback` that is not enabled in `locales` answers 400 `locale_not_enabled`.
Filtering and sorting are only allowed on `indexed`/`unique` fields, so every storefront query hits an index.
`/api/admin/*` requires a session (`super_admin` role); `/api/content/*` is public. Every `/api/**` failure
answers `{ "error": { "code", "message", "issues"? } }`. Browsers on other origins can read
`/api/content/**` (GET only, no credentials) if their origin is listed in `cors.origins`.

## Languages and content groups

Admin Settings has three pages: Users, Content types (with a Groups tab) and Languages. Content groups and
website languages are files in your project, like content types:

```ts
// src/locales.ts: written by Settings > Languages (dev only)
import { defineLocales } from '@opencms/schema';
export default defineLocales({ defaultLocale: 'en-US', locales: ['en-US', 'vi-VN'] });

// src/content-groups.ts: written by Settings > Content types > Groups (dev only)
import { defineContentGroups } from '@opencms/schema';
export default defineContentGroups([{ key: 'shop', title: { 'en-US': 'Shop', 'vi-VN': 'Cửa hàng' }, order: 10 }]);

// opencms.config.ts
import locales from './src/locales';
export default defineConfig({ database: { url: process.env.DATABASE_URL! }, ...locales });
```

Pass the groups to the module: `OpenCmsModule.forRoot({ ..., contentGroups })` (`import contentGroups from './content-groups'`).
Supported locales: `en-US` (English, the default and the fallback everywhere), `vi-VN` (Tiếng Việt), `fr-FR`
(Français), `id-ID` (Bahasa Indonesia). The admin UI is translated into all four; each user picks a language
on the Account page. The vi/fr/id admin translations are machine-made and need review by native speakers.

Website strings use the same helpers as the admin (`defineMessages`, `createTranslator`, `formatDateTime`,
`formatNumber`, `localizedText`, `matchLocale`): import them from `@opencms/core` in server components and from
`@opencms/core/admin` in client components (`'use client'`), which also has `useLocale`, `useTranslator`,
`useFormat`. See [`packages/core/README.md`](packages/core/README.md#i18n).

## Breaking changes

See [`CHANGELOG.md`](CHANGELOG.md). In short: `adminToken` / `OPENCMS_ADMIN_TOKEN` are gone (sign in
with a user instead), `/api/admin` no longer sends CORS headers, `/api/**` errors use a new body, and
`OPENCMS_INTERNAL_URL` is removed. The admin moved from a bundled SPA to Next App Router modules and the old
admin options are replaced by the `web` option; existing projects need the migration steps in the changelog.
Locale codes are now region codes (`en-US`, not `en`); the core migrates existing content rows automatically.

## Extensions

```ts
// src/extensions/product/product.hooks.ts
export default defineHooks('product', {
  beforePublish: async (doc) => { /* throw to block */ },
  afterPublish:  async (doc) => { /* revalidateTag('product'), search indexing, webhooks */ },
});
```

## Roadmap

- v0.2: markets/sites/currencies as first-class entities, RBAC scoped by market + locale, webhooks, asset upload with storage adapters (local/S3)
- v0.3: widget schema + page builder, Next.js preview (draft mode), `@opencms/sdk` + React widget renderer
- v0.4: plugin API (custom field kinds, storage), scheduled publishing, translation workflow, ~~`opencms init` scaffolder~~ (done)

## License

MIT
