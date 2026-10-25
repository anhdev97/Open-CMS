# OpenCloudCMS rebrand (npm scope + full identifier rename)

**Date:** 2026-10-25  
**Status:** Approved for planning  
**Context:** npm org `@opencms` cannot be created; publish under `@opencloudcms`. Product has not been published yet, so a breaking rename with **no** backwards-compatible aliases is acceptable.

## Goal

Rename every user-facing and code identifier from **OpenCMS / opencms / OPENCMS / `@opencms`** to **OpenCloudCMS / opencloudcms / OPENCLOUDCMS / `@opencloudcms`**, so the monorepo can publish to npm under the `@opencloudcms` org with a consistent CLI and config surface.

## Non-goals

- Renaming the git/filesystem folder `Open-CMS` (out of repo scope).
- Rewriting already-applied SQL/history inside example migration files beyond string imports that break the build (table names stay as shipped).
- Keeping temporary aliases (`opencms` bin, `OPENCMS_*` env, `opencms.config.ts`).
- Changing HTTP routes (`/admin`, `/api`, `/oauth2`) — those are paths, not the product npm brand.
- Publishing to npm in this change set (prep only: names + `publishConfig`).

## Decisions

| Area | From | To |
|------|------|-----|
| npm scope | `@opencms/*` | `@opencloudcms/*` |
| CLI package | `opencms-cli` | `@opencloudcms/cli` |
| CLI bin | `opencms` | `opencloudcms` (`bin/opencloudcms.js`) |
| Config file | `opencms.config.ts` / `.js` | `opencloudcms.config.ts` / `.js` |
| Env prefix | `OPENCMS_*` | `OPENCLOUDCMS_*` |
| DI symbols | `OPENCMS_DB`, `OPENCMS_OPTIONS`, … | `OPENCLOUDCMS_DB`, `OPENCLOUDCMS_OPTIONS`, … |
| Nest module / types | `OpenCmsModule`, `ResolvedOpenCmsOptions`, … | `OpenCloudCmsModule`, `ResolvedOpenCloudCmsOptions`, … |
| Logger / product strings | `OpenCms`, “OpenCMS” | `OpenCloudCms`, “OpenCloudCMS” |
| Example scripts | `"opencms": "opencms"` | `"opencloudcms": "opencloudcms"` |

**Compatibility:** Approach A — hard cut, no dual-read of old names.

**Archived docs:** Historical files under `docs/superpowers/plans/` and older specs may keep the old name unless a reference must compile or misleads the current README; **must** update root `README.md`, package READMEs, `CHANGELOG.md`, and this rebrand’s plan. Prefer updating active docs; leave sealed historical design narrative alone when it does not block the rename.

## Package map

| Package dir | New `name` |
|-------------|------------|
| `packages/cli` | `@opencloudcms/cli` |
| `packages/core` | `@opencloudcms/core` |
| `packages/db` | `@opencloudcms/db` |
| `packages/oauth2` | `@opencloudcms/oauth2` |
| `packages/schema` | `@opencloudcms/schema` |
| `packages/codegen` | `@opencloudcms/codegen` |
| `packages/assets` | `@opencloudcms/assets` |

Each publishable package gets:

```json
"publishConfig": { "access": "public" }
```

Internal deps stay `workspace:*` (pnpm rewrites on publish).

## Config & env

- `packages/schema` `CONFIG_FILE_NAMES` → `['opencloudcms.config.ts', 'opencloudcms.config.js']`.
- CLI `init` templates write `opencloudcms.config.ts` and `.env` with `OPENCLOUDCMS_*`.
- Examples rename config files and env examples; local `.env` (gitignored) must be updated by the developer when testing.
- OAuth2 / core code that reads `process.env.OPENCMS_*` switches to `OPENCLOUDCMS_*` only.

## CLI surface

- Binary entry: `bin/opencloudcms.js` (remove or replace `bin/opencms.js`).
- `package.json` `bin`: `{ "opencloudcms": "bin/opencloudcms.js" }`.
- Help text, smoke scripts (`scripts/smoke-init.mjs`), and init tests assert the new command and file names.
- User-facing quick start: `npx @opencloudcms/cli init …` then `pnpm opencloudcms …` / `pnpm dev`.

## Code rename rules

1. Replace import specifiers `@opencms/` → `@opencloudcms/` everywhere (packages, examples, tests, generated headers if they embed the scope).
2. Rename TypeScript symbols with `OpenCms` / `OPENCMS` prefixes as above; rename source files when the filename itself is branded (e.g. `opencms.module.ts` → `opencloudcms.module.ts`) and fix barrel exports.
3. Regenerate or hand-edit example `src/generated/*` only as needed so imports compile after scope change.
4. `pnpm-lock.yaml` refreshed via `pnpm install` after `package.json` renames.

## Verification

- `pnpm -r --filter './packages/*' build` succeeds.
- `pnpm test` (or package vitest suites) pass with new names.
- `pnpm --filter @opencloudcms/cli` / example `init` or smoke-init creates `opencloudcms.config.ts` and documents `OPENCLOUDCMS_SECRET`.
- `rg -i 'opencms'` on `packages/`, `examples/`, `README.md`, `CHANGELOG.md`, `scripts/` returns **no** remaining brand hits (Approach A: zero allowlist in those trees).
- Exception: sealed history under `docs/superpowers/plans/` and older specs may still say OpenCMS; this rebrand spec + root README/CHANGELOG must use OpenCloudCMS.
- Exception: SQL identifiers already embedded in applied example migrations (e.g. table/column names) are **not** rewritten; only TypeScript import/package strings in those files change if required to compile.

## Publish readiness (after rename)

Not part of the rename PR’s required merge gate, but documented:

1. Create npm org `@opencloudcms`.
2. `npm login` with org access.
3. `pnpm -r --filter './packages/*' build`
4. `pnpm -r --filter './packages/*' publish --access public`

## Risks

- Missed string in templates → broken `init` for new users (mitigate with init tests + smoke script).
- Example `.env` left with old keys locally → auth fails until renamed (document in CHANGELOG).
- Broad mechanical replace may touch migration import lines in examples; keep SQL identifiers intact.
