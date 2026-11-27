# Block builder common components — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag-and-drop builder elements for the interactive pieces websites need (Dropdown, Tooltip, Accordion, Tabs, Carousel, Icon, seven form controls), hover styles, icons in buttons, clickable Image/Box/Card, and starter templates, UI only.

**Architecture:** New `ComposedElement`s are validated in `@opencloudcms/schema` and rendered server-side by `@opencloudcms/core/blocks` with all content in the HTML. CSS-only elements use literal Tailwind lookup tables (`group-hover:`, `group-focus-within:`, `<details>`); Dropdown, Tabs, Carousel, Combobox and Accordion `single` get small client components in `@opencloudcms/core/blocks/client`. The Puck-based block builder gets element configs, three new field kinds, a hover style section, selection-aware canvas rendering and a Templates palette section. Codegen prints and ejects the new elements.

**Tech Stack:** TypeScript, React 19, Next.js 16, Puck 0.24.1 (pinned), Tailwind v4, lucide-react, vitest + happy-dom, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-26-builder-components-design.md` (sections 1–5 and decisions 1–8 are binding).

## Global Constraints

- Literal Tailwind classes in lookup tables only (no interpolated class names); theme colors via `--ocms-color-*`.
- `@opencloudcms/schema` imports no `node:*`, React or lucide; blocks `ui` stays isomorphic; client code only in `@opencloudcms/core/blocks/client` (ESM + CJS, no browser globals at import time); Next-only code in `blocks/next`.
- Specs, pages and buttons without the new elements, props or `style.hover` render byte-identically; existing specs keep today's validation results.
- Strict unknown-prop checks only on the new elements (`Dropdown`, `Tooltip`, `Accordion`, `AccordionItem`, `Tabs`, `TabPanel`, `Carousel`, `Icon`, `Input`, `Textarea`, `Select`, `Combobox`, `Radio`, `Checkbox`, `Switch`) and on the new props of Button (`icon`, `iconPosition`, `iconOnly`), Image/Box/Card (`action`, `ariaLabel`).
- Form control `name`: `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Options: 1–100 entries, `value` non-empty ≤ 100 chars and unique, `label` non-empty.
- Counts: Accordion 1–30 items, Tabs 1–12 panels, Carousel 1–20 slides, `perView` 1–6, `autoplay` `off` or 3–10, Textarea `rows` 2–12, Tooltip `text` ≤ 200 chars, icons ≤ 80.
- Every interactive element is keyboard (Tab, Enter/Space, Esc, arrows per the ARIA pattern) and touch operable, with visible focus rings; all panel/tab/slide content in the server HTML.
- No form submission, no menu data model, no new server endpoints.
- All new admin strings in en-US, vi-VN (accented), fr-FR, id-ID.
- my-store uses placeholder copy only.

## Review Focus

1. Touch: a hover Dropdown opens on tap, closes on outside tap / second tap / Esc, no sticky hover (test in Task 3).
2. Right edge on a 375 px screen: Dropdown `bottom-end` panel and a Tooltip near the edge cause no horizontal scroll (`max-w`, wrapping) (checked in Task 8; classes asserted in Tasks 2–3).
3. Tabs/Accordion inside a collection item template: ids unique per rendered item (test in Task 3).
4. Builder: removing the last TabPanel / AccordionItem shows an empty state and the validation message, no canvas crash (test in Task 5).
5. Carousel with 1 slide, `loop`, or fewer slides than `perView`: no arrows, no dots, no autoplay, no errors (test in Task 3).

---

### Task 1: Schema — elements, props, rules, hover, clickable containers, icons

**Files:**
- Modify: `packages/schema/src/composed-block.ts`, `packages/schema/src/style.ts`, `packages/schema/src/index.ts`
- Create: `packages/schema/src/icons.ts`, `packages/schema/src/form-controls.ts`
- Test: `packages/schema/test/composed-block.test.ts`, `packages/schema/test/style.test.ts`, `packages/schema/test/components.test.ts`

**Interfaces:**
- Produces:
  - `ComposedElement` / `COMPOSED_ELEMENTS` gain the 15 names in the Global Constraints list (13 elements + `AccordionItem`, `TabPanel`).
  - `ELEMENT_BINDABLE`: Dropdown `['label','href']`, Tooltip `['text']`, AccordionItem `['title']`, TabPanel `['label']`, Icon `['label']`, Input/Textarea/Select/Combobox `['label','placeholder','help']`, Radio/Checkbox/Switch `['label','help']`, Image `['src','alt','href']`, Box/Card `['href']`; others `[]`.
  - `ICON_NAMES: readonly string[]` (kebab-case lucide names, ≤ 80, including at least those listed in spec §5) and `isIconName(v): boolean`.
  - `FORM_CONTROL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/`, `type ControlOption = { value: string; label: string | LocalizedText }`, `validateOptions(v, path): ComposedIssue[]`, `INPUT_TYPES`, `AUTOCOMPLETE_TOKENS` (allow-list: `name`, `given-name`, `family-name`, `email`, `tel`, `street-address`, `postal-code`, `country`, `organization`, `username`, `current-password`, `new-password`, `bday`, `off`).
  - `NodeStyle.hover?: { background?: ColorValue; color?: ColorValue; borderColor?: ColorValue }` (allowed on Box, Card, Button only).
  - `ComposedBinding.layout.kind` gains `'carousel'` (`columns` 1–6 for carousel; grid keeps 2–6).
  - Exported helpers `INTERACTIVE_ELEMENTS` (`Button`, `Dropdown`, `Tooltip`, `Tabs`, `Accordion`, `Carousel`, `Slot`, the 7 controls) and `isClickable(node): boolean` (Image/Box/Card with `bind.href` or valid `props.action`).
- Rules (spec §1): props and defaults per the spec table; children rules (AccordionItem only in Accordion and vice versa, TabPanel only in Tabs and vice versa, counts); Tooltip exactly one child, not Tooltip/Dropdown/control; no Dropdown inside a Dropdown at any depth; the 5 interactive containers not the root of an overlay frame; Carousel not inside a collection item template; Dropdown with bound `href` requires `chevron` not `false`; Select/Combobox/Radio `defaultValue` is one of the option values; clickable Box/Card refuse any descendant in `INTERACTIVE_ELEMENTS` or a clickable Image/Box/Card; Image/Box/Card `action` via `validateButtonAction`; clickable Image with `alt` bound to `{from:'const', value:''}` → issue; `hover` on another element → issue; unknown props on the new elements → issue.

- [ ] **Step 1: Failing tests** in `components.test.ts`:
  - a nav spec (Stack > Button, Dropdown{label const 'Shop'} > Stack > 3 Buttons) is valid;
  - Dropdown inside a Dropdown panel (depth 2) → issue at the inner Dropdown `el`;
  - Dropdown with `bind.href` and `props.chevron: false` → issue at `props.chevron`;
  - Accordion with a Text child → issue; AccordionItem under Box → issue; Accordion with 31 items → issue; Tabs with 0 children → issue;
  - Tooltip with 2 children → issue; Tooltip wrapping an Input → issue;
  - Carousel `perView: { base: 7 }` → issue; `autoplay: 2` → issue; `autoplay: 'off'` valid; Carousel inside a collection item template → issue;
  - Icon `name: 'menu'` valid, `'not-an-icon'` → issue;
  - Input `name: '1x'` → issue, `type: 'color'` → issue; Select options with duplicate value → issue; `defaultValue: 'zz'` not in options → issue; Radio with 0 options → issue;
  - unknown prop `foo` on Tabs → issue; unknown prop `foo` on Heading → no issue (unchanged);
  - Box with `bind.href` containing a Button → issue; clickable Card containing Text and Image → valid; Image with `props.action: {type:'overlay', op:'open', target:'lien-he'}` valid; Image with `bind.href` and `alt` const `''` → issue;
  - `style.hover: { background: 'primary' }` on Button valid, on Text → issue (in `style.test.ts`);
  - binding `layout: { kind: 'carousel', columns: 1 }` valid, `{ kind: 'grid', columns: 1 }` still an issue;
  - every existing my-store spec and every fixture in `composed-block.test.ts` still returns the same issues as before.
- [ ] **Step 2: Run** `pnpm vitest run packages/schema` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(schema): builder component elements, hover style, clickable containers`

### Task 2: Rendering — CSS-only elements, icons, hover, clickable containers

**Files:**
- Modify: `packages/core/blocks/src/composed/render.tsx`, `packages/core/blocks/src/ui/content.tsx`, `packages/core/blocks/src/ui/layout.tsx`, `packages/core/blocks/src/ui/style.ts`, `packages/core/blocks/src/ui/index.ts`, `packages/core/package.json` (only if lucide must be listed for the blocks build)
- Create: `packages/core/blocks/src/ui/icon.tsx`, `packages/core/blocks/src/ui/tooltip.tsx`, `packages/core/blocks/src/ui/accordion.tsx`, `packages/core/blocks/src/ui/form.tsx`
- Test: `packages/core/test/blocks/components-ui.test.ts`, `packages/core/test/blocks/ui.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `ICON_NAMES`.
- Produces: `Icon({ name, size, label })`, `Tooltip`, `Accordion`/`AccordionItem` (`<details name>` per spec §2; `single` emits a shared `name`), `Input`, `Textarea`, `Select`, `Radio`, `Checkbox`, `Switch` (ids from `useId`, `<label for>`, help via `aria-describedby`), Button `icon`/`iconPosition`/`iconOnly`, Image/Box/Card rendered as `<a>` / `ActionButton` when clickable, hover classes `hover:bg-(--ocms-hover-bg)` / `hover:text-(--ocms-hover-fg)` / `hover:border-(--ocms-hover-border)` plus the variables, emitted only when `style.hover` is set. `ICON_COMPONENTS: Record<IconName, LucideIcon>` with explicit named imports.

- [ ] **Step 1: Failing tests** (`renderToStaticMarkup`): Icon `menu` renders an `<svg>` with `aria-hidden="true"` and no label, `role="img"` + `aria-label` with one; Tooltip renders `role="tooltip"` and the target's button gets `aria-describedby` equal to the bubble id; Accordion renders one `<details>` per item and `single` gives them the same `name`; `defaultOpen: 'first'` sets `open` on the first only; Input with `required` and `help` renders `<label for=X>`, `<input id=X required aria-describedby=Y>`; Select renders `<option>` per option with `defaultValue` selected and a disabled placeholder option; Radio renders `<fieldset><legend>`; Switch renders `role="switch"`; Button with `icon: 'shopping-cart', iconOnly: true` has `aria-label` = label and no visible label text; Image with bound href renders `<a href="/"><img alt="Trang chủ">`; Card with action renders a `<button type="button">` carrying the Card classes; `style.hover` on Box adds the hover classes and variables; **a spec snapshot of every existing my-store block renders byte-identical HTML to before** (compare with fixtures captured from `HEAD` before the change).
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/blocks` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(blocks): icon, tooltip, accordion, form controls, hover style, clickable containers`

### Task 3: Client runtimes — Dropdown, Tabs, Carousel, Combobox, Accordion single; collection carousel

**Files:**
- Create: `packages/core/blocks/src/client/Dropdown.tsx`, `Tabs.tsx`, `Carousel.tsx`, `Combobox.tsx`, `AccordionSingle.tsx`
- Modify: `packages/core/blocks/src/client/index.ts`, `packages/core/blocks/src/composed/render.tsx`, `packages/core/blocks/src/ui/index.ts` (server shells), collection layout rendering (where `layoutValue` / `grid-<n>` is handled)
- Test: `packages/core/test/blocks/components-client.test.ts`, `packages/core/test/blocks/composed.test.ts`

**Interfaces:**
- Consumes: Task 2 primitives, the existing overlay store (`closeOverlay`), `OverlayRouteWatcher` behaviour.
- Produces: client components exported from `@opencloudcms/core/blocks/client`; server render emits the no-JS markup from spec §2 and the client component hydrates it. Dropdown closes on Esc, outside pointerdown, route change and when its containing overlay closes; touch (`pointerType !== 'mouse'`) toggles on tap; `display` responsive per breakpoint with one panel. Tabs: `role="tablist"`, arrow keys / Home / End move focus and select, `aria-selected`, `hidden` on others. Carousel: scroll-snap track, arrows and dots only when `slides > perView`, autoplay only when `autoplay` is a number, `slides > perView`, not `prefers-reduced-motion`; pauses on hover, focus-within, `document.hidden`. Combobox: server `<select>`, client `role="combobox"` + `role="listbox"`, case- and accent-insensitive contains matching, hidden input keeps `name`. Collection binding `layout.kind: 'carousel'` and page-editor value `carousel-<n>` render the collection through Carousel (mobile 1.25 per view).

- [ ] **Step 1: Failing tests** (happy-dom, `@testing-library/react` as the existing client tests do):
  - Dropdown: hover opens (mouse); `pointerdown` with `pointerType: 'touch'` on the trigger opens, a second tap closes, tap outside closes; Esc closes and returns focus to the trigger; `aria-expanded` follows; with `href` the label is an `<a>` and only the chevron button toggles; panel content is in the server HTML;
  - Tabs: server HTML contains every panel, all but the first `hidden`; ArrowRight selects tab 2; two Tabs in two collection items have distinct ids;
  - Carousel: 1 slide or `slides <= perView` → no arrow buttons, no dots, no timer (`vi.useFakeTimers`); 3 slides `autoplay: 5` advances after 5 s, not while focus is inside, not under `prefers-reduced-motion: reduce`;
  - Combobox: server HTML is a `<select name=topic>`; after hydration typing "dich" matches "Dịch vụ";
  - Accordion single: opening item 2 closes item 1;
  - collection spec with `layout: { kind: 'carousel', columns: 4 }` renders a carousel track with the entries; stored `grid-3` / `list` values render as before.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm build` (ESM + CJS client entry) and `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(blocks): dropdown, tabs, carousel, combobox client runtimes`

### Task 4: Codegen — print and eject the new elements

**Files:**
- Modify: `packages/codegen/src/blocks.ts`, `packages/codegen/src/eject.ts`
- Test: the existing codegen block printer / eject tests (extend), `packages/core/test/blocks/define.test.ts`

**Interfaces:**
- Consumes: Task 1 spec shape, Tasks 2–3 renderers.
- Produces: printing a spec with every new element, `style.hover`, Button icon props and clickable Image/Box/Card round-trips (`parse(print(spec))` deep-equals `spec`); eject output renders the same HTML as the composed render.

- [ ] **Step 1: Failing tests:** a fixture spec containing all 15 new element names, hover, `layout.kind: 'carousel'` and clickable containers round-trips through the printer; ejected component HTML equals composed HTML for that fixture.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(codegen): print and eject builder component elements`

### Task 5: Block builder — element configs, field kinds, hover section, canvas visibility

**Files:**
- Modify: `packages/core/admin/src/block-builder/element-config.ts`, `tree-puck.ts`, `Canvas.tsx`, `ElementPanel.tsx`, `BlockPanel.tsx`, `style/StylePanel.tsx`, `style/fields.tsx`, `packages/core/admin/src/pages/BlockEditor.tsx`, admin locale files (en-US, vi-VN, fr-FR, id-ID)
- Create: `packages/core/admin/src/block-builder/OptionsField.tsx`, `IconPicker.tsx`, `ChildItemsField.tsx`
- Test: `packages/core/test/admin/builder-components.test.ts`, `packages/core/test/admin/tree-puck.test.ts`, `packages/core/test/admin/style-fields.test.ts`

**Interfaces:**
- Consumes: Task 1 schema, Tasks 2–3 renderers for the canvas.
- Produces:
  - `ELEMENT_PROPS`, `ELEMENT_DEFAULTS`, `STYLE_SECTIONS` entries for every new element (defaults from the spec table; AccordionItem/TabPanel default bound text `Item 1` / `Tab 1`); `StyleSection` gains `'hover'` on Box, Card, Button.
  - Palette categories `interactive` and `form`; `AccordionItem`/`TabPanel` not in the palette; Accordion/Tabs slots `allow` only their item element; `ChildItemsField` with "Add item" / "Add tab" buttons; Dropdown slot disallows `Dropdown`; clickable Box/Card slots disallow `INTERACTIVE_ELEMENTS` while `href`/`action` is set.
  - New `PropDef` kinds `options`, `icon`, `name` (`FORM_CONTROL_NAME_RE`); Image/Box/Card get `action` (existing `ActionField`) and Box/Card `ariaLabel`.
  - Canvas (block builder only): Dropdown panel and Tooltip bubble rendered open when the element or a descendant is selected; Tabs show the selected (or selection-containing) TabPanel and a click on a tab selects that TabPanel; Accordion items open; Carousel side by side, no autoplay. Page builder canvas uses the real runtimes.
  - Hover section has a "Show hover" toggle that previews hover colors on the selected element.
  - Empty Accordion/Tabs (last child removed) render an empty state with the validation message.
- [ ] **Step 1: Failing tests:** every new element appears in the right palette category with translated labels in all 4 locales (no missing keys); dropping Tabs creates one TabPanel; "Add tab" appends a TabPanel; removing the last TabPanel shows the empty state and the validation message, no throw; the options field adds/reorders/removes rows and rejects a duplicate value inline; the icon picker filters by name; selecting a Button inside a Dropdown panel renders the panel open in the canvas; selecting TabPanel 2 shows its content; the hover section writes `style.hover.background`; the tree ↔ Puck conversion round-trips specs with every new element.
- [ ] **Step 2: Run** `pnpm vitest run packages/core/test/admin` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(admin): block builder component elements, field kinds, hover section`

### Task 6: Builders — Templates palette section, palette search, page-editor carousel layout

**Files:**
- Create: `packages/core/admin/src/block-builder/templates.ts`, `packages/core/admin/src/components/PaletteSearch.tsx`, `packages/core/admin/src/lib/fold-search.ts`
- Modify: `packages/core/admin/src/block-builder/element-config.ts` (palette), `BlockEditor.tsx`, `PageEditor.tsx` / the page-editor drawer override (block list), the page-editor layout field (`editorLayout` options), admin locale files
- Test: `packages/core/test/admin/builder-templates.test.ts`, `packages/core/test/admin/palette-search.test.ts`, `packages/core/test/admin/editor-fields.test.ts`

**Interfaces:**
- Consumes: Task 5 configs.
- Produces: `BUILDER_TEMPLATES: { id: 'nav-menu' | 'mobile-nav' | 'faq' | 'product-tabs' | 'banner-carousel' | 'contact-form'; label: key; tree(locale): ComposedNode }` per spec §3 (constant text in the admin's current locale, no block fields); a "Templates" palette section inserting the subtree at the drop position; the page-editor layout field offers `carousel-<n>` (n = 1–6) only when the spec's binding layout kind is `carousel`.
  - `foldSearch(s: string): string` (lowercase, NFD, strip combining marks, `đ`→`d`); `PaletteSearch` filters palette items by `foldSearch(translatedLabel)` or `foldSearch(englishName)` containing the folded query; empty categories hidden; "No matches" empty state; Enter inserts the first match (Block builder: end of the selected container, else root; Page builder: end of the page content); `/` and Ctrl/Cmd+K focus it unless focus is in an input/textarea/contenteditable; Esc clears. Used in both the Block builder palette (elements + templates) and the Page builder block list.
- [ ] **Step 1: Failing tests:** `foldSearch('Ảnh đẹp')` = `'anh dep'`; typing "anh" in the vi-VN Block builder palette leaves Image; "tab" leaves Tabs and the Product tabs template; "zzz" shows "No matches"; Enter with "faq" inserts the FAQ template; `/` focuses the box from the canvas but not while typing in a text field; the Page builder list filters blocks by label; each template's tree passes `validateComposedSpec` when wrapped in a block spec; inserting "faq" adds a Heading and an Accordion with 3 items; template text follows the admin locale (vi-VN gives Vietnamese copy); "mobile-nav" Dropdowns use `display: { base: 'inline' }`; the layout field shows carousel options only for a carousel binding.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(admin): builder templates and carousel collection layout`

### Task 7: my-store demo, smoke and docs

**Files:**
- Modify: `examples/my-store/src/blocks/store-header/store-header.block.ts` (logo Image linking to `/`, two-level nav with a "Shop" Dropdown: Áo / Quần / Phụ kiện), `examples/my-store/src/blocks/mobile-menu/mobile-menu.block.ts` (same menu, `display: inline`), `examples/my-store/src/blocks/contact-modal/contact-modal.block.ts` (contact form layout: name, email, tel, topic Select, message, newsletter Checkbox, Send button), `examples/my-store/src/blocks/composed.ts`, `examples/my-store/scripts/seed-pages.ts` (home: banner Carousel + FAQ; a product page: Tabs Description / Specs / Shipping and a Tooltip on a badge; a clickable product Card linking `entryUrl` in a collection block), `scripts/smoke-init.mjs`, `README.md`, `packages/core/README.md`, `CHANGELOG.md`
- Create: new my-store blocks as needed (`home-banner`, `faq`, `product-tabs`) in builder format
- Test: my-store composed spec tests (validate + printer + eject equality), seed run, smoke

**Interfaces:**
- Consumes: all tasks.
- Produces: the spec's test target in my-store; smoke steps asserting the home HTML contains the carousel slides, the FAQ `<details>`, the header Dropdown panel links and the logo `<a href="/">`; docs for every new element, the hover style, clickable containers, templates and the client components.
- [ ] **Step 1:** my-store spec tests for the changed/new blocks — FAIL → implement → PASS.
- [ ] **Step 2:** `pnpm build`, `pnpm vitest run`, `pnpm -r typecheck`, `cd examples/my-store && pnpm seed:pages -- --force`, `node scripts/smoke-init.mjs`.
- [ ] **Step 3: Commit** `feat(my-store): two-level nav, banner carousel, FAQ, product tabs, contact form layout`

### Task 8: Verification

**Files:** none (controller task).

- [ ] **Step 1:** Run my-store; headless Chrome at 375 and 1280: hover "Shop" (1280) opens the panel; Tab to it opens it; Esc closes; tap emulation at 375 inside the drawer expands the inline menu; tooltip on hover and focus; FAQ opens/closes; tabs by click and arrow keys; carousel arrows, dots, autoplay pause on hover; logo goes to `/`; clickable product card navigates; no horizontal scroll at 375 with the Dropdown open near the right edge; contact form renders labelled controls and the Combobox filters.
- [ ] **Step 2:** Admin walkthrough screenshots: palette Interactive/Form/Templates, each element's fields, options field, icon picker, hover section with "Show hover", selected Dropdown panel visible in canvas, Tabs panel switching in canvas, inserting each template.
- [ ] **Step 3:** JS-off check: home and product page HTML (curl) contain every slide, every tab panel and every FAQ answer.
- [ ] **Step 4:** Record differences; fix or ledger them.
