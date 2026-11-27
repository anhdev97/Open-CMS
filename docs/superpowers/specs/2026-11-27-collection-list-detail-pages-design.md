# Collection list element, slug fields and entry detail pages — design

Date: 2026-11-27 · Status: approved 2026-11-27 · Branch: `feat/collection-list-detail-pages` (from
`feat/builder-components` e1254f0; rebased onto `main` once PR #15 is merged)

## Intent

Two gaps hit the user while building real sites:

1. **A block cannot mix static content with a repeating list.** Binding a block to a collection makes the whole
   tree the item template, so a "Questions" block with a common title repeats the title for every question. Today
   the workaround is two blocks side by side on the page (`section-head` + `product-grid` in my-store).
2. **Entries have no pages of their own.** The `slug` field kind is a plain text box (its `from` option does
   nothing), pages match exact paths only, so my-store seeds one page per product and products added later link to
   404s; `entryUrl` needs a hand-typed `urlPattern` on every block.

This sprint adds a **Collection list** element (the list lives inside the block, the rest renders once), makes the
**slug field** real (generated, unique, accent-free), and adds **entry detail pages**: a content type can opt into a
detail URL (`/products/{slug}`), and one template page per such type renders every entry.

Test target in `examples/my-store`: a "Questions" block (Heading from a block field + Collection list of `question`
entries + "See all" button) where the title appears once; `product` has a detail page `/products/{slug}` rendered from
one template page; a product created after seeding gets a working page and product cards link to it without
`urlPattern`; the seed no longer creates one page per product.

## Goals

- **Collection list element** in the block builder: anywhere in a block's tree, children are the item template
  (with `entry.*` bindings and `entryUrl`), content outside renders once; several lists per block; per-list page
  editor options (filter, sort, limit, layout).
- **Slug fields:** default = the entry id; an optional pattern (`{name}`, `{name}-{id6}`, …) generates SEO-standard
  slugs (accent-free), editable, validated, unique per content type and locale.
- **Detail pages:** an opt-in per content type (off by default), a template page per enabled type in the page
  builder, website routing `/<prefix>/{slug}` → template rendered with that entry, 404 when missing.
- **Automatic entry links:** `entryUrl` resolves from the type's detail path when no `urlPattern` is set.
- **Compatible:** existing blocks (including block-level collection bindings and `urlPattern`), pages, content
  types and entries behave exactly as today.

## Non-goals (agreed)

- Block-in-block (embedding one composed block in another).
- Nested Collection lists (a list inside a list's item template).
- Automatic redirects when a slug changes.
- Several detail-page variants for one content type.
- A detail page for private types.
- Embedding the code `EntryList` library block in the block builder (it stays a page-builder block, unchanged).
- Dynamic "related" lists (filters that reference the route entry) — custom code later.
- Block lifecycle hooks (`beforeQuery` / `afterFetch`, client hooks) — next phase.

## Anti-goals

- A detail URL that renders a draft or private entry to anonymous visitors.
- A typo'd or duplicate slug silently shadowing another entry's page.
- An ordinary page becoming unreachable because a detail path pattern matches its path.
- Breaking stored page data or block specs: no migration of existing content may be required.

## Approaches

**Collection list.**
1. *A `CollectionList` element* (chosen): the binding moves from the block to an element; many lists per block, lists
   inside Tabs/Columns, combinable with a single-entry block binding. Costs a new element across schema, renderer,
   eject and builder, per-list stored page props, and page resolution that handles several lists per block.
2. *Header/footer zones on a collection-bound block:* smallest change, but one list per block and the static
   content only above or below.
3. *Slot + two blocks:* today's workaround; nothing to build, but it is the pain point.

**Where the detail URL is declared.**
- *A. On the content type* (chosen): one detail path per type, so `entryUrl` always knows an entry's URL; one
  template page per type.
- *B. On the page* (`/products/:slug` page with a type): more flexible, but an entry's canonical URL becomes ambiguous.

The user picked 1 and A, with detail pages opt-in per type.

## Design

### 1. Collection list (`@opencloudcms/schema`, blocks, codegen, builder)

New element `CollectionList`.

| Prop | Value | Default |
|---|---|---|
| `key` | `^[a-z][a-zA-Z0-9]{0,31}$`, unique within the block | `list`, `list2`, … (assigned on drop) |
| `apiId` | a non-private content type | required |
| `filter`, `sort`, `limit` | same shapes and limits as `ComposedBinding` (limit 1–50) | none / none / 12 |
| `layout` | `list` \| `grid` (columns 2–6) \| `carousel` (per view 1–6) | `{ kind: 'grid', columns: 3 }` |
| `emptyText` | LocalizedText | none |
| `urlPattern` | optional, same rules as `ComposedBinding.urlPattern` | none (the type's detail path is used) |
| `editor` | `{ filter?, sort?, limit?, layout? }` booleans: which options page editors may change | all false |

- **Children** are the item template. Inside it the existing collection rules apply (`entry.*` sources, `entryUrl`,
  no `Slot`, no `Carousel`, no `Overlay`, no Region/PageContent), plus: no `CollectionList` inside a
  `CollectionList` at any depth.
- **Outside** the list, `entry.*` sources are invalid unless the block itself has a `single` binding (then they refer
  to that entry). A block with a block-level `collection` binding cannot contain a `CollectionList` (one model per
  block).
- **Max 4 lists per block.**
- **Stored page data:** each list gets a generated block field named after its `key`, a `b.entries` query field
  (the same kind block-level collections use today), so page resolution (`resolvePage`) batches it with every other
  query. Page-editor options appear in the block's fields when `editor.*` is on, prefixed with the list's label.
  The keys `list`, `list2`, … join the reserved generated field names, so manual fields can never clash with them.
- **Rendering:** same markup as today's block-level collection for each layout (grid/list/carousel), wrapped where
  the element sits; `emptyText` or nothing when empty (editor placeholder in the canvases).
- **Block builder:**
  - The palette "Data" category has Collection list (hidden in collection-bound blocks).
  - Props panel: content type picker, filter/sort/limit/layout, empty text, the page-editor toggles.
  - Bindings inside the item template offer the list's type fields. Sample data from the type fills the canvas, as
    block-level collections do today.
  - A FAQ-style template "List with heading" (Heading + Text + CollectionList > Card + Button) joins the Templates
    section.
- **Codegen:** print and eject support the element; eject equality tests cover it.

### 2. Slug fields (`slug` kind)

**Default = id.** A slug field without a pattern holds the entry's `documentId` (read-only in the admin, no
generation or uniqueness check). A detail page whose type has no slug field can also use `{id}` directly.

**Pattern (optional field option `pattern`)** — the slug is generated from entry fields:

| `pattern` | Result for name "Áo Thun Trắng", category "Áo" |
|---|---|
| (none, default) | `3f9a2c1e-…` (documentId) |
| `{name}` | `ao-thun-trang` |
| `{name}-{id6}` | `ao-thun-trang-3f9a2c` |
| `{category}-{name}` | `ao-ao-thun-trang` |

- Placeholders: field names of the type (text, slug-free scalar fields: text, longText, number, email, taxonomy
  term name) plus `{id}` (documentId) and `{id6}` (first 6 hex chars; 8 on collision). Unknown placeholders are a
  schema validation issue.
- Each field part goes through `slugify`; the parts are joined with `-`; the whole result is cut to `maxLength`.
- A pattern containing `{id}`/`{id6}` is unique by construction; routing resolves such slugs by the id part, so
  renaming keeps old links working (they render the entry; no redirect).
- With a pattern, editors may type their own value (custom). A typed value stops following the pattern; the admin
  shows "Regenerate" to go back to the pattern. Without a pattern the field is read-only.
- The legacy option `from: 'name'` is read as `pattern: '{name}'`.

**SEO-standard `slugify`:** `foldSearch` (accents removed, `đ`→`d`); `&` → `va` (vi) / `and` (other locales);
emoji and currency symbols dropped; lowercase; runs of other characters → `-`; no leading, trailing or double
dashes; max `maxLength` (default 75), cut at a word (dash) boundary. Example: "Áo Thun Trắng & Đen — Mùa Hè 2026!" →
`ao-thun-trang-va-den-mua-he-2026`.

The rules below apply to pattern slugs:

- **Generation (server, on create and update):** if the slug value is empty, or it was never edited by hand and a
  field used by the pattern changed, it is regenerated from the pattern.
- **"Edited by hand" (inferred, no new column):** on update the server computes the pattern result from the old
  values. If the stored slug equals it, or equals it plus a numeric suffix (`-2`, `-3`…), the slug is treated as
  generated and follows the new values; otherwise it was edited by hand and is kept.
- **Validation:** `^[a-z0-9]+(?:-[a-z0-9]+)*$`, length ≤ `maxLength`.
- **Uniqueness:** per content type and locale, counted per entry (`documentId`): a slug is taken when another entry
  has it in its draft or published row; the two rows of the same entry never conflict with each other.
  - A generated duplicate gets `-2`, `-3`, …
  - A typed duplicate is a 422 `slug_taken` with the field path; the entry form shows it inline.
  - Publishing re-checks against other entries' published rows and fails with 409 `slug_taken` in the rare case
    another entry took the slug meanwhile.
  - Routing reads published rows (drafts only in an authenticated preview).
- **Concurrency:** generation and uniqueness are enforced under a per-type advisory lock (or a unique index where
  the slug column exists), so two simultaneous creates cannot get the same slug.
- **Localized fields:** a localized slug is generated per locale from the field values in the same locale (falling
  back to the default locale's values); a non-localized slug is generated from the default locale's values and shared
  across locales.
- **Existing entries (grandfathered):** keep their values. Format validation applies only when the slug value
  changes, so saving another field never fails on an old slug; an empty slug is filled on the next update. Detail
  routing only matches slugs in the valid format. Duplicates already in the data are reported in the content type page
  ("2 entries share slug x") and do not block reads; detail routing picks the most recently published one and the
  admin warns.

### 3. Detail pages

**Content type setting** (stored in the type definition, edited in the content type pages, dev-only like other
schema writes):

```ts
detailPage?: { path: string; slugField?: string }   // '/products/{slug}' + slugField, or '/posts/{id}' (no slug field)
```

- **Path rules:**
  - It starts with `/`, contains exactly one `{slug}` or `{id}` as the last segment, and its static segments match
    the page path rules. `{slug}` requires `slugField`; `{id}` matches the entry's `documentId`.
  - Not allowed on private types.
  - `slugField` must be a `slug` field of the type. The admin refuses to delete or retype that field while the
    detail page is on (disable it first); a code-defined schema that does it anyway is tolerated: the type shows
    "detail page misconfigured", its detail URLs return 404, and nothing else breaks.
  - Two types cannot have overlapping patterns.
- **Toggle:** off by default; the content type edit page has a "Detail page" section (switch, slug field picker, path
  with a live example).

**Template page:**

- A page row with `kind: 'detail'` and `detailApiId`, created from the Pages list ("New detail template" lists the
  enabled types without one). At most one per type.
- It uses base pages like ordinary pages, has no `path` of its own, and appears in admin lists but never in public
  page lists.
- In the page builder, a "Preview entry" picker chooses which entry fills the template (defaults to the latest
  published).

**Routing** (`by-path`, used by the website and the preview):

1. An exact page path match wins (ordinary pages are never shadowed).
2. Otherwise, if the path matches an enabled type's pattern, the entry with that slug is looked up in the requested
   locale. Public requests only see published, non-private entries; draft preview with a valid session sees drafts.
3. Found and a template exists: respond with the template page plus the entry (`routeEntry`). Missing entry or no
   template: 404 (the admin shows "no detail template" on the type).
4. The admin warns when an ordinary page's path matches a detail pattern ("this page hides /products/{slug} for slug
   x").

**Blocks on a template:**

- Single-entry blocks (block-level `single` binding) whose type equals the template's type use the route entry when
  their `entry` field is empty; a picked entry still wins.
- The page editor shows the field as "Page entry (from URL)" by default on templates.

**SEO:** title and description default to the entry's title field and first text field. The page's SEO settings can
override them with placeholders `{field}`.

**Cache:** detail responses use the same cache rules as pages.

### 4. Automatic entry links

- `entryUrl` (CollectionList items, block-level collections, clickable Box/Card/Image `href`, Button `href`)
  resolves as follows:
  1. the block's `urlPattern` if set (unchanged behaviour);
  2. otherwise the entry type's `detailPage.path` with `{slug}` filled from `slugField` (or `{id}` from
     `documentId`);
  3. otherwise no link (as today when `urlPattern` is missing).
- The schema rule "'entryUrl' requires binding.urlPattern" becomes "requires `urlPattern` or a content type with a
  detail page". The check runs where type definitions are available (server block checks and the builder); the pure
  spec validator only rejects the case where neither can apply.
- The page resolution step fills a per-type `detailPath` map so the website renderer needs no extra requests.

### 5. my-store

- `product`'s slug uses `pattern: '{name}'`; `product` gets `detailPage: { path: '/products/{slug}', slugField: 'slug' }`
  and a template page with the existing product tabs and badge tooltip.
- `seed-pages.ts` stops creating one page per product and creates the template instead; the README note about
  product pages created by the seed is removed.
- A `question` content type with seeded entries, and a "Questions" block (Heading + Text from block fields,
  CollectionList of questions in an Accordion-style Card, "See all" button) on the home page.
- ProductStrip and ProductGrid drop their `urlPattern` (links come from the detail page).
- Smoke steps:
  - `/products/<slug>` of a product created during the smoke renders;
  - an unknown slug returns 404;
  - the Questions title appears once while the questions appear N times;
  - a draft product's URL is 404 anonymously.

## Decisions

(7–12 settled during the builder check as designer's calls.)

1. The collection binding moves to an element (`CollectionList`); block-level bindings keep working unchanged.
2. The detail URL is declared on the content type, opt-in, one per type.
3. Exact page paths always win over detail patterns.
4. Typed duplicate slugs are rejected; generated ones get numeric suffixes.
5. Template pages are a new page kind `detail`; they have no path of their own.
6. `urlPattern`, when set, wins over the type's detail path.
7. "Edited by hand" is inferred from the old source value (with numeric suffixes); no new column.
8. Slug uniqueness counts per entry across draft and published rows; publish re-checks.
9. CollectionList has its own optional `urlPattern`; a block's single-binding `urlPattern` never applies to lists.
10. Old slugs are grandfathered: format checks only on change; empty ones are filled on the next update.
11. Non-localized slugs come from the default locale's source value.
12. A dangling `detailPage` is refused in the admin and tolerated at runtime (404 + admin warning).
13. Slugs default to the entry id; generation only with a field `pattern` (`{field}`, `{id}`, `{id6}`), custom
    values allowed when a pattern exists (user); SEO slugify with 75-char default.
14. Related-by-route-entry lists and block lifecycle hooks are out of this sprint (user).

## Constraints

- Literal Tailwind classes in lookup tables only; theme colors via `--ocms-color-*`.
- `@opencloudcms/schema` imports no `node:*`, React or lucide; blocks `ui` stays isomorphic; client code only in
  `@opencloudcms/core/blocks/client`; Next-only code in `blocks/next`.
- Existing specs, pages, content types and entries behave and render byte-identically; existing specs keep today's
  validation results (the render baseline test stays green).
- A private or unpublished entry never reaches an anonymous request through a detail URL, `entryUrl` or a
  CollectionList.
- Schema writes (`detailPage`, slug options) stay dev-only through `SchemaWriteQueue`; a new migration only adds
  columns or indexes (no data rewrite).
- All new admin strings in en-US, vi-VN (accented), fr-FR, id-ID.
- my-store uses placeholder copy only.

## Review focus (for the plan)

1. Two entries created at the same time from the same title get distinct slugs.
2. A page at `/products/sale` exists and `product` has `/products/{slug}`: `/products/sale` renders the page, not a
   product.
3. A product unpublished after being cached: its detail URL becomes 404 within the cache window and never shows
   draft data.
4. Renaming or deleting the slug field, or disabling the detail page, while a template exists: the admin explains
   the state; the website returns 404 cleanly; nothing crashes.
5. A block with two CollectionLists of the same type with different filters on one page: both resolve in the batch,
   ids and keys stay distinct, and page-editor options apply to the right list.

## Left to the builder

- Exact storage of the generated CollectionList fields and how their editor options are labelled.
- The advisory-lock vs unique-index choice for slug uniqueness per storage layout.
- The admin UI details of the "Detail page" section and the "New detail template" flow.
- SEO field defaults when a type has no obvious title field.
