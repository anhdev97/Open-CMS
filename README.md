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
| **Core** (`packages/*`) | `@opencms/schema`: DSL, field registry, physical mapping · `@opencms/codegen`: diff engine, migration + code generator · `@opencms/db`: system migrations, migrator · `@opencms/core`: NestJS module (content engine, APIs, builder) · `opencms-cli`: the `opencms` command · `apps/admin`: Next.js admin | this repo, published to npm |
| **Implementation** (`examples/my-store`) | `src/content-types/**/*.schema.ts` (source of truth), `src/generated/*` (generated, never edit), `src/extensions/*` (your hooks, never overwritten), `migrations/*` | your project |

## Quick start

```bash
pnpm install && pnpm build
docker compose up -d                      # Postgres 16 on :5432

cd examples/my-store
pnpm opencms migrate:up                   # core system tables + project tables
pnpm dev                                  # API on http://localhost:4000

cd ../../apps/admin && pnpm dev           # admin on http://localhost:3000
```

## Defining a content type

```ts
// src/content-types/product/product.schema.ts
import { defineContentType, f } from '@opencms/schema';

export default defineContentType({
  id: 'ct_product01',            // stable: never change it
  apiId: 'product',              // -> table ct_product, REST /api/content/product
  displayName: 'Product',
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

With `schemaEditable: true` (the default outside production) the builder calls
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
| `GET /api/content/:type?locale=vi-VN&fallback=en&filter[featured]=true&sort=name:asc&limit=20` | published entries (storefront) |
| `GET /api/content/:type/:documentId?locale=` | one published entry |
| `GET/POST /api/admin/content/:type` · `PATCH/DELETE /api/admin/content/:type/:id` | drafts |
| `POST /api/admin/content/:type/:id/publish` · `/unpublish` · `GET …/versions` | publishing |
| `GET/POST /api/admin/content-types` · `POST …/plan` · `DELETE …/:id` | schema builder |
| `GET/POST /api/admin/assets` · `/api/admin/taxonomies[/:slug/terms]` | system data |

Filtering and sorting are only allowed on `indexed`/`unique` fields, so every storefront query hits an index.
Set `OPENCMS_ADMIN_TOKEN` to require `Authorization: Bearer <token>` on `/api/admin/*`.

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
- v0.4: plugin API (custom field kinds, storage), scheduled publishing, translation workflow, `opencms init` scaffolder

## License

MIT
