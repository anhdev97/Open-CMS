# Settings, i18n, Content Groups, Permission Groups and Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Spec A (Settings with a two-level sidebar, content type groups, a 4-language admin UI, website languages written into project code) and then Spec B (permission groups, fixed roles, review workflow).

**Architecture:** Pure locale/i18n helpers live in `@opencms/schema` (no Node imports in that file) and are re-exported by `@opencms/core` (server) and `@opencms/core/admin` (client, plus React hooks). Code-owned data (`src/locales.ts`, `src/content-groups.ts`, `review`/`group` on content types) is written by core's schema-builder path in dev only. Runtime data (groups, user locale, workflow state) lives in Postgres: `@opencms/oauth2` migrations for auth tables, `@opencms/db` core migrations for `opencms_workflow` and the locale-code data migration.

**Tech Stack:** NestJS 11, Kysely, PostgreSQL 16, zod v3, Next.js 16 App Router admin modules (React 19, shadcn), vitest, pnpm.

**Specs:** A = `docs/superpowers/specs/2026-10-21-settings-i18n-design.md`, B = `docs/superpowers/specs/2026-10-21-groups-permissions-review-design.md`. § references are `A§n` / `B§n`.

## Global Constraints

- Branch `feat/admin-nextjs`. Never push to `main`, never merge.
- Locale codes, exactly: `en-US`, `vi-VN`, `fr-FR`, `id-ID`; native names: `English`, `Tiếng Việt`, `Français`, `Bahasa Indonesia`. `en-US` is the admin default and the fallback everywhere.
- `LocalizedText = Partial<Record<Locale, string>> & { 'en-US': string }`; a plain string means `{ 'en-US': string }`.
- Group key / content group key slug: `^[a-z][a-z0-9-]{0,63}$`. Group name 1–100 chars. Reject note 1–1000 chars.
- No new package subpaths: public i18n API is exported only from `@opencms/core` (server) and `@opencms/core/admin` (client).
- Files OpenCMS writes: `src/locales.ts`, `src/content-groups.ts`, content type `*.schema.ts` — only when `schemaEditable`; otherwise the same `ForbiddenException` the Builder throws today.
- Error body format stays `{ error: { code, message, issues? } }`. New codes: `group_in_use` (409), `locale_has_entries` (409), `locale_not_enabled` (400), `forbidden` (403), `in_review_locked` (409), `invalid_transition` (409), `system_group` (409), `group_key_taken` (409), `last_super_admin` (409, existing).
- `localStorage` keys: `opencms-locale` (admin language), `opencms-nav` (sidebar open groups); every access in try/catch.
- Permissions, exactly: `content.read`, `content.create`, `content.update`, `content.delete`, `content.submit`, `content.publish`, `settings.users`, `settings.groups`, `settings.content-types`, `settings.languages`.
- Seed groups: `super-admin` (name `Super Admin`, `system=true`, effective = all permissions), `contenter` (`content.read, content.create, content.update, content.delete, content.submit`), `reviewer` (`content.read, content.update, content.publish`).
- Server error messages stay English; admin translates known codes.
- Commit trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01BTGSzeTt7egh9MPNhCcXmg`; author email `anhnn97.it@gmail.com`.
- Postgres: `pg_ctlcluster 16 main start` (postgres/postgres). Full check: `pnpm build && pnpm test`.

## Review Focus

- A user's stored `locale` that is not one of the 4 codes (manual DB edit, removed later) must fall back (browser → `en-US`), never crash the admin — pinned in Task 7 (`resolveAdminLocale` test).
- Existing schema files with `displayName: 'Product'` (string) must round-trip through the printer unchanged (still a string), not be rewritten into a map — pinned in Task 2.
- A content group whose last content type was deleted stays in the Groups tab but is hidden in the sidebar; a type whose group key was removed fails schema load with a clear message — pinned in Tasks 2 and 8.
- Disabling the locale currently selected in the content editor must fall back to `defaultLocale`, not keep sending a now-rejected `?locale=` — pinned in Task 10.
- Privilege escalation: a user with `settings.users` or `settings.groups` but not in `super-admin` must not be able to add anyone (including themselves) to `super-admin`, nor grant a group a permission they do not hold themselves (403 `forbidden`) — pinned in Task 13. (Ruling beyond the spec: closes an escalation path the spec leaves open.)

---

## Part A

### Task 1: Locales, i18n runtime and content groups in `@opencms/schema`

**Files:**
- Create: `packages/schema/src/i18n.ts` (no imports from `node:*`), `packages/schema/src/locales.ts`, `packages/schema/src/groups.ts`
- Modify: `packages/schema/src/types.ts` (`ContentTypeDefinition.group?`, `displayName: string | LocalizedText`, same for `ContentTypeInput`; `OpenCmsConfig.defaultLocale?: Locale`, `locales?: Locale[]`), `packages/schema/src/config.ts` (`resolveConfig` validates locales, default `en-US`), `packages/schema/src/define.ts` (`normalizeDefinition` keeps `group`, `displayName`), `packages/schema/src/validate.ts` (definition validation of `group` slug and `displayName`), `packages/schema/src/index.ts`
- Test: `packages/schema/test/i18n.test.ts`, `packages/schema/test/locales.test.ts`, `packages/schema/test/groups.test.ts`

**Interfaces — Produces:**
```ts
// i18n.ts
export const SUPPORTED_LOCALES: readonly { code: Locale; name: string }[];
export type Locale = 'en-US' | 'vi-VN' | 'fr-FR' | 'id-ID';
export type LocalizedText = Partial<Record<Locale, string>> & { 'en-US': string };
export function isLocale(v: unknown): v is Locale;
export function matchLocale(input: string | readonly string[] | null | undefined): Locale;
export function localizedText(v: string | LocalizedText | undefined, locale: Locale, fallback?: string): string; // locale → en-US → fallback ?? ''
export function defineMessages<M extends MessageTree>(m: { 'en-US': M } & Partial<Record<Locale, DeepPartial<M>>>): typeof m;
export function createTranslator(messages: MessageBundle, locale: Locale): (key: string, vars?: Record<string, string | number>) => string;
export function formatDateTime(value: Date | string | number, locale: Locale, opts?: Intl.DateTimeFormatOptions): string;
export function formatNumber(value: number, locale: Locale, opts?: Intl.NumberFormatOptions): string;
// locales.ts
export interface LocaleSettings { defaultLocale: Locale; locales: Locale[] }
export function defineLocales(s: LocaleSettings): LocaleSettings; // validates, throws Error
export function validateLocaleSettings(s: { defaultLocale?: unknown; locales?: unknown }): string[]; // issue messages, [] if valid
// groups.ts
export interface ContentGroupDefinition { key: string; title: LocalizedText; order?: number }
export function defineContentGroups(groups: ContentGroupDefinition[]): ContentGroupDefinition[]; // validates, throws Error
export function validateContentGroups(groups: unknown): string[];
```
`ResolvedConfig.defaultLocale: Locale`, `ResolvedConfig.locales: Locale[]`.

- [ ] **Step 1: Write failing tests**
  - `matchLocale`: `'vi'`→`vi-VN`, `'VI-vn'`→`vi-VN`, `'fr-CA'`→`fr-FR`, `['de','id']`→`id-ID`, `'fr;q=0.5, vi;q=0.9'`→`vi-VN`, `''`/`null`/`['de']`→`en-US`.
  - `createTranslator`: locale hit; missing in locale → en-US value; missing everywhere → key; `{name}` replaced, unknown placeholder kept.
  - `localizedText('Product','vi-VN')`→`'Product'`; `{ 'en-US':'Shop','vi-VN':'Cửa hàng' }` with `fr-FR` → `'Shop'`; undefined + fallback `'shop'` → `'shop'`.
  - `formatNumber(1234.5,'vi-VN')` equals `new Intl.NumberFormat('vi-VN').format(1234.5)`.
  - `validateLocaleSettings`: empty list, duplicate, `'en'` (message contains `en-US`), `'de-DE'`, default not in list → each one issue; valid → `[]`. `resolveConfig({database, locales:['en']}, root)` throws mentioning `en-US`; omitted locales → `defaultLocale 'en-US'`, `locales ['en-US']`.
  - `validateContentGroups`: bad slug, duplicate key, missing/empty `title['en-US']`, title key `de-DE`, `order: 1.5` → issues; valid → `[]`.
  - Definition validation: `group: 'Bad Key'` rejected; `displayName: { 'vi-VN': 'x' }` (no en-US) rejected; string still valid.
- [ ] **Step 2: Run** `pnpm vitest run packages/schema` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; `defineMessages` returns its argument (typing only).
- [ ] **Step 4: Run** `pnpm vitest run packages/schema && pnpm --filter @opencms/schema exec tsc --noEmit` → PASS. Fix any other package that no longer typechecks because `defaultLocale` became `Locale` (`pnpm -r exec tsc --noEmit` or `pnpm build`).
- [ ] **Step 5: Commit** — `feat(schema): supported locales, i18n helpers, content groups, localized display names`

### Task 2: Codegen — load and print content groups and locales

**Files:**
- Modify: `packages/codegen/src/loader.ts` (`loadContentGroups(config)`), `packages/codegen/src/printer.ts` (`printSchemaFile` prints `group`, map `displayName`; new `printContentGroupsFile`, `printLocalesFile`), `packages/codegen/src/pipeline.ts` (`assertValidSchema` also checks every `group` exists), `packages/codegen/src/index.ts`
- Test: `packages/codegen/test/groups-locales.test.ts`

**Interfaces:**
- Consumes: Task 1 types and validators.
- Produces: `contentGroupsFile(config: ResolvedConfig): string` (= `<root>/src/content-groups.ts`), `localesFile(config): string` (= `<root>/src/locales.ts`); `loadContentGroups(config): Promise<ContentGroupDefinition[]>` (missing file → `[]`); `printContentGroupsFile(groups): string`; `printLocalesFile(s: LocaleSettings): string`; `assertValidSchema(defs, groups?: ContentGroupDefinition[])` — unknown group key → Error `Content type "<apiId>" uses unknown group "<key>"`.

- [ ] **Step 1: Failing tests** — printed groups file loads back (jiti) to the same array; printed locales file loads back equal; `printSchemaFile` of a def with `displayName: 'Product'` contains `displayName: 'Product'` (string, not object); with a map it prints the map; with `group: 'shop'` prints it; `assertValidSchema` throws the exact message for an unknown group; `loadContentGroups` on a dir without the file → `[]`. Printed files start with the same "managed by OpenCMS" header style the schema files use.
- [ ] **Step 2: Run** `pnpm vitest run packages/codegen` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run packages/codegen` → PASS.
- [ ] **Step 5: Commit** — `feat(codegen): content groups and locales files, group references`

### Task 3: Core — content groups API and registry

**Files:**
- Create: `packages/core/src/content-groups.ts` (`ContentGroupsService`, controller routes on `api/admin`)
- Modify: `packages/core/src/options.ts` (`contentGroups?: ContentGroupDefinition[]` — `import contentGroups from './content-groups'` in hosts), `packages/core/src/registry.service.ts` (holds groups; `groups()`, `reloadGroups()`), `packages/core/src/opencms.module.ts`, `packages/core/src/schema-builder.ts` (`/api/admin/meta` adds `groups`), `packages/core/src/index.ts`
- Test: `packages/core/test/integration/content-groups.test.ts`

**Interfaces:**
- Consumes: Task 2 `printContentGroupsFile`, `contentGroupsFile`, `validateContentGroups`.
- Produces: `GET /api/admin/content-groups` → `{ groups, editable }`; `PUT /api/admin/content-groups` `{ groups }` per A§3.2 (403 not editable, 422 invalid, 409 `group_in_use` with `issues: [{ path: [key], message: 'apiId1, apiId2' }]`, 200 `{ groups }`); writes serialized through the same `exclusive` queue as `SchemaBuilderService` (share it). Guarded with the existing `@RequireRole('super_admin')` for now (Task 14 switches to permissions).

- [ ] **Step 1: Failing integration tests** (`createCoreTestApp`, root tmp dir with `schemaEditable: true`): GET empty; PUT valid → file `src/content-groups.ts` exists and reloads equal, GET returns it; PUT dropping a group used by a content type → 409 `group_in_use` naming the apiId; PUT invalid slug → 422; `schemaEditable: false` → 403.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm vitest run packages/core` → PASS.
- [ ] **Step 5: Commit** — `feat(core): content groups API`

### Task 4: Core — website locales API, locale enforcement, data migration, two leftovers

**Files:**
- Create: `packages/core/src/locales.ts` (`LocalesService`, routes)
- Modify: `packages/core/src/entries.service.ts` (`locale()`/`localeChain()` reject non-enabled → 400 `locale_not_enabled`), `packages/core/src/opencms.module.ts`, `packages/db/src/index.ts` (core migration `0002_region_locales`), `packages/core/src/web/web-host.ts` (also delete `content-security-policy-report-only` on non-admin paths), `.gitignore` (`*.tsbuildinfo`), remove tracked `examples/my-store/tsconfig.tsbuildinfo`
- Test: `packages/core/test/integration/locales.test.ts`, `packages/core/test/integration/region-locales.test.ts` (uses the core test DB helpers), `packages/core/test/unit/web-host.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2 `printLocalesFile`, `localesFile`; Task 1 `validateLocaleSettings`, `SUPPORTED_LOCALES`.
- Produces: `GET /api/admin/locales` → `{ supported, locales, defaultLocale, editable, entryCounts }`; `PUT /api/admin/locales` `{ locales, defaultLocale, confirmDisable? }` per A§6.2 (updates `options.config.locales/defaultLocale` in memory). `entryCounts` counts rows per `locale` across `l10nTable(def)` of every registered type. Guard as Task 3.

- [ ] **Step 1: Failing tests**
  - GET counts (create entries in `en-US` and `vi-VN` via management API first).
  - PUT enable `fr-FR` + default `vi-VN` → `src/locales.ts` reloads to that; subsequent `GET /api/content/<type>?locale=fr-FR` is 200 (no restart).
  - PUT removing `vi-VN` with entries and no `confirmDisable` → 409 `locale_has_entries` (`issues[0].path[0] === 'vi-VN'`, message = count); same with `confirmDisable: ['vi-VN']` → 200; vi rows still in DB.
  - PUT default outside list → 422; `schemaEditable: false` → 403; no `src/locales.ts` → `editable: false` and PUT 403.
  - `?locale=de-DE` and `?fallback=vi-VN` (disabled) → 400 `locale_not_enabled`.
  - Migration: a `ct_x_l10n` table with rows `en`, `vi`, and one entry having both `en` and `en-US` → after `0002_region_locales`: `en`→`en-US`, `vi`→`vi-VN`, the conflicting `en` row untouched.
  - web-host: non-admin request carrying `content-security-policy-report-only` reaches Next without it.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm vitest run packages/core packages/db` → PASS; `git ls-files | grep tsbuildinfo` → empty.
- [ ] **Step 5: Commit** — `feat(core): website locales API and enforcement, region locale migration`

### Task 5: OAuth2 — user locale

**Files:**
- Create: `packages/oauth2/src/db/migrations/oauth2_0002_user_locale.ts`
- Modify: migrations index, `db/types.ts`, `users/user.service.ts` (`setLocale`), `bff/auth.controller.ts` (`GET /me` adds `locale`; `@Patch('me')`), `guard/current-user.decorator.ts` (`RequestUser.locale: Locale | null`), session user loading
- Test: `packages/oauth2/test/integration/me-locale.test.ts`

**Interfaces — Produces:** `PATCH /api/auth/me` `{ locale: Locale | null }` → 200 same shape as `GET /me`; invalid → 422; no session → 401; audit `user.locale.update`.

- [ ] **Step 1: Failing tests** — set `vi-VN` → `/me.locale === 'vi-VN'`; `null` clears; `'de-DE'` and `'en'` → 422; unauthenticated → 401; migration up/down.
- [ ] **Step 2–4:** run `pnpm vitest run packages/oauth2` FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(oauth2): per-user admin locale`

### Task 6: Admin i18n runtime and public i18n exports

**Files:**
- Create: `packages/core/admin/src/i18n/messages/en-US.ts` (moved from `i18n/en.ts`; export `enUS` and `type Messages` = deep string tree of it), `packages/core/admin/src/i18n/I18nProvider.tsx`, `packages/core/admin/src/i18n/hooks.ts` (`useLocale`, `useTranslator`, `useFormat`), `packages/core/admin/src/i18n/resolve.ts` (`resolveAdminLocale`)
- Modify: `packages/core/admin/src/i18n/en.ts` → replaced by `i18n/index.ts` exporting `t`; all imports of `../i18n/en`; `Providers.tsx` wraps `I18nProvider`; `packages/core/admin/src/index.tsx` re-exports the Task 1 helpers + hooks; `packages/core/src/index.ts` re-exports Task 1 helpers; every `toLocaleString()` in admin → `formatDateTime`/`formatNumber` via `useFormat()`
- Test: `packages/core/test/admin/i18n-runtime.test.ts`

**Interfaces:**
- Consumes: Task 1 `createTranslator`, `matchLocale`, `isLocale`.
- Produces:
  - `t(key, vars?)` (same signature as today) reads the active bundle.
  - `I18nProvider({ initialLocale?: Locale, children })`, `setAdminLocale(l: Locale): Promise<void>` (loads bundle via `loadMessages`, sets `document.documentElement.lang`, writes `localStorage['opencms-locale']`, re-renders).
  - `loadMessages(l: Locale): Promise<Messages>` — `en-US` static; others `import('./messages/<l>')` (files arrive in Task 7; until then `vi-VN`/`fr-FR`/`id-ID` resolve to `en-US` via a guarded map).
  - `resolveAdminLocale({ userLocale, stored, browser }: { userLocale?: string | null; stored?: string | null; browser?: readonly string[] }): Locale` — valid `userLocale` → valid `stored` → `matchLocale(browser)`.
  - `useLocale(): Locale`, `useTranslator(messages)`, `useFormat(): { formatDateTime(v, opts?), formatNumber(v, opts?) }`.
  - `@opencms/core` and `@opencms/core/admin` both export `SUPPORTED_LOCALES, isLocale, matchLocale, localizedText, defineMessages, createTranslator, formatDateTime, formatNumber` and type `Locale`; admin additionally `useLocale, useTranslator, useFormat`.

- [ ] **Step 1: Failing tests** — `resolveAdminLocale`: `userLocale 'vi-VN'` wins; `userLocale 'xx'` (invalid) + stored `'fr-FR'` → `fr-FR`; nothing + browser `['id']` → `id-ID`; nothing → `en-US`. `t('setup.passwordHint', { min: 8, max: 128 })` returns the en-US string filled. A test imports `../../src/index` (core server entry) and asserts the 8 exported helpers exist.
- [ ] **Step 2–4:** `pnpm vitest run packages/core/test/admin` FAIL → implement → PASS; `pnpm --filter @opencms/core build && pnpm --filter @opencms/core typecheck` PASS; `grep -rn "toLocaleString" packages/core/admin/src` → empty.
- [ ] **Step 5: Commit** — `feat(admin): i18n runtime and public locale helpers`

### Task 7: Admin translations (vi-VN, fr-FR, id-ID) and language pickers

**Files:**
- Create: `packages/core/admin/src/i18n/messages/vi-VN.ts`, `fr-FR.ts`, `id-ID.ts` (typed `Messages`), `packages/core/admin/src/components/LanguageMenu.tsx`
- Modify: `i18n/I18nProvider.tsx` (real dynamic imports), `pages/Setup.tsx`, `pages/Login.tsx` (LanguageMenu in a corner), `pages/Account.tsx` (select "Interface language" with "Browser default" = `null`, calls `PATCH /api/auth/me`), `auth/AuthGate.tsx` (applies `resolveAdminLocale` with `/me.locale`), `admin/DESIGN.md` (translations are machine-made; review before release)
- Test: `packages/core/test/admin/messages.test.ts`

**Interfaces:** Consumes Task 5 `PATCH /api/auth/me`, Task 6 `setAdminLocale`, `resolveAdminLocale`.

- [ ] **Step 1: Failing test** — for each of the 3 bundles: same set of leaf keys as `en-US`, and for every key the same set of `{placeholder}` names; no value is empty; no value equals the en-US value for more than 25% of keys (guards against untranslated copies; brand words like `OpenCMS` allowed).
- [ ] **Step 2–4:** run → FAIL → write translations (natural UI language, keep placeholders) and UI → PASS; `pnpm --filter @opencms/core typecheck` PASS.
- [ ] **Step 5: Commit** — `feat(admin): Vietnamese, French and Indonesian UI, language pickers`

### Task 8: Settings navigation, two-level sidebar, routes

**Files:**
- Create: `packages/core/admin/src/navigation.ts`, `packages/core/admin/src/lib/sidebar-tree.ts` (pure)
- Modify: `router/match.ts`, `router/routes.ts` (routes `settings/users` → Users, `settings/content-types` → Builder, `settings/languages` → Languages placeholder until Task 10 creates the page — create `pages/Languages.tsx` here as a stub rendering the page header), redirect routes `users`, `builder`; `components/AppLayout.tsx` (renders the tree, collapsible groups, `opencms-nav` storage, drawer on mobile); `pages/Home.tsx` (links to `/settings/content-types?type=`); i18n keys in all 4 bundles
- Test: `packages/core/test/admin/router.test.ts` (extend), `packages/core/test/admin/sidebar-tree.test.ts`

**Interfaces:**
- Produces:
  - `settingsItems: { to: string; label: string /* i18n key */; icon: LucideIcon; permission?: Permission }[]` in `navigation.ts` (permission used in Task 16; leave undefined now).
  - `buildSidebarTree(types: { apiId: string; displayName: string | LocalizedText; group?: string }[], groups: ContentGroupDefinition[], locale: Locale): { key: string; title: string; items: { apiId: string; title: string }[] }[]` — groups sorted by `order` (missing = +∞) then title (`localeCompare` with locale); items by title; ungrouped types → final entry `key: '__ungrouped'`; groups with no types omitted.
  - `RouteId` adds `settingsUsers`, `settingsContentTypes`, `settingsLanguages`, `redirectUsers`, `redirectBuilder`.
- [ ] **Step 1: Failing tests** — `matchRoute(['settings','users'])` → `settingsUsers`; `['users']` → `redirectUsers`; `['builder']` → `redirectBuilder`; `buildSidebarTree` ordering (order 10 before order 20 before no-order; equal order by localized title), ungrouped last, empty group omitted, vi-VN titles used when present.
- [ ] **Step 2–4:** run → FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(admin): settings section and two-level sidebar with content groups`

### Task 9: Builder — group, localized display name, Groups tab

**Files:**
- Modify: `pages/Builder.tsx` (tabs Type | Groups via `?tab=groups`; group select incl. "No group"; 4 displayName inputs, en-US required), create `components/ContentGroupsTab.tsx`, `lib/content-groups.ts` (API client), i18n keys
- Test: `packages/core/test/admin/content-groups.test.ts` (pure helpers: `toLocalizedText(inputs)` drops empty non-en values; `groupUsage(groups, types)`)

**Interfaces:** Consumes Task 3 API; Task 1 `LocalizedText`. Produces `toLocalizedText(values: Partial<Record<Locale,string>>): string | LocalizedText` — returns plain string when only en-US is filled (keeps schema files minimal).

- [ ] **Step 1: Failing tests** for the two helpers (`{ 'en-US': 'Shop' }` → `'Shop'`; with `vi-VN` → map; whitespace-only values dropped).
- [ ] **Step 2–4:** FAIL → implement (read-only rendering when `editable` false) → PASS; typecheck.
- [ ] **Step 5: Commit** — `feat(admin): content groups and localized names in the builder`

### Task 10: Settings → Languages page

**Files:**
- Modify: `pages/Languages.tsx` (from Task 8 stub), create `lib/locales.ts` (API client + `planLocaleChange`), `pages/Content.tsx` (locale select from enabled list; if current locale not enabled → `defaultLocale`), i18n keys
- Test: `packages/core/test/admin/locales.test.ts`

**Interfaces:** Consumes Task 4 API. Produces `planLocaleChange(current: { locales: Locale[]; defaultLocale: Locale }, next: { locales; defaultLocale }, counts: Record<Locale, number>): { needsConfirm: Locale[] }` and `pickEditorLocale(requested: string | null, enabled: Locale[], defaultLocale: Locale): Locale`.

- [ ] **Step 1: Failing tests** — disabling a locale with count > 0 lists it in `needsConfirm`, count 0 does not; `pickEditorLocale('fr-FR', ['en-US'], 'en-US')` → `en-US`; enabled value kept.
- [ ] **Step 2–4:** FAIL → implement page per A§6.3 (default cannot be disabled; only enabled can be default; confirm dialog with counts; read-only banner) → PASS.
- [ ] **Step 5: Commit** — `feat(admin): website languages settings`

### Task 11: Init, my-store, smoke and docs for Part A

**Files:**
- Modify: `packages/cli/src/init/templates.ts` + `index.ts` (generate `src/locales.ts` en-US, `src/content-groups.ts` empty, config spreads locales, `app.module.ts` passes `contentGroups`, `next.config.ts` adds `serverExternalPackages: ['@opencms/core']`, `app/(site)/messages.ts` with en-US + vi-VN, home page uses `createTranslator(messages, locales.defaultLocale)`), `packages/cli/test/init.test.ts`, `examples/my-store` (same files; locales `['en-US','vi-VN','id-ID']`; group `shop` with product+brand), `scripts/smoke-init.mjs`, `README.md`, `packages/core/README.md` (i18n API + client/server import rule), `CHANGELOG.md` (A breaking changes: locale codes, config validation, auto data migration)
- [ ] **Step 1:** update init tests (expected files, contents) → FAIL → implement → PASS.
- [ ] **Step 2:** smoke additions: generated project has the three new files; after login `GET /api/admin/locales` → `locales: ['en-US']`; `GET /` contains the en-US string from `messages.ts`.
- [ ] **Step 3: Run** `pnpm build && pnpm test && node scripts/smoke-init.mjs && pnpm --filter my-store typecheck && pnpm --filter my-store build` → all PASS. If `next build` fails on `node:path` pulled into the client bundle through `@opencms/schema`, fix by making the browser-reachable import path Node-free (e.g. import `./i18n` directly where the client needs it) — record what was done in the report.
- [ ] **Step 4: Commit** — `feat: init and example for settings, languages and content groups`

## Part B

### Task 12: Permission groups model, permissions and guard (`@opencms/oauth2`)

**Files:**
- Create: `packages/oauth2/src/db/migrations/oauth2_0003_groups.ts`, `packages/oauth2/src/permissions.ts`
- Modify: migrations index, `db/types.ts` (rename tables), `users/user.service.ts` (all `auth_roles`/`auth_user_roles` → groups; `SUPER_ADMIN = 'super-admin'`), `setup/bootstrap.service.ts`, `guard/current-user.decorator.ts` (`RequirePermission`, `RequestUser.groups`, `.permissions`, `.isSuperAdmin`; keep `RequireRole` working until Task 14 removes its uses, then delete it in Task 14), `guard/auth.guard.ts`, `guard/session-auth.service.ts`, `bff/auth.controller.ts` (`/me` adds `groups`, `permissions`), `index.ts`
- Test: `packages/oauth2/test/integration/groups-migration.test.ts`, `packages/oauth2/test/unit/permissions.test.ts`

**Interfaces — Produces:**
```ts
export const PERMISSIONS: readonly Permission[]; export type Permission = /* B§3.1 union */;
export function effectivePermissions(groups: { system: boolean; roles: string[] }[]): Permission[]; // system → all; else sorted union filtered to PERMISSIONS
export const RequirePermission: (...perms: Permission[]) => MethodDecorator & ClassDecorator; // needs all
export interface RequestUser { id; email; name; locale; groups: { key: string; name: string }[]; permissions: Permission[]; isSuperAdmin: boolean }
```
403 body `{ error: { code: 'forbidden', message: 'Missing permission: <perm>' } }`.

- [ ] **Step 1: Failing tests** — `effectivePermissions` (system; union of contenter+reviewer; unknown role dropped; empty → `[]`); migration on a DB with an existing user: user in `super-admin`, `contenter`/`reviewer` exist with exact roles, `down` restores `auth_roles`; a handler with `@RequirePermission('settings.users')` → 403 with the exact message for a contenter, 200 for super admin; `/me` returns permissions.
- [ ] **Step 2–4:** `pnpm vitest run packages/oauth2` FAIL → implement → PASS (existing last-super-admin tests still green with the new key).
- [ ] **Step 5: Commit** — `feat(oauth2)!: permission groups replace roles`

### Task 13: Groups API and user group assignment

**Files:**
- Create: `packages/oauth2/src/groups/groups.controller.ts`, `groups.service.ts`
- Modify: `users/users.controller.ts` + `user.service.ts` (`groupIds` on create (≥1) and PATCH; list returns `groups`), `oauth2.module.ts`, audit calls
- Test: `packages/oauth2/test/integration/groups-api.test.ts`

**Interfaces — Produces:** routes of B§4.3 guarded by `settings.groups` / `settings.users`; `GET /api/admin/permissions`.

- [ ] **Step 1: Failing tests** — CRUD; `system_group` on PATCH/DELETE super-admin; `group_key_taken`; unknown role 422; create user without groups 422; `last_super_admin` via PATCH groupIds removing the last one, via disable, via delete; two concurrent requests removing the last two super admins → exactly one 200 (Promise.all); **escalation (Review Focus):** a non-super-admin with `settings.users` assigning `super-admin` to anyone → 403 `forbidden`; a non-super-admin with `settings.groups` creating/updating a group with a permission they lack → 403 `forbidden`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(oauth2): groups API and user group assignment`

### Task 14: Core permission mapping and `review` on content types

**Files:**
- Modify: `packages/core/src/content.controllers.ts`, `schema-builder.ts`, `system.controller.ts`, `content-groups.ts`, `locales.ts` (replace every `@RequireRole('super_admin')` per B§4.2; then delete `RequireRole` from oauth2), `entries.service.ts` (publish/unpublish rule by `review` + permission, needs current user), `packages/schema/src/types.ts` + validate (`review?: boolean`), `packages/codegen/src/printer.ts` (prints `review`)
- Test: `packages/core/test/integration/permissions.test.ts`

**Interfaces — Produces:** `EntriesService.publish(apiId, documentId, user: RequestUser)` / `unpublish(...)` — throws 403 `forbidden` when the rule of B§4.2 fails.

- [ ] **Step 1: Failing tests** — one representative call per row of B§4.2 as contenter, reviewer and a 0-group user (expected 200/403); contenter publishes a `review: false` type → 200, a `review: true` type → 403; printer round-trips `review: true`.
- [ ] **Step 2–4:** FAIL → implement → PASS; `grep -rn "RequireRole" packages` → empty.
- [ ] **Step 5: Commit** — `feat(core): permission-based access and per-type review flag`

### Task 15: Review workflow

**Files:**
- Create: `packages/core/src/workflow.service.ts`, `packages/core/src/workflow.ts` (pure transition table)
- Modify: `packages/db/src/index.ts` (core migration `0003_workflow`), `content.controllers.ts` (`submit`, `withdraw`, `reject`, `?workflow=in_review`, `GET /api/admin/workflow/pending-count`), `entries.service.ts` (PUT lock, publish clears row, delete clears row, responses carry `workflow`)
- Test: `packages/core/test/unit/workflow.test.ts`, `packages/core/test/integration/workflow.test.ts`

**Interfaces — Produces:**
```ts
export type WorkflowState = 'draft' | 'in_review';
export type WorkflowAction = 'submit' | 'withdraw' | 'reject' | 'publish';
export function nextState(current: WorkflowState, action: WorkflowAction): WorkflowState | 'cleared' | null; // null = invalid_transition
```
Response field per B§5.3.

- [ ] **Step 1: Failing tests** — `nextState` full table; integration scenario of B§7 (create → submit → contenter PUT 409 `in_review_locked` → reviewer PUT 200 → reject without note 422 → reject with note → contenter GET sees note → submit → approve → published, workflow row gone); submit on `review: false` type → 409 `invalid_transition`; withdraw by another contenter (not submitter) → 403; two concurrent approves → one 200 one 409; pending-count reflects state; deleting an entry removes its row; type flipped to `review: false` treats `in_review` as draft.
- [ ] **Step 2–4:** FAIL → implement (transactions + `FOR UPDATE`) → PASS.
- [ ] **Step 5: Commit** — `feat(core): review workflow`

### Task 16: Admin — permissions in the UI, Groups page, users' groups

**Files:**
- Create: `packages/core/admin/src/lib/can.ts` (`can`, `useCan`), `pages/Groups.tsx`, `pages/Forbidden.tsx`, `lib/groups.ts` (API client)
- Modify: `navigation.ts` (permissions on items + "Groups" item `/settings/groups` → `settings.groups`), `router/*` (`settingsGroups`, `forbidden` handling: guarded route whose permission is missing renders Forbidden), `components/AppLayout.tsx` (filter), `pages/Users.tsx` (groups column, multi-select, errors), i18n keys incl. `permissions.<perm>.label|description` and `groups.<key>` for seed names
- Test: `packages/core/test/admin/can.test.ts`

**Interfaces — Produces:** `can(perms: readonly string[], p: Permission): boolean`; `visibleSettingsItems(items, perms)`; `routePermission(id: RouteId): Permission | undefined` (`settingsUsers`→`settings.users`, `settingsGroups`→`settings.groups`, `settingsContentTypes`→`settings.content-types`, `settingsLanguages`→`settings.languages`, `content`→`content.read`).

- [ ] **Step 1: Failing tests** — `visibleSettingsItems` hides items; all hidden → empty (caller hides the Settings group); `routePermission` mapping.
- [ ] **Step 2–4:** FAIL → implement → PASS; typecheck.
- [ ] **Step 5: Commit** — `feat(admin): permission-aware navigation, groups and user groups`

### Task 17: Admin — review actions, status, pending tile, builder toggle

**Files:**
- Create: `packages/core/admin/src/lib/entry-actions.ts` (pure)
- Modify: `pages/Content.tsx` (status column, "Pending review" filter, action buttons, reject dialog, rejection banner), `pages/Home.tsx` (pending tile), `pages/Builder.tsx` ("Require review before publishing" switch), i18n keys
- Test: `packages/core/test/admin/entry-actions.test.ts`

**Interfaces — Produces:** `entryActions(input: { review: boolean; workflow: { state: WorkflowState; submittedBy?: { id: string } | null } | null; published: boolean; permissions: readonly string[]; userId: string }): Array<'save' | 'publish' | 'submit' | 'withdraw' | 'approve' | 'reject' | 'unpublish'>` and `formLocked(...) : boolean` — exactly the table of B§6.4.

- [ ] **Step 1: Failing tests** — one case per row of B§6.4 plus: in-review submitter who also has `content.publish` gets approve/reject (not just withdraw) and form unlocked; 0 permissions → `[]`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(admin): review workflow in the content editor`

### Task 18: my-store, smoke and docs for Part B

**Files:** `examples/my-store` (`product` gets `review: true`), `scripts/smoke-init.mjs`, `README.md`, `packages/core/README.md`, `packages/oauth2/README.md`, `CHANGELOG.md` (B breaking: tables renamed, `RequireRole` → `RequirePermission`, users need groups)
- [ ] **Step 1:** smoke: super admin creates a Contenter user (API), before building, the smoke writes a sample `article` schema file with `review: true` into the tmp project and runs the CLI's generate + migration-create commands (check `packages/cli/src/index.ts` for their names), Contenter submits; Reviewer created by super admin rejects then approves; Contenter publishing directly → 403.
- [ ] **Step 2: Run** `pnpm build && pnpm test && node scripts/smoke-init.mjs && pnpm --filter my-store typecheck && pnpm --filter my-store build` → PASS.
- [ ] **Step 3:** docs per file list; word-grep `grep -rnw "RequireRole\|auth_user_roles" --include=*.ts --include=*.md . | grep -v node_modules | grep -v docs/superpowers | grep -v CHANGELOG` → empty.
- [ ] **Step 4: Commit** — `test: smoke covers groups and review; docs`
