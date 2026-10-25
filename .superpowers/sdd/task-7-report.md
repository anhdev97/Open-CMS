# Task 7 Report: Root docs, smoke script, verification gate

## Status

Implemented the OpenCloudCMS rename in the root README, changelog, smoke-init script, and root package metadata.

## Changes

- Updated root documentation to use OpenCloudCMS, `@opencloudcms/*`, the `opencloudcms` CLI, `opencloudcms.config.*`, `OpenCloudCmsModule`, and `OPENCLOUDCMS_*`.
- Added an Unreleased changelog entry describing the breaking rename and lack of compatibility aliases.
- Updated `scripts/smoke-init.mjs` to invoke `packages/cli/bin/opencloudcms.js` and the installed `@opencloudcms/cli`, generate imports from `@opencloudcms/schema`, use the renamed environment variables, and check the renamed branding markers.
- Renamed the private root package to `opencloudcms-monorepo`.

## Verification

- `pnpm -r --filter './packages/*' build`: passed (7/7 package builds).
- `node --check scripts/smoke-init.mjs`: passed.
- `pnpm test`: infrastructure-blocked by local PostgreSQL authentication (`password authentication failed for user "postgres"`). Vitest completed with 52 test files passed and 31 failed; 397 tests passed, 12 failed, and 218 were skipped. The failures originate from database setup/hooks, not rebrand assertions.
- IDE diagnostics for `README.md`, `CHANGELOG.md`, `scripts/smoke-init.mjs`, and `package.json`: no errors.
- `git diff --check`: passed.

## Brand residue gate

Command scope: `rg -i 'opencms' packages examples README.md CHANGELOG.md scripts`

- `scripts`: no matches.
- `packages`: 27 matches, all intentionally stable SQL table, migration-table, constraint, or index identifiers in schema/database code, tests, comments, and `packages/core/README.md`.
- `examples`: 4 matches, all foreign-key references to intentionally stable SQL tables inside migration bodies.
- `README.md`: 2 matches on one line, documenting the stable `opencms_core_migrations` and `opencms_migrations` SQL identifiers.
- `CHANGELOG.md`: 5 matches, consisting of the documented `opencms_*` compatibility note and stable SQL table identifiers.
- No old npm scope, CLI command, config filename, environment variable, module class, product name, or smoke-script branding remains in the gate scope.

## Concern

The full smoke workflow was not run because it requires the same usable PostgreSQL credentials that blocked the database-backed Vitest suites.
