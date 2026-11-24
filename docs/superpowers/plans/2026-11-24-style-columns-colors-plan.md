# Style system (columns, spacing, size, colors, palettes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the block builder lay out a real storefront (the user's my-store mockup) — ratio/custom column tracks, per-side spacing, size, brand colors and palettes, all per breakpoint — and rebuild that mockup in `examples/my-store` with builder-made blocks.

**Architecture:** A pure `NodeStyle` value model and validator in `@opencloudcms/schema`; `styleProps()` in the blocks `ui` turns a style into CSS custom properties plus literal Tailwind classes from lookup tables; composed nodes carry an optional `style` sibling of `props`. A project `src/theme.ts` declares brand colors and palettes; `ThemeStyle` emits the active palette as `:root` variables; a dev-only theme API rewrites the file. The admin gets a style panel (token-or-custom fields, box model, colors, column tracks), a device toggle that both resizes Puck's iframe and selects the breakpoint being edited, and a Theme screen.

**Tech Stack:** TypeScript, React 19, Next.js 16, NestJS 11, Puck 0.24.1 (pinned), Tailwind v4, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-24-style-columns-colors-design.md` (mockup: `docs/superpowers/specs/assets/2026-11-24-store-preview.html`, image `docs/superpowers/specs/assets/store-editorial.png`)

## Global Constraints

- Breakpoints: `base` (mobile), `md` ≥ 768px, `lg` ≥ 1024px. Mobile-first: an unset breakpoint inherits the nearest smaller one.
- Custom length: `^-?\d+(\.\d+)?(px|rem|em|%|vw|vh)$`, absolute value ≤ 10000; a leading `-` is valid only inside `margin`. Spacing tokens are `SPACING_TOKENS` (unit-less) and render as `calc(var(--spacing) * N)`.
- Color value: a `COLOR_TOKENS` member, `brand:<name>` with name `^[a-z][a-z0-9-]{0,31}$`, or hex `#rgb|#rrggbb|#rrggbbaa`. `brand:x` renders `var(--ocms-color-x)`.
- Track: `<n>fr` with n integer 1–12, `auto`, or a Length. ≤ 12 tracks per breakpoint in composed Columns, ≤ 6 in the library `Columns` block.
- CSS variable prefix `--ocms-`; brand colors `--ocms-color-<name>`.
- Every Tailwind class is a literal string in a lookup table (`@source` scan of `dist/blocks`); never interpolate class names. Tailwind v4 variable syntax `pt-(--ocms-pt)`.
- A user value reaches a `style` attribute only after passing the validators above (no CSS injection).
- Specs/nodes without `style` and the old props render byte-identical classes to today.
- `@opencloudcms/schema` imports no `node:*`; blocks `ui` stays isomorphic (no hooks, no browser globals); dual ESM/CJS build of blocks.
- All admin strings in en-US, vi-VN, fr-FR, id-ID.
- Theme writes: dev only (`schemaEditable`), through `SchemaWriteQueue`, permission `settings.content-types`.
- No VinFast or other real-brand assets; my-store demo uses the mockup's own text and the user's image.

## Review Focus

1. A malicious or malformed style value (`red;background:url(x)`, `1e9px`, `brand:Foo`, `#12`) saved via the blocks API → rejected with a path, never rendered.
2. A `brand:` color whose name the active theme lacks → renders (variable unset, no crash), builder shows a warning.
3. Editing at `md` a property stored as a plain value (all breakpoints) → becomes `{ base: old, md: new }`, base unchanged.
4. Opening and saving an old block (Box `padding`, Columns `count`) → converted to `style`/`tracks`, renders the same at every breakpoint.
5. `hidden.md: true` on a Stack → hidden on tablet only; mobile and desktop keep `flex` display.

---

### Task 1: Style values and theme in `@opencloudcms/schema`

**Files:**
- Create: `packages/schema/src/style.ts`, `packages/schema/src/theme.ts`
- Modify: `packages/schema/src/composed-block.ts` (ComposedNode `style`, Columns/Stack/Image prop checks, walk), `packages/schema/src/index.ts`
- Test: `packages/schema/test/style.test.ts`, `packages/schema/test/theme.test.ts`, `packages/schema/test/composed-block.test.ts`

**Interfaces:**
- Produces (`style.ts`):
  - `BREAKPOINTS = ['base','md','lg'] as const`, `type Breakpoint`
  - `type Responsive<T> = T | Partial<Record<Breakpoint, T>>`
  - `type Length = string` (token or custom), `type ColorValue = string`, `type Track = string`, `type Sides = { t?: Length; r?: Length; b?: Length; l?: Length }`
  - `interface NodeStyle` exactly as the spec's Values section plus `span?: Responsive<number | 'full'>` (1–12)
  - `RADIUS_TOKENS = ['none','sm','md','lg','xl','full']`, `BORDER_WIDTH_TOKENS = ['0','1','2','4']`
  - `isLength(v: unknown, opts?: { negative?: boolean; auto?: boolean }): boolean`, `isColorValue(v: unknown): boolean`, `isTrack(v: unknown): boolean`
  - `resolveResponsive<T>(v: Responsive<T> | undefined): Partial<Record<Breakpoint, T>>` — plain value → `{ base: v }`; object kept; an object is recognised only when every key is a Breakpoint
  - `valueAt<T>(v: Responsive<T> | undefined, bp: Breakpoint): { value: T | undefined; from: Breakpoint | null }` (inheritance)
  - `setAt<T>(v: Responsive<T> | undefined, bp: Breakpoint, next: T | undefined): Responsive<T> | undefined` (plain + bp≠base → object; clearing the last key → undefined)
  - `validateNodeStyle(style: unknown, path: (string|number)[]): ComposedIssue[]`
- Produces (`theme.ts`): `interface ThemeDefinition { colors: Record<string, { label?: string }>; palettes: Record<string, { label?: string; values: Record<string, string> }>; activePalette: string }`, `defineTheme(t)`, `validateTheme(t: unknown): ComposedIssue[]`, `activeColors(t: ThemeDefinition): Record<string, string>`
- Composed: `ComposedNode.style?: NodeStyle`; Columns props `tracks?: Responsive<Track[]>`, `alignY`, `gapX`, `gapY`; Stack `justify: 'start'|'center'|'end'|'between'`, `wrap: boolean`, `direction` and `align` now also responsive (`Responsive<'vertical'|'horizontal'>`, `Responsive<'start'|'center'|'end'|'stretch'>`); Image `fit: 'cover'|'contain'`, `aspect?: Responsive<'auto'|'square'|'video'|'3/2'|'4/3'|'wide'>`.

- [ ] **Step 1: Write failing tests** — `style.test.ts`: `isLength('37px')`, `isLength('8')`, `isLength('5%')` true; `isLength('-4px')` false, `isLength('-4px',{negative:true})` true; `isLength('1e9px')`, `isLength('10001px')`, `isLength('4px;color:red')` false; `isColorValue('brand:accent-ink')`, `'#fbf8ef'`, `'#fff'`, `'primary'` true; `'brand:Foo'`, `'#12'`, `'red'` false; `isTrack('2fr')`, `'auto'`, `'240px'` true, `'13fr'`, `'0fr'` false; `valueAt({base:'4',lg:'8'},'md')` → `{value:'4',from:'base'}`; `setAt('4','md','8')` → `{base:'4',md:'8'}`; `setAt({md:'8'},'md',undefined)` → `undefined`; `validateNodeStyle({padding:{t:'-4px'}},['s'])` has issue at `['s','padding','t']`; margin `-4px` ok; `columns tracks` of 13 → issue. `theme.test.ts`: a palette missing a color → issue `['palettes','clay','values','line']`; `activePalette` unknown → issue; invalid hex → issue; `activeColors` returns the active palette's values. `composed-block.test.ts`: node with `style:{background:'brand:accent'}` valid; `style:{color:'red;x'}` → issue path `['tree','style','color']`; Columns `props.tracks` `{base:['1fr'],md:['2fr','3fr']}` valid, `['99fr']` invalid.
- [ ] **Step 2: Run** `pnpm vitest run packages/schema` — FAIL.
- [ ] **Step 3: Implement** `style.ts`, `theme.ts`, extend `walk` in `validateComposedSpec` to call `validateNodeStyle(n.style, [...path,'style'])` and check the new Columns/Stack/Image props; export from `index.ts`. Style changes are not breaking (`isBreakingChange` unchanged).
- [ ] **Step 4: Run** `pnpm vitest run packages/schema` — PASS; `pnpm -r typecheck` clean.
- [ ] **Step 5: Commit** `feat(schema): node style values, column tracks and theme palettes`

### Task 2: `styleProps` and the `ui` primitives

**Files:**
- Create: `packages/core/blocks/src/ui/style.ts`
- Modify: `packages/core/blocks/src/ui/tokens.ts`, `ui/layout.tsx`, `ui/content.tsx`, `ui/index.ts`, `packages/core/blocks/src/composed/render.tsx`
- Test: `packages/core/test/blocks/ui.test.ts`, `packages/core/test/blocks/composed.test.ts`

**Interfaces:**
- Consumes: Task 1 types and validators.
- Produces:
  - `styleProps(style: NodeStyle | undefined, display?: 'block'|'flex'|'grid'|'inline-flex'): { className: string; style: React.CSSProperties }` — invalid values are skipped (re-validated with Task 1 checks); empty style → `{ className: '', style: {} }`.
  - `cssLength(v: string): string` (token → `calc(var(--spacing) * N)`, else as is), `cssColor(v: string): string` (token → `var(--color-<token>)`, `brand:x` → `var(--ocms-color-x)`, hex as is), `cssTracks(t: Track[]): string` (`'2fr 3fr'`, `'auto 1fr auto'`, lengths via `cssLength`).
  - Variables: `--ocms-{pt,pr,pb,pl,mt,mr,mb,ml,w,maxw,h,minh,cols,span}` with suffix `''|'-md'|'-lg'`; `--ocms-bg`, `--ocms-fg`, `--ocms-bc`, `--ocms-bw`, `--ocms-r`.
  - Lookup tables in `tokens.ts` (`STYLE_CLASS[prop][bp]`), e.g. `pt: { base: 'pt-(--ocms-pt)', md: 'md:pt-(--ocms-pt-md)', lg: 'lg:pt-(--ocms-pt-lg)' }`, `cols: { base: 'grid-cols-(--ocms-cols)', … }`, `span: { base: 'col-span-(--ocms-span)', … }` (`full` → `col-span-full` literal table), `HIDE: Record<Breakpoint, …>` and `SHOW: Record<display, Record<Breakpoint, string>>` (e.g. `{ flex: { base: 'flex', md: 'md:flex', lg: 'lg:flex' } }`), border sides table `{ t:'border-t-(length:--ocms-bw)', … }` with `border-(--ocms-bc)`.
  - All layout/content primitives accept `style?: NodeStyle` and render `cn(tokenClasses, sp.className)` + `style={sp.style}`; Columns accepts `tracks`, `alignY`, `gapX`, `gapY`; Stack `justify`, `wrap`, responsive `align` (literal per-bp table) and responsive `direction` (literal table `{base:'flex-col'|'flex-row flex-wrap', md:'md:flex-col'|'md:flex-row md:flex-wrap', lg:…}`; a plain value renders exactly today's classes); Image `fit`, `aspect` (aspect classes literal per bp, `3/2` → `aspect-[3/2]`, `4/3` → `aspect-[4/3]`).
  - Columns with `tracks`: missing breakpoints filled from the smaller one; emits `--ocms-cols*` and `grid grid-cols-(--ocms-cols) md:… lg:…`; without `tracks` exactly today's classes.
  - When a node's style sets padding (any bp), the old `padding` token class is not emitted; same for `background`.
  - `renderNode` passes `n.style` and the new props to the primitives.
- [ ] **Step 1: Write failing tests** — `styleProps({padding:{t:'37px'}})` → className contains `pt-(--ocms-pt)`, style `{'--ocms-pt':'37px'}`; `{padding:{md:{l:'5%'}}}` → `md:pl-(--ocms-pl-md)`; token `'8'` → `calc(var(--spacing) * 8)`; `{background:'brand:accent'}` → `--ocms-bg: var(--ocms-color-accent)`; `{color:'red;x'}` → nothing emitted; `{hidden:{md:true}}` with display `flex` → `flex md:hidden lg:flex`; `{span:{base:'full',md:1}}` → `col-span-full md:col-span-(--ocms-span-md)`; render of Columns `tracks={{base:['1fr'],md:['2fr','3fr']}}` has `--ocms-cols:1fr`, `--ocms-cols-md:2fr 3fr`, `--ocms-cols-lg:2fr 3fr`; Box `padding="8"` without style renders the same class string as before (snapshot of today's output); every value in every `STYLE_CLASS` table matches `/^[a-z:-]+(\(.+\)|\[.+\])?$/` and is a literal (iterate tables). `composed.test.ts`: a spec with `style` on Box and `tracks` on Columns renders the expected classes and variables.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/blocks` — FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** — PASS; `pnpm --filter @opencloudcms/core build` succeeds and `grep -c "pt-(--ocms-pt)" packages/core/dist/blocks -r` ≥ 1.
- [ ] **Step 5: Commit** `feat(blocks): styleProps, column tracks and style-aware ui primitives`

### Task 3: Library `Columns` tracks and `ThemeStyle`

**Files:**
- Modify: `packages/core/blocks/src/library/layout.tsx`, `packages/core/blocks/src/fields.ts` (if a new field kind is needed), `packages/core/blocks/src/next/*` (export), `packages/core/blocks/src/puck-config.ts`
- Create: `packages/core/blocks/src/next/theme-style.tsx`
- Test: `packages/core/test/blocks/library.test.ts`, `packages/core/test/blocks/puck-config.test.ts`

**Interfaces:**
- Consumes: Task 1 `ThemeDefinition`, `activeColors`, `validateTheme`; Task 2 `cssTracks`.
- Produces:
  - Library `Columns` fields: `columns` (kept, fallback), new `tracks: b.tracks({ max: 6 })` (stored `Responsive<Track[]> | null`), slots `column1`..`column6`. Rendered column count = tracks length at the widest set breakpoint when `tracks` set, else `columns`. Puck field: custom field kind `tracks` rendered by the admin (Task 5's `TrackField`), with a plain fallback select of presets when the admin renderer is absent.
  - `ThemeStyle({ theme, palette? }: { theme: ThemeDefinition; palette?: string }): ReactElement` → `<style>{':root{--ocms-color-x:#…;…}'}</style>`; skips (and `console.warn`s once) on invalid themes; values pass `isColorValue` hex check before output.
- [ ] **Step 1: Failing tests** — library Columns with `tracks={{base:['1fr'],md:['2fr','1fr','1fr']}}` renders 3 column wrappers and `--ocms-cols-md:2fr 1fr 1fr`; old data `{columns:3}` renders as today; `ThemeStyle` of the mockup's olive palette outputs `--ocms-color-surface:#fbf8ef`; `palette:'clay'` override uses clay; a value `'#fff;}body{'` never appears in output.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/blocks` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(blocks): column tracks on the Columns block and ThemeStyle`

### Task 4: Theme file and API

**Files:**
- Modify: `packages/codegen/src/loader.ts` (`themeFile`, `loadTheme`), `packages/codegen/src/printer.ts` (`printThemeFile`), `packages/codegen/src/index.ts`, `packages/core/src/opencloudcms.module.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/theme.ts` (`ThemeService`, `ThemeController`)
- Test: `packages/codegen/test/theme.test.ts`, `packages/core/test/integration/theme.test.ts`

**Interfaces:**
- Produces:
  - `themeFile(config): string` → `<root>/src/theme.ts`; `loadTheme(config): Promise<ThemeDefinition | null>` (fresh jiti, like `loadContentGroups`; missing file → null; invalid → throws with `validateTheme` issues).
  - `printThemeFile(t: ThemeDefinition): string` — header comment "Managed by OpenCloudCMS: edit by hand or from the admin Page builder > Theme", `import { defineTheme } from '@opencloudcms/schema';`, `export default defineTheme({...});`, stable key order (colors, palettes, activePalette).
  - `GET /api/admin/theme` → `{ theme: ThemeDefinition | null, editable: boolean }` (permission `content.read`).
  - `PUT /api/admin/theme` body `ThemeDefinition` → same shape (permission `settings.content-types`; `SchemaBuilderService.assertEditable()`; queue; 422 `{ message, issues }` on `validateTheme` issues; writes via `printThemeFile`; snapshot the previous file and restore it if the write throws).
- [ ] **Step 1: Failing tests** — printer round-trip (`loadTheme` of a printed file deep-equals the input); integration: GET with no file → `{theme:null}`; PUT valid in an editable temp project → file written and GET returns it; PUT with `schemaEditable:false` → 403; PUT invalid hex → 422 with path `['palettes','olive','values','surface']`.
- [ ] **Step 2: Run** `pg_ctlcluster 16 main start; pnpm vitest run packages/codegen packages/core/test/integration/theme.test.ts` — FAIL.
- [ ] **Step 3: Implement**; register controller and service in the module next to Locales.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(core): theme file and admin theme API`

### Task 5: Style fields and element style sections in the block builder

**Files:**
- Create: `packages/core/admin/src/block-builder/style/` — `fields.tsx` (`LengthField`, `ColorField`, `SidesField`, `TrackField`), `StylePanel.tsx`, `breakpoint.ts`, `migrate.ts`
- Modify: `block-builder/element-config.ts`, `block-builder/tree-puck.ts`, `pages/BlockEditor.tsx`, i18n `messages/{en-US,vi-VN,fr-FR,id-ID}.ts`
- Test: `packages/core/test/admin/style-fields.test.ts`, `packages/core/test/admin/tree-puck.test.ts`, `packages/core/test/admin/block-builder.test.ts`

**Interfaces:**
- Consumes: Task 1 (`valueAt`, `setAt`, validators, `NodeStyle`), Task 4 GET theme (brand color list).
- Produces:
  - `RESERVED_ITEM_KEYS` gains `'style'`; `treeToPuck`/`itemToNode` copy `style` (omitted when empty object).
  - `STYLE_SECTIONS: Record<ComposedElement, ('layout'|'spacing'|'margin'|'size'|'maxWidth'|'colors'|'textColor'|'visibility'|'span')[]>` per the spec table; `span` for every child of Columns/Grid (shown when the parent is Columns or Grid).
  - `migrateLegacyProps(el: ComposedElement, props: Record<string, unknown>, style: NodeStyle | undefined): { props; style }` — Box `padding: p` → `style.padding = {t:p,b:p}`; Card `padding: p` → all four sides; Box/Card `background` is NOT converted: the semantic token prop stays (it carries its paired foreground class) and is shown in the Colors section next to the style background; a style background, when set, replaces it (Task 2); Columns `count: n` → `tracks: { base: ['1fr'], md: n×'1fr' }` (count 4 → `lg: 4×1fr`, `md: 2×1fr`, matching today's `COLS[4]`). Called from Puck `resolveData` on the first change of an item.
  - Field behaviour: a token `Select` (tokens; for colors: semantic swatches, then brand swatches from the theme, then "Custom") and, for Custom, a number + unit input (`px rem em % vw vh`) or a hex input with `<input type="color">`; invalid input shows an error and is not written. Inherited values render muted with "from Mobile/Tablet"; a reset button calls `setAt(v, bp, undefined)`.
  - `SidesField`: box-model widget (outer margin ring, inner padding ring), link toggle sets all four sides.
  - `TrackField`: preset strip (1 · 1:1 · 1:2 · 2:1 · 1:1:1 · 1:2:1 · 1:1:1:1 · auto|1fr|auto · 1fr auto) + per-track editor (`fr`/`auto`/length, add/remove, max from props).
  - Columns element fields: `tracks` (TrackField), `alignY`, `gapX`, `gapY`; Stack: `justify`, `wrap`; Image: `fit`, `aspect`. `count` hidden for new nodes (kept for legacy display only until migrated).
  - One Puck custom field `style` per element rendering `StylePanel` with the sections of `STYLE_SECTIONS[el]`.
- [ ] **Step 1: Failing tests** — tree-puck round trip keeps `style`; `migrateLegacyProps('Box',{padding:'8'})` → `{props:{}, style:{padding:{t:'8',b:'8'}}}`; Columns `count:3` → `tracks {base:['1fr'], md:['1fr','1fr','1fr']}`; `STYLE_SECTIONS.Heading` excludes `spacing` and includes `margin`; `LengthField` (React Testing Library, as other admin tests) at bp `md` with value `'4'` shows inherited muted "4" and writing `37px` emits `{base:'4',md:'37px'}`; entering `4px;x` shows the error and emits nothing; i18n test: all new keys exist in 4 locales.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/admin` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(admin): style panel, column tracks and legacy prop migration in the block builder`

### Task 6: Device toggle, canvas theme and page-builder fields

**Files:**
- Modify: `block-builder/BuilderHeader.tsx`, `block-builder/Canvas.tsx`, `block-builder/context.ts`, `pages/BlockEditor.tsx`, `pages/PageEditor.tsx`, the page editor header, i18n files
- Create: `packages/core/admin/src/block-builder/style/theme-context.tsx`
- Test: `packages/core/test/admin/block-builder.test.ts`, `packages/core/test/admin/pages.test.ts`

**Interfaces:**
- Consumes: Task 5 `StylePanel`, `TrackField`; Task 3 `ThemeStyle`; Task 4 GET theme.
- Produces:
  - Puck `viewports={[{width:375,label:Mobile},{width:768,label:Tablet},{width:1280,label:Desktop}]}` on both editors; a 3-button toggle in each header that sets Puck's current viewport; `breakpointForWidth(w: number): Breakpoint` (`<768` base, `<1024` md, else lg) drives the panel's edited breakpoint via context.
  - `ThemeContext` `{ theme: ThemeDefinition | null; palette: string; setPalette(p) }`; a palette select in both headers (only when the theme has > 1 palette) changes the canvas only; `ThemeStyle` rendered inside the canvas iframe root.
  - Page builder renders the library Columns `tracks` field with `TrackField`; and brand colors appear wherever the page builder uses `ColorField`.
- [ ] **Step 1: Failing tests** — `breakpointForWidth(375)`='base', `(768)`='md', `(1280)`='lg'; header toggle click calls Puck dispatch with width 768; palette select hidden with one palette; canvas root contains `--ocms-color-` for the selected palette.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(admin): device breakpoints and palette preview in the builders`

### Task 7: Page builder › Theme screen

**Files:**
- Create: `packages/core/admin/src/pages/ThemeSettings.tsx`
- Modify: `packages/core/admin/src/navigation.ts` (`pageBuilderItems` gets `{ to: '/settings/theme', label: 'nav.theme', icon: PaletteIcon, permission: 'settings.content-types' }`), router, i18n files, `packages/core/test/admin/can.test.ts`
- Test: `packages/core/test/admin/theme-settings.test.ts`

**Interfaces:**
- Consumes: Task 4 API.
- Produces: screen listing colors (rows) × palettes (columns) with hex inputs + swatches; add/rename/remove color and palette; pick active palette; Save → PUT; 422 issues shown inline by path; read-only (inputs disabled, notice) when `editable` false; empty state with "Create theme" when `theme` is null (seeds one palette `default`).
- [ ] **Step 1: Failing tests** — renders the olive/clay/night matrix from a mocked GET; changing a hex and saving sends the full theme; read-only mode disables inputs; nav test: `pageBuilderItems` has 3 items.
- [ ] **Step 2–4:** run FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(admin): Page builder > Theme screen`

### Task 8: my-store rebuild of the mockup

**Files:**
- Create: `examples/my-store/src/theme.ts`, `examples/my-store/src/blocks/{store-header,store-hero,section-head,story-band,store-footer}/*.block.ts` (builder format, `defineComposedBlock`), `examples/my-store/public/files/store-editorial.png` (or seeded as an asset — whichever the existing seed uses for images)
- Modify: `examples/my-store/src/blocks/composed.ts`, `examples/my-store/app/(site)/layout.tsx` (`<ThemeStyle theme={theme} />` in `<head>`, body `bg-(--ocms-color-surface) text-(--ocms-color-ink)`), `examples/my-store/app/globals.css` (serif display font for h1/h2 and the mockup's type sizes — project CSS, allowed by the spec), `examples/my-store/scripts/seed-pages.ts` (home `/` = StoreHeader, StoreHero, SectionHead + ProductGrid/ActiveProducts, StoryBand, StoreFooter; existing pages untouched), `packages/cli/src/init/templates.ts` (scaffold `src/theme.ts` with one palette and ThemeStyle in the site layout), `scripts/smoke-init.mjs`, README.md, packages/core/README.md, CHANGELOG.md
- Test: `packages/core/test/blocks/composed.test.ts` (load each my-store block spec, validate, render at base/md), smoke

**Interfaces:**
- Consumes: everything above.
- Produces — block layouts (values from the mockup CSS, colors only via `brand:`):
  - `StoreHeader`: Stack `justify:'between'`, style `{ minHeight:'76px', padding:{t:'14px',b:'14px',l:'5%',r:'5%'}, borderWidth:'1', borderSides:['b'], borderColor:'brand:line', background:'brand:surface' }`; wordmark Text (field `brand`, default `my-store`) + nav Stack of Buttons (variant link, fields for 3 links); `direction {base:'vertical', md:'horizontal'}`, `align {base:'start', md:'center'}` (mockup ≤420px stacks).
  - `StoreHero`: Columns `tracks {base:['1fr'], md:['2fr','3fr']}` (the mockup's ratio select is a design-time control: 40/60 · 50/50 · 60/40 are the 2:3 / 1:1 / 3:2 presets of the block builder's track field, not a site field). Copy column Stack (`justify` center, padding `75px`), Heading level 1, Text, Button (`background:'brand:accent'`, `color:'brand:accent-ink'`); Image `fit:'cover'`, style `minHeight {base:'0', md:'450px'}`, `aspect {base:'3/2', md:'auto'}`, `height {md:'100%'}`.
  - `SectionHead`: Stack horizontal `justify:'between'`, `wrap`, Heading 2 + link Button.
  - `StoryBand`: Box `background:'brand:feature'`, padding `72px 5%`, Columns `2fr 3fr` (base `1fr`).
  - `StoreFooter`: Box `background:'brand:accent'`, `color:'brand:accent-ink'`, Columns `tracks {base:['1fr','1fr'], md:['2fr','1fr','1fr']}`, intro Stack style `span {base:'full', md:1}`.
  - `src/theme.ts`: colors `surface, feature, ink, accent, accent-ink, line`; palettes `olive`, `clay`, `night` with the mockup's exact hex values; `activePalette: 'olive'`.
- [ ] **Step 1: Failing test** — every my-store composed spec passes `validateComposedSpec`; StoreFooter render contains `--ocms-cols:1fr 1fr` and `--ocms-cols-md:2fr 1fr 1fr`; `validateTheme(theme)` is empty.
- [ ] **Step 2–4:** FAIL → implement → PASS. Then `pnpm --filter my-store typecheck`, run `pnpm seed:pages` against the dev DB and `node scripts/smoke-init.mjs` (add steps: GET/PUT theme, open builder with StoreHeader, save without changes keeps the file byte-identical).
- [ ] **Step 5: Commit** `feat(my-store): rebuild the storefront mockup with builder blocks and palettes`

### Task 9: Visual acceptance

**Files:** none (controller task; screenshots under the plan workspace).

- [ ] **Step 1:** Start my-store (`pnpm dev`), open `/` at 375, 768, 1280 with each palette (switch `activePalette` via the Theme screen), screenshot, and compare side by side with the mockup at the same widths (open the mockup HTML with the image path pointed at the copied asset).
- [ ] **Step 2:** In the block builder, open StoreHeader, toggle Tablet, change padding left to `40px`, confirm canvas updates and the saved file has `md` only; revert.
- [ ] **Step 3:** List differences; fix any layout one (not typography) as a follow-up commit, or record it in the ledger.
