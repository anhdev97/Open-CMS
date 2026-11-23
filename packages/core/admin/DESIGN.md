# OpenCloudCMS admin design system

The admin is a set of Next App Router modules (`@opencloudcms/core/admin`, `/admin/layout`, `/admin/theme.css`) built from shadcn components (`src/components/ui/`) and a few OpenCloudCMS components (`src/components/`), styled with Tailwind v4 and the tokens in `src/styles/theme.css`. Open `/admin/_ui` (served only when the host runs in dev mode) to see every component and variant in light and dark.

## Tokens

All colours are CSS variables in `src/styles/theme.css`, mapped to Tailwind utilities (`bg-primary`, `text-muted-foreground`, `border-border`, ...). `--radius` is `0.5rem`; the radius steps follow shadcn (`sm = radius - 4px`, `md = radius - 2px`, `lg = radius`, `xl = radius + 4px`). Shadows are Tailwind defaults: cards use `shadow-xs`, dialogs `shadow-lg`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#f7f7f5` | `#161615` | Page background |
| `--foreground` | `#1d1d1b` | `#ecebe7` | Text on background |
| `--card`, `--popover` | `#ffffff` | `#1f1f1d` | Panels, dialogs, menus |
| `--card-foreground`, `--popover-foreground` | `#1d1d1b` | `#ecebe7` | Text on card / popover |
| `--primary` | `#2f5bea` | `#7b9cff` | Primary button, links |
| `--primary-foreground` | `#ffffff` | `#10172e` | Text on primary |
| `--secondary`, `--muted` | `#efeeea` | `#2a2a27` | Secondary surfaces and buttons |
| `--secondary-foreground` | `#1d1d1b` | `#ecebe7` | Text on secondary |
| `--muted-foreground` | `#6b6a66` | `#a09e97` | Secondary text |
| `--accent` | `#eaf0ff` | `#232c47` | Hover, selected sidebar item |
| `--accent-foreground` | `#1e3fb8` | `#c7d4ff` | Text on accent |
| `--destructive` | `#c73a2e` | `#ff7b6e` | Delete, errors |
| `--destructive-foreground` | `#ffffff` | `#2a0f0c` | Text on destructive |
| `--destructive-soft` | `#fdecea` | `#3a1f1c` | Error alert background |
| `--success` | `#1f7a4a` | `#6fd39c` | Published, success |
| `--success-soft` | `#e8f6ee` | `#173024` | Success badge / alert background |
| `--warning` | `#8a5a00` | `#f0c060` | Migration warning, "changed" |
| `--warning-soft` | `#fff5e0` | `#3a2f16` | Warning badge / alert background |
| `--border` | `#e3e2de` | `#34332f` | Borders |
| `--input` | `#d6d5d0` | `#3d3c38` | Input borders |
| `--ring` | `#2f5bea` | `#7b9cff` | Focus ring (2px, offset 2px) |
| `--sidebar` | `#ffffff` | `#1f1f1d` | Sidebar background |
| `--sidebar-foreground` | `#1d1d1b` | `#ecebe7` | Sidebar text |
| `--sidebar-accent` | `#eaf0ff` | `#232c47` | Selected sidebar item |
| `--sidebar-accent-foreground` | `#1e3fb8` | `#c7d4ff` | Text on selected item |
| `--sidebar-border` | `#e3e2de` | `#34332f` | Sidebar borders |
| `--sidebar-primary` | `#2f5bea` | `#7b9cff` | Equals `--primary` |
| `--sidebar-primary-foreground` | `#ffffff` | `#10172e` | Equals `--primary-foreground` |
| `--sidebar-ring` | `#2f5bea` | `#7b9cff` | Equals `--ring` |
| `--chart-1` ... `--chart-5` | `#2f5bea`, `#1f7a4a`, `#c77d00`, `#8e44ad`, `#c73a2e` | `#7b9cff`, `#6fd39c`, `#f0c060`, `#c39bd3`, `#ff7b6e` | Reserved for charts |

## Dark mode

The default follows `prefers-color-scheme`. `ThemeToggle` stores the choice in `localStorage['opencloudcms-theme']` (read and written inside try/catch) and sets the `.dark` class on `<html>`. A small inline script in `src/layout.tsx` (nonce taken from the CSP header) sets the class before first paint so the page never flashes. Use `src/lib/theme.ts` (`getTheme`, `setTheme`, `applyTheme`) rather than touching the class directly.

## Adding a component

From `packages/core/admin`:

```sh
pnpm dlx shadcn@latest add <name>
```

Commit the generated file unchanged, then show it on the `/_ui` page (`src/pages/UiKit.tsx`). The only intentional edits to generated files are the `success` / `warning` variants of `badge` and `alert`, the `destructive` variant of `button`, the `variant` prop of `AlertDialogAction`, and the focus-ring classes (`focus-visible:` with `ring-offset-background`). Radix primitives come from the `radix-ui` umbrella package.

## Rules

- Pages are composed only from `components/ui` and `components/*`.
- No hex or `rgb()` colours in TSX or CSS outside `theme.css`. Use utilities mapped from the tokens (`bg-primary`, `text-muted-foreground`, ...).
- No arbitrary Tailwind values (`[13px]`) unless a comment next to them says why.
- Icons come only from `lucide-react`.
- Every interactive element works with the keyboard and shows a visible focus ring (`focus-visible:`, never plain `focus:`, with `ring-offset-background`).
- UI text is English and lives only in `src/i18n/messages/*` (en-US is the source), read through `t()`.
- Modules imported by root vitest tests (`lib/api.ts` once the API client is added, `lib/api-error.ts`, `lib/format-issue.ts`, `i18n/messages/en-US.ts`, ...) use relative imports only; the `@/` alias no longer exists because `tsc` does not rewrite it on emit.

## Page editor

`/admin/pages/:documentId?locale=` is a full-screen [Puck](https://puckeditor.com) editor (`src/pages/PageEditor.tsx`, parts in `src/page-editor/`).

- **Chrome.** Puck's `overrides.header` is `EditorHeader` (back, title + path, locale, undo/redo, "View on website", save state, Save, Publish). `overrides.fieldTypes` (`puck-fields.tsx`) swaps Puck's text, textarea, number, select and radio inputs for `components/ui`. Puck keeps its own layout, drawer, outline, viewport/zoom controls and array/rich-text fields; their strings come from `pageEditor.puck.*` through Puck's `dictionary`.
- **Data fields** are Puck custom fields built from `components/ui`: `LinkField` (URL or page), `ImageField` (the content editor's asset picker and upload via `FieldInput`, or a URL, plus alt text), `EntryField`/`EntryPicker` (search drafts of the type), `EntriesField` (pick, or filter on `indexed`/`unique` fields + sort + limit), `TokenField` (`b.color`/`b.spacing`: design tokens only) and `ContentTypeField` (the text prop named by an entries field's `apiIdFrom`). Every field renders its own label with `FieldShell`.
- **Canvas.** Puck's iframe copies the host page's styles, so blocks are drawn with the same `app/globals.css` as the website. Puck's CSS is imported as `@puckeditor/core/no-external.css`: the default `puck.css` `@import`s a font from rsms.me, which the admin CSP blocks (and the failed import breaks the editor chunk). Data fields are shown resolved (`resolvePage` with the admin fetcher, 300 ms after a data-field change); before that they get empty values (`previewProps`).
- **Saving.** `autosave.ts` debounces 1.5 s, sends `If-Match` with the last `updatedAt`, stops on `409 stale_draft` (conflict banner with Reload) and saves on Save, locale switch, back, unmount and before unload.
- **States.** Unknown blocks are delete-only placeholders (`UnknownBlock`, hidden from the drawer). `needs-migration` content is read-only with a warning banner and is never saved. A locale without a translation offers "Copy from <default locale>". `b.slot({ max })` is enforced by undoing the drop that overfills a slot (Puck 0.24 slots have no `max`).

## Dev workflow

Run `pnpm --filter @opencloudcms/core dev:admin` (`tsc -w`, emits to `dist/admin`) next to the example host app (`examples/my-store`), whose Next dev server bundles the admin from `dist/admin`. Edit `src/`, `tsc` re-emits, Next hot-reloads. `pnpm --filter @opencloudcms/core build` produces the full output including `theme.css`; `dev:admin` does not copy `theme.css`, so on a fresh checkout run that build once before `dev:admin`.

## Note for plugins

The components are built on Tailwind, so a plugin UI that wants to look the same must also use Tailwind with these same tokens. The components are not exported for plugins yet.

## Translations

The `vi-VN`, `fr-FR` and `id-ID` bundles in `src/i18n/messages/` are machine-made. They need review by native speakers before a public release. `messages.test.ts` guards structure only (same keys, same `{placeholders}`, not copies of English), not wording quality.

## Block builder

`/admin/settings/blocks/:name` (or `new`) is a full-screen Puck editor for composed blocks (`src/pages/BlockEditor.tsx`, parts in `src/block-builder/`). It reuses the page editor's Puck setup: iframe canvas with `no-external.css`, `fieldTypes`, `TokenField`, `ImageField`, Puck's dictionary strings.

- **Canvas.** One Puck component per design-system element (`element-config.ts`, token props from `ELEMENT_PROPS`). Each element is drawn by `defineComposedBlock` itself with the sample entry, `_locale` (the header's preview language, default the site's default locale) and `_editor: true`, so it looks exactly like the page builder and the website. Containers draw their Puck slot with `ui.layoutClass` so drops land in the real grid/stack. A collection draws the template once (editable) and the other samples after it, read-only (`inert`). Elements hidden by their show condition stay visible, dimmed. Puck data ⇄ spec `tree` is a pure conversion (`tree-puck.ts`).
- **Samples.** Drafts from `/api/admin/content/:apiId` with the block's fixed filter, sort and limit (at most 12), asset ids of image bindings resolved with one assets call; a single-entry block lists 20 entries in the header's "Sample entry" select. No match → a placeholder entry built from the field labels (`sample-data.ts`).
- **Right panel.** Nothing selected → `BlockPanel` (Puck `overrides.fields`): labels in four languages, technical name (follows the English label until the first save, then locked), category, icon, block fields (type, label, default, choices for `select`; a field used by an element cannot be removed), and the content settings (entry page address, fixed filters on indexed/unique fields with non-indexed fields shown disabled, order, count, layout, page-editor switches, empty text). An element selected → its Puck fields: "Content" (`SourcePicker` per bindable prop: kind-compatible content fields only, never multiple/reference, entry page link, block fields or "+ New block field", fixed value), the token props and "Show". Binding a Price to a money field sets "Show currency" from the field's currency mode (`fixed` yes, `market` no).
- **Saving.** Explicit Save (no autosave): a dialog lists the changes (or the validation issues), then `PUT /api/admin/blocks/:name`; `409 block_in_use` asks again with the page count and what pages lose, then resends with `confirmBreaking`. The "Commit these files" card stays after the first save (the URL is replaced without a router navigation). Leaving with unsaved edits asks first. Switching one entry ⇄ list remounts Puck (its drawer rules are read once), which resets undo history. Production (`schemaEditable: false`) shows everything read-only.
