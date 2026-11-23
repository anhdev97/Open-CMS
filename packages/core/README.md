# @opencloudcms/core

NestJS module of OpenCloudCMS: the content engine, the delivery and admin APIs, the Content Type Builder, login
(via `@opencloudcms/oauth2`) and the embedded admin UI at `/admin`. Most projects get a working setup from
`npx @opencloudcms/cli init my-cms`; this page describes what that setup does.

## Usage

```ts
// src/app.module.ts
@Module({
  imports: [
    OpenCloudCmsModule.forRoot({
      root: path.resolve(__dirname, '..'),
      config,           // opencloudcms.config.ts
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

**`bodyParser: false` is required.** `@opencloudcms/core` registers the JSON and urlencoded parsers itself and
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
| `auth` | `{}` | non-secret auth settings (`@opencloudcms/oauth2`: TTLs, password policy, rate limit, OIDC IdP) |
| `web` | `{ enabled: true, dir: process.cwd(), dev: NODE_ENV !== 'production' }` | serve the project's Next app (admin at `/admin`, website at `/`) from Nest. `enabled: false` is API-only and never loads `next`; `/admin` is then 404, and the auth flow still redirects to `/admin/login`, so the host must serve its own UI there |
| `cors.origins` | none | exact origins (no wildcard) allowed to read `/api/content/**` cross-origin |
| `pages.blocks` | none | the project's block manifest (`blockManifest(blocks)` from `src/blocks`); publishing a page that uses another block fails with 422 `unknown_block`, and the `b.richText` values it lists are normalized on save. Absent: no check, no normalization on save, WARN at boot |
| `env` | `process.env` | environment for the auth module (tests) |

CORS applies to `GET`, `HEAD`, `OPTIONS` on `/api/content/**` only, without credentials. No other route
sends CORS headers; the admin UI is same-origin.

The browser must reach the admin at the public URL (`OPENCLOUDCMS_PUBLIC_URL`, default `http://localhost:PORT`). Opening it at another address (`127.0.0.1`, a LAN IP) makes setup and login fail with `origin_mismatch`; open the configured URL or set `OPENCLOUDCMS_PUBLIC_URL` to the address you use.

## Environment

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres connection (read by `opencloudcms.config.ts`) |
| `PORT` | default `4000` |
| `OPENCLOUDCMS_SECRET` | required, at least 32 bytes (`opencloudcms init` generates one) |
| `OPENCLOUDCMS_PUBLIC_URL` | optional in dev (default `http://localhost:${PORT ?? 4000}`), required when `NODE_ENV=production` |
| `OPENCLOUDCMS_ADMIN_EMAIL`, `OPENCLOUDCMS_ADMIN_PASSWORD` | seed the first Super Admin without the setup page |

## Admin and website (Next inside Nest)

The project runs one Next app (`app/(admin)` + `app/(site)`) inside the Nest process. Nest handles `/api/**`
and `/oauth2/**`; everything else goes to Next, loaded from the project (`next`, `react`, `react-dom` are
optional peer dependencies, not needed with `web.enabled: false`). The admin ships as `@opencloudcms/core/admin`,
`@opencloudcms/core/admin/layout` and `@opencloudcms/core/admin/theme.css` (ESM in `dist/admin`, bundled by the
project's Next). `/admin/**` is served with a CSP using a per-request nonce plus `X-Robots-Tag: noindex`;
`/` gets no CSP.

Production needs `NODE_ENV=production`, `OPENCLOUDCMS_PUBLIC_URL` and a built `.next` (`pnpm build` in the project,
before `pnpm start`). Without a build, web routes answer 503 (`Web UI chưa được build. Chạy \`pnpm build\` rồi khởi động lại.`).
`.next/cache` is on local disk, so run a single instance.

Working on the admin inside this monorepo: `pnpm --filter @opencloudcms/core dev:admin` (`tsc -w`) next to
`pnpm --filter my-store dev`. `dev:admin` does not copy `theme.css`; run `pnpm --filter @opencloudcms/core build`
once on a fresh checkout first.

## Page builder

Website pages are **data** (the core content type `opencloudcmsPage`), built with drag and drop in the admin
(`/admin/pages`, [Puck](https://puckeditor.com) `0.24.1`, pinned). Blocks are **code** in the project.

### Blocks

```tsx
// src/blocks/product-grid/product-grid.block.tsx
import { b, defineBlock } from '@opencloudcms/core/blocks';

const COLUMNS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' } as const;

export default defineBlock({
  name: 'ProductGrid',                       // stable key stored in pages: PascalCase, unique
  label: { 'en-US': 'Product grid', 'vi-VN': 'Lưới sản phẩm' },
  category: 'commerce',                      // group in the editor's component list
  icon: 'layout-grid',                       // lucide icon name
  fields: {
    heading: b.text({ label: 'Heading', default: 'Featured' }),
    columns: b.select({ options: [2, 3, 4], default: 3 }),
    products: b.entries('product', { limit: 12, sortable: true, filterable: true }),
  },
  render: ({ heading, columns, products }) => (
    <section className="py-12">
      <h2 className="text-2xl font-semibold">{heading}</h2>
      <div className={`grid gap-6 ${COLUMNS[columns]}`}>
        {products.map((p) => <p key={p.documentId}>{String(p.name)}</p>)}
      </div>
    </section>
  ),
});
```

```ts
// src/blocks/index.ts
import { coreBlocks, defineBlocks } from '@opencloudcms/core/blocks';
import ProductGrid from './product-grid/product-grid.block';

export default defineBlocks([...coreBlocks, ProductGrid]);
```

`defineBlocks` throws on a duplicate or non-PascalCase `name`, an unknown field kind or a `default` of the wrong
type. `coreBlocks`: `Section`, `Columns`, `Grid`, `Spacer`, `Divider`, `Heading`, `Text`, `Image`, `Button`,
`ButtonGroup`, `Card`, `Badge`, `Hero`, `FeatureList`, `CallToAction`, `FAQ`, `EntryList` (any content type:
pick or query, list/grid/table).

| Builder | Stored in the page | `render` receives | Editor input |
|---|---|---|---|
| `b.text`, `b.longText` | string | string | input / textarea |
| `b.richText` | HTML string (normalized: only what the editor produces) | rendered node (sanitized HTML) | rich text editor |
| `b.number`, `b.boolean`, `b.select`, `b.radio` | value | value | matching input |
| `b.link` | `{ kind: 'url', href }` or `{ kind: 'page', documentId }` | `{ href }` (page path resolved; `null` if gone) | URL or page picker |
| `b.image` | `{ assetId?, src, alt }` | `{ src, alt, width?, height? }` | asset picker or URL |
| `b.color`, `b.spacing` | design-system token (`primary`, `muted`, `4`, …) | token | token list |
| `b.entry(apiId)` | `{ documentId }` | resolved entry or `null` | entry search |
| `b.entries(apiId, opts)` | `{ mode: 'pick', ids }` or `{ mode: 'query', filter, sort, limit }` | entry array | pick, or a filter on indexed/unique fields |
| `b.list({ ...fields })` | array of objects | array of objects | repeatable rows |
| `b.slot({ allow?, max? })` | nested blocks | `ReactNode` | drop zone |

Rich text is parsed with the editor's schema (tiptap, the extensions of Puck's `richtext` field) and written back
(`normalizeRichText`): other tags, event handlers, `style` other than text alignment and links other than
`http(s)`/`mailto`/… (no `javascript:`) are dropped. The server does it on save (blocks listed with `richText` paths in
`pages.blocks`), `readPageContent` on read, and the website renders it in place (no stored HTML is ever written
unsanitized).

Only declared fields are stored. `version` (default `1`) is stored as `_v` on every block; when the props change
shape, bump it and add `migrate: [{ from: 1, up: (props) => ({ ...props, … }) }]` (run when a page is read).

**Rules for `render`** (the same file runs in the editor, in the browser, on the website, in a server component,
and is imported by Nest for `blockManifest`):

- isomorphic: no server-only APIs (`fs`, `next/headers`, …), no `fetch`, no database access; data comes in
  through `b.entry` / `b.entries` / `b.link` / `b.image`, resolved in batches before rendering;
- no CSS imports: Tailwind classes only, written out in full (`grid-cols-${n}` is never generated). The project's
  `app/globals.css` scans the core blocks and `src/blocks`;
- interactive parts go in a child component marked `'use client'`.

### Wiring (written by `opencloudcms init`)

| File | |
|---|---|
| `src/blocks/index.ts` | `export default defineBlocks([...coreBlocks, …])` |
| `src/app.module.ts` | `pages: { blocks: blockManifest(blocks) }` (Nest loads `@opencloudcms/core/blocks` as CommonJS) |
| `tsconfig.server.json` | `"jsx": "react-jsx"` (block files are TSX) |
| `app/(admin)/admin/AdminWithBlocks.tsx` | `'use client'` wrapper: `<AdminApp blocks={blocks} />`; `[[...slug]]/page.tsx` re-exports it |
| `app/(site)/[[...path]]/page.tsx` | `createCmsPage({ blocks })` from `@opencloudcms/core/blocks/next`: `default` = `Page`, `generateMetadata`, `dynamic = 'force-dynamic'` |
| `app/(site)/%5F_opencloudcms/preview/route.ts`, `…/preview/exit/route.ts` | `createPreviewRoute()`, `createPreviewExitRoute()`. Next treats folders starting with `_` as private; `%5F` keeps the URL `/__opencloudcms/preview` |
| `app/globals.css` | `@source "../node_modules/@opencloudcms/core/dist/blocks"; @source "../src/blocks";` |

`createCmsPage` and `createPreviewRoute` call the API at `baseUrl` (default `http://127.0.0.1:${PORT ?? 4000}`). In
draft mode (and in the preview route) they forward the visitor's cookies, including the admin session, to `baseUrl`:
it must be this server itself (loopback or the site's own origin), never another host.

The renderer serves the page published at the request path in the default locale; a path without a page is
`notFound()`; `/` without a page shows a welcome page. A file route of `app/(site)` (e.g. `blog/page.tsx`) wins
over a page with the same path: `GET /api/admin/pages/shadowed` lists those paths (computed at boot) and the
editor warns about them.

### Preview

- In the editor: the canvas renders the blocks with draft data (iframe, same `globals.css`).
- On the website: "View on website" opens `/__opencloudcms/preview?page=<documentId>&locale=<locale>`. The route
  checks the admin session against the API (`content.read`), turns on Next draft mode, sets
  `opencloudcms_preview_locale` and redirects to the page path. In draft mode every catch-all page shows drafts
  (including the entries of data blocks) with a "Viewing draft · Exit" bar; the session is checked on every request
  and without it the published page is shown. There is no share token: someone without an admin account sees the
  published page. Responses are `Cache-Control: private, no-store`.
- Next marks its draft-mode cookie `Secure` in production, so the website preview needs https (or `localhost`).
- After signing in from a preview link you land on `/admin`, not back on the preview.

### API

| | |
|---|---|
| `/api/admin/content/opencloudcmsPage/**` | the usual content API (CRUD, publish, versions); fields `title`, `path`, `seo`, `content` (all localizable) |
| `GET /api/content/opencloudcmsPage/by-path?path=&locale=` | published page (public) |
| `GET /api/admin/content/opencloudcmsPage/by-path?path=&locale=` | draft page (`content.read`, `no-store`) |
| `GET /api/admin/pages/blocks-check` | `{ data, manifest }`: pages using blocks missing from `pages.blocks` |
| `GET /api/admin/pages/shadowed` | `{ data: string[] }`: page paths served by a file route of the website |

`path`: `/` or `/segment(/segment)*` with lowercase letters, digits and hyphens; unique per locale. Errors:
422 `invalid_path`, 422 `path_reserved` (`/_next`, `/admin`, `/api`, `/oauth2`, `/__opencloudcms`), 409
`unique_violation`, 409 `stale_draft` (the `If-Match` timestamp is not the current one), 422 `unknown_block` on
publish (`issues: [{ path: [name], message: <count> }]`; send `{ "force": true }` to publish anyway). Unknown blocks
render nothing on the website (one WARN per name) and appear as a removable placeholder in the editor.
A page whose `content` has another `formatVersion` (needs migration) is read-only in the editor and renders an
empty body on the website (one WARN per page and locale).
`apiId` `opencloudcmsPage` is reserved.

### Limits

- Puck is 0.x and pinned exactly; stored content carries `formatVersion` (the Puck minor) for data migrations.
- The website serves the default locale only; other locales can be edited, published and previewed.
- No caching: each request calls the API over loopback and resolves the data blocks.
- Data blocks do not populate references inside entries (they stay ids).
- The editor canvas shows the page body only (no website header/footer); "View on website" shows the full page.
- Adding or changing a block is a code change (and a deploy); building and publishing pages works in production.

## i18n

One API, two entries. Server code (Nest, server components of the website) imports from `@opencloudcms/core`;
client components (`'use client'`) import from `@opencloudcms/core/admin`. A client component must never import
`@opencloudcms/core`: its main entry is the Nest module. In a server component Next resolves `@opencloudcms/core` with
the `react-server` condition to a small module that has only the functions below, so NestJS is not bundled
(no `serverExternalPackages` needed).

| | `@opencloudcms/core` | `@opencloudcms/core/admin` |
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
import { defineMessages } from '@opencloudcms/core';
export const messages = defineMessages({
  'en-US': { home: { title: 'Welcome, {name}' } },
  'vi-VN': { home: { title: 'Chào mừng, {name}' } },
});

// app/(site)/page.tsx (server component)
import { createTranslator } from '@opencloudcms/core';
import locales from '../../src/locales';
import { messages } from './messages';
const t = createTranslator(messages, locales.defaultLocale);
t('home.title', { name: 'Ann' });
```

Project strings are added next to the core's; they do not override the admin's own strings.

Everything under `app/` that runs on the server (server components, route handlers, server actions,
middleware) gets **only** this i18n API from `@opencloudcms/core` (the `react-server` condition; any other name is
`undefined` there) and needs the Node runtime, not Edge. The generated `app/(site)/messages.ts` is therefore
server-only: client components import `defineMessages` from `@opencloudcms/core/admin` instead.

Website languages: `GET /api/admin/locales` → `{ supported, locales, defaultLocale, editable, entryCounts }`;
`PUT /api/admin/locales` `{ locales, defaultLocale, confirmDisable? }` rewrites `src/locales.ts` (only with
`schemaEditable` and an existing `src/locales.ts`, else 403). Disabling a locale that still has entries
answers 409 `locale_has_entries` until it is listed in `confirmDisable`; its rows are kept, not deleted.
Content groups: `GET/PUT /api/admin/content-groups` rewrites `src/content-groups.ts`; removing a group still
used by a content type answers 409 `group_in_use`. Content APIs reject a `locale`/`fallback` that is not
enabled with 400 `locale_not_enabled`.

## Permissions and review workflow

Every `/api/admin/**` route checks a permission of the signed-in user (groups and `@RequirePermission` are
described in [`@opencloudcms/oauth2`](../oauth2/README.md#groups-and-permissions)); missing → 403 `forbidden`.

| Route | Permission |
|---|---|
| `GET /api/admin/meta`, `GET /api/admin/content-types(/:apiId)` | session only |
| `GET /api/admin/content/:apiId(/:documentId)`, `…/versions`, `GET /api/admin/assets`, `GET /api/admin/taxonomies(/:slug/terms)` | `content.read` |
| `POST /api/admin/content/:apiId` | `content.create` |
| `PATCH …/:documentId` | `content.update`; while In review also `content.publish`, else 409 `in_review_locked` |
| `POST /api/admin/assets`, `POST /api/admin/taxonomies/:slug/terms` | `content.update` |
| `DELETE …/:documentId` | `content.delete` |
| `POST …/publish`, `…/unpublish` | `review: true` type: `content.publish`; otherwise `content.update` or `content.publish` |
| `POST …/submit` | `content.submit` |
| `POST …/withdraw` | the submitter or `content.publish` |
| `POST …/reject`, `POST …/approve`, `GET /api/admin/workflow/pending-count` | `content.publish` |
| `POST/DELETE /api/admin/content-types…`, `POST …/plan`, `/api/admin/content-groups`, `POST /api/admin/taxonomies` | `settings.content-types` |
| `/api/admin/locales` | `settings.languages` |

A content type with `review: true` keeps its review state in the core table `opencms_workflow` (one row per
document, all locales together; no row = clean draft):

| Endpoint | From → to |
|---|---|
| `POST /api/admin/content/:apiId/:documentId/submit` | Draft → In review |
| `POST …/withdraw` | In review → Draft |
| `POST …/reject` `{ note }` (1–1000 chars) | In review → Draft, `note` kept for the author until the next submit |
| `POST …/approve` | In review → published (row deleted); from any other state 409 `invalid_transition` |
| `POST …/publish` | direct publish by a `content.publish` holder, from Draft or In review (row deleted) |

Invalid transitions answer 409 `invalid_transition`; transitions lock the row, so of two concurrent approvals
one wins and the other gets 409. Draft entries carry `workflow: { state, submittedBy: { id, name } | null,
submittedAt, note } | null`. `GET /api/admin/content/:apiId?workflow=in_review` lists entries waiting for
review; `GET /api/admin/workflow/pending-count` → `{ count, byType }`. Publishing through `approve` runs the
same hooks as `publish`.

## Breaking changes

- `adminToken` and `OPENCLOUDCMS_ADMIN_TOKEN` are removed; `/api/admin/*` needs a signed-in session whose groups grant the matching permission (`content.*`, `settings.*`); `GET /api/admin/meta` and content type reads need only a session.
- CORS on the admin API is removed; use `cors.origins` for `/api/content/**`.
- Errors under `/api/**` are `{ "error": { "code", "message", "issues"? } }`.
- `OPENCLOUDCMS_INTERNAL_URL` is removed (the BFF calls `http://127.0.0.1:${PORT ?? 4000}`).
- The Nest app must be created with `bodyParser: false`.
- The admin is now Next modules and the old admin options and dev variable are replaced by `web` (migration steps in the changelog).
- Locale codes are `en-US`, `vi-VN`, `fr-FR`, `id-ID`; short codes (`en`) fail config validation. Content rows are migrated by the core migration `0002_region_locales`, applied by `opencloudcms migrate:up` (run by `start`) or `autoMigrate`.
- Roles became permission groups (tables renamed to `auth_groups`, `auth_user_groups`); routes are guarded with `@RequirePermission` (the role decorator is removed); creating a user needs `groupIds`. Details in the root `CHANGELOG.md`.

See the root `CHANGELOG.md`.
