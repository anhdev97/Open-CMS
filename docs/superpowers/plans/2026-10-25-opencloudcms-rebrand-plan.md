# OpenCloudCMS rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-cut rename every OpenCMS / `@opencms` / `opencms` / `OPENCMS_*` identifier to OpenCloudCMS / `@opencloudcms` / `opencloudcms` / `OPENCLOUDCMS_*` so packages can publish under the `@opencloudcms` npm org.

**Architecture:** Mechanical, ordered string/file renames across `packages/*`, `examples/*`, root docs, and `scripts/`. No runtime aliases. SQL table names inside already-written example migrations stay unchanged; only TS import/package strings in those files change if needed to compile. Refresh `pnpm-lock.yaml` after `package.json` renames.

**Tech Stack:** pnpm workspaces, NestJS, TypeScript, vitest, Commander CLI.

**Spec:** `docs/superpowers/specs/2026-10-25-opencloudcms-rebrand-design.md`

## Global Constraints

- Approach A: **no** dual-read of old names (`opencms` bin, `OPENCMS_*`, `opencms.config.ts`, `@opencms/*`).
- Replace order (always): `@opencms/` → `OPENCMS_` → `OpenCms` → `OpenCMS` → remaining `opencms` / `opencms-cli` / filenames.
- Do **not** rewrite SQL identifiers in applied example migrations (e.g. `opencms_assets` table name).
- Do **not** change HTTP paths `/admin`, `/api`, `/oauth2`.
- Do **not** bulk-edit sealed history under `docs/superpowers/plans/` and older specs except this plan + the rebrand spec; **do** update root `README.md`, `CHANGELOG.md`, package READMEs, `scripts/`.
- Every publishable package gets `"publishConfig": { "access": "public" }`.
- After rename: `rg -i 'opencms' packages examples README.md CHANGELOG.md scripts` must be empty (except intentional SQL identifiers in migration bodies if any remain — document any leftover and justify).

## File structure (rename map)

```
packages/cli/
  package.json                    name → @opencloudcms/cli; bin → opencloudcms
  bin/opencms.js                  → bin/opencloudcms.js
  src/init/templates.ts           templates, env keys, OpenCloudCmsModule imports
  src/index.ts                    OPENCLOUDCMS_ROOT / OPENCLOUDCMS_DEBUG; config load errors
  test/init.test.ts               assert new filenames / package names

packages/schema/
  package.json                    → @opencloudcms/schema + publishConfig
  src/config.ts                   CONFIG_FILE_NAMES
  src/types.ts                    OpenCmsConfig → OpenCloudCmsConfig
  src/define.ts                   defineConfig typing

packages/oauth2/
  package.json                    → @opencloudcms/oauth2
  src/config/schema.ts            all OPENCLOUDCMS_* env reads + error strings
  README.md                       full rebrand

packages/core/
  package.json                    → @opencloudcms/core
  src/opencms.module.ts           → src/opencloudcms.module.ts (OpenCloudCmsModule)
  src/options.ts                  OPENCLOUDCMS_* symbols + OpenCloudCmsModuleOptions
  admin i18n messages             OpenCloudCmsModule / OPENCLOUDCMS_PUBLIC_URL strings
  README.md

packages/{db,codegen,assets}/
  package.json                    scope + workspace deps + publishConfig

examples/{my-store,phone-store}/
  opencms.config.ts               → opencloudcms.config.ts
  package.json                    deps + "opencloudcms" script
  .env.example                    OPENCLOUDCMS_*
  src/**                          imports / OpenCloudCmsModule / env

scripts/smoke-init.mjs            CLI binary + env + config filenames
README.md, CHANGELOG.md
```

---

### Task 1: Package names, publishConfig, lockfile

**Files:**
- Modify: `packages/cli/package.json`, `packages/core/package.json`, `packages/db/package.json`, `packages/oauth2/package.json`, `packages/schema/package.json`, `packages/codegen/package.json`, `packages/assets/package.json`
- Modify: `examples/my-store/package.json`, `examples/phone-store/package.json`
- Modify: `pnpm-lock.yaml` (via install)

**Interfaces:**
- Produces: workspace package names `@opencloudcms/{cli,core,db,oauth2,schema,codegen,assets}`

- [ ] **Step 1: Update each `packages/*/package.json` `name` and deps**

Set names and replace every `"@opencms/` dependency key with `"@opencloudcms/`. For CLI:

```json
{
  "name": "@opencloudcms/cli",
  "bin": { "opencloudcms": "bin/opencloudcms.js" },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@opencloudcms/schema": "workspace:*",
    "@opencloudcms/codegen": "workspace:*",
    "@opencloudcms/db": "workspace:*",
    "@opencloudcms/oauth2": "workspace:*",
    "commander": "^12.1.0",
    "jiti": "^2.4.0"
  }
}
```

Add the same `publishConfig` to core, db, oauth2, schema, codegen, assets. Keep other fields unchanged except `@opencms/` → `@opencloudcms/` in dependency keys.

- [ ] **Step 2: Update example `package.json` deps and scripts**

In both examples:

```json
{
  "scripts": {
    "opencloudcms": "opencloudcms",
    "dev": "opencloudcms migrate:up && tsx --tsconfig tsconfig.server.json src/main.ts"
  },
  "dependencies": {
    "@opencloudcms/core": "workspace:*",
    "@opencloudcms/schema": "workspace:*"
  },
  "devDependencies": {
    "@opencloudcms/cli": "workspace:*"
  }
}
```

Remove old `"opencms"` script and `@opencms/*` / `opencms-cli` entries.

- [ ] **Step 3: Refresh lockfile**

Run: `pnpm install`

Expected: exit 0; `pnpm-lock.yaml` references `@opencloudcms/` only (no `@opencms/` importers).

- [ ] **Step 4: Commit**

```bash
git add packages/*/package.json examples/*/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore: rename npm packages to @opencloudcms scope

EOF
)"
```

---

### Task 2: Schema config type + config filenames

**Files:**
- Modify: `packages/schema/src/config.ts`, `packages/schema/src/types.ts`, `packages/schema/src/define.ts`
- Modify: any schema tests that mention `opencms.config` or `OpenCmsConfig`
- Test: schema / cli tests that load config by filename

**Interfaces:**
- Produces: `OpenCloudCmsConfig`, `CONFIG_FILE_NAMES = ['opencloudcms.config.ts', 'opencloudcms.config.js']`, `defineConfig(config: OpenCloudCmsConfig)`

- [ ] **Step 1: Write failing assertion on config filenames**

In the existing test that covers config discovery (cli `test/env.test.ts` or schema tests), change the expected filename to `opencloudcms.config.ts` **before** changing production code, or add:

```ts
import { CONFIG_FILE_NAMES } from '../src/config'; // adjust path per package

it('discovers opencloudcms.config.* only', () => {
  expect(CONFIG_FILE_NAMES).toEqual(['opencloudcms.config.ts', 'opencloudcms.config.js']);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @opencloudcms/schema exec vitest run` (or path to the new test file)  
Expected: FAIL — still `opencms.config.ts`

- [ ] **Step 3: Implement schema renames**

`packages/schema/src/config.ts`:

```ts
export const CONFIG_FILE_NAMES = ['opencloudcms.config.ts', 'opencloudcms.config.js'];

export function resolveConfig(config: OpenCloudCmsConfig, root: string): ResolvedConfig {
  // ... unchanged body
}
```

`packages/schema/src/types.ts`: rename `OpenCmsConfig` → `OpenCloudCmsConfig` (and update `ResolvedConfig` if it references it).

`packages/schema/src/define.ts`:

```ts
export function defineConfig(config: OpenCloudCmsConfig): OpenCloudCmsConfig {
  return config;
}
```

Re-export from schema package index if needed.

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @opencloudcms/schema test` (or vitest for that package)  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/schema
git commit -m "$(cat <<'EOF'
refactor(schema): OpenCloudCmsConfig and opencloudcms.config.* filenames

EOF
)"
```

---

### Task 3: OAuth2 env prefix `OPENCLOUDCMS_*`

**Files:**
- Modify: `packages/oauth2/src/config/schema.ts`
- Modify: all files under `packages/oauth2/test/` that set or assert `OPENCMS_*`
- Modify: `packages/oauth2/README.md`

**Interfaces:**
- Consumes: unchanged `loadConfig(env, file)` signature
- Produces: env keys `OPENCLOUDCMS_SECRET`, `OPENCLOUDCMS_PUBLIC_URL`, `OPENCLOUDCMS_AUTH_TTL_*`, `OPENCLOUDCMS_IDP_OIDC_*`, `OPENCLOUDCMS_ADMIN_*` (same suffixes as today)

- [ ] **Step 1: Update unit test expectations to new env names (fail first)**

In `packages/oauth2/test/unit/config.test.ts`, replace every `OPENCMS_` with `OPENCLOUDCMS_` in fixtures and `/OPENCMS_SECRET/` regexes → `/OPENCLOUDCMS_SECRET/`.

- [ ] **Step 2: Run unit test — expect FAIL**

Run: `pnpm --filter @opencloudcms/oauth2 exec vitest run test/unit/config.test.ts`  
Expected: FAIL — production still reads `OPENCMS_SECRET`

- [ ] **Step 3: Update `loadConfig` / `decodeSecret` messages**

In `packages/oauth2/src/config/schema.ts`, replace all `env.OPENCMS_*` reads and error strings with `OPENCLOUDCMS_*`. Example:

```ts
if (!raw) throw new ConfigError('OPENCLOUDCMS_SECRET is required (at least 32 bytes, base64 or hex)');
const secret = decodeSecret(env.OPENCLOUDCMS_SECRET);
const publicRaw = env.OPENCLOUDCMS_PUBLIC_URL || file.publicUrl;
```

Apply the same prefix to TTL, IdP, and admin seed keys listed in the spec/README table.

- [ ] **Step 4: Update remaining oauth2 tests + README**

Replace `OPENCMS_` → `OPENCLOUDCMS_` and `@opencms/` → `@opencloudcms/` in oauth2 tests and `packages/oauth2/README.md` (including `OPENCMS_DB` → `OPENCLOUDCMS_DB` in docs).

- [ ] **Step 5: Run oauth2 tests — expect PASS**

Run: `pnpm --filter @opencloudcms/oauth2 test`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/oauth2
git commit -m "$(cat <<'EOF'
refactor(oauth2): read OPENCLOUDCMS_* environment variables

EOF
)"
```

---

### Task 4: Core module, DI symbols, file rename

**Files:**
- Rename: `packages/core/src/opencms.module.ts` → `packages/core/src/opencloudcms.module.ts`
- Modify: `packages/core/src/options.ts`, all core imports of `OpenCmsModule` / `OPENCMS_*` / `ResolvedOpenCmsOptions`
- Modify: `packages/core/src` barrel exports (find the file that re-exports the module — typically `packages/core/src/index.ts` or package `main`)
- Modify: `packages/core/admin/src/i18n/messages/{en-US,vi-VN,fr-FR,id-ID}.ts`
- Modify: `packages/core/README.md`, core tests under `packages/core/test/`

**Interfaces:**
- Produces:
  - `export const OPENCLOUDCMS_OPTIONS = Symbol('OPENCLOUDCMS_OPTIONS')`
  - `export const OPENCLOUDCMS_DB = Symbol('OPENCLOUDCMS_DB')`
  - `export class OpenCloudCmsModule`
  - `export interface OpenCloudCmsModuleOptions` / `ResolvedOpenCloudCmsOptions`

- [ ] **Step 1: Rename symbols in `options.ts`**

```ts
export const OPENCLOUDCMS_OPTIONS = Symbol('OPENCLOUDCMS_OPTIONS');
export const OPENCLOUDCMS_DB = Symbol('OPENCLOUDCMS_DB');

export interface OpenCloudCmsModuleOptions {
  config: OpenCloudCmsConfig; // from @opencloudcms/schema
  // ... remainder unchanged aside from type renames
}

export interface ResolvedOpenCloudCmsOptions extends Omit<OpenCloudCmsModuleOptions, 'config'> {
  // ...
}
```

Update every `@Inject(OPENCMS_DB)` / `OPENCMS_OPTIONS` / `ResolvedOpenCmsOptions` / `OpenCmsModuleOptions` in `packages/core/src/**` to the new names. Update imports from `@opencms/schema` → `@opencloudcms/schema`.

- [ ] **Step 2: Rename module file and class**

- `git mv packages/core/src/opencms.module.ts packages/core/src/opencloudcms.module.ts`
- Rename `class OpenCmsModule` → `OpenCloudCmsModule`
- Logger `'OpenCms'` → `'OpenCloudCms'`
- Fix barrel export paths

- [ ] **Step 3: Update admin i18n copy**

Replace `OpenCmsModule` → `OpenCloudCmsModule` and `OPENCMS_PUBLIC_URL` → `OPENCLOUDCMS_PUBLIC_URL` in the four message files.

- [ ] **Step 4: Update core tests + README**

Replace remaining `@opencms/`, `OpenCms`, `OPENCMS_` in `packages/core/test/**` and `packages/core/README.md`.

- [ ] **Step 5: Build core — expect SUCCESS**

Run: `pnpm --filter @opencloudcms/core build`  
Expected: exit 0; `dist/opencloudcms.module.js` (or equivalent) exists; `dist/admin/styles/theme.css` present.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "$(cat <<'EOF'
refactor(core): OpenCloudCmsModule and OPENCLOUDCMS_* DI tokens

EOF
)"
```

---

### Task 5: CLI binary, init templates, CLI tests

**Files:**
- Create: `packages/cli/bin/opencloudcms.js` (same contents as old bin)
- Delete: `packages/cli/bin/opencms.js`
- Modify: `packages/cli/src/init/templates.ts`, `packages/cli/src/init/index.ts`, `packages/cli/src/index.ts`
- Modify: `packages/cli/test/init.test.ts`, `packages/cli/test/env.test.ts`

**Interfaces:**
- Produces: `bin.opencloudcms` → `bin/opencloudcms.js`; init writes `opencloudcms.config.ts` and `OPENCLOUDCMS_*` in `.env`

- [ ] **Step 1: Point bin at new file**

```js
#!/usr/bin/env node
require("../dist/index.js").program.parseAsync(process.argv);
```

Save as `packages/cli/bin/opencloudcms.js`, remove `bin/opencms.js`. Ensure `package.json` `bin` already maps `opencloudcms` (Task 1).

- [ ] **Step 2: Update CLI source env + errors**

`packages/cli/src/index.ts`:

```ts
const root = findProjectRoot(process.env.OPENCLOUDCMS_ROOT ?? process.cwd());
// ...
if (process.env.OPENCLOUDCMS_DEBUG) console.error(e);
// error text: opencloudcms.config.ts
```

- [ ] **Step 3: Rewrite init templates**

In `packages/cli/src/init/templates.ts` and `index.ts`:

- Write file `opencloudcms.config.ts` (not `opencms.config.ts`)
- Import `@opencloudcms/core` / `OpenCloudCmsModule`
- `.env` keys `OPENCLOUDCMS_SECRET`, `OPENCLOUDCMS_PUBLIC_URL`, admin keys with new prefix
- README snippets inside templates use `opencloudcms` / OpenCloudCMS
- `tsconfig` include `opencloudcms.config.ts`

- [ ] **Step 4: Update CLI tests to new names**

`init.test.ts` / `env.test.ts`: expect `opencloudcms.config.ts`, `@opencloudcms/core`, `OpenCloudCmsModule`, `OPENCLOUDCMS_SECRET`, script/bin `opencloudcms`.

- [ ] **Step 5: Build + test CLI**

Run:

```bash
pnpm --filter @opencloudcms/cli build
pnpm --filter @opencloudcms/cli test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "$(cat <<'EOF'
refactor(cli): @opencloudcms/cli binary and init templates

EOF
)"
```

---

### Task 6: Remaining packages + examples

**Files:**
- Modify: `packages/db/**`, `packages/codegen/**`, `packages/assets/**` (imports, comments, tests)
- Modify: `examples/my-store/**`, `examples/phone-store/**`
- Rename: `examples/*/opencms.config.ts` → `opencloudcms.config.ts`

**Interfaces:**
- Consumes: Task 1–5 public names
- Produces: examples boot with `OpenCloudCmsModule` + `opencloudcms.config.ts` + `OPENCLOUDCMS_*`

- [ ] **Step 1: Mechanical replace in remaining packages**

From repo root, only under `packages/db`, `packages/codegen`, `packages/assets` (and any leftover under `packages/core`/`oauth2`/`schema`/`cli` if `rg` still finds hits):

Apply replacements in order with a careful tool (do **not** replace inside SQL string literals that are table names like `opencms_assets` if present):

1. `@opencms/` → `@opencloudcms/`
2. `OPENCMS_` → `OPENCLOUDCMS_`
3. `OpenCms` → `OpenCloudCms`
4. `OpenCMS` → `OpenCloudCMS`
5. leftover path/brand `opencms` in comments/imports only

- [ ] **Step 2: Rename example config files**

```bash
git mv examples/my-store/opencms.config.ts examples/my-store/opencloudcms.config.ts
git mv examples/phone-store/opencms.config.ts examples/phone-store/opencloudcms.config.ts
```

Update imports (`app.module.ts`, etc.), `.env.example`, `main.ts` comments, `package.json` scripts already done in Task 1, and generated headers if they embed `@opencms/`.

- [ ] **Step 3: Update local example `.env` if present (gitignored)**

When testing locally, rename keys in `examples/*/.env` to `OPENCLOUDCMS_*` (document in CHANGELOG; do not commit secrets).

- [ ] **Step 4: Typecheck / build examples**

Run:

```bash
pnpm --filter my-store typecheck
pnpm --filter phone-store typecheck
```

Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add packages/db packages/codegen packages/assets examples
git commit -m "$(cat <<'EOF'
refactor: finish @opencloudcms rename in libs and examples

EOF
)"
```

---

### Task 7: Root docs, smoke script, verification gate

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `scripts/smoke-init.mjs`, `packages/core/README.md` (if not done), any other active docs outside sealed plans
- Verify: repo-wide `rg`

- [ ] **Step 1: Update README + CHANGELOG**

- Quick start: `npx @opencloudcms/cli init …`, `pnpm opencloudcms`, packages table `@opencloudcms/*`
- Env docs: `OPENCLOUDCMS_SECRET`, `OPENCLOUDCMS_PUBLIC_URL`, …
- CHANGELOG entry under Unreleased: breaking rename to OpenCloudCMS / `@opencloudcms`

- [ ] **Step 2: Update `scripts/smoke-init.mjs`**

Replace CLI invocation (`opencms` → `opencloudcms`), package filter names, env `OPENCLOUDCMS_*`, config filename checks, and log strings.

- [ ] **Step 3: Full build + test**

Run:

```bash
pnpm -r --filter './packages/*' build
pnpm test
```

Expected: build exit 0; vitest suites green.

- [ ] **Step 4: Brand residue gate**

Run:

```bash
rg -i 'opencms' packages examples README.md CHANGELOG.md scripts || true
```

Expected: **no** matches for package scope, env, CLI, or product name. If a match remains only as an SQL identifier inside an example migration body (e.g. `opencms_assets`), leave it and note it in the commit message; fix any other hit.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md scripts/smoke-init.mjs
git commit -m "$(cat <<'EOF'
docs: rebrand to OpenCloudCMS for npm @opencloudcms publish

EOF
)"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `@opencloudcms/*` package names + `publishConfig` | 1 |
| `@opencloudcms/cli` + bin `opencloudcms` | 1, 5 |
| `opencloudcms.config.ts` / `.js` | 2, 5, 6 |
| `OPENCLOUDCMS_*` env | 3, 5, 6, 7 |
| `OPENCLOUDCMS_DB` / `OPTIONS` + `OpenCloudCmsModule` | 4 |
| Examples + init templates | 5, 6 |
| README / CHANGELOG / smoke | 7 |
| No aliases; SQL migration identifiers untouched | Global + Task 6 note |
| `rg` verification | 7 |
| Actual npm publish | Out of scope (documented in spec only) |
