# Task 6 Report

Status: Complete

Commit: `refactor: finish @opencloudcms rename in libs and examples`

Verification:
- `pnpm --filter @opencloudcms/codegen build` — passed
- `pnpm --filter @opencloudcms/db build` — passed
- `pnpm --filter @opencloudcms/oauth2 build` — passed
- `pnpm --filter @opencloudcms/cli build` — passed
- `pnpm --filter my-store typecheck` — passed
- `pnpm --filter phone-store typecheck` — passed
- IDE diagnostics for changed package and example trees — no errors

Concerns:
- Existing `opencms_*` SQL table, index, constraint, and migration metadata identifiers were intentionally preserved, including references inside applied example migrations.
- Local example `.env` files were absent, so no ignored secret-bearing files were changed.
# Task 6 report — AssetsService / AssetsController / AssetsModule

Status: DONE (with concerns below)

## Delivered (packages/assets)
- `src/provider/create-provider.ts` — `local` supported; s3/gcs throw `S3/GCS provider not available yet` (Task 7); incomplete local config throws.
- `src/nest/assets.service.ts` — `list`, `register`, `upload`, `patch`, `delete`, snake→camel row mapping (`mimeType`, `storageKey`, `createdAt`, `variants`, `size` as number).
- `src/nest/assets.controller.ts` — `AssetsController` (GET/POST `api/admin/assets`, PATCH/DELETE `assets/:id`) and `AssetsUploadController` (POST `assets/upload`, only registered when `assets` non-null). Permissions: list=`content.read`, register/patch/upload/delete=`content.update`.
- `AssetUploadInterceptor` — wraps `FileInterceptor('file')` with multer `fileSize = limits.maxBytes` (multer limit → 413) and `files: 1`.
- `src/nest/local-static.middleware.ts` — serves `local.root` at the pathname of `local.publicBaseUrl` (GET/HEAD, `sendFile` with `root` + `dotfiles: deny`, nosniff + `CSP: sandbox`). Uses `originalUrl` because Nest mounts middleware through `app.use`.
- `src/nest/assets.module.ts` — `AssetsModule.forRoot({ dbToken, assets? })`; provider factory runs at init (throws on bad config). No `assets` → no upload route, no static.
- `types.ts`: `VariantInfo.key` added. `constants.ts`: `ASSETS_DB` token. `index.ts`: exports module/service/controllers/createProvider/`InvalidImageError`.
- `package.json`: `@opencms/oauth2` workspace dep, `@nestjs/platform-express` peer; `pnpm-lock.yaml` updated (`--lockfile-only`).

## Behaviour
- Upload: size > maxBytes → 413; `accept` mismatch → 415 (supports `image/*`); ImageTooLarge/InvalidImage → 400 (`code` kept); put failure → cleanup + 502; DB insert failure → best-effort cleanup + logged orphan keys, error rethrown.
- Delete: keys = `storage_key` ∪ `variants.*.key`; storage first, failure → 502 and row kept; then row. Registered (external) rows have no keys → no storage call. If keys exist but provider is absent/different kind → 409.
- Malformed/unknown ids → 404. `alt` blank → null; max lengths validated (400).

## Tests (all pass: `npx vitest run packages/assets` → 49 passed; `tsc` typecheck + build clean)
- `test/unit/assets.service.test.ts` (17): real local provider on tmp dir + in-memory FakeDb (`test/support/fake-db.ts`).
- `test/unit/create-provider.test.ts` (3).
- `test/integration/assets-http.test.ts` (3): Nest + supertest — multipart upload, static serve, patch, delete, 413, 400 without file, `assets: null` omits upload route.

## Postgres status
`postgres://postgres:postgres@localhost:5432/postgres` is reachable but **password authentication fails** in this environment, so no real-DB tests were run; Kysely is mocked by FakeDb. SQL against the real table (jsonb `variants` insert as JSON string, bigint `size`) is therefore unverified — worth running in Task 8 with real DB.

## Concerns / notes
- Vitest (esbuild) doesn't emit decorator metadata → controllers/services use explicit `@Inject(...)`.
- `pnpm install` couldn't run (no TTY prompt for modules purge); I used `--lockfile-only` and manually symlinked `packages/assets/node_modules/@opencms/oauth2` (untracked). A normal `pnpm install` will reproduce it.
- Core (`system.controller.ts`) untouched; its duplicate `/api/admin/assets` routes must be removed in Task 8 to avoid conflicts. Its list response was raw snake_case; the new one is camelCase.
- Local static middleware is applied `forRoutes('*')` and is skipped when `publicBaseUrl` has no path prefix.

## Fix (critical review)
- **DELETE `/api/admin/assets/:id` permission:** was `@RequirePermission('content.delete')`; corrected to `content.update` (same as register/patch/upload). Commit: `fix(assets): DELETE assets requires content.update`. Tests: `pnpm exec vitest run packages/assets/test` → 49 passed (7 files); no test asserted `content.delete`.
