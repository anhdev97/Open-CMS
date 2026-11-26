# Block builder: common website components (dropdown, tooltip, accordion, tabs, carousel, icon, form controls, hover styles) — design

Date: 2026-11-26 · Status: approved 2026-11-26 · Branch: `feat/builder-components` (from `feat/base-page-overlays`
37be4d7; rebased onto `main` once PR #14 is merged)

## Intent

The block builder can lay out pages (Box, Stack, Columns, Grid, Card, text, image, button…) and, since the last sprint,
frames and overlays. It cannot build the interactive pieces almost every website has: a nav menu whose second level
appears on hover, a tooltip, an FAQ that folds, product tabs, a banner carousel, icons, and form controls. Today each
of these needs hand-written code.

This sprint adds them as **drag-and-drop UI only**: new builder elements, a hover style group, and starter templates
built from the elements. No data model for menus, no form submission, no new server endpoints.

Test target: in `examples/my-store`, the header nav becomes a two-level menu (hover "Shop ▾" → Áo / Quần / Phụ kiện)
built in the block builder; the same menu inside the `menu-mobile` drawer expands on tap; the home page gets a banner
carousel and an FAQ; a product page gets tabs (Description / Specs / Shipping) and a tooltip on a badge; the
`lien-he` modal gets a contact form layout (name, email, phone, topic select, message, newsletter checkbox) that
renders correctly but does not submit.

## Goals

- **New elements (13):**
  - Interactive: `Dropdown`, `Tooltip`, `Accordion` (+ `AccordionItem`), `Tabs` (+ `TabPanel`), `Carousel`, `Icon`.
  - Form controls, UI only: `Input`, `Textarea`, `Select`, `Combobox`, `Radio`, `Checkbox`, `Switch`.
- **Hover styles:** a "On hover" style group (background, text color, border color) on Box, Card and Button.
- **Icons in buttons:** Button gets an optional icon (start or end) and an icon-only mode.
- **Clickable images and cards:** Image, Box and Card can link or run a button action (e.g. the logo links to the
  home page; a whole product card is one link).
- **Starter templates in the palette:** two-level nav menu, FAQ, product tabs, banner carousel, contact form layout.
- **Usable everywhere:** keyboard and touch work for every element; screen readers get correct roles and states.
- **Editable in the builder:** hidden parts (dropdown panel, tooltip, non-selected tab, folded item, other slides) can
  be seen and edited in the block builder canvas.
- **Page editors can change the text where the designer wants:** labels and titles are bindable to block fields,
  like Button labels today (templates insert constant text; see §3).
- **Compatible:** existing specs, pages and buttons render byte-identically.

## Non-goals (agreed)

- Form submission, form actions, server validation, storing submissions. A later "Form" phase does this; the
  controls only render native, correctly labelled HTML with `name` attributes.
- A menu data model or admin "Menu" page. Menus are built in blocks.
- Breadcrumb, Rating, Alert, Avatar, Countdown, Embed / Video.
- Third menu level (Dropdown inside a Dropdown panel is refused).
- A code-side "custom element" registry.

## Anti-goals

- A hover-only menu that cannot be opened by keyboard or on a phone.
- Content hidden from the server render: everything in tabs, accordions and carousels is in the HTML, so it can be
  indexed and works before JS loads.
- Loading the whole icon library on the website.
- Interpolated Tailwind class names (classes stay literal in lookup tables).
- Changing how existing blocks render or what their specs contain.

## Approaches

1. **Every component is a builder element** (about 19, including Alert, Avatar…). Uniform, but the element list grows
   with things that are only arrangements of existing elements.
2. **Hybrid (chosen).** New elements only for what needs its own behaviour or HTML (the 13 above), a hover style
   group, and the remaining "components" as starter templates assembled from elements (like the overlay starter
   today). Fewer elements to maintain; people still get ready-made components.
3. **A code-side custom element registry**, then the components built on it. Most flexible long-term but doubles the
   sprint with an extension API.

The user picked 2 and then dropped the later group (Breadcrumb, Rating, Alert, Avatar, Countdown, Embed).

## Design

### 1. Spec model (`@opencloudcms/schema`)

`ComposedElement` gains `Dropdown`, `Tooltip`, `Accordion`, `AccordionItem`, `Tabs`, `TabPanel`, `Carousel`, `Icon`,
`Input`, `Textarea`, `Select`, `Combobox`, `Radio`, `Checkbox`, `Switch`. Nodes keep the existing shape
(`el`, `props`, `bind`, `showIf`, `children`, `style`); no named slots are introduced: structure comes from child
element types.

| Element | Children | Props (validated) | Bindable |
|---|---|---|---|
| `Dropdown` | panel content (any element except `Dropdown`, `Overlay`, regions) | `openOn`: `hover` \| `click` (default `hover`; touch always uses click); `placement`: `bottom-start` \| `bottom-end` \| `bottom` (default `bottom-start`); `display`: responsive `popover` \| `inline` (default `popover`; `inline` expands in the flow, for drawers); `triggerVariant`: Button variants (default `ghost`); `chevron`: boolean (default true) | `label`, `href` (optional: the trigger label navigates on click when set; the chevron part still toggles, so `href` requires `chevron: true`) |
| `Tooltip` | exactly 1 child (the target) | `side`: `top` \| `bottom` \| `left` \| `right` (default `top`) | `text` (plain text, ≤ 200 chars) |
| `Accordion` | 1–30 `AccordionItem` only | `single`: boolean (only one open at a time; default false); `defaultOpen`: `none` \| `first` (default `none`) | — |
| `AccordionItem` | content (any allowed element) | — | `title` |
| `Tabs` | 1–12 `TabPanel` only | `variant`: `underline` \| `pills` (default `underline`); `align`: `start` \| `center` \| `stretch` | — |
| `TabPanel` | content | — | `label` |
| `Carousel` | 1–20 slides (each child is one slide) | `perView`: responsive 1–6 (default `{ base: 1 }`); `gap`: spacing token; `arrows`: boolean (default true); `dots`: boolean (default true); `loop`: boolean (default false); `autoplay`: `off` \| 3–10 (seconds; default `off`) | — |
| `Icon` | none | `name`: one of `ICON_NAMES` (curated list, §5); `size`: `sm` \| `md` \| `lg` \| `xl` | `label` (accessible name; empty = decorative, `aria-hidden`) |
| `Input` | none | `name` (field-name pattern, required); `type`: `text` \| `email` \| `tel` \| `number` \| `url` \| `password` \| `date` (default `text`); `required`, `disabled`: boolean; `autocomplete`: allow-listed token or omitted | `label`, `placeholder`, `help` |
| `Textarea` | none | `name`; `rows`: 2–12 (default 4); `required`, `disabled` | `label`, `placeholder`, `help` |
| `Select` | none | `name`; `options` (§1.1); `required`, `disabled`; `defaultValue` (one of the option values) | `label`, `placeholder`, `help` |
| `Combobox` | none | `name`; `options` (§1.1); `required`, `disabled`; `defaultValue` | `label`, `placeholder`, `help` |
| `Radio` | none | `name`; `options` (§1.1); `orientation`: `vertical` \| `horizontal`; `required`, `disabled`; `defaultValue` | `label` (group legend), `help` |
| `Checkbox` | none | `name`; `value` (default `on`); `defaultChecked`, `required`, `disabled` | `label`, `help` |
| `Switch` | none | `name`; `defaultChecked`, `disabled` | `label`, `help` |

Button gains `icon` (an `ICON_NAMES` entry), `iconPosition`: `start` \| `end` (default `start`) and `iconOnly`: boolean
(the label becomes the `aria-label`; the label is still required).

Image gains the same click behaviour as Button: a bindable `href` (`ELEMENT_BINDABLE.Image` becomes
`src`, `alt`, `href`) and the `action` prop (`ButtonAction`: overlay open/close/toggle, scroll), validated by the
existing `validateButtonAction`. With `href` the image renders inside `<a>`; with `action` inside `<button
type="button">` (the existing `ActionButton` client runtime); both get the theme focus ring and no default button
styling. `href` and `action` together: `action` wins, as on Button today. A clickable image needs a non-empty `alt`
(it is the link's name): an issue when `alt` is bound to a constant empty string; at render a missing alt falls back
to the block name. An Image without `href`/`action` renders exactly as today.

Box and Card gain the same `href` (bindable; `ELEMENT_BINDABLE.Box` and `.Card` become `['href']`) and `action`.
A clickable Box/Card renders its element as `<a>` (href) or `<button type="button">` (action) with the same classes,
`block`/`flex` display kept, focus ring, and no default link or button styling (text color inherits). Because HTML
does not allow interactive content inside a link or button, a clickable Box/Card may not contain (at any depth)
Button, clickable Image/Box/Card, Dropdown, Tooltip, Tabs, Accordion, Carousel, form controls or Slot (an issue).
Its accessible name is its text content; an optional `ariaLabel` prop (plain text) overrides it. A Box/Card without
`href`/`action` renders exactly as today. In a collection item template `href` can bind `entryUrl`, so a whole
product card links to its entry.

Rules added to `validateComposedSpec`:

- `AccordionItem` only directly inside `Accordion`; `TabPanel` only directly inside `Tabs`; `Accordion`/`Tabs` accept
  only those children; counts as in the table.
- `Tooltip` has exactly one child; that child is not a `Tooltip`, `Dropdown` or form control. (Form controls carry
  their own `help` text, which is the accessible pattern.)
- A `Dropdown` cannot contain a `Dropdown` at any depth (two levels: trigger + panel).
- Interactive containers (`Dropdown`, `Tooltip`, `Accordion`, `Tabs`, `Carousel`) cannot be the root of an overlay
  block's frame (they may be inside it) and are allowed in collection item templates except `Carousel`.
- Form control `name`: `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Names may repeat (radio-like groups across blocks are the
  author's business); no uniqueness check.
- `ELEMENT_BINDABLE` lists the bindable props above; binding works exactly as for Button/Heading today.
- Unknown props are issues on the 13 new elements, `AccordionItem` and `TabPanel` only (new strictness; existing
  elements keep today's checks). On Button only the new `icon`, `iconPosition`, `iconOnly` are validated.
- A Dropdown with a bound `href` must keep `chevron: true` (otherwise touch and keyboard users could not open it).

#### 1.1 Options

`options: { value: string; label: string | LocalizedText }[]`, 1–100 entries, `value` non-empty ≤ 100 chars and
unique within the list, `label` non-empty. Options are static in the spec (no data binding this sprint).

#### 1.2 Hover style

`NodeStyle.hover?: { background?: ColorValue; color?: ColorValue; borderColor?: ColorValue }`, validated like the
existing color values, allowed on Box, Card and Button only (an issue elsewhere). A node without `hover` produces no
new classes or variables.

#### 1.3 Collection binding

`ComposedBinding.layout.kind` gains `carousel` (for "product strip" blocks). `columns` is then the per-view count
on desktop (1–6 for carousel; grid keeps 2–6); mobile shows 1.25 cards (a peeking next card). Reuses the Carousel
runtime. The page-editor layout field (`editorLayout`) stores `carousel-<n>` alongside today's `list` and
`grid-<n>`, and offers carousel options only when the spec's layout kind is `carousel`; existing stored values are
unchanged.

### 2. Rendering (`@opencloudcms/core/blocks`)

All new elements render on the server with full content in the HTML. Behaviour lives in two places:

- **CSS only (no JS):** Tooltip, Accordion (`<details>`/`<summary>`), Radio, Checkbox, Switch, Input, Textarea,
  Select, hover styles.
- **Client components in `@opencloudcms/core/blocks/client`** (ESM + CJS, no browser globals at import time):
  Dropdown (click/touch toggle, Esc, outside click, arrow keys in the panel), Tabs (switching, roving focus), Carousel
  (arrows, dots, autoplay), Combobox (filter + listbox), Accordion `single` mode (closes siblings; without JS several
  may be open). Before hydration each degrades as listed below.

| Element | HTML | No-JS behaviour |
|---|---|---|
| Dropdown | one markup for every `display` value: wrapper `relative group`; trigger `<button aria-expanded aria-controls>` (plus `<a>` when `href` is bound); one panel `role="group"`. Per breakpoint, `popover` makes the panel absolutely positioned and adds the hover/focus-within classes; `inline` keeps it in the flow and opens only through the toggle (`data-open`) | `popover`: opens on `:hover` and `:focus-within` via literal `group-hover:` / `group-focus-within:` classes; `inline`: needs JS (it lives in drawers, which need JS already) |
| Tooltip | wrapper `relative inline-flex group`; bubble `role="tooltip" id` with `aria-describedby` on the target's first focusable element (or the wrapper with `tabindex=0` when the target has none) | shows on hover and focus; client adds Esc to dismiss |
| Accordion | `<details>` per item, `<summary>` = title (styled with chevron); `name` attribute for `single` where the browser supports it | native |
| Tabs | `role="tablist"` of `<button role="tab">`, panels `role="tabpanel"`; all panels in HTML, non-first get `hidden` | server renders tab 1 visible; others reachable after JS. Panel content is in the HTML. |
| Carousel | `<section aria-roledescription="carousel">` with a scroll-snap track (`overflow-x-auto snap-x`), slides `role="group" aria-label="n of N"` | swipe/scroll works; arrows and dots appear after JS; autoplay pauses on hover, focus, hidden tab and `prefers-reduced-motion` |
| Icon | inline `<svg>` from the curated map | — |
| Input / Textarea / Select | `<label for>` + control + help (`aria-describedby`); ids from `useId` | native |
| Combobox | client: input `role="combobox"` + `role="listbox"`; server: a native `<select>` with the same name and options | native select |
| Radio | `<fieldset>` + `<legend>` + inputs | native |
| Checkbox / Switch | native checkbox; Switch adds `role="switch"` and a styled track | native |

Colors, radius and focus rings come from the theme (`--ocms-color-*` and the existing tokens). Tailwind classes are
literal entries in lookup tables. Overlay rules from the last sprint still apply (a Dropdown inside a drawer closes
when the overlay closes; navigation from a dropdown link closes it and any overlay via the route watcher).

### 3. Block builder (admin)

- **Palette:** a new "Interactive" category (Dropdown, Tooltip, Accordion, Tabs, Carousel, Icon) and a "Form"
  category (the 7 controls); `AccordionItem` and `TabPanel` are not in the palette: they are added with an "Add item"
  / "Add tab" button on the parent and can be reordered by drag inside it.
- **Canvas visibility:** in the block builder canvas only:
  - a Dropdown panel and a Tooltip bubble are shown open while the element or anything inside it is selected;
  - Tabs show the TabPanel that is selected (or contains the selection), and clicking a tab in the canvas selects it;
  - Accordion items render open;
  - a Carousel shows slides side by side according to `perView`, scrollable, no autoplay.
  The Page builder canvas and the website use the real behaviour.
- **Prop fields:** new field kinds `options` (an editable list of label/value rows with reorder), `icon` (searchable
  icon picker over `ICON_NAMES`) and `name` (field-name pattern). Other props reuse select / boolean / responsive
  select / spacing fields.
- **Style panel:** an "On hover" section (background, text, border) for Box, Card, Button, previewable with a
  "Show hover" toggle in the section.
- **Starter templates** — new infrastructure (today the builder only offers the bare Overlay element as a starting
  point): a palette section "Templates" whose entries insert a prebuilt subtree, edited freely afterwards. Text is
  inserted as constant values in the admin's current locale (`from: 'const'`), like element defaults today; the
  designer binds any of it to block fields afterwards. Inserting a template adds no block fields.
  1. *Nav menu (2 levels):* horizontal Stack of Buttons (link variant) and one Dropdown "Shop" with a vertical Stack
     of three link Buttons; hover colors set.
  2. *Mobile nav:* the same structure with `display: inline` for use inside a drawer.
  3. *FAQ:* Heading + Accordion with three items.
  4. *Product tabs:* Tabs with Description / Specs / Shipping.
  5. *Banner carousel:* Carousel with three slides (Image + Heading + Button), `autoplay: 5`.
  6. *Contact form:* Stack with Input name, Input email, Input tel, Select topic, Textarea message, Checkbox
     newsletter, Button "Send" (no action).
  Template text is placeholder copy, localized in the 4 admin locales.
- **i18n:** all new element, prop, value and template labels in en-US, vi-VN (accented), fr-FR and id-ID.

### 4. Page builder and code

- Composed blocks with the new elements work in the Page builder like any composed block (bound labels editable in
  block fields).
- Ejected / printed block code (`defineComposedBlock`, printer, eject) supports every new element and the `hover`
  style; eject equality tests extend to them.
- No new client API beyond the element runtimes. (Form value access is the Form phase's job.)

### 5. Icons

- `ICON_NAMES` (schema, plain string list, no imports): a curated set of about 60 lucide icons covering nav and
  commerce: menu, x, chevron-down/up/left/right, arrow-right/left, search, shopping-cart, shopping-bag, heart, user,
  phone, mail, map-pin, clock, calendar, star, check, info, alert-circle, help-circle, plus, minus, filter, globe,
  home, truck, credit-card, gift, tag, share-2, external-link, download, play, pause, facebook, instagram, youtube,
  twitter, linkedin, github, message-circle, send, eye, lock, settings, log-in, log-out, sun, moon… (the exact list is
  fixed in the plan, ≤ 80).
- The blocks UI maps names to explicitly imported lucide components, so the website bundle only includes this set.
  `lucide-react` moves to (or is added as) a dependency of the blocks build as needed.

## Decisions settled during the builder check (designer's calls)

1. A Dropdown with a bound `href` requires `chevron: true`: the label navigates, the chevron toggles.
2. Responsive `display` uses one markup (no duplicated panel); `inline` opens through the client toggle only.
3. Strict unknown-prop checking applies only to the new elements and the new Button props, so existing specs keep
   today's validation results.
4. Templates insert constant text in the current admin locale and create no block fields.
5. Collection carousel layout: `kind: 'carousel'`, `columns` 1–6, page-editor value `carousel-<n>`, fixed 1.25 cards
   on mobile.
6. Templates are a new palette mechanism (nothing to reuse).
7. Clickable images and cards (added after review, user's example: logo → home page, then "add it" for cards):
   Image, Box and Card get Button's `href` and `action`; clickable containers refuse interactive descendants.

## Constraints

- Literal Tailwind classes in lookup tables only; theme colors via `--ocms-color-*`.
- `@opencloudcms/schema` imports no `node:*` and no React or lucide; blocks `ui` stays isomorphic; client code only in
  `@opencloudcms/core/blocks/client`; Next-only code in `blocks/next`.
- Specs, pages and buttons without the new elements, props or `hover` render byte-identically; existing validation
  results unchanged for existing specs.
- Every interactive element is operable by keyboard (Tab, Enter/Space, Esc, arrows where the ARIA pattern expects
  them) and by touch; visible focus rings.
- All panel/tab/slide content is present in the server HTML.
- All new admin strings in en-US, vi-VN (accented), fr-FR, id-ID.
- Theme/schema/block writes stay dev-only through `SchemaWriteQueue` (unchanged).
- my-store uses placeholder copy only.

## Review focus (for the plan)

1. Touch devices: a hover Dropdown must open on tap and close on outside tap or a second tap, without a "sticky
   hover" leaving it open.
2. A Dropdown or Tooltip near the right edge of a narrow screen must not cause horizontal scroll (`bottom-end`
   placement, `max-w` on panels, tooltip wrapping).
3. Tabs and Accordion inside a collection item template: ids stay unique per item (`useId` per rendered instance).
4. Removing the last `TabPanel` / `AccordionItem` in the builder: the parent shows an empty state and the spec
   validation message, rather than crashing the canvas.
5. Carousel with `loop` and 1 slide, or fewer slides than `perView`: no arrows, no dots, no autoplay, no errors.

## Left to the builder

- Exact lookup-table classes, spacing and animation (fade/slide 150 ms, respecting `prefers-reduced-motion`).
- The final icon list (within the stated scope) and icon picker UI.
- How "Add item" / "Add tab" is presented on the parent's fields.
- Combobox matching (case- and accent-insensitive "contains" is the expected default).
