# OpenCMS admin design system

The admin SPA is built from shadcn components (`src/components/ui/`) and a few OpenCMS components (`src/components/`), styled with Tailwind v4 and the tokens in `src/styles/globals.css`. Open `/admin/_ui` (start the host app with `OPENCMS_ADMIN_DEV=1`) to see every component and variant in light and dark.

## Tokens

All colours are CSS variables in `src/styles/globals.css`, mapped to Tailwind utilities (`bg-primary`, `text-muted-foreground`, `border-border`, ...). `--radius` is `0.5rem`; the radius steps follow shadcn (`sm = radius - 4px`, `md = radius - 2px`, `lg = radius`, `xl = radius + 4px`). Shadows are Tailwind defaults: cards use `shadow-xs`, dialogs `shadow-lg`.

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

The default follows `prefers-color-scheme`. `ThemeToggle` stores the choice in `localStorage['opencms-theme']` (read and written inside try/catch) and sets the `.dark` class on `<html>`. A small inline script in `index.html` sets the class before first paint so the page never flashes. Use `src/lib/theme.ts` (`getTheme`, `setTheme`, `applyTheme`) rather than touching the class directly.

## Adding a component

From `packages/core/admin`:

```sh
pnpm dlx shadcn@latest add <name>
```

Commit the generated file unchanged, then show it on the `/_ui` page (`src/pages/UiKit.tsx`). The only intentional edits to generated files are the `success` / `warning` variants of `badge` and `alert`, the `destructive` variant of `button`, the `variant` prop of `AlertDialogAction`, and the focus-ring classes (`focus-visible:` with `ring-offset-background`). Radix primitives come from the `radix-ui` umbrella package.

## Rules

- Pages are composed only from `components/ui` and `components/*`.
- No hex or `rgb()` colours in TSX or CSS outside `globals.css`. Use utilities mapped from the tokens (`bg-primary`, `text-muted-foreground`, ...).
- No arbitrary Tailwind values (`[13px]`) unless a comment next to them says why.
- Icons come only from `lucide-react`.
- Every interactive element works with the keyboard and shows a visible focus ring (`focus-visible:`, never plain `focus:`, with `ring-offset-background`).
- UI text is English and lives only in `src/i18n/en.ts`, read through `t()`.
- Modules imported by root vitest tests (`lib/api.ts` once the API client is added, `lib/api-error.ts`, `lib/format-issue.ts`, `i18n/en.ts`, ...) use relative imports only, never the `@/` alias.

## Note for plugins

The components are built on Tailwind, so a plugin UI that wants to look the same must also use Tailwind with these same tokens. The components are not exported for plugins yet.
