# Realm roles (Keycloak-lite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add realm-role CRUD and user↔role assignment in `@opencms/oauth2`, plus a thin `/admin/roles` UI and user-role multi-select in the embedded admin SPA — no storefront/init work.

**Architecture:** Domain logic lives entirely in `@opencms/oauth2` (`RoleService` + admin HTTP controllers). Migration `oauth2_0002_roles` renames `auth_roles.key` → `name` and adds `description` / `is_system` / timestamps. `AuthGuard` already re-joins roles per request (no session cache), so assign/unassign refresh active sessions without re-login. `@opencms/core` admin is HTTP-only (fetch wrappers + pages); no Nest `RoleService` in core.

**Tech Stack:** NestJS 11, Kysely, PostgreSQL 16, zod, vitest, `@opencms/oauth2` / `@opencms/core` admin (Vite + React 19 + React Router + shadcn/ui + react-hook-form).

**Spec (binding):** Project store `docs/2026-10-16-roles-storefront-init-design.md` (mirror under `docs/superpowers/specs/` when present) — **Track A only** (§1 Track A, §2 R1–R6, §3, §5.1, §6 roles rows). Track B (storefront init / proxy) is out of scope for this plan.

**Repo facts (verified on `main` @ `38061de`, apply to every task):**
- Monorepo pnpm; tests from root: `pnpm vitest run <path>`; root `vitest.config.ts` includes `packages/*/test/**/*.test.ts`. Package filter: `pnpm --filter @opencms/oauth2 vitest run …` also works when `vitest` is on PATH via root.
- Postgres: `TEST_DATABASE_URL` default `postgres://postgres:postgres@localhost:5432/postgres`; `packages/oauth2/test/support/db.ts` `startTestDb()` creates/drops a temp DB and runs all registered core migrations (incl. oauth2).
- Nest under vitest: every constructor param uses explicit `@Inject(Token)`.
- After changing `@opencms/oauth2` `src/`, run `pnpm --filter @opencms/oauth2 build` before core admin typecheck if importing types; admin tests import source under `packages/core/admin/src/` directly.
- Existing role column is `auth_roles.key` (identifier) + display `name` (`oauth2_0001_init`). Call sites: `UserService.find` / `create` / `isLastActiveSuperAdmin`, `UsersController.views`, `BootstrapService` seed SQL — all use `key`. After Task 2 they must use `name`.
- `@RequireRole('super_admin')` stays string-by-name (`packages/oauth2/src/guard/current-user.decorator.ts`).
- Error JSON: `{ error: { code, message, issues? } }` via `AuthError` + filters in `packages/oauth2/src/errors.ts`. This plan extends that with optional `userCount` on `role_in_use`.
- Admin SPA: `packages/core/admin/`; routes in `src/routes.tsx` (basename `/admin`); Users page `src/pages/Users.tsx`; API client `src/lib/api.ts` + `src/lib/users.ts`; copy in `src/i18n/en.ts`; nav in `src/components/AppLayout.tsx`.
- Commit style (recent history): conventional, scoped — `feat(oauth2): …`, `feat(admin): …`, `test(oauth2): …`, `fix(oauth2): …`.

## Global Constraints

- Domain roles **only** in `@opencms/oauth2`. Admin UI calls HTTP; **no** `RoleService` / Nest role module in `@opencms/core`.
- Seed **only** `super_admin` with `is_system = true`. Do **not** seed `editor` / `viewer` / any other role.
- System role: no delete; no rename (`name` immutable). Description may be updated.
- Delete role with ≥1 `auth_user_roles` row → `409 role_in_use` with `userCount`; no cascade.
- Duplicate role `name` → `409 role_name_taken`.
- Every `/api/admin/roles*` and `/api/admin/users/:id/roles*` endpoint requires `@RequireRole('super_admin')` → missing → `403 forbidden`.
- Role `name` validation: trim, non-empty, max 64, pattern `^[a-z][a-z0-9_]*$`. Failures → `422 validation_failed`.
- `RequestUser.roles` and all `roles: string[]` responses remain **names**, not UUIDs.
- Assign/unassign / `PUT …/roles` must **not** revoke sessions solely for role change; next authenticated request / `GET /api/auth/me` must see updated roles (AuthGuard re-joins).
- Unassign / replace that would remove `super_admin` from the last active user with that role → `409 last_super_admin` (reuse `UserService` lock / invariant pattern with `AUTH_SETUP_LOCK`).
- `UserService.create` keeps assigning `super_admin` (existing auth behaviour); UI then `PUT`s the chosen role set after create.
- Out of scope: groups, composite roles, client scopes, Authorization Services, storefront/init (Track B), Playwright E2E.

## Review Focus

1. **Migration order** (`oauth2_0002`): add new columns → backfill `description` / `is_system` for `super_admin` while old display `name` still exists → drop display `name` → rename `key` → `name`. Wrong order collides on column `name`.
2. **Last super_admin** on `PUT /api/admin/users/:id/roles` and `DELETE …/roles/:roleId` when stripping `super_admin` from the sole active holder.
3. **Session refresh without re-login:** assign a custom role to an already-logged-in user; their `GET /api/auth/me` must list the new role with the same `oc_session` cookie.
4. **`role_in_use` body shape:** `{ error: { code: 'role_in_use', message: string, userCount: number } }` — `userCount` is a sibling of `code`/`message`, not under `issues`.
5. **Admin UI boundaries:** Roles page and user multi-select only call `/api/admin/roles*` / `/api/admin/users/:id/roles`; no duplicated last-super-admin / is_system rules beyond disable/hide UX.

---

## File structure (new / changed)

```
packages/oauth2/
  src/errors.ts                                 # + role_* codes, userCount on AuthError
  src/db/types.ts                               # AuthRolesTable post-0002 shape
  src/db/migrations/oauth2_0002_roles.ts        # NEW
  src/db/migrations/index.ts                    # register 0002
  src/users/user.service.ts                     # key → name
  src/users/users.controller.ts                 # key → name
  src/setup/bootstrap.service.ts                # key → name in SQL
  src/roles/role-name.ts                        # NEW validateRoleName
  src/roles/role.service.ts                     # NEW CRUD + assign
  src/roles/roles.controller.ts                 # NEW /api/admin/roles
  src/roles/user-roles.controller.ts            # NEW /api/admin/users/:id/roles*
  src/roles/role.mapper.ts                      # NEW Role → JSON
  src/oauth2.module.ts                          # register service + controllers
  src/index.ts                                  # export Role types / RequireRole already exported
  test/unit/role-name.test.ts                   # NEW
  test/integration/migration-roles.test.ts      # NEW (0002)
  test/integration/migration.test.ts            # update for post-0002 schema
  test/integration/role-service.test.ts         # NEW
  test/integration/roles-api.test.ts            # NEW

packages/core/admin/
  src/lib/api-error.ts                          # optional userCount
  src/lib/api.ts                                # parse userCount
  src/lib/roles.ts                              # NEW HTTP wrappers + error helpers
  src/lib/users.ts                              # setUserRoles helper
  src/i18n/en.ts                                # roles.* + nav.roles + users role strings
  src/pages/Roles.tsx                           # NEW
  src/pages/Users.tsx                           # multi-select create + edit roles
  src/routes.tsx                                # /roles
  src/components/AppLayout.tsx                  # Roles nav (super_admin)

packages/core/test/admin/
  roles.test.ts                                 # NEW pure helpers
  users.test.ts                                 # extend if setUserRoles helpers added
```

---

### Task 1: Auth error codes + `userCount` on `role_in_use`

**Files:**
- Modify: `packages/oauth2/src/errors.ts`
- Test: `packages/oauth2/test/unit/auth-error-render.test.ts` (create)

**Interfaces:**
- Consumes: existing `AuthError` / `AuthExceptionFilter` / `sendError` pattern.
- Produces:
  - `AuthErrorCode` includes `'role_name_taken' | 'role_in_use' | 'system_role_immutable'`.
  - `AuthError` accepts `opts?: { retryAfterSec?: number; userCount?: number }` and stores `userCount?: number`.
  - Rendered JSON for an error with `userCount` is `{ error: { code, message, userCount } }` (no `issues` unless later added).

- [ ] **Step 1: Write the failing test**

Create `packages/oauth2/test/unit/auth-error-render.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AuthError, AuthExceptionFilter } from '../../src/errors';

function fakeHost(res: { statusCode?: number; body?: unknown }) {
  const response = {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    json(body: unknown) {
      res.body = body;
      return this;
    },
    setHeader() {
      return this;
    },
  };
  return {
    switchToHttp: () => ({ getResponse: () => response }),
  } as any;
}

describe('AuthError role_in_use rendering', () => {
  it('includes userCount beside code and message', () => {
    const out: { statusCode?: number; body?: unknown } = {};
    const err = new AuthError('role_in_use', 409, 'Role is assigned to 2 users', { userCount: 2 });
    new AuthExceptionFilter().catch(err, fakeHost(out));
    expect(out.statusCode).toBe(409);
    expect(out.body).toEqual({
      error: { code: 'role_in_use', message: 'Role is assigned to 2 users', userCount: 2 },
    });
  });

  it('omits userCount when unset', () => {
    const out: { statusCode?: number; body?: unknown } = {};
    new AuthExceptionFilter().catch(new AuthError('forbidden', 403, 'Forbidden'), fakeHost(out));
    expect(out.body).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/oauth2/test/unit/auth-error-render.test.ts`

Expected: FAIL (TypeScript/runtime: `userCount` not on `AuthError` / body missing `userCount`).

- [ ] **Step 3: Minimal implementation**

In `packages/oauth2/src/errors.ts`:

1. Extend `AuthErrorCode`:

```ts
export type AuthErrorCode =
  | 'unauthenticated' | 'setup_required' | 'setup_already_completed' | 'invalid_credentials'
  | 'account_disabled' | 'forbidden' | 'origin_mismatch' | 'validation_failed' | 'weak_password'
  | 'not_found' | 'email_taken' | 'last_super_admin' | 'rate_limited'
  | 'idp_account_not_found' | 'idp_email_unverified' | 'login_expired' | 'invalid_state'
  | 'role_name_taken' | 'role_in_use' | 'system_role_immutable';
```

2. Update `AuthError`:

```ts
export class AuthError extends Error {
  retryAfterSec?: number;
  userCount?: number;
  constructor(
    public readonly code: AuthErrorCode,
    public readonly status: number,
    message?: string,
    opts?: { retryAfterSec?: number; userCount?: number },
  ) {
    super(message ?? code);
    this.name = 'AuthError';
    this.retryAfterSec = opts?.retryAfterSec;
    this.userCount = opts?.userCount;
  }
}
```

3. Replace `sendError` / `renderAuthError` so extras are included:

```ts
function sendError(
  host: ArgumentsHost,
  status: number,
  code: string,
  message: string,
  extras?: { issues?: unknown[]; userCount?: number },
): void {
  const error: Record<string, unknown> = { code, message };
  if (extras?.issues !== undefined) error.issues = extras.issues;
  if (extras?.userCount !== undefined) error.userCount = extras.userCount;
  host.switchToHttp().getResponse().status(status).json({ error });
}

function renderAuthError(err: AuthError, host: ArgumentsHost): void {
  if (err.retryAfterSec !== undefined) host.switchToHttp().getResponse().setHeader('Retry-After', String(err.retryAfterSec));
  sendError(host, err.status, err.code, err.message, {
    userCount: err.userCount,
  });
}
```

Update every other `sendError(...)` call in this file to pass `issues` via the extras object (e.g. `sendError(host, status, code, message, { issues: list })`) so signatures stay consistent. Keep behaviour for non-`userCount` paths identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/oauth2/test/unit/auth-error-render.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/oauth2/src/errors.ts packages/oauth2/test/unit/auth-error-render.test.ts
git commit -m "feat(oauth2): role error codes and userCount on AuthError"
```

---

### Task 2: Migration `oauth2_0002_roles` + Kysely types

**Files:**
- Create: `packages/oauth2/src/db/migrations/oauth2_0002_roles.ts`
- Modify: `packages/oauth2/src/db/migrations/index.ts`, `packages/oauth2/src/db/types.ts`
- Test: `packages/oauth2/test/integration/migration-roles.test.ts` (create)
- Also update: `packages/oauth2/test/integration/migration.test.ts` (post-0002 assertions — do in Step 3 of this task after 0002 lands so the suite stays green)

**Interfaces:**
- Consumes: `oauth2_0001_init` tables; `registerCoreMigrations` via `oauth2CoreMigrations`.
- Produces:
  - Migration key `oauth2_0002_roles` in `oauth2CoreMigrations`.
  - `AuthRolesTable`: `{ id: Generated<string>; name: string; description: Generated<string>; is_system: Generated<boolean>; created_at: Timestamp; updated_at: Timestamp }` — **no** `key` field.
  - After up: exactly one role `name = 'super_admin'`, `is_system = true`, `description` = previous display name (`Super Admin`).

- [ ] **Step 1: Write the failing test**

Create `packages/oauth2/test/integration/migration-roles.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import type { AuthTables } from '../../src/db/types';
import { startTestDb } from '../support/db';

describe('oauth2_0002_roles', () => {
  let ctx: Awaited<ReturnType<typeof startTestDb>>;
  let db: Kysely<AuthTables>;
  beforeAll(async () => {
    ctx = await startTestDb();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx?.stop();
  });

  it('auth_roles has name unique, description, is_system, timestamps; no key column', async () => {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>`
      select column_name, data_type, is_nullable, column_default::text
      from information_schema.columns
      where table_schema = 'public' and table_name = 'auth_roles'
      order by column_name
    `.execute(db);
    expect(cols.rows.map((c) => c.column_name)).toEqual([
      'created_at',
      'description',
      'id',
      'is_system',
      'name',
      'updated_at',
    ]);
    expect(cols.rows.find((c) => c.column_name === 'is_system')).toMatchObject({
      data_type: 'boolean',
      is_nullable: 'NO',
    });
  });

  it('seeds only super_admin as system role with description from old display name', async () => {
    const rows = await db.selectFrom('auth_roles').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'super_admin',
      description: 'Super Admin',
      is_system: true,
    });
    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect(rows[0].updated_at).toBeInstanceOf(Date);
  });

  it('enforces unique name', async () => {
    await expect(
      db.insertInto('auth_roles').values({ name: 'super_admin', description: 'x' }).execute(),
    ).rejects.toThrow();
  });

  it('records oauth2_0002_roles in opencms_core_migrations', async () => {
    const r = await sql<{ name: string }>`select name from opencms_core_migrations`.execute(db);
    expect(r.rows.map((x) => x.name)).toEqual(expect.arrayContaining(['oauth2_0001_init', 'oauth2_0002_roles']));
  });
});
```

Also extend `packages/oauth2/test/unit/register-migrations.test.ts` so after import it expects both `oauth2_0001_init` and `oauth2_0002_roles` in `allCoreMigrations()` (add the second `toContain` assertion in Step 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/oauth2/test/integration/migration-roles.test.ts`

Expected: FAIL (migration missing / columns still `key`+display `name`).

- [ ] **Step 3: Write migration + types + fix `migration.test.ts`**

Create `packages/oauth2/src/db/migrations/oauth2_0002_roles.ts`:

```ts
import { sql, type Kysely, type Migration } from 'kysely';

const now = sql`now()`;

export const oauth2_0002_roles: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .alterTable('auth_roles')
      .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
      .execute();
    await db.schema
      .alterTable('auth_roles')
      .addColumn('is_system', 'boolean', (c) => c.notNull().defaultTo(false))
      .execute();
    await db.schema
      .alterTable('auth_roles')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .execute();
    await db.schema
      .alterTable('auth_roles')
      .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
      .execute();

    // Old `name` is still the display label; `key` is the identifier.
    await sql`
      update auth_roles
      set description = name, is_system = true
      where key = 'super_admin'
    `.execute(db);

    await db.schema.alterTable('auth_roles').dropColumn('name').execute();
    await sql`alter table auth_roles rename column key to name`.execute(db);
  },

  async down(db: Kysely<any>) {
    await sql`alter table auth_roles rename column name to key`.execute(db);
    await db.schema
      .alterTable('auth_roles')
      .addColumn('name', 'text', (c) => c.notNull().defaultTo(''))
      .execute();
    await sql`update auth_roles set name = description`.execute(db);
    await db.schema.alterTable('auth_roles').dropColumn('description').execute();
    await db.schema.alterTable('auth_roles').dropColumn('is_system').execute();
    await db.schema.alterTable('auth_roles').dropColumn('created_at').execute();
    await db.schema.alterTable('auth_roles').dropColumn('updated_at').execute();
  },
};
```

Update `packages/oauth2/src/db/migrations/index.ts`:

```ts
import type { Migration } from 'kysely';
import { oauth2_0001_init } from './oauth2_0001_init';
import { oauth2_0002_roles } from './oauth2_0002_roles';

export const oauth2CoreMigrations: Record<string, Migration> = {
  oauth2_0001_init,
  oauth2_0002_roles,
};
```

Update `AuthRolesTable` in `packages/oauth2/src/db/types.ts`:

```ts
export interface AuthRolesTable {
  id: Generated<string>;
  name: string;
  description: Generated<string>;
  is_system: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Update `packages/oauth2/test/integration/migration.test.ts`:
- Change seed assertion to post-0002 shape: `expect(rows.map((r) => [r.name, r.is_system])).toEqual([['super_admin', true]]);` (or select `name` / `description` / `is_system`).
- Change `where('key', '=', 'super_admin')` → `where('name', '=', 'super_admin')`.
- Change the `migrateDown` test: first `migrateDown` returns `oauth2_0002_roles`; call `migrateDown` again for `oauth2_0001_init`, then assert tables empty — **or** assert only that downing 0002 restores `key` column if you keep a focused 0001 down test. Prefer: two downs then empty tables.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run packages/oauth2/test/integration/migration-roles.test.ts packages/oauth2/test/integration/migration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/oauth2/src/db/migrations/oauth2_0002_roles.ts \
  packages/oauth2/src/db/migrations/index.ts \
  packages/oauth2/src/db/types.ts \
  packages/oauth2/test/integration/migration-roles.test.ts \
  packages/oauth2/test/integration/migration.test.ts \
  packages/oauth2/test/unit/register-migrations.test.ts
git commit -m "feat(oauth2): migrate auth_roles key to name with system flag"
```

---

### Task 3: Retarget all `auth_roles.key` readers to `name`

**Files:**
- Modify: `packages/oauth2/src/users/user.service.ts`, `packages/oauth2/src/users/users.controller.ts`, `packages/oauth2/src/setup/bootstrap.service.ts`
- Tests (run existing; fix compile breaks): `packages/oauth2/test/integration/user-service.test.ts`, `packages/oauth2/test/integration/users-api.test.ts`, `packages/oauth2/test/integration/bootstrap.test.ts`, any other file selecting `r.key`

**Interfaces:**
- Consumes: `AuthRolesTable.name` from Task 2.
- Produces: unchanged public APIs (`AuthUser.roles: string[]` still names); SQL/joins use `r.name` / `where name = 'super_admin'`.

- [ ] **Step 1: Write / adjust a focused failing assertion**

In `packages/oauth2/test/integration/user-service.test.ts`, ensure create still yields `roles: ['super_admin']` (already present). Temporarily leave production code on `r.key` and run Step 2 to confirm TypeScript/runtime failure against new types — or skip straight to Step 3 if `tsc` already fails on `r.key`.

- [ ] **Step 2: Run to observe failure**

Run: `pnpm --filter @opencms/oauth2 typecheck`

Expected: FAIL on `r.key` / `where('key', …)` / SQL `where key =`.

- [ ] **Step 3: Minimal retarget**

In `user.service.ts`:
- `.select('r.key')` → `.select('r.name')`; `.orderBy('r.key')` → `.orderBy('r.name')`; `roles: roles.map((r) => r.key)` → `r.name`.
- Insert SQL: `where key = ${SUPER_ADMIN}` → `where name = ${SUPER_ADMIN}`.
- `isLastActiveSuperAdmin`: `where('r.key', '=', SUPER_ADMIN)` → `where('r.name', '=', SUPER_ADMIN)`.

In `users.controller.ts`:
- Select/order/map `r.key` → `r.name`.

In `bootstrap.service.ts`:
- `where key = 'super_admin'` → `where name = 'super_admin'`.

Grep the package for `auth_roles` / `.key` / `where key` and fix remaining oauth2 call sites (not unrelated crypto `.key` fields).

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run packages/oauth2/test/integration/user-service.test.ts \
  packages/oauth2/test/integration/users-api.test.ts \
  packages/oauth2/test/integration/bootstrap.test.ts \
  packages/oauth2/test/integration/guard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/oauth2/src/users/user.service.ts \
  packages/oauth2/src/users/users.controller.ts \
  packages/oauth2/src/setup/bootstrap.service.ts
git commit -m "fix(oauth2): read auth_roles.name after key rename"
```

---

### Task 4: `validateRoleName` + `RoleService` CRUD

**Files:**
- Create: `packages/oauth2/src/roles/role-name.ts`, `packages/oauth2/src/roles/role.mapper.ts`, `packages/oauth2/src/roles/role.service.ts`
- Test: `packages/oauth2/test/unit/role-name.test.ts`, `packages/oauth2/test/integration/role-service.test.ts`

**Interfaces:**
- Consumes: `OAUTH2_DB`, `AuthError`, `AuthTables`, `AUTH_SETUP_LOCK` (later tasks for assign).
- Produces:

```ts
// role-name.ts
export const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export function validateRoleName(raw: unknown): string;
// throws AuthError('validation_failed', 422, …) when not a string, empty after trim, >64, or !ROLE_NAME_PATTERN

// role.mapper.ts
export type RoleRow = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};
export type RoleJson = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};
export function mapRole(row: {
  id: string; name: string; description: string; is_system: boolean; created_at: Date; updated_at: Date;
}): RoleRow;
export function roleJson(r: RoleRow): RoleJson;

// role.service.ts
export class RoleService {
  list(): Promise<RoleRow[]>;
  get(id: string): Promise<RoleRow>; // not_found
  create(input: { name: string; description?: string }): Promise<RoleRow>; // is_system always false; 409 role_name_taken
  update(id: string, input: { name?: string; description?: string }): Promise<RoleRow>;
  // system + name change → 403 system_role_immutable; duplicate name → 409
  delete(id: string): Promise<void>;
  // system → 403; userCount≥1 → 409 role_in_use { userCount }; else delete
  countUsers(roleId: string, trx?: Trx): Promise<number>;
}
```

- [ ] **Step 1: Write failing unit tests for `validateRoleName`**

Create `packages/oauth2/test/unit/role-name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateRoleName } from '../../src/roles/role-name';

describe('validateRoleName', () => {
  it('accepts snake_case identifiers', () => {
    expect(validateRoleName(' editor ')).toBe('editor');
    expect(validateRoleName('content_editor')).toBe('content_editor');
    expect(validateRoleName('a')).toBe('a');
  });

  it('rejects empty, too long, and bad patterns', () => {
    for (const raw of ['', '   ', 'Editor', '1abc', 'ab-c', 'ab.c', 'a'.repeat(65)]) {
      expect(() => validateRoleName(raw)).toMatchObject({ code: 'validation_failed', status: 422 });
    }
  });
});
```

- [ ] **Step 2: Run unit test — expect FAIL**

Run: `pnpm vitest run packages/oauth2/test/unit/role-name.test.ts`

Expected: FAIL module not found.

- [ ] **Step 3: Implement `role-name.ts`**

```ts
import { AuthError } from '../errors';

export const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export function validateRoleName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new AuthError('validation_failed', 422, 'name: required');
  }
  const name = raw.trim();
  if (!name) throw new AuthError('validation_failed', 422, 'name: required');
  if (name.length > 64) throw new AuthError('validation_failed', 422, 'name: max length 64');
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw new AuthError(
      'validation_failed',
      422,
      'name: must match ^[a-z][a-z0-9_]*$ (snake_case ASCII)',
    );
  }
  return name;
}
```

- [ ] **Step 4: Run unit test — expect PASS**

Run: `pnpm vitest run packages/oauth2/test/unit/role-name.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing integration tests for CRUD**

Create `packages/oauth2/test/integration/role-service.test.ts` (CRUD section only for this task; assign tests in Task 5 — write both now or split files; prefer one file, implement assign in Task 5):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleService } from '../../src/roles/role.service';
import { UserService } from '../../src/users/user.service';
import { createTestApp, type TestApp } from '../support/app';

describe('RoleService', () => {
  let t: TestApp;
  let roles: RoleService;
  let users: UserService;

  beforeAll(async () => {
    t = await createTestApp();
    roles = t.app.get(RoleService);
    users = t.app.get(UserService);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it('CRUD: create list get patch description rename delete', async () => {
    const created = await roles.create({ name: 'editor', description: 'Edits content' });
    expect(created).toMatchObject({ name: 'editor', description: 'Edits content', isSystem: false });
    const listed = await roles.list();
    expect(listed.map((r) => r.name).sort()).toEqual(['editor', 'super_admin']);
    expect(await roles.get(created.id)).toMatchObject({ id: created.id, name: 'editor' });
    const patched = await roles.update(created.id, { description: 'Updated' });
    expect(patched.description).toBe('Updated');
    const renamed = await roles.update(created.id, { name: 'content_editor' });
    expect(renamed.name).toBe('content_editor');
    await roles.delete(created.id);
    await expect(roles.get(created.id)).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('system protect: no delete/rename super_admin; description ok', async () => {
    const sa = (await roles.list()).find((r) => r.name === 'super_admin')!;
    await expect(roles.delete(sa.id)).rejects.toMatchObject({ code: 'system_role_immutable', status: 403 });
    await expect(roles.update(sa.id, { name: 'root' })).rejects.toMatchObject({
      code: 'system_role_immutable',
      status: 403,
    });
    const updated = await roles.update(sa.id, { description: 'Primary admin' });
    expect(updated.description).toBe('Primary admin');
    expect(updated.name).toBe('super_admin');
  });

  it('duplicate name → role_name_taken', async () => {
    await roles.create({ name: 'dup_role' });
    await expect(roles.create({ name: 'dup_role' })).rejects.toMatchObject({
      code: 'role_name_taken',
      status: 409,
    });
  });

  it('delete role in use → role_in_use with userCount', async () => {
    const role = await roles.create({ name: 'temp_role' });
    const u = await users.create({ email: 'r@x.com', name: 'R', password: 'correct horse battery' });
    await t.db.insertInto('auth_user_roles').values({ user_id: u.id, role_id: role.id }).execute();
    await expect(roles.delete(role.id)).rejects.toMatchObject({
      code: 'role_in_use',
      status: 409,
      userCount: 1,
    });
  });
});
```

Note: `createTestApp` will not provide `RoleService` until Task 6 wires the module — for Task 4, register `RoleService` in the module early (Step 7) **or** instantiate `new RoleService(t.db)` in the test if you keep the service free of other deps. Prefer wiring in `OAuth2Module` providers in this task (controllers in Task 6) so `t.app.get(RoleService)` works:

In `oauth2.module.ts` add `RoleService` to `providers` and `exports` only (no controllers yet).

- [ ] **Step 6: Run CRUD integration — expect FAIL**

Run: `pnpm vitest run packages/oauth2/test/integration/role-service.test.ts`

Expected: FAIL (RoleService missing).

- [ ] **Step 7: Implement mapper + RoleService CRUD + register provider**

`packages/oauth2/src/roles/role.mapper.ts`:

```ts
export type RoleRow = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RoleJson = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

export function mapRole(row: {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
}): RoleRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function roleJson(r: RoleRow): RoleJson {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
```

`packages/oauth2/src/roles/role.service.ts` (CRUD methods only in this task — assign / unassign / replaceUserRoles are added in Task 5, not stubbed here):

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { mapRole, type RoleRow } from './role.mapper';
import { validateRoleName } from './role-name';

type Trx = Transaction<AuthTables>;

@Injectable()
export class RoleService {
  constructor(@Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>) {}

  private async rowById(id: string, trx?: Trx): Promise<RoleRow | undefined> {
    const row = await (trx ?? this.db)
      .selectFrom('auth_roles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? mapRole(row) : undefined;
  }

  async list(): Promise<RoleRow[]> {
    const rows = await this.db.selectFrom('auth_roles').selectAll().orderBy('name').execute();
    return rows.map(mapRole);
  }

  async get(id: string): Promise<RoleRow> {
    const row = await this.rowById(id);
    if (!row) throw new AuthError('not_found', 404, 'Role not found');
    return row;
  }

  async create(input: { name: string; description?: string }): Promise<RoleRow> {
    const name = validateRoleName(input.name);
    const description = (input.description ?? '').trim();
    try {
      const row = await this.db
        .insertInto('auth_roles')
        .values({
          name,
          description,
          is_system: false,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return mapRole(row);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AuthError('role_name_taken', 409, 'Role name already taken');
      throw e;
    }
  }

  async update(id: string, input: { name?: string; description?: string }): Promise<RoleRow> {
    const existing = await this.get(id);
    const patch: { name?: string; description?: string; updated_at: Date } = { updated_at: new Date() };
    if (input.name !== undefined) {
      const name = validateRoleName(input.name);
      if (existing.isSystem && name !== existing.name) {
        throw new AuthError('system_role_immutable', 403, 'System role name cannot be changed');
      }
      patch.name = name;
    }
    if (input.description !== undefined) patch.description = input.description.trim();
    try {
      await this.db.updateTable('auth_roles').set(patch).where('id', '=', id).execute();
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AuthError('role_name_taken', 409, 'Role name already taken');
      throw e;
    }
    return this.get(id);
  }

  async countUsers(roleId: string, trx?: Trx): Promise<number> {
    const r = await (trx ?? this.db)
      .selectFrom('auth_user_roles')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (existing.isSystem) {
      throw new AuthError('system_role_immutable', 403, 'System role cannot be deleted');
    }
    const userCount = await this.countUsers(id);
    if (userCount > 0) {
      throw new AuthError('role_in_use', 409, `Role is assigned to ${userCount} user(s)`, { userCount });
    }
    await this.db.deleteFrom('auth_roles').where('id', '=', id).execute();
  }
}
```

Register in `oauth2.module.ts`: import `RoleService`, add to `providers` and `exports`.

- [ ] **Step 8: Run integration — expect PASS**

Run: `pnpm vitest run packages/oauth2/test/unit/role-name.test.ts packages/oauth2/test/integration/role-service.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/oauth2/src/roles/role-name.ts \
  packages/oauth2/src/roles/role.mapper.ts \
  packages/oauth2/src/roles/role.service.ts \
  packages/oauth2/src/oauth2.module.ts \
  packages/oauth2/test/unit/role-name.test.ts \
  packages/oauth2/test/integration/role-service.test.ts
git commit -m "feat(oauth2): RoleService CRUD with system and in-use guards"
```

---

### Task 5: Assign / unassign / replace roles + `last_super_admin`

**Files:**
- Modify: `packages/oauth2/src/roles/role.service.ts`
- Modify: `packages/oauth2/test/integration/role-service.test.ts` (add assign cases)

**Interfaces:**
- Consumes: `UserService` patterns for `AUTH_SETUP_LOCK` / last super_admin; `RoleService` from Task 4.
- Produces (add to `RoleService`):

```ts
assign(userId: string, roleId: string): Promise<void>; // 404 user/role; idempotent 204 semantics at HTTP layer
unassign(userId: string, roleId: string): Promise<void>; // 404; last_super_admin if stripping last active super_admin
replaceUserRoles(userId: string, roleIds: string[]): Promise<RoleRow[]>;
// full replace in one transaction; unknown role id → 404; last_super_admin when new set drops super_admin from last holder
listForUser(userId: string): Promise<RoleRow[]>; // 404 if user missing
```

Use `pg_advisory_xact_lock(AUTH_SETUP_LOCK)` on any mutation that can remove `super_admin` from a user (unassign of that role, or replace that omits it).

Logic for last super_admin (mirror `UserService.isLastActiveSuperAdmin`):
- If the mutation would leave **zero** active users with role `super_admin`, throw `last_super_admin`.
- Equivalent: if target user is active, currently has `super_admin`, the mutation removes it, and no other active user has `super_admin`, throw.

- [ ] **Step 1: Append failing tests** to `role-service.test.ts`:

```ts
  it('assign is idempotent; listForUser returns roles', async () => {
    const role = await roles.create({ name: 'viewer_role' });
    const u = await users.create({ email: 'v@x.com', name: 'V', password: 'correct horse battery' });
    await roles.assign(u.id, role.id);
    await roles.assign(u.id, role.id);
    const list = await roles.listForUser(u.id);
    expect(list.map((r) => r.name).sort()).toEqual(['super_admin', 'viewer_role']);
  });

  it('replace roles and unassign; last_super_admin blocked', async () => {
    const editor = await roles.create({ name: 'ed2' });
    const a = await users.create({ email: 'a1@x.com', name: 'A', password: 'correct horse battery' });
    const b = await users.create({ email: 'b1@x.com', name: 'B', password: 'correct horse battery' });
    // a and b both have super_admin from create
    const sa = (await roles.list()).find((r) => r.name === 'super_admin')!;
    await roles.replaceUserRoles(a.id, [editor.id]);
    expect((await roles.listForUser(a.id)).map((r) => r.name)).toEqual(['ed2']);
    await expect(roles.unassign(b.id, sa.id)).rejects.toMatchObject({ code: 'last_super_admin', status: 409 });
    await expect(roles.replaceUserRoles(b.id, [editor.id])).rejects.toMatchObject({
      code: 'last_super_admin',
      status: 409,
    });
  });

  it('assign unknown user or role → not_found', async () => {
    const role = await roles.create({ name: 'xrole' });
    await expect(roles.assign('00000000-0000-4000-8000-000000000099', role.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    const u = await users.create({ email: 'u2@x.com', name: 'U', password: 'correct horse battery' });
    await expect(roles.assign(u.id, '00000000-0000-4000-8000-000000000099')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run packages/oauth2/test/integration/role-service.test.ts`

Expected: FAIL (`assign` / `replaceUserRoles` undefined).

- [ ] **Step 3: Implement assign methods on `RoleService`**

Inject `UserService` **or** duplicate the minimal last-super-admin query inside `RoleService` to avoid circular DI. Prefer **no** `UserService` inject: copy the lock + query using `AUTH_SETUP_LOCK` and joins on `auth_roles.name = 'super_admin'`.

```ts
import { sql } from 'kysely';
import { AUTH_SETUP_LOCK } from '../constants';

const SUPER_ADMIN = 'super_admin';

// inside RoleService:

private async assertUserExists(userId: string, trx: Trx): Promise<void> {
  const u = await trx.selectFrom('auth_users').select('id').where('id', '=', userId).executeTakeFirst();
  if (!u) throw new AuthError('not_found', 404, 'User not found');
}

private async assertNotRemovingLastSuperAdmin(
  userId: string,
  nextRoleIds: string[],
  trx: Trx,
): Promise<void> {
  const sa = await trx
    .selectFrom('auth_roles')
    .select('id')
    .where('name', '=', SUPER_ADMIN)
    .executeTakeFirstOrThrow();
  const willHave = nextRoleIds.includes(sa.id);
  if (willHave) return;
  const user = await trx
    .selectFrom('auth_users')
    .select(['id', 'status'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  if (user.status !== 'active') return;
  const currentlyHas = await trx
    .selectFrom('auth_user_roles')
    .select('role_id')
    .where('user_id', '=', userId)
    .where('role_id', '=', sa.id)
    .executeTakeFirst();
  if (!currentlyHas) return;
  const others = await trx
    .selectFrom('auth_users as u')
    .innerJoin('auth_user_roles as ur', 'ur.user_id', 'u.id')
    .select('u.id')
    .where('ur.role_id', '=', sa.id)
    .where('u.status', '=', 'active')
    .where('u.id', '<>', userId)
    .execute();
  if (others.length === 0) throw new AuthError('last_super_admin', 409);
}

async listForUser(userId: string): Promise<RoleRow[]> {
  const user = await this.db.selectFrom('auth_users').select('id').where('id', '=', userId).executeTakeFirst();
  if (!user) throw new AuthError('not_found', 404, 'User not found');
  const rows = await this.db
    .selectFrom('auth_user_roles as ur')
    .innerJoin('auth_roles as r', 'r.id', 'ur.role_id')
    .selectAll('r')
    .where('ur.user_id', '=', userId)
    .orderBy('r.name')
    .execute();
  return rows.map(mapRole);
}

async assign(userId: string, roleId: string): Promise<void> {
  await this.db.transaction().execute(async (trx) => {
    await this.assertUserExists(userId, trx);
    const role = await this.rowById(roleId, trx);
    if (!role) throw new AuthError('not_found', 404, 'Role not found');
    await trx
      .insertInto('auth_user_roles')
      .values({ user_id: userId, role_id: roleId })
      .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing())
      .execute();
  });
}

async unassign(userId: string, roleId: string): Promise<void> {
  await this.db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${AUTH_SETUP_LOCK})`.execute(trx);
    await this.assertUserExists(userId, trx);
    const role = await this.rowById(roleId, trx);
    if (!role) throw new AuthError('not_found', 404, 'Role not found');
    const current = await trx
      .selectFrom('auth_user_roles')
      .select('role_id')
      .where('user_id', '=', userId)
      .execute();
    const next = current.map((r) => r.role_id).filter((id) => id !== roleId);
    await this.assertNotRemovingLastSuperAdmin(userId, next, trx);
    await trx
      .deleteFrom('auth_user_roles')
      .where('user_id', '=', userId)
      .where('role_id', '=', roleId)
      .execute();
  });
}

async replaceUserRoles(userId: string, roleIds: string[]): Promise<RoleRow[]> {
  const unique = [...new Set(roleIds)];
  return this.db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${AUTH_SETUP_LOCK})`.execute(trx);
    await this.assertUserExists(userId, trx);
    for (const id of unique) {
      if (!(await this.rowById(id, trx))) throw new AuthError('not_found', 404, 'Role not found');
    }
    await this.assertNotRemovingLastSuperAdmin(userId, unique, trx);
    await trx.deleteFrom('auth_user_roles').where('user_id', '=', userId).execute();
    if (unique.length) {
      await trx
        .insertInto('auth_user_roles')
        .values(unique.map((role_id) => ({ user_id: userId, role_id })))
        .execute();
    }
    const rows = await trx
      .selectFrom('auth_user_roles as ur')
      .innerJoin('auth_roles as r', 'r.id', 'ur.role_id')
      .selectAll('r')
      .where('ur.user_id', '=', userId)
      .orderBy('r.name')
      .execute();
    return rows.map(mapRole);
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run packages/oauth2/test/integration/role-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/oauth2/src/roles/role.service.ts packages/oauth2/test/integration/role-service.test.ts
git commit -m "feat(oauth2): assign, unassign, replace user roles with last_super_admin"
```

---

### Task 6: HTTP controllers + module wiring + API integration tests

**Files:**
- Create: `packages/oauth2/src/roles/roles.controller.ts`, `packages/oauth2/src/roles/user-roles.controller.ts`
- Modify: `packages/oauth2/src/oauth2.module.ts`, `packages/oauth2/src/index.ts`
- Test: `packages/oauth2/test/integration/roles-api.test.ts`

**Interfaces:**
- Consumes: `RoleService`, `roleJson`, `parseBody`, `RequireRole`, uuid helper (copy from `users.controller.ts` or extract shared `packages/oauth2/src/http/uuid.ts` — prefer **copy the local `uuid()` helper** into both new controllers to avoid drive-by refactors).
- Produces endpoints (all `@RequireRole('super_admin')`):

| Method | Path | Success |
|---|---|---|
| GET | `/api/admin/roles` | `200 { data: RoleJson[] }` |
| GET | `/api/admin/roles/:id` | `200` RoleJson (controllers may return bare RoleJson **or** `{ data }` — **match users API:** wrap list in `{ data }`; for single role return the RoleJson object directly as `200` body **per spec table** which says `200` Role — use **bare RoleJson** for get/create/patch to match spec §3.3 Success column) |
| POST | `/api/admin/roles` | `201` RoleJson |
| PATCH | `/api/admin/roles/:id` | `200` RoleJson |
| DELETE | `/api/admin/roles/:id` | `204` |
| GET | `/api/admin/users/:id/roles` | `200 { data: RoleJson[] }` |
| PUT | `/api/admin/users/:id/roles` | body `{ roleIds: string[] }` → `200 { data: RoleJson[] }` |
| POST | `/api/admin/users/:id/roles/:roleId` | `204` |
| DELETE | `/api/admin/users/:id/roles/:roleId` | `204` |

Zod bodies:
- create: `z.object({ name: z.string(), description: z.string().optional() }).strict()`
- patch: `z.object({ name: z.string().optional(), description: z.string().optional() }).strict().refine(… at least one key)`
- put roles: `z.object({ roleIds: z.array(z.string()) }).strict()`

Name format is enforced in `validateRoleName` inside the service (not only zod).

- [ ] **Step 1: Write failing API tests**

Create `packages/oauth2/test/integration/roles-api.test.ts` modelled on `users-api.test.ts` (`createTestApp`, `loginAs`, local `api()` helper with Origin on mutations):

Cover:
1. Full CRUD happy path as super_admin.
2. System protect via HTTP.
3. Duplicate name → `409` `role_name_taken`.
4. Assign / PUT / unassign / idempotent POST assign.
5. Delete in-use → `409` `role_in_use` + `error.userCount`.
6. PUT/DELETE that strips last `super_admin` → `409` `last_super_admin`.
7. Non–`super_admin` session (create user, delete their `auth_user_roles` or replace with only a custom role while another admin remains) → `403` on every roles path listed above.
8. After assign, same cookie `GET /api/auth/me` includes the new role name **without** re-login.
9. Validation: `POST` `{ name: 'Bad-Name' }` → `422` `validation_failed`.
10. Unknown ids → `404`.

Sketch for session refresh case:

```ts
it('GET /api/auth/me reflects assign without re-login', async () => {
  const target = await users.create({ email: 'me@x.com', name: 'Me', password: PW });
  const targetCookie = await login('me@x.com');
  const role = (await api('/api/admin/roles', { method: 'POST', body: { name: 'reporter' } })).body;
  expect((await api('/api/auth/me', { cookie: targetCookie })).body.roles).toEqual(['super_admin']);
  expect(
    (await api(`/api/admin/users/${target.id}/roles/${role.id}`, { method: 'POST' })).status,
  ).toBe(204);
  expect((await api('/api/auth/me', { cookie: targetCookie })).body.roles.sort()).toEqual([
    'reporter',
    'super_admin',
  ]);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run packages/oauth2/test/integration/roles-api.test.ts`

Expected: FAIL (404 on `/api/admin/roles`).

- [ ] **Step 3: Implement controllers**

`packages/oauth2/src/roles/roles.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthError } from '../errors';
import { RequireRole } from '../guard/current-user.decorator';
import { parseBody } from '../security/validate';
import { roleJson } from './role.mapper';
import { RoleService } from './role.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: string): string {
  if (!UUID.test(value)) throw new AuthError('not_found', 404, 'Not found');
  return value;
}

const createSchema = z.object({ name: z.string(), description: z.string().optional() }).strict();
const patchSchema = z
  .object({ name: z.string().optional(), description: z.string().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined, { message: 'name or description is required' });

@RequireRole('super_admin')
@Controller('api/admin/roles')
export class RolesController {
  constructor(@Inject(RoleService) private readonly roles: RoleService) {}

  @Get()
  async list() {
    return { data: (await this.roles.list()).map(roleJson) };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return roleJson(await this.roles.get(uuid(id)));
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const input = parseBody(createSchema, body);
    return roleJson(await this.roles.create(input));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(patchSchema, body);
    return roleJson(await this.roles.update(uuid(id), input));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.roles.delete(uuid(id));
  }
}
```

`packages/oauth2/src/roles/user-roles.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuthError } from '../errors';
import { RequireRole } from '../guard/current-user.decorator';
import { parseBody } from '../security/validate';
import { roleJson } from './role.mapper';
import { RoleService } from './role.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: string): string {
  if (!UUID.test(value)) throw new AuthError('not_found', 404, 'Not found');
  return value;
}

const putSchema = z.object({ roleIds: z.array(z.string()) }).strict();

@RequireRole('super_admin')
@Controller('api/admin/users')
export class UserRolesController {
  constructor(@Inject(RoleService) private readonly roles: RoleService) {}

  @Get(':id/roles')
  async list(@Param('id') id: string) {
    return { data: (await this.roles.listForUser(uuid(id))).map(roleJson) };
  }

  @Put(':id/roles')
  async replace(@Param('id') id: string, @Body() body: unknown) {
    const { roleIds } = parseBody(putSchema, body);
    const rows = await this.roles.replaceUserRoles(uuid(id), roleIds.map(uuid));
    return { data: rows.map(roleJson) };
  }

  @Post(':id/roles/:roleId')
  @HttpCode(204)
  async assign(@Param('id') id: string, @Param('roleId') roleId: string) {
    await this.roles.assign(uuid(id), uuid(roleId));
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(204)
  async unassign(@Param('id') id: string, @Param('roleId') roleId: string) {
    await this.roles.unassign(uuid(id), uuid(roleId));
  }
}
```

**Nest routing note:** `UsersController` is already `@Controller('api/admin/users')`. Adding `UserRolesController` on the same path is fine — Nest merges routes. Ensure `:id/roles` does not collide with `:id/password` / `:id/identities/:identityId` (more specific static segments win).

Wire in `oauth2.module.ts` `controllers: […, RolesController, UserRolesController]`.

Export from `index.ts`:

```ts
export * from './roles/role.mapper';
export * from './roles/role.service';
export * from './roles/role-name';
```

Do **not** export controllers unless other packages need them.

- [ ] **Step 4: Run API tests — expect PASS**

Run: `pnpm vitest run packages/oauth2/test/integration/roles-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/oauth2/src/roles/roles.controller.ts \
  packages/oauth2/src/roles/user-roles.controller.ts \
  packages/oauth2/src/oauth2.module.ts \
  packages/oauth2/src/index.ts \
  packages/oauth2/test/integration/roles-api.test.ts
git commit -m "feat(oauth2): admin roles and user-roles HTTP API"
```

---

### Task 7: Admin API client — `roles.ts`, `ApiError.userCount`, i18n

**Files:**
- Modify: `packages/core/admin/src/lib/api-error.ts`, `packages/core/admin/src/lib/api.ts`, `packages/core/admin/src/lib/users.ts`, `packages/core/admin/src/i18n/en.ts`
- Create: `packages/core/admin/src/lib/roles.ts`
- Test: `packages/core/test/admin/roles.test.ts`

**Interfaces:**
- Consumes: `api()`, existing `ApiError`.
- Produces:

```ts
export interface AdminRole {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}
export const listRoles = () => api<{ data: AdminRole[] }>('/api/admin/roles').then((r) => r.data);
export const createRole = (input: { name: string; description?: string }) =>
  api<AdminRole>('/api/admin/roles', { method: 'POST', json: input });
export const updateRole = (id: string, input: { name?: string; description?: string }) =>
  api<AdminRole>(`/api/admin/roles/${id}`, { method: 'PATCH', json: input });
export const deleteRole = (id: string) => api<void>(`/api/admin/roles/${id}`, { method: 'DELETE' });
export const setUserRoles = (userId: string, roleIds: string[]) =>
  api<{ data: AdminRole[] }>(`/api/admin/users/${userId}/roles`, { method: 'PUT', json: { roleIds } }).then((r) => r.data);
export function roleErrorMessage(err: unknown): string;
export function roleError(err: unknown): Error;
```

`ApiError` gains optional `userCount?: number`. `api.ts` reads `payload.error?.userCount`.

i18n keys (add under `en`):
- `nav.roles`: `'Roles'`
- `roles.title`, `roles.description`, `roles.newRole`, `roles.emptyTitle`, `roles.emptyDescription`, `roles.listLabel`, `roles.name`, `roles.descriptionField`, `roles.systemBadge`, `roles.actions`, `roles.create.*`, `roles.edit.*`, `roles.remove.*` (title/description/confirm/done), `roles.errors.role_name_taken`, `roles.errors.role_in_use` (`'This role is assigned to {count} user(s). Remove those assignments first.'`), `roles.errors.system_role_immutable`, `roles.errors.forbidden`, `roles.errors.not_found`, `roles.errors.validation_failed`
- `users.roles`, `users.editRoles.*`, `users.create.roles`, `users.errors.role_in_use` not required on users if only used on roles page

- [ ] **Step 1: Failing tests**

`packages/core/test/admin/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../admin/src/lib/api-error';
import { roleError, roleErrorMessage } from '../../admin/src/lib/roles';

describe('roleErrorMessage', () => {
  it('formats role_in_use with count', () => {
    const err = new ApiError(409, 'role_in_use', 'Role is assigned to 3 user(s)', [], undefined, 3);
    expect(roleErrorMessage(err)).toBe('This role is assigned to 3 user(s). Remove those assignments first.');
  });
  it('maps role_name_taken', () => {
    expect(roleErrorMessage(new ApiError(409, 'role_name_taken', 'x'))).toBe('A role with this name already exists.');
  });
});

describe('roleError', () => {
  it('rewrites known codes and preserves userCount', () => {
    const e = roleError(new ApiError(409, 'role_in_use', 'x', [], undefined, 2)) as ApiError;
    expect(e.userCount).toBe(2);
    expect(e.message).toContain('2');
  });
});
```

Update `ApiError` constructor signature in the test to match Step 3 (`userCount` as last arg).

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run packages/core/test/admin/roles.test.ts`

Expected: FAIL (module / ctor).

- [ ] **Step 3: Implement client + i18n + ApiError**

`api-error.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues: unknown[] = [],
    public retryAfterSec?: number,
    public userCount?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

In `api.ts` `ErrorBody`:

```ts
interface ErrorBody {
  error?: { code?: string; message?: string; issues?: unknown[]; userCount?: number };
}
```

Pass `payload.error?.userCount` into `new ApiError(...)`.

Implement `roles.ts` mirroring `users.ts` `KNOWN_ERRORS` + `t('roles.errors.${code}', { count: err.userCount ?? 0 })` for `role_in_use`.

Add `setUserRoles` either in `roles.ts` or `users.ts` (prefer `roles.ts` export; re-export from users if the Users page imports from `@/lib/users` only — **Users page may import both**).

Add all `en.ts` strings listed above (exact English copy; keep tone of existing users strings).

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run packages/core/test/admin/roles.test.ts packages/core/test/admin/users.test.ts packages/core/test/admin/api.test.ts`

Expected: PASS (update `api.test.ts` only if `ApiError` arity broke a construct — fix call sites).

- [ ] **Step 5: Commit**

```bash
git add packages/core/admin/src/lib/api-error.ts \
  packages/core/admin/src/lib/api.ts \
  packages/core/admin/src/lib/roles.ts \
  packages/core/admin/src/lib/users.ts \
  packages/core/admin/src/i18n/en.ts \
  packages/core/test/admin/roles.test.ts
git commit -m "feat(admin): roles API client, userCount on ApiError, i18n"
```

---

### Task 8: `/admin/roles` page + route + sidebar

**Files:**
- Create: `packages/core/admin/src/pages/Roles.tsx`
- Modify: `packages/core/admin/src/routes.tsx`, `packages/core/admin/src/components/AppLayout.tsx`

**Interfaces:**
- Consumes: `listRoles`, `createRole`, `updateRole`, `deleteRole`, `roleError` / `roleErrorMessage`, UI primitives used by `Users.tsx` (`PageHeader`, `Table`, `Dialog`, `ConfirmDialog`, `Badge`, `Form`, …).
- Produces: route `path: 'roles'` under `AuthGate`; nav item `/roles` visible when `user.roles.includes('super_admin')` (gate **Users** the same way for consistency with spec §3.6).

- [ ] **Step 1: Extend `LayoutUser` + failing typecheck path**

Update `AppLayout.tsx`:

```ts
export interface LayoutUser {
  name?: string | null;
  email: string;
  roles: string[];
}
```

Filter `NAV` (or build nav array) so `users` and `roles` entries render only if `user.roles.includes('super_admin')`. Pass `user` from `AuthGate` (already has `roles`).

Add route:

```ts
{ path: 'roles', lazy: async () => ({ Component: (await import('./pages/Roles')).Roles }) },
```

Create a minimal `Roles.tsx` that throws `throw new Error('not implemented')` first if you want a red test via build — prefer implementing in Step 3 after a thin smoke: `pnpm --filter @opencms/core exec tsc -p admin/tsconfig.json --noEmit` once the page exists.

Because admin UI has no Playwright, verification is **typecheck + build** plus pure unit tests from Task 7. Treat Step 1 as “route/nav compile fails until page exists.”

- [ ] **Step 2: Run typecheck — expect FAIL** (missing page)

Run: `pnpm --filter @opencms/core exec tsc -p admin/tsconfig.json --noEmit`

Expected: FAIL cannot find `./pages/Roles`.

- [ ] **Step 3: Implement `Roles.tsx`**

Behaviour checklist (must all be present):
- Table columns: name, description, System badge when `isSystem`.
- Create dialog: name + description; on `role_name_taken` set field error; on `validation_failed` show message on name.
- Edit dialog: description always editable; **name input `disabled={role.isSystem}`**; submit PATCH.
- Delete: `ConfirmDialog`; hide/disable delete when `isSystem`; on `role_in_use` toast `roleErrorMessage` (includes count).
- Load errors via `ErrorAlert`; empty via `EmptyState`.
- Mirror `Users.tsx` patterns (toast, `run` helper, dialog state).

Keep the page as a single file similar in size to `Users.tsx` create/list sections — no Nest logic.

- [ ] **Step 4: Typecheck + admin unit tests**

Run:

```bash
pnpm --filter @opencms/core exec tsc -p admin/tsconfig.json --noEmit
pnpm vitest run packages/core/test/admin/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/admin/src/pages/Roles.tsx \
  packages/core/admin/src/routes.tsx \
  packages/core/admin/src/components/AppLayout.tsx
git commit -m "feat(admin): /admin/roles page and sidebar entry"
```

---

### Task 9: Users form — multi-select roles (create + edit)

**Files:**
- Modify: `packages/core/admin/src/pages/Users.tsx`
- Optional small helper test in `packages/core/test/admin/users.test.ts` if you extract `toggleId(ids, id, on)` — otherwise no new test file required beyond manual typecheck.

**Interfaces:**
- Consumes: `listRoles`, `setUserRoles`, `createUser` from Task 7; `Checkbox` from `@/components/ui/checkbox`.
- Produces:
  - Create user dialog: checkbox list of roles from `listRoles()`; after successful `createUser`, call `setUserRoles(created.id, selectedIds)` (always, including empty array). If `setUserRoles` fails, show error (user exists — show `roleError` / `userError` toast and keep dialog open or reload list).
  - Row action **Edit roles**: dialog with checkboxes pre-checked from `listRoles` ∩ user's current role **ids** — user list only has role **names**. Therefore on open: `listRoles()` + map `user.roles` (names) → ids; submit `setUserRoles(user.id, selectedIds)`.
  - Do not implement last-super-admin client-side beyond letting the server error toast (`users.errors.last_super_admin` already exists).
  - Disable deleting system role from UI N/A here; optionally disable unchecking `super_admin` only as soft UX — **server remains source of truth** (spec: no client last-super-admin logic required). Prefer **allow uncheck** and show toast on `409`.

- [ ] **Step 1: Write a small pure helper test (optional but preferred)**

If extracted to `packages/core/admin/src/lib/roles.ts`:

```ts
export function roleIdsFromNames(all: AdminRole[], names: string[]): string[] {
  const set = new Set(names);
  return all.filter((r) => set.has(r.name)).map((r) => r.id);
}
```

Test in `roles.test.ts`.

- [ ] **Step 2: Run — expect FAIL** then **Step 3: implement helper + Users UI**

In `CreateUserDialog`:
- `useEffect` → `listRoles().then(setAllRoles)`.
- State `selected: string[]` (ids).
- Render checkbox per role (`name` as label; show System badge text if `isSystem`).
- `onSubmit`: `const created = await createUser(…); await setUserRoles(created.id, selected);`

Add `EditRolesDialog` similar to reset-password dialog; menu item `t('users.editRoles.menu')`.

Show a Roles column on the table (names as badges) — optional but recommended for admin UX; if added, use `t('users.roles')`.

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter @opencms/core exec tsc -p admin/tsconfig.json --noEmit
pnpm vitest run packages/core/test/admin/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/admin/src/pages/Users.tsx \
  packages/core/admin/src/lib/roles.ts \
  packages/core/admin/src/i18n/en.ts \
  packages/core/test/admin/roles.test.ts
git commit -m "feat(admin): multi-select roles on user create and edit"
```

---

### Task 10: Final verification + README touch (oauth2)

**Files:**
- Modify: `packages/oauth2/README.md` (short section: realm roles API table + migration `oauth2_0002_roles`)
- Do **not** change Track B docs.

- [ ] **Step 1: Run full oauth2 + admin test suites**

```bash
pnpm vitest run packages/oauth2/test/
pnpm vitest run packages/core/test/admin/
pnpm --filter @opencms/oauth2 typecheck
pnpm --filter @opencms/core exec tsc -p admin/tsconfig.json --noEmit
```

Expected: all PASS / exit 0.

- [ ] **Step 2: Grep guardrails**

```bash
rg -n "editor|viewer" packages/oauth2/src/db/migrations/
rg -n "RoleService" packages/core/src/
rg -n "\\bkey\\b" packages/oauth2/src/users packages/oauth2/src/setup packages/oauth2/src/roles
```

Expected:
- No seed of editor/viewer in migrations.
- No `RoleService` under `packages/core/src/` (Nest).
- No remaining `auth_roles.key` usage in users/setup/roles.

- [ ] **Step 3: README** — document endpoints from spec §3.3 and note `is_system` / `role_in_use` / session refresh behaviour in 5–10 lines under a `## Realm roles` heading in `packages/oauth2/README.md`.

- [ ] **Step 4: Commit**

```bash
git add packages/oauth2/README.md
git commit -m "docs(oauth2): document realm roles admin API"
```

---

## Spec coverage self-review (Track A)

| Spec requirement | Task |
|---|---|
| R1 domain in `@opencms/oauth2` | 4–6 |
| R2 seed only `super_admin` `is_system` | 2 |
| R3 delete in-use → 409 + `userCount` | 1, 4, 6 |
| R4 session roles refresh without re-login | 6 (me test); no session revoke on assign |
| R5 admin UI HTTP-only | 7–9 |
| R6 `@RequireRole` by name | unchanged; controllers use it (6) |
| §3.1 migration column order / no extra seeds | 2 |
| §3.2 create/update/delete/assign rules + authz | 4–6 |
| §3.3 API table | 6 |
| §3.4 AuthGuard re-join (no token/session rewrite) | 6 test; no code that revokes on role change |
| §3.5 package layout `roles/*` | 4–6 |
| §3.6 `/admin/roles`, user multi-select, sidebar | 8–9 |
| §5.1 integration/unit tests listed | 1–6 |
| Error codes table §3.3 | 1 + service throws |
| Track B excluded | no tasks for init/proxy/Next |

**Placeholder scan:** no TBD/TODO left in steps; Interfaces blocks present; commands + expected output present; commit after each task.

**Type consistency:** `RoleRow` / `RoleJson` / `AdminRole` field names (`isSystem`, ISO strings) align across service → HTTP → admin client.
