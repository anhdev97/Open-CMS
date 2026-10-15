# `@opencms/oauth2` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây package `@opencms/oauth2`: OpenCMS tự làm OAuth2/OIDC Authorization Server cho Admin UI theo mô hình BFF, có setup admin lần đầu (wizard + env) và đăng nhập qua một IdP OIDC generic.

**Architecture:**
- `oidc-provider` được mount tại `/oauth2` trong NestJS và lưu dữ liệu vào Postgres qua `KyselyAdapter`.
- Lớp BFF dùng `openid-client` để đổi code với chính provider đó. Token được giữ trong `auth_sessions`; trình duyệt chỉ có cookie `oc_session`.
- `AuthGuard` toàn cục bảo vệ `/api/**`.
- Các bảng thuộc stream core migrations.

**Tech Stack:** NestJS 11 (Express adapter), Kysely, PostgreSQL 16, zod, `oidc-provider` ^9, `openid-client` ^6, `argon2`, `jose`, vitest, supertest, `oauth2-mock-server` (IdP giả trong E2E).

**Spec:** `docs/superpowers/specs/2026-10-14-auth-oauth2-design.md` (đọc cùng plan này; số mục `§` trỏ về spec).

**Repo đã xác nhận (2026-10-14, nhánh `feat/oauth2`):**
- (a) Package mới nằm ở `packages/oauth2`, tên npm `@opencms/oauth2`. Workspace là pnpm, TypeScript `module: commonjs` (kế thừa `tsconfig.base.json`), test runner là vitest chạy từ root (`vitest.config.ts` gom `packages/*/test/**/*.test.ts`). Node 22.22 nên `require()` được các package chỉ có ESM (`oidc-provider`, `openid-client`, `jose`).
- (b) Kysely trong repo được inject bằng Symbol `OPENCMS_DB` của `@opencms/core`. **`@opencms/oauth2` không phụ thuộc `@opencms/core`** (tránh vòng phụ thuộc khi core/app import oauth2). Thay vào đó oauth2 tự định nghĩa token `OAUTH2_DB` (Symbol trong `src/constants.ts`), và `OAuth2Module.forRoot({ dbToken, ... })` nhận token DI của Kysely do app cung cấp rồi tạo provider `{ provide: OAUTH2_DB, useExisting: dbToken }`. App dùng `dbToken: OPENCMS_DB`; test dùng một global module test cung cấp Kysely riêng. Mọi chỗ plan ghi `DB_TOKEN` nghĩa là `OAUTH2_DB`.
- (c) Migrator core nằm trong `packages/db/src/index.ts`: `coreMigrations` là hằng số và `coreMigrator()` trả về map đó cố định. Task 3 thêm vào **`@opencms/db`** (không phải `@opencms/core`) hàm `registerCoreMigrations(source: Record<string, Migration>): void`; `coreMigrator()` gộp `coreMigrations` với mọi nguồn đã đăng ký (trùng key thì throw), sắp theo key. `'0001_system_tables'` < `'oauth2_0001_init'` theo thứ tự chuỗi nên core luôn chạy trước.
- (d) Không có Docker trong môi trường này nên **không dùng testcontainers**. `test/support/db.ts` đọc `TEST_DATABASE_URL` (mặc định `postgres://postgres:postgres@localhost:5432/postgres`), tạo một database ngẫu nhiên `oauth2_test_<random>` cho mỗi lần gọi `startTestDb()`, chạy core migrations, và `stop()` thì destroy Kysely rồi drop database đó. CI đã có service Postgres 16.

## Global Constraints

- PKCE bắt buộc, chỉ `S256`. Grants: `authorization_code`, `refresh_token`. Client duy nhất `opencms-admin`, xác thực `client_secret_basic`.
- Issuer = `publicUrl + '/oauth2'`. `redirect_uris = [publicUrl + '/api/auth/callback']`. `post_logout_redirect_uris = [publicUrl + '/admin/login']`.
- Scope cấp cho admin: `openid profile email offline_access`.
- Cookie: `oc_session`, `oc_login` (Path=/api/auth, 10 phút), `oc_idp`. Tất cả httpOnly, SameSite=Lax, Secure khi `publicUrl` là https.
- TTL mặc định:

  | Loại | Giá trị |
  |---|---|
  | Access token | 900 s |
  | Refresh token | 30 ngày |
  | Session idle | 7 ngày |
  | Session absolute | 30 ngày |
  | Authorization code | 60 s |
  | Interaction | 10 phút |

  Refresh token luôn được clamp về ≤ session absolute. TTL đọc qua `AuthSettingsProvider.getTtls()` mỗi lần dùng.
- Mật khẩu: argon2id; độ dài `minLength` (12) – 256; ≠ email (không phân biệt hoa thường); không có quy tắc loại ký tự.
- Rate limit login: 5 lần / 15 phút theo email, 20 lần / 15 phút theo IP.
- `OPENCMS_SECRET` ≥ 32 byte và `OPENCMS_PUBLIC_URL` là bắt buộc; thiếu thì từ chối khởi động.
- Mã hoá AES-256-GCM. Khoá con lấy bằng HKDF-SHA256 từ `OPENCMS_SECRET` với info `opencms/token`, `opencms/key`, `opencms/cookie`, `opencms/client-secret`.
- Lỗi `/api/**` có dạng `{ "error": { "code", "message" } }`, mã và HTTP status đúng bảng §8. Lỗi trong chuỗi redirect → 302 `/admin/login?error=<code>`.
- Không bao giờ trả access/refresh/id token ra trình duyệt. Không log mật khẩu, token hay giá trị cookie.
- Advisory lock dùng chung cho setup, seed, force reset và kiểm tra super_admin cuối: `pg_advisory_xact_lock(AUTH_SETUP_LOCK)` với `AUTH_SETUP_LOCK = 0x0C_A0_5E_70` (hằng số trong `src/constants.ts`).
- Email được chuẩn hoá ở mọi lối vào bằng `normalizeEmail(s) = s.trim().toLowerCase()`.

## Review Focus

1. **Email có hoa/thường hoặc khoảng trắng** (`" Admin@X.com"`) ở setup, login, tạo user và liên kết IdP. Kỳ vọng: cùng là một user, không bị `email_taken` giả, đăng nhập được. Test nằm ở Task 6 và Task 9.
2. **`OPENCMS_PUBLIC_URL` có dấu `/` cuối** (`https://cms.x.com/`). Kỳ vọng: issuer, redirect URI và kiểm tra Origin vẫn đúng. Test nằm ở Task 1.
3. **Mở form login quá 10 phút rồi mới submit** (interaction hết hạn). Kỳ vọng: nhận `{ redirectTo: '/admin/login?error=login_expired' }`, không phải 500. Test nằm ở Task 9.
4. **Mật khẩu có khoảng trắng đầu/cuối hoặc dài 257 ký tự.** Kỳ vọng: khoảng trắng không bị trim (giữ nguyên khi đăng nhập), còn 257 ký tự trả `422 weak_password`, không phải 500. Test nằm ở Task 2.
5. **Server sau reverse proxy TLS**, nơi BFF không gọi được `publicUrl` từ bên trong container. Kỳ vọng: BFF đổi code và refresh qua `auth.internalUrl` (mặc định `http://127.0.0.1:${PORT}`). Test nằm ở Task 10. Đây là bổ sung so với bản spec đầu; spec §5 đã được cập nhật.

---

## Cấu trúc file

```
packages/oauth2/
  package.json, tsconfig.json, vitest.config.ts
  src/
    index.ts                      # export OAuth2Module, types
    constants.ts                  # AUTH_SETUP_LOCK, cookie names, ADMIN_CLIENT_ID
    errors.ts                     # AuthError, AuthExceptionFilter
    oauth2.module.ts
    config/schema.ts              # zod OAuth2Config + loadConfig(env, fileCfg)
    settings/settings.provider.ts # AuthSettingsProvider, ConfigAuthSettingsProvider
    security/crypto.ts            # deriveKey, seal, open, sha256
    security/password.ts          # PasswordService (policy + argon2)
    security/return-to.ts         # sanitizeReturnTo
    security/rate-limiter.ts      # RateLimiter, InMemoryRateLimiter
    security/origin.ts            # assertSameOrigin
    db/types.ts                   # AuthTables cho Kysely
    db/migrations/oauth2_0001_init.ts
    db/migrations/index.ts        # oauth2CoreMigrations
    audit/audit.service.ts
    users/user.service.ts
    users/users.controller.ts
    users/password.controller.ts
    setup/bootstrap.service.ts
    setup/setup.controller.ts
    provider/kysely.adapter.ts
    provider/signing-keys.ts
    provider/provider.factory.ts
    provider/provider.service.ts  # giữ instance Provider, GrantRevoker impl
    interaction/interaction.controller.ts
    bff/oidc-client.ts            # openid-client config + internalUrl fetch
    bff/session.store.ts
    bff/auth.controller.ts        # login, callback, logout, me
    guard/auth.guard.ts
    guard/current-user.decorator.ts
    idp/identity-provider.ts      # interface + ExternalIdentity
    idp/oidc.identity-provider.ts
    idp/identity-linker.ts
    idp/idp.controller.ts
    maintenance/cleanup.service.ts
  test/
    unit/*.test.ts
    integration/*.test.ts         # Postgres thật qua TEST_DATABASE_URL
    e2e/*.test.ts
    support/db.ts, support/app.ts
```

---

### Task 1: Scaffold, config và settings

**Files:**
- Create: `packages/oauth2/{package.json,tsconfig.json,vitest.config.ts}`, `src/constants.ts`, `src/errors.ts`, `src/config/schema.ts`, `src/settings/settings.provider.ts`
- Test: `test/unit/config.test.ts`, `test/unit/settings.test.ts`

**Interfaces:**
- Produces:
  - `type OAuth2Config = { publicUrl: string; internalUrl: string; secret: Buffer; ttl: Ttls; password: { minLength: number }; rateLimit: {...}; idp: { oidc?: { issuer, clientId, clientSecret, label } }; admin: { email?, password?, name?, forceReset: boolean } }`
    - `publicUrl` đã chuẩn hoá: không có `/` cuối, chỉ origin + path.
  - `loadConfig(env: NodeJS.ProcessEnv, file?: Partial<AuthFileConfig>): OAuth2Config`. Throw `ConfigError` khi thiếu hoặc sai giá trị.
  - `type Ttls = { accessToken; refreshToken; sessionIdle; sessionAbsolute; authorizationCode; interaction }`, đơn vị giây.
  - `interface AuthSettingsProvider { getTtls(): Promise<Ttls> }`.
  - `class ConfigAuthSettingsProvider implements AuthSettingsProvider`. Token DI: `AUTH_SETTINGS`.
  - `class AuthError extends Error { constructor(code: AuthErrorCode, status: number, message?: string) }`.
  - `AuthExceptionFilter` chuyển `AuthError` sang JSON theo §8.

- [ ] **Step 1: Viết test fail**
  - `config.test.ts`:
    - `loadConfig({})` throw, message chứa `OPENCMS_SECRET`.
    - Secret 31 byte → throw.
    - `OPENCMS_PUBLIC_URL='https://cms.x.com/'` → `publicUrl === 'https://cms.x.com'`.
    - `OPENCMS_AUTH_TTL_ACCESS='60'` ghi đè file config.
    - `internalUrl` mặc định `http://127.0.0.1:${PORT ?? 3000}`.
  - `settings.test.ts`:
    - Mặc định khớp bảng TTL ở Global Constraints.
    - Refresh 40 ngày với absolute 30 ngày → `getTtls().refreshToken === 30*86400`, và logger nhận đúng một warn.
- [ ] **Step 2:** `pnpm --filter @opencms/oauth2 vitest run test/unit` → FAIL (module not found).
- [ ] **Step 3: Cài đặt `loadConfig` bằng zod và `ConfigAuthSettingsProvider`.**
  - Secret chấp nhận chuỗi base64 hoặc hex; đo độ dài theo byte sau khi decode.
  - Bảng ánh xạ env ↔ config theo §5. Thêm env `OPENCMS_INTERNAL_URL`.
- [ ] **Step 4:** Chạy lại → PASS.
- [ ] **Step 5:** Commit `feat(oauth2): scaffold package, config and settings provider`.

### Task 2: Primitive bảo mật

**Files:**
- Create: `src/security/{crypto,password,return-to,origin,rate-limiter}.ts`
- Test: `test/unit/{crypto,password,return-to,origin,rate-limiter}.test.ts`

**Interfaces:**
- Consumes: `OAuth2Config`, `AuthError` (Task 1).
- Produces:
  - `deriveKey(secret: Buffer, purpose: 'token'|'key'|'cookie'|'client-secret'): Buffer` (32 byte).
  - `seal(key: Buffer, plaintext: string): string`. Kết quả là base64url của `iv(12)|tag(16)|ciphertext`.
  - `open(key: Buffer, sealed: string): string`. Throw nếu dữ liệu bị sửa.
  - `sha256(s: string): string` (hex).
  - `class PasswordService`:
    - `validate(password: string, email: string): void`. Throw `AuthError('weak_password', 422)`.
    - `hash(p): Promise<string>`.
    - `verify(hash: string, p: string): Promise<boolean>`.
    - `verifyDummy(p): Promise<false>`. Dùng hash tính sẵn một lần, để thời gian phản hồi đồng đều.
  - `sanitizeReturnTo(v: string | undefined): string`.
  - `assertSameOrigin(originHeader: string | undefined, publicUrl: string): void`. Throw `AuthError('origin_mismatch', 403)`.
  - `interface RateLimiter { hit(key: string, limit: number, windowSec: number): { ok: boolean; retryAfterSec: number } }`.
  - `InMemoryRateLimiter`. Token DI: `RATE_LIMITER`.

- [ ] **Step 1: Viết test fail**
  - crypto: `open(k, seal(k,'x')) === 'x'`. Đổi 1 ký tự của sealed thì `open` throw. Hai `deriveKey` khác `purpose` cho ra khoá khác nhau.
  - password:
    - `validate('a'.repeat(11), e)` throw `weak_password`.
    - `'a'.repeat(257)` throw `weak_password`.
    - `validate('ADMIN@X.COM', 'admin@x.com')` throw.
    - `'correct horse battery'` qua.
    - `verify(await hash('  pw with spaces  '), 'pw with spaces')` → false (không trim).
  - return-to:
    - Các giá trị `'/admin/x'` → giữ nguyên.
    - `undefined`, `'//evil.com'`, `'https://evil.com'`, `'/api/x'`, `'/admin\\@evil'`, `'/\\evil'` → `'/admin'`.
  - origin: `undefined` → throw. `'https://cms.x.com'` khớp `publicUrl='https://cms.x.com'` → qua. `'https://cms.x.com:443'` → qua (so theo origin đã chuẩn hoá).
  - rate-limiter: lần thứ 6 trong cửa sổ có `ok=false` và `retryAfterSec>0`. Sau cửa sổ (fake timers) lại `ok=true`.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: Cài đặt.**
  - crypto dùng `node:crypto` (`hkdfSync`, `aes-256-gcm`).
  - Hash dùng `argon2.hash(p, { type: argon2.argon2id })`.
- [ ] **Step 4:** Chạy → PASS.
- [ ] **Step 5:** Commit `feat(oauth2): crypto, password policy, returnTo, origin, rate limiter`.

### Task 3: Migration `oauth2_0001_init` vào stream core

**Files:**
- Create: `src/db/types.ts`, `src/db/migrations/oauth2_0001_init.ts`, `src/db/migrations/index.ts`, `test/support/db.ts`
- Modify: `packages/db/src/index.ts` (thêm `registerCoreMigrations`, xem mục (c) ở đầu plan). Test cho phần này: `packages/db/test/register.test.ts`.
- Test: `test/integration/migration.test.ts`

**Interfaces:**
- Produces:
  - `interface AuthTables` khớp DDL §4, tên bảng chính xác.
  - `oauth2CoreMigrations: Record<string, Migration>`, key `'oauth2_0001_init'`.
  - `startTestDb(): Promise<{ db: Kysely<AuthTables>; stop(): Promise<void> }>`. Hàm này chạy toàn bộ core migrations.
- **Quyết định về migrator:**
  - Thêm vào `@opencms/db` hàm `registerCoreMigrations(source: Record<string, Migration>): void` như mục (c) ở đầu plan. Đăng ký trùng key (kể cả với `0001_system_tables`) thì throw; đăng ký lại cùng object thì bỏ qua (idempotent, vì module có thể bị import nhiều lần).
  - Phía `@opencms/oauth2` gọi đăng ký này ở import cấp module (`src/index.ts`), và `test/support/db.ts` import `src/db/migrations` rồi đăng ký trước khi migrate.

- [ ] **Step 1: Viết test fail** (`migration.test.ts`)
  - Sau `up`, có đủ 9 bảng §4.
  - `auth_roles` có đúng một dòng `key='super_admin'`.
  - Insert hai user `A@x.com` và `a@x.com` → lỗi unique.
  - `opencms_core_migrations` chứa `oauth2_0001_init`.
  - `down` xoá hết 9 bảng.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: Viết migration bằng Kysely schema builder.**
  - Unique index trên `lower(email)` qua `sql`.
  - FK `on delete cascade` theo §4.
  - Seed `super_admin` ngay trong `up`.
- [ ] **Step 4:** Chạy → PASS.
- [ ] **Step 5:** Commit `feat(oauth2): core migration oauth2_0001_init`.

### Task 4: Audit service

**Files:**
- Create: `src/audit/audit.service.ts`
- Test: `test/integration/audit.test.ts`

**Interfaces:**
- Produces:
  - `type AuditType` gồm đúng các giá trị: `'login_succeeded'|'login_failed'|'logout'|'setup_completed'|'admin_seeded_from_env'|'admin_force_reset'|'user_created'|'user_disabled'|'user_enabled'|'user_deleted'|'password_reset_by_admin'|'password_changed'|'idp_linked'`.
  - `AuditService.record(e: { type: AuditType; userId?: string; actorId?: string; ip?: string; userAgent?: string; meta?: Record<string, unknown> }, trx?: Transaction): Promise<void>`.

- [ ] **Step 1: Test.** `record` ghi một dòng có `at`. Nếu `meta` chứa key `password`, `token` hoặc `cookie` thì key đó bị loại trước khi ghi.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt; lọc key nhạy cảm bằng danh sách cố định.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit.

### Task 5: `UserService`

**Files:**
- Create: `src/users/user.service.ts`
- Test: `test/integration/user-service.test.ts`

**Interfaces:**
- Consumes: `PasswordService` (Task 2), `AuditService` (Task 4), `AUTH_SETUP_LOCK`.
- Produces:
  - `type AuthUser = { id; email; name; status: 'active'|'disabled'; roles: string[]; passwordHash: string|null; lastLoginAt: Date|null }`.
  - `interface GrantRevoker { revokeAllGrants(userId: string): Promise<void> }`. Token DI: `GRANT_REVOKER`. Task 8 cài đặt.
  - Các phương thức của `UserService`:
    - `countUsers(trx?)`.
    - `findById(id)`, `findByEmail(email)` (chuẩn hoá email).
    - `create(input: { email; name; password?: string; actorId?: string }, trx?): Promise<AuthUser>`. Gán `super_admin`; email trùng → `AuthError('email_taken', 409)`.
    - `setPassword(userId, password, trx?)`.
    - `setStatus(userId, status, actorId)`.
    - `delete(userId, actorId)`.
    - `withSetupLock<T>(fn: (trx) => Promise<T>): Promise<T>`.
    - `revokeAll(userId, opts?: { exceptSessionId?: string }, trx?)`. Xoá `auth_sessions` (trừ `id_hash = exceptSessionId`) rồi gọi `GrantRevoker`.
    - `touchLogin(userId)`.

- [ ] **Step 1: Viết test fail**
  - `create({email:' A@X.com ', …})` lưu `a@x.com`. Tạo lại với `a@x.com` → `email_taken`.
  - `setStatus(last,'disabled')` khi chỉ còn một super_admin active → `last_super_admin`.
  - Hai lệnh `setStatus(disabled)` đồng thời trên hai super_admin cuối → đúng một thành công, một `last_super_admin`.
  - `delete(self, self)` → `AuthError('forbidden', 403)`.
  - `revokeAll(u, { exceptSessionId: s1 })` giữ `s1`, xoá các session khác, và `GrantRevoker` mock được gọi một lần.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt. Kiểm tra super_admin cuối chạy bên trong `withSetupLock`. Disable gọi `revokeAll` và audit `user_disabled`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit.

### Task 6: Bootstrap khi khởi động và setup wizard

**Files:**
- Create: `src/setup/bootstrap.service.ts`, `src/setup/setup.controller.ts`
- Test: `test/integration/bootstrap.test.ts`, `test/integration/setup.test.ts`

**Interfaces:**
- Consumes: `UserService`, `PasswordService`, `RateLimiter`, `assertSameOrigin`, `AuditService`.
- Produces:
  - `BootstrapService.run(): Promise<void>`. Chạy bước 4–6 của §6.1; bước 2–3 nằm ở Task 8. Ném `BootstrapError` để khiến server từ chối khởi động.
  - `SetupController`: `GET /api/auth/setup` → `{ required }`, `POST /api/auth/setup` → `201 { id, email }`.
  - `SetupState.isRequired(): Promise<boolean>`. Cache `false` trong bộ nhớ sau khi đã có user; Task 11 dùng hàm này.

- [ ] **Step 1: Viết test fail**
  - bootstrap:
    - DB trống, có env email + mật khẩu → tạo 1 user và audit `admin_seeded_from_env`. Chạy `run()` lần hai → vẫn 1 user.
    - Env có mật khẩu yếu → `BootstrapError`.
    - DB trống, không có env → logger nhận WARN chứa `/admin/setup` và câu "Bất kỳ ai truy cập".
    - Force reset với user có sẵn → mật khẩu mới verify được, status `active`, có `super_admin`, `revokeAll` được gọi, audit `admin_force_reset`.
    - Force reset với email lạ → `BootstrapError`.
  - setup (supertest, Origin hợp lệ):
    - DB trống → `GET` trả `{required:true}`. `POST` với `{email:'Admin@X.com ', name, password}` → 201. `GET` → `{required:false}`.
    - Hai `POST` đồng thời → status `[201, 409]`, body `setup_already_completed`.
    - Thiếu Origin → 403 `origin_mismatch`.
    - Mật khẩu 11 ký tự → 422 `weak_password`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt. Seed và force reset chạy trong `withSetupLock`. Câu WARN lấy đúng văn bản §6.1 bước 6.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(oauth2): first-run bootstrap and setup wizard API`.

### Task 7: `KyselyAdapter` cho `oidc-provider`

**Files:**
- Create: `src/provider/kysely.adapter.ts`
- Test: `test/integration/kysely-adapter.test.ts`

**Interfaces:**
- Produces: `createKyselyAdapter(db: Kysely<AuthTables>): AdapterConstructor`. Adapter hiện thực đúng hợp đồng `oidc-provider`: `upsert(id, payload, expiresIn)`, `find`, `findByUid`, `findByUserCode`, `consume`, `destroy`, `revokeByGrantId`. Mọi thao tác lọc theo `kind = name`.

- [ ] **Step 1: Viết test fail**
  - `upsert` rồi `find` trả payload. `upsert` cùng id thì ghi đè.
  - `expiresIn=1`, dời thời gian 2 giây (tham số `now` inject vào adapter) → `find` trả `undefined`.
  - `consume` → `find(...).consumed` là số giây epoch.
  - `revokeByGrantId('g')` xoá mọi kind có `grant_id='g'`.
  - `findByUid` chỉ trả đúng kind.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt. Cột `grant_id`, `uid` và `user_code` lấy từ các trường cùng tên trong payload.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit.

### Task 8: Provider (signing key, client, mount `/oauth2`)

**Files:**
- Create: `src/provider/{signing-keys,provider.factory,provider.service}.ts`, `src/oauth2.module.ts` (lắp các module), `test/support/app.ts`
- Test: `test/integration/provider.test.ts`

**Interfaces:**
- Consumes: Task 1, 2, 3 và 7.
- Produces:
  - `ensureSigningKey(db, key): Promise<JWK[]>`. Nếu chưa có key với `retired_at is null` thì sinh ES256 bằng `jose`, seal rồi lưu.
  - `adminClientSecret(cfg): string` = base64url(`deriveKey(secret,'client-secret')`).
  - `upsertAdminClient(db, cfg)`.
  - `ProviderService`:
    - `get provider(): Provider`.
    - `onModuleInit()` thực hiện, theo thứ tự: tạo key → upsert client → `new Provider(issuer, conf)` → `BootstrapService.run()`.
    - Mount vào `app.use('/oauth2', provider.callback())`.
    - Hiện thực `GrantRevoker` bằng cách destroy mọi `Grant` theo `accountId`. Tra bằng `auth_oidc_payloads` với `kind='Grant'` và `payload->>'accountId'`.
  - `OAuth2Module.forRoot(fileCfg?: Partial<AuthFileConfig>): DynamicModule`.
  - `createTestApp(env?): Promise<{ app: INestApplication; db; url: string; close() }>`.
- **Cấu hình provider (quyết định):**
  - `adapter: createKyselyAdapter(db)`.
  - `jwks: { keys }`.
  - `cookies.keys: [deriveKey(secret,'cookie')]`.
  - `pkce: { required: () => true }`.
  - `features: { devInteractions: false, revocation: true, rpInitiatedLogout: true }`.
  - `rotateRefreshToken: true`.
  - `ttl`: mỗi mục là hàm `async () => (await settings.getTtls()).X`.
  - `interactions.url = (_, i) => '/admin/login?uid=' + i.uid`.
  - `loadExistingGrant`: với client `opencms-admin` thì tự tạo hoặc tái dùng Grant đủ scope trong Global Constraints.
  - `findAccount` đọc `UserService.findById`, trả claims `sub`, `email`, `name`.
  - `proxy = true` khi `publicUrl` là https.

- [ ] **Step 1: Viết test fail**
  - `GET /oauth2/.well-known/openid-configuration` → `issuer === url + '/oauth2'`, `code_challenge_methods_supported` chỉ gồm `['S256']`.
  - Khởi động lần hai không sinh thêm signing key.
  - Không có `OPENCMS_SECRET` → `createTestApp` reject.
  - `GrantRevoker.revokeAllGrants(u)` xoá các dòng Grant của `u`, giữ Grant của user khác.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(oauth2): mount oidc-provider with kysely adapter`.

### Task 9: Interaction đăng nhập bằng mật khẩu

**Files:**
- Create: `src/interaction/interaction.controller.ts`
- Test: `test/integration/interaction.test.ts`

**Interfaces:**
- Consumes: `ProviderService`, `UserService`, `PasswordService`, `RateLimiter`, `AuditService`.
- Produces:
  - `GET /oauth2/interaction/:uid` → `{ loginHint?: string; idps: { id: string; label: string }[] }`.
  - `POST /oauth2/interaction/:uid/login` → `{ redirectTo: string }`.
  - Hàm nội bộ `finishLogin(req, res, uid, userId)`, Task 13 dùng lại.
- Routes phải đăng ký trên Nest **trước** khi mount `provider.callback()`, để `/oauth2/interaction/*` không rơi vào provider.

- [ ] **Step 1: Viết test fail.** Helper `startInteraction()` gọi `/oauth2/auth` với PKCE và lấy `uid` từ header Location.
  - Đúng mật khẩu, email `' ADMIN@x.com'` → 200 `{ redirectTo }` trỏ về `/oauth2/auth/<uid>`. Audit `login_succeeded`.
  - Sai mật khẩu và email lạ → cả hai `401 invalid_credentials` với cùng body.
  - User disabled + đúng mật khẩu → `403 account_disabled`.
  - Lần thứ 6 cùng email → `429` kèm header `Retry-After`.
  - Thiếu Origin → 403.
  - Interaction hết hạn (TTL 1 s, chờ 2 s) → 200 `{ redirectTo: '/admin/login?error=login_expired' }`.
  - Response có `Cache-Control: no-store`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt. Bắt `SessionNotFound` của provider và chuyển thành `login_expired`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit.

### Task 10: BFF login/callback và session store

**Files:**
- Create: `src/bff/oidc-client.ts`, `src/bff/session.store.ts`, `src/bff/auth.controller.ts` (phần `login` và `callback`)
- Test: `test/integration/bff-login.test.ts`

**Interfaces:**
- Consumes: Task 1, 2, 5 và 9.
- Produces:
  - `OidcClient`:
    - `getConfig(): Promise<openid.Configuration>`. Discovery lười ở lần dùng đầu, cache lại. Dùng `customFetch` để viết lại origin `publicUrl` thành `internalUrl` và gửi kèm `X-Forwarded-Proto` và `X-Forwarded-Host` của `publicUrl`.
    - `buildLoginUrl(p: { state; nonce; codeChallenge; loginHint? }): URL`.
    - `exchange(currentUrl: URL, p: { verifier; state; nonce }): Promise<TokenSet>`.
    - `refresh(refreshToken): Promise<TokenSet>`.
    - `revoke(refreshToken): Promise<void>`.
    - `endSessionUrl(idToken): string`.
  - `SessionStore`:
    - `create(userId, tokens, meta: { ip; userAgent }): Promise<{ cookieValue: string; idHash: string }>`.
    - `get(cookieValue): Promise<SessionRow | undefined>`.
    - `lockForRefresh<T>(idHash, fn: (row, trx) => Promise<T>): Promise<T>`. Dùng `SELECT … FOR UPDATE`.
    - `updateTokens(idHash, tokens, trx)`.
    - `touch(idHash, now)`. Gia hạn idle nhưng không vượt absolute; tối đa một lần mỗi 60 s.
    - `delete(idHash)`.
  - Routes: `GET /api/auth/login?returnTo&login_hint` → 302 kèm cookie `oc_login`. `GET /api/auth/callback` → 302 `returnTo` kèm cookie `oc_session`.
- **Bổ sung so với bản spec đầu (đã cập nhật §5):** khoá config `internalUrl` / env `OPENCMS_INTERNAL_URL`. Lý do: sau reverse proxy TLS, server thường không gọi được chính `publicUrl` của mình.

- [ ] **Step 1: Viết test fail.** Helper `loginAs(email, pw)` đi trọn chuỗi bằng supertest agent giữ cookie: `/api/auth/login` → `/oauth2/auth` → POST interaction → theo `redirectTo` → `/api/auth/callback`.
  - Kết quả cuối là 302 về `/admin/x`. Có `Set-Cookie: oc_session` với `HttpOnly`, `SameSite=Lax`, `Path=/`. `oc_login` bị xoá.
  - DB có 1 `auth_sessions`, các cột `*_enc` không chứa chuỗi `eyJ`, `last_login_at` đã được set.
  - Không body nào trong chuỗi chứa `access_token`, `refresh_token` hay `id_token`.
  - `returnTo=//evil.com` → kết thúc tại `/admin`.
  - `state` bị sửa → 302 `/admin/login?error=invalid_state`.
  - `publicUrl='https://cms.test'` và `internalUrl` trỏ vào app test → callback vẫn thành công, cookie có `Secure`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt. Nội dung `oc_login` gồm `{state, nonce, verifier, returnTo}`, được `seal` bằng khoá `cookie`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(oauth2): BFF login and callback`.

### Task 11: `AuthGuard`, `me`, refresh và logout

**Files:**
- Create: `src/guard/auth.guard.ts`, `src/guard/current-user.decorator.ts`
- Modify: `src/bff/auth.controller.ts` (thêm `me` và `logout`), `src/oauth2.module.ts` (đăng ký `APP_GUARD` và `APP_FILTER`)
- Test: `test/integration/guard.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `OidcClient`, `UserService`, `SetupState`, `assertSameOrigin`.
- Produces:
  - `@Public()` để đánh dấu route nằm ngoài guard, theo danh sách §3.
  - `request.user: { id; email; name; roles: string[] }`.
  - `@CurrentUser()`.
  - `@RequireRole('super_admin')`, vi phạm → `forbidden`.
  - `GET /api/auth/me`.
  - `POST /api/auth/logout` → `{ redirectTo }`.

- [ ] **Step 1: Viết test fail**
  - DB trống → `GET /api/auth/me` trả `409 setup_required`.
  - Không cookie → `401 unauthenticated`.
  - Sau `loginAs` → `me` trả 200 `{ id, email, name, roles:['super_admin'] }`.
  - TTL access 2 s, chờ 3 s → `me` vẫn 200 và `access_token_enc` đã đổi.
  - Hai `me` song song sau khi hết hạn → cả hai 200, chỉ có 1 lần refresh (đếm bằng spy trên `OidcClient.refresh`).
  - Disable user qua `UserService` → request kế tiếp 401 và cookie bị xoá.
  - `POST` có Origin sai → `403 origin_mismatch`.
  - `logout`:
    - Session bị xoá; refresh token cũ dùng trực tiếp ở `/oauth2/token` → `invalid_grant`.
    - `redirectTo` bắt đầu bằng `url + '/oauth2/session/end'` và chứa `post_logout_redirect_uri`.
  - Dùng lại refresh token đã xoay → grant bị thu hồi; refresh token mới cũng hết hiệu lực.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt theo §6.5 bước 1–6 và §6.6. Đường dẫn end-session lấy từ discovery, không hardcode.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(oauth2): global auth guard, refresh, logout`.

### Task 12: API quản lý user và đổi mật khẩu

**Files:**
- Create: `src/users/users.controller.ts`, `src/users/password.controller.ts`
- Test: `test/integration/users-api.test.ts`

**Interfaces:**
- Consumes: `UserService`, `@RequireRole`, `@CurrentUser`.
- Produces: các endpoint trong bảng §6.7, body và mã lỗi đúng như bảng đó. Validate body bằng zod; lỗi → `422 validation_failed`.

- [ ] **Step 1: Viết test fail**
  - `GET` list có `identities` và không có `passwordHash`.
  - `POST` không có password → user có `password_hash` null. Login mật khẩu với user đó → `invalid_credentials`.
  - `PATCH` disable chính mình khi là super_admin cuối → `409 last_super_admin`.
  - Admin reset mật khẩu → session của user đích bị xoá.
  - `POST /api/auth/password` sai `currentPassword` → `401 invalid_credentials`. Đúng → session hiện tại vẫn dùng được, session thứ hai (`loginAs` lần 2) nhận 401.
  - `DELETE` identity → dòng liên kết bị xoá.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit.

### Task 13: IdP ngoài (OIDC generic)

**Files:**
- Create: `src/idp/{identity-provider,oidc.identity-provider,identity-linker,idp.controller}.ts`
- Modify: `src/interaction/interaction.controller.ts` (`idps` lấy từ registry)
- Test: `test/unit/identity-linker.test.ts`, `test/integration/idp.test.ts`

**Interfaces:**
- Consumes: `finishLogin` (Task 9), `UserService`, `AuditService`.
- Produces:
  - `IdentityProvider` và `ExternalIdentity` đúng như §6.4. `SealedState` = string, kết quả của `seal`.
  - `IDENTITY_PROVIDERS: IdentityProvider[]`. Chỉ chứa `OidcIdentityProvider` khi `cfg.idp.oidc` có giá trị. `label` mặc định là `'SSO'`.
  - `IdentityLinker.resolve(identity: ExternalIdentity): Promise<string /* userId */>`. Throw `AuthError` với code `idp_email_unverified`, `idp_account_not_found` hoặc `account_disabled`.
  - Routes: `GET /oauth2/interaction/:uid/idp/:provider` (bắt đầu) và `GET /oauth2/idp/:provider/callback` (cố định, đã cập nhật trong spec §6.4).

- [ ] **Step 1: Viết test fail**
  - Unit (5 nhánh của §6.4 bước 3):
    - Đã có liên kết → trả user của liên kết.
    - `emailVerified=false` → `idp_email_unverified`.
    - Email không khớp user nào → `idp_account_not_found`.
    - `'User@X.com'` khớp `user@x.com` → tạo liên kết, audit `idp_linked`.
    - User đã liên kết nhưng disabled → `account_disabled`.
  - Integration với `oauth2-mock-server`:
    - Bật env IdP → `GET /oauth2/interaction/:uid` trả `idps:[{id:'oidc',label}]`.
    - Chuỗi đầy đủ qua IdP kết thúc với `oc_session` hợp lệ.
    - Mock trả `email_verified:false` → 302 `/admin/login?error=idp_email_unverified`.
    - Cookie `oc_idp` của một `uid` khác → 302 `error=invalid_state`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt. Callback ở phía IdP dùng URI **cố định** `publicUrl + '/oauth2/idp/oidc/callback'`, vì phần lớn IdP không chấp nhận redirect URI có wildcard. `uid` được lấy từ cookie `oc_idp` (sealed `{uid, state, nonce, verifier}`), không lấy từ path.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(oauth2): generic OIDC identity provider`.

### Task 14: Dọn dẹp định kỳ và E2E toàn chuỗi

**Files:**
- Create: `src/maintenance/cleanup.service.ts`, `test/e2e/full-flow.test.ts`, `packages/oauth2/README.md` (env, cảnh báo §9)
- Test: `test/integration/cleanup.test.ts`

**Interfaces:**
- Produces: `CleanupService.run(now = new Date()): Promise<{ payloads: number; sessions: number }>`. Chạy khi boot và mỗi 3600 s qua `setInterval(...).unref()`.

- [ ] **Step 1: Viết test fail**
  - cleanup: xoá payload có `expires_at < now` và session hết idle hoặc absolute; giữ các dòng còn hạn.
  - E2E (TTL ngắn): setup → `loginAs` → `me` → chờ hết access → `me` (đã refresh) → logout → `me` trả 401. Đây cũng là kịch bản smoke cho người review.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Cài đặt. Viết README liệt kê toàn bộ env §5, `OPENCMS_INTERNAL_URL`, và rủi ro §9.1 kèm khuyến nghị seed bằng env ở production.
- [ ] **Step 4:** `pnpm --filter @opencms/oauth2 vitest run` → toàn bộ PASS.
- [ ] **Step 5:** Commit `feat(oauth2): cleanup job, e2e flow, README`.

---

## Ngoài plan này
- Các màn `/admin/setup`, `/admin/login` và quản lý user trong `@opencms/admin`. Phần này đi theo spec "admin nhúng trong project" và dùng hợp đồng API ở trên.
- Thay cơ chế bearer token cũ trong API core bằng `OAuth2Module`. Việc này làm khi tích hợp với spec admin nhúng, vì cần biết thứ tự mount `/admin`.
