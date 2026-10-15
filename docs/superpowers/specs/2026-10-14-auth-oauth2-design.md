# opencms: Authentication trên OAuth2 — Design Spec

**Ngày:** 2026-10-14 · **Trạng thái:** Draft chờ review · **Package:** `@opencms/oauth2`
**Thay thế:** cơ chế "single bearer token" cho admin (Known gaps, architecture-decisions v0.1)

## 1. Mục tiêu và phạm vi

### Mục tiêu
- OpenCMS tự đóng vai **OAuth2/OIDC Authorization Server**, có tài khoản local (email + mật khẩu) và đăng nhập qua **IdP ngoài** (OIDC).
- Khi project chạy lần đầu, có cách tạo **admin ban đầu**: wizard trên web, hoặc seed từ biến môi trường.
- Đặt nền dữ liệu (roles, user_roles, oauth_clients, identities) để v0.2 (scoped RBAC) và các client sau này (CLI, SDK, server-to-server) mở rộng mà không phải đổi schema.

### Trong phạm vi
- Client duy nhất: **Admin UI**, dùng Authorization Code + PKCE (S256).
- Nhiều user. Mọi user mang role `super_admin`.
- Quản lý user: tạo, vô hiệu hoá, admin reset mật khẩu hộ, user tự đổi mật khẩu.
- Interface `IdentityProvider` và một provider **OIDC generic** cấu hình bằng env.
- Thời hạn token/session cấu hình qua config, đọc qua interface để sau này chuyển sang cấu hình trên UI.
- Audit log cho các sự kiện auth (chỉ ghi).

### Ngoài phạm vi
- Device Code, Client Credentials, `opencms login` (CLI chỉ dùng cho `opencms init`).
- Quên mật khẩu qua email, mailer adapter.
- MFA.
- Role khác `super_admin` và phân quyền theo scope (v0.2).
- Xác thực end-user của website (customer identity).
- Màn xem audit log, màn cấu hình TTL trên UI.

### Phụ thuộc (spec riêng)
- **Admin nhúng trong project:** một server NestJS phục vụ API ở `/api` và admin SPA build sẵn (`@opencms/admin`) ở `/admin`, cùng origin.
- **`opencms init`:** tạo project và sinh `OPENCMS_SECRET` vào `.env`.

Spec này giả định hai mục trên đã có. Các màn login/setup/quản lý user nằm trong `@opencms/admin`, nhưng hợp đồng API của chúng do spec này định nghĩa.

## 2. Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Dùng `oidc-provider` (panva) làm Authorization Server, `openid-client` cho phía client và IdP ngoài | Thư viện đã chứng nhận OpenID; không tự viết logic bảo mật OAuth2 |
| D2 | Mô hình **BFF**: NestJS là confidential client của chính mình. Token nằm ở server, trình duyệt chỉ có cookie `oc_session` httpOnly | Cùng origin; trình duyệt không bao giờ chạm access/refresh token |
| D3 | Bảng auth thuộc stream `opencms_core_migrations`. Migration nằm trong `@opencms/oauth2` và được migrator core gom vào | Giữ quy tắc "core chạy trước, từ chối khởi động khi còn migration pending" |
| D4 | Wizard setup **không có token**. Mở khi `auth_users` trống | Quyết định của owner. Rủi ro được ghi ở §9 |
| D5 | "Cần setup" ⇔ `auth_users` **trống hoàn toàn** | Vô hiệu hoá admin không làm wizard mở lại |
| D6 | IdP ngoài chỉ **liên kết với user đã tồn tại**, không tự tạo user | Kiểm soát ai có quyền vào CMS |
| D7 | TTL đọc qua `AuthSettingsProvider` ở mỗi lần dùng | Phase sau chuyển lên UI mà không đổi luồng |

## 3. Cấu trúc package `@opencms/oauth2`

`OAuth2Module.forRoot(config)` được API core import. Package phụ thuộc vào `@opencms/db` (Kysely), `oidc-provider`, `openid-client` và `argon2`.

| Khối | Trách nhiệm | Route |
|---|---|---|
| `provider/` | Cấu hình `oidc-provider`, `KyselyAdapter`, nạp signing key | `/oauth2/*` (auth, token, revocation, jwks, end_session), `/oauth2/.well-known/openid-configuration` |
| `interaction/` | Nhận login từ SPA, xác thực mật khẩu/IdP, gọi `interactionFinished` | `/oauth2/interaction/:uid/*` |
| `bff/` | Khởi tạo login, nhận callback, lưu token đã mã hoá, cấp và huỷ cookie, refresh | `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`, `/api/auth/me` |
| `setup/` | Trạng thái setup, wizard, seed từ env, force reset | `/api/auth/setup` |
| `users/` | CRUD user, reset mật khẩu, đổi mật khẩu | `/api/admin/users/*`, `/api/auth/password` |
| `idp/` | `IdentityProvider` interface, `OidcIdentityProvider` | `/oauth2/interaction/:uid/idp/:provider`, `/oauth2/idp/:provider/callback` |
| `guard/` | `AuthGuard` toàn cục cho `/api/**`, decorator `@CurrentUser()`, kiểm tra Origin | — |
| `settings/` | `AuthSettingsProvider`, `ConfigAuthSettingsProvider` | — |
| `security/` | Băm mật khẩu, chính sách mật khẩu, mã hoá token, `RateLimiter` | — |
| `audit/` | Ghi `auth_audit_events` | — |

**Ranh giới:** chỉ `bff/` và `guard/` biết đến cookie. Chỉ `provider/` và `interaction/` biết đến `oidc-provider`. `users/` và `setup/` dùng chung một `UserService` (tạo user, gán role, đặt mật khẩu, huỷ session).

Route ngoài `AuthGuard`: `/oauth2/**`, `/api/auth/login`, `/api/auth/callback`, `GET|POST /api/auth/setup`, `GET /api/auth/me` (tự trả 401/`setup_required`).

## 4. Dữ liệu (core migrations)

Mọi bảng tạo trong migration `oauth2_0001_init`.

```
auth_users
  id               uuid pk
  email            text not null      -- unique index trên lower(email)
  name             text not null
  password_hash    text null          -- null: user chỉ đăng nhập qua IdP
  status           text not null default 'active'   -- 'active' | 'disabled'
  last_login_at    timestamptz null
  created_at, updated_at timestamptz not null

auth_roles
  id uuid pk, key text unique not null, name text not null
  -- seed: ('super_admin', 'Super Admin')

auth_user_roles
  user_id uuid fk → auth_users on delete cascade
  role_id uuid fk → auth_roles
  pk (user_id, role_id)
  -- v0.2 thêm cột scope

auth_user_identities
  id uuid pk
  user_id uuid fk → auth_users on delete cascade
  provider text not null, subject text not null, email text null
  created_at timestamptz not null
  unique (provider, subject)

auth_oauth_clients
  client_id text pk, metadata jsonb not null, created_at, updated_at
  -- 'opencms-admin' được upsert mỗi lần boot

auth_oidc_payloads              -- kho của KyselyAdapter
  kind text, id text, pk (kind, id)
  payload jsonb not null
  grant_id text null, uid text null, user_code text null
  expires_at timestamptz null, consumed_at timestamptz null
  index (kind, grant_id), index (grant_id), index (kind, (payload->>'accountId')), index (kind, uid), index (expires_at)

auth_sessions                   -- session BFF
  id_hash text pk               -- sha256 của giá trị cookie
  user_id uuid fk → auth_users on delete cascade
  access_token_enc text, refresh_token_enc text, id_token_enc text
  access_expires_at timestamptz
  idle_expires_at timestamptz, absolute_expires_at timestamptz
  created_at, last_seen_at timestamptz
  ip text, user_agent text

auth_signing_keys
  kid text pk, jwk_private_enc text not null, alg text not null
  created_at timestamptz, retired_at timestamptz null

auth_audit_events
  id uuid pk, at timestamptz not null, type text not null
  user_id uuid null, actor_id uuid null
  ip text null, user_agent text null, meta jsonb not null default '{}'
  index (at), index (user_id, at)
```

- Các cột `*_enc` được mã hoá AES-256-GCM. Khoá được dẫn xuất từ `OPENCMS_SECRET` bằng HKDF, mỗi mục đích (token, key, cookie) một khoá con.
- Dọn dẹp: mỗi lần boot và định kỳ mỗi giờ, xoá các dòng `auth_oidc_payloads` và `auth_sessions` đã hết hạn.

## 5. Cấu hình

`opencms.config.ts` → `auth`. Env có thể ghi đè các giá trị tương ứng.

| Khoá | Mặc định | Env |
|---|---|---|
| `publicUrl` | Dev: `http://localhost:${PORT ?? 4000}`. Production (`NODE_ENV=production`): bắt buộc, thiếu thì từ chối khởi động | `OPENCMS_PUBLIC_URL` |
| — | — (bắt buộc) | `OPENCMS_SECRET` (≥ 32 byte) |
| `ttl.accessToken` | 900 s | `OPENCMS_AUTH_TTL_ACCESS` |
| `ttl.refreshToken` | 30 ngày | `OPENCMS_AUTH_TTL_REFRESH` |
| `ttl.sessionIdle` | 7 ngày | `OPENCMS_AUTH_TTL_SESSION_IDLE` |
| `ttl.sessionAbsolute` | 30 ngày | `OPENCMS_AUTH_TTL_SESSION_ABSOLUTE` |
| `ttl.authorizationCode` | 60 s | — |
| `ttl.interaction` | 10 phút | — |
| `password.minLength` | 12 | — |
| `rateLimit.login` | 5 lần / 15 phút theo email; 20 lần / 15 phút theo IP | — |
| `idp.oidc` | không bật | `OPENCMS_IDP_OIDC_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_LABEL` |
| — | — | `OPENCMS_ADMIN_EMAIL`, `OPENCMS_ADMIN_PASSWORD`, `OPENCMS_ADMIN_NAME`, `OPENCMS_ADMIN_FORCE_RESET` |

- Không có `internalUrl` / `OPENCMS_INTERNAL_URL`: BFF luôn gọi provider ở `http://127.0.0.1:${PORT ?? 4000}` (kèm `X-Forwarded-Proto/Host` của URL công khai), nên không cần cấu hình thêm sau reverse proxy TLS.
- Refresh token **không dài hơn** session tuyệt đối. Nếu cấu hình như vậy, server dùng giá trị nhỏ hơn và log cảnh báo.
- `AuthSettingsProvider.getTtls()` được gọi ở mỗi lần dùng. TTL của `oidc-provider` được khai báo dạng hàm gọi vào provider này.
- Phase sau sẽ thêm `DbAuthSettingsProvider`, dùng config làm mặc định.

## 6. Luồng

### 6.1 Khởi động
1. Kiểm tra migration (cơ chế hiện có). Kiểm tra có `OPENCMS_SECRET`, và `OPENCMS_PUBLIC_URL` khi `NODE_ENV=production`; thiếu thì từ chối khởi động.
2. Nếu chưa có signing key active thì sinh ES256, mã hoá rồi lưu vào `auth_signing_keys`.
3. Upsert client `opencms-admin`. Đây là confidential client, secret được dẫn xuất từ `OPENCMS_SECRET`. Thông số: `redirect_uris = [publicUrl + /api/auth/callback]`, `post_logout_redirect_uris = [publicUrl + /admin/login]`, grants `authorization_code` và `refresh_token`, bắt buộc PKCE.
4. **Force reset:** nếu `OPENCMS_ADMIN_FORCE_RESET=true` và có email + mật khẩu env:
   - User tồn tại: đặt lại mật khẩu, set `active`, đảm bảo có role `super_admin`, huỷ mọi session và grant của user đó.
   - User không tồn tại: từ chối khởi động.
   - Ghi audit `admin_force_reset` và log cảnh báo nhắc gỡ biến.
5. **Seed:** nếu có email + mật khẩu env và `auth_users` trống:
   - Tạo user với role `super_admin` và ghi audit `admin_seeded_from_env`.
   - Mật khẩu vi phạm chính sách thì từ chối khởi động.
   - Nếu đã có user, bỏ qua env và log info.
6. Nếu `auth_users` vẫn trống, log mức WARN ở mỗi lần boot:
   `Chưa có tài khoản admin. Mở <publicUrl>/admin/setup để tạo. Bất kỳ ai truy cập được URL này trước sẽ trở thành admin.`

Bước 4 và 5 chạy trong transaction có `pg_advisory_xact_lock(<hằng số auth_setup>)`.

### 6.2 Setup wizard
- `GET /api/auth/setup` → `{ required: boolean }`.
- `POST /api/auth/setup` với body `{ email, name, password }`:
  1. Kiểm tra Origin và rate limit theo IP.
  2. Validate input và chính sách mật khẩu → lỗi `422 weak_password` hoặc `422 validation_failed`.
  3. Mở transaction, lấy advisory lock, kiểm tra lại `auth_users` còn trống. Nếu không còn trống → `409 setup_already_completed`.
  4. Tạo user với role `super_admin`, ghi audit `setup_completed`, trả `201`.
- Sau khi tạo xong, SPA chuyển đến `/api/auth/login?login_hint=<email>`. Không có lối tắt tự đăng nhập.
- Khi `required=true`, SPA đưa mọi route `/admin/*` về `/admin/setup`. Các route `/api/**` có guard trả `409 setup_required`.

### 6.3 Đăng nhập bằng mật khẩu
1. SPA gọi `GET /api/auth/me`. Nhận `401` thì điều hướng toàn trang đến `/api/auth/login?returnTo=<path>`.
2. BFF:
   - Kiểm tra `returnTo`: chỉ chấp nhận đường dẫn tương đối bắt đầu bằng `/admin`, không có `//` và không có scheme. Sai thì dùng `/admin`.
   - Sinh `state`, `nonce` và PKCE verifier, lưu vào cookie `oc_login` (đã mã hoá, httpOnly, SameSite=Lax, Path=/api/auth, 10 phút).
   - Chuyển hướng 302 đến `/oauth2/auth?...&code_challenge_method=S256&prompt=login[&login_hint]`. `prompt=login` luôn được gửi: session phía provider không bao giờ tự đăng nhập lại một trình duyệt đã đăng xuất hoặc hết hạn session BFF (xem §6.6).
3. Provider tạo interaction và chuyển hướng 302 đến `/admin/login?uid=<uid>`.
4. SPA gọi `GET /oauth2/interaction/:uid` để lấy `{ loginHint, idps: [{ id, label }] }`, rồi hiện form.
5. `POST /oauth2/interaction/:uid/login` với `{ email, password }`:
   - Rate limit theo email và IP → `429 rate_limited`.
   - Tìm user. Nếu không có, vẫn chạy một lần verify giả để thời gian phản hồi đồng đều. Sai thông tin → `401 invalid_credentials`.
   - Mật khẩu đúng nhưng user `disabled` → `403 account_disabled`.
   - Thành công: `interactionFinished` với `accountId` và tự cấp grant (scope `openid profile email offline_access`) cho client first-party. Trả `{ redirectTo }` cho SPA điều hướng tiếp.
   - Mọi kết quả đều ghi audit `login_succeeded` hoặc `login_failed`.
6. Provider chuyển hướng 302 đến `/api/auth/callback?code&state`. BFF:
   - Kiểm tra `state` với cookie `oc_login`.
   - Đổi code lấy token bằng `openid-client` (`code_verifier`, xác thực client bằng `client_secret_basic`) và kiểm tra `nonce`.
   - Tạo `auth_sessions`, set cookie `oc_session` (giá trị ngẫu nhiên 32 byte; httpOnly; SameSite=Lax; Path=/; Secure khi `publicUrl` là https).
   - Xoá `oc_login`, cập nhật `last_login_at`, chuyển hướng 302 đến `returnTo`.
   - Có lỗi thì chuyển hướng 302 đến `/admin/login?error=<code>`.

### 6.4 Đăng nhập qua IdP ngoài
Bước 1–4 giống §6.3. Nút SSO chỉ hiện khi `idp.oidc` đã cấu hình.

1. `GET /oauth2/interaction/:uid/idp/oidc`: `OidcIdentityProvider` tạo `state`, `nonce` và PKCE, lưu cùng `uid` vào cookie `oc_idp`, rồi chuyển hướng 302 đến IdP.
2. `GET /oauth2/idp/oidc/callback` (URI cố định để đăng ký ở IdP, không dùng wildcard): lấy `uid` từ `oc_idp`, kiểm tra `state` và đổi code. Kết quả trả về: `{ provider: 'oidc', subject, email, emailVerified }`.
3. Liên kết theo `IdentityLinker`:
   - Đã có dòng `(provider, subject)` → dùng user đó.
   - Chưa có liên kết:
     - `emailVerified` phải là true; nếu không → `idp_email_unverified`.
     - Phải có user khớp `lower(email)`; nếu không → `idp_account_not_found`.
     - Khớp thì tạo liên kết và ghi audit `idp_linked`.
   - User `disabled` → `account_disabled`.
4. `interactionFinished`, sau đó tiếp tục như bước 6 của §6.3. Lỗi thì chuyển hướng 302 đến `/admin/login?error=<code>`.

Interface:
```ts
interface IdentityProvider {
  id: string; label: string;
  start(ctx: { uid: string; returnUrl: string }): Promise<{ redirectUrl: string; cookie: SealedState }>;
  finish(ctx: { uid: string; query: URLSearchParams; cookie: SealedState }): Promise<ExternalIdentity>;
}
type ExternalIdentity = { provider: string; subject: string; email?: string; emailVerified: boolean };
```

### 6.5 Request vào `/api`
`AuthGuard`:
1. Request không phải GET/HEAD/OPTIONS: `Origin` phải đúng bằng origin của `publicUrl`. Sai → `403 origin_mismatch`.
2. Đọc `oc_session`, tra `auth_sessions` theo `sha256`.
   - Không có, hết `idle_expires_at` hoặc hết `absolute_expires_at` → `401 unauthenticated` và xoá cookie.
3. Nạp user. Nếu không `active` → huỷ session, trả `401`.
4. Nếu `access_expires_at - now < 60s`: refresh qua `openid-client`.
   - Ghi token mới vào session. Refresh token xoay vòng, token cũ bị consume.
   - Refresh thất bại → huỷ session, trả `401`.
   - Refresh được tuần tự hoá theo session bằng `SELECT … FOR UPDATE` để hai request song song không cùng dùng một refresh token.
5. Cập nhật `last_seen_at`, rồi gia hạn `idle_expires_at` nhưng không vượt `absolute_expires_at`. Việc cập nhật tối đa một lần mỗi phút.
6. Gắn `request.user = { id, email, name, roles }`.

`GET /api/auth/me` → `200 { id, email, name, roles }`, hoặc `401 unauthenticated`, hoặc `409 setup_required`.

### 6.6 Đăng xuất và thu hồi
- `POST /api/auth/logout`:
  - Thu hồi refresh token tại `/oauth2/token/revocation`, xoá session, xoá cookie, ghi audit `logout`.
  - Kết thúc session phía provider ngay trên server: xoá mọi dòng `Session` của user trong `auth_oidc_payloads` (`payload->>'accountId'` = user id).
  - Trả `{ redirectTo: '/admin/login' }`. Không có bước chuyển qua end_session của provider: bước đó cần `id_token_hint` trong URL mà trình duyệt nhìn thấy, trái với §7 (không response nào trả token cho trình duyệt), và phụ thuộc vào việc trình duyệt đi theo redirect.
- Khi `AuthGuard` huỷ session BFF vì hết `idle_expires_at`/`absolute_expires_at` hoặc vì user không còn `active` (§6.5 bước 2–3), các `Session` phía provider của user cũng bị xoá như trên. Cùng với `prompt=login` (§6.3 bước 2), lần `GET /api/auth/login` tiếp theo luôn chạy interaction đăng nhập.
- Hàm `UserService.revokeAll(userId, { exceptSessionId? })` xoá các dòng `auth_sessions` và gọi `provider.Grant` destroy cho các grant của user (kèm code/token cấp theo grant và các `Session` phía provider). Khi có `exceptSessionId`, grant của session đó (tra từ refresh token đang lưu) được giữ lại để session hiện tại vẫn refresh được. Hàm được dùng khi:
  - Admin vô hiệu hoá user hoặc reset mật khẩu → huỷ tất cả.
  - User tự đổi mật khẩu → giữ session hiện tại.
  - Force reset từ env → huỷ tất cả.

### 6.7 Quản lý user
Mọi endpoint cần role `super_admin`.

| Endpoint | Ghi chú |
|---|---|
| `GET /api/admin/users` | `{ data: [...] }`, mỗi phần tử: `id, email, name, status, roles, lastLoginAt, identities` (camelCase và bọc `data`, theo quy ước API của `@opencms/core`) |
| `POST /api/admin/users` | `{ email, name, password? }`. Không có password nghĩa là user chỉ đăng nhập qua IdP. Email trùng → `409 email_taken`. Audit `user_created` |
| `PATCH /api/admin/users/:id` | `{ name?, status? }`. Vô hiệu hoá super_admin active cuối cùng → `409 last_super_admin`. Vô hiệu hoá thì gọi `revokeAll`. Audit `user_disabled` / `user_enabled` |
| `POST /api/admin/users/:id/password` | `{ password }`. Gọi `revokeAll`. Audit `password_reset_by_admin` |
| `DELETE /api/admin/users/:id` | Chặn super_admin active cuối cùng và chặn tự xoá chính mình. Audit `user_deleted` |
| `DELETE /api/admin/users/:id/identities/:identityId` | Gỡ liên kết IdP |
| `POST /api/auth/password` | Người dùng hiện tại gửi `{ currentPassword, newPassword }`. Sau đó gọi `revokeAll(except current)`. Audit `password_changed` |

Kiểm tra "super_admin active cuối cùng" chạy trong cùng transaction với advisory lock `auth_setup`.

## 7. Bảo mật

- **Mật khẩu:** argon2id với tham số mặc định của thư viện `argon2`. Độ dài từ `minLength` đến 256 ký tự. Không được trùng email (so sánh không phân biệt hoa thường). Không có quy tắc bắt buộc loại ký tự (theo NIST 800-63B).
- **Cookie:**
  - `oc_session` và `oc_login`/`oc_idp`: httpOnly, SameSite=Lax, Secure khi chạy https.
  - Cookie interaction của `oidc-provider` được ký bằng khoá dẫn xuất từ `OPENCMS_SECRET`.
- **CSRF:** SameSite=Lax kết hợp kiểm tra `Origin` trên request ghi. Các endpoint POST của interaction cũng kiểm tra `Origin`.
- **Rate limit:** interface `RateLimiter`, mặc định lưu in-memory. Áp cho login, setup và đổi mật khẩu.
- **Không lộ token:** không response nào trả access/refresh/id token ra trình duyệt. Log không bao giờ chứa mật khẩu, token hay giá trị cookie.
- **Signing key:** ES256, mã hoá khi lưu. Có cột `retired_at` để xoay khoá ở phase sau; phase này chưa tự động xoay.
- **Header:** `/admin` và `/oauth2/interaction` trả `Cache-Control: no-store` cho response chứa trạng thái auth.

## 8. Lỗi

Định dạng chung cho `/api/**`: `{ "error": { "code": string, "message": string, "issues"?: unknown[] } }`. `issues` chỉ có khi lỗi mang chi tiết theo từng mục (ví dụ schema không hợp lệ ở Content Type Builder).

| code | HTTP | Khi nào |
|---|---|---|
| `unauthenticated` | 401 | Không có hoặc hết session, refresh thất bại (kèm xoá cookie) |
| `setup_required` | 409 | Gọi API được bảo vệ khi `auth_users` trống |
| `setup_already_completed` | 409 | `POST /api/auth/setup` khi đã có user |
| `invalid_credentials` | 401 | Sai email hoặc mật khẩu (thông báo chung chung) |
| `account_disabled` | 403 | Thông tin đúng nhưng user bị vô hiệu hoá |
| `forbidden` | 403 | Thiếu role |
| `origin_mismatch` | 403 | `Origin` sai trên request ghi |
| `validation_failed` | 422 | Input không hợp lệ |
| `weak_password` | 422 | Vi phạm chính sách mật khẩu |
| `email_taken` | 409 | Email đã tồn tại |
| `last_super_admin` | 409 | Vô hiệu hoá hoặc xoá super_admin active cuối cùng |
| `rate_limited` | 429 | Kèm `Retry-After` |

Lỗi trong chuỗi redirect (lỗi OAuth từ provider, `state` sai, `idp_account_not_found`, `idp_email_unverified`, `account_disabled`, `login_expired` khi interaction hết hạn) đều chuyển hướng 302 đến `/admin/login?error=<code>`. SPA ánh xạ code sang thông báo. Không bao giờ trả stack trace.

## 9. Rủi ro đã chấp nhận và giới hạn

1. **Wizard setup không có token** (quyết định D4 của owner). Khi `auth_users` trống, ai truy cập được `/admin/setup` trước sẽ trở thành super_admin. Biện pháp giảm nhẹ duy nhất: cảnh báo WARN ở mỗi lần boot. Khuyến nghị cho deploy production: seed qua env.
2. **Rate limiter in-memory** chỉ đúng khi chạy một instance. Chạy nhiều instance thì cần adapter Postgres hoặc Redis.
3. Không có quên mật khẩu qua email. Cách khôi phục: admin khác reset, hoặc `OPENCMS_ADMIN_FORCE_RESET`.
4. Chưa tự động xoay signing key.
5. Giả định của mô hình BFF: admin và API luôn cùng origin (phụ thuộc vào spec admin nhúng).

## 10. Kiểm thử

**Unit**
- Chính sách mật khẩu.
- Kiểm tra `returnTo`.
- `IdentityLinker`: liên kết sẵn có, khớp email, chưa xác minh email, không tìm thấy, user disabled.
- `ConfigAuthSettingsProvider`: env ghi đè config, chặn refresh dài hơn session tuyệt đối.
- Mã hoá/giải mã token.

**Integration** (Postgres thật, database tạm qua `TEST_DATABASE_URL`)
- Migration `oauth2_0001_init` chạy trong stream core; `down()` hoạt động.
- Hai `POST /api/auth/setup` đồng thời → đúng một `201` và một `409`.
- Seed từ env chạy lặp lại vẫn idempotent; force reset huỷ session; force reset với email không tồn tại → từ chối khởi động.
- Chặn `last_super_admin` khi vô hiệu hoá và khi xoá đồng thời.
- Hợp đồng `KyselyAdapter`: upsert, find, findByUid, consume, destroy, revokeByGrantId, hết hạn.

**E2E** (server thật, TTL ngắn)
- Chuỗi đầy đủ: setup → login mật khẩu → callback → `me` → tự refresh khi access token hết hạn → logout.
- User bị vô hiệu hoá nhận `401` ngay ở request kế tiếp.
- Dùng lại refresh token cũ thì grant bị thu hồi.
- Hai request song song lúc cần refresh → chỉ refresh một lần, cả hai đều thành công.
- IdP với mock OIDC server: liên kết theo email; `email_verified=false` bị từ chối; email lạ bị từ chối.
- Request ghi với `Origin` sai → `403`.
- Cookie có đủ cờ; không response nào chứa token.
- `returnTo=//evil.com` và `returnTo=https://evil.com` bị thay bằng `/admin`.

## 11. Hướng mở rộng (không làm ở phase này)
- `DbAuthSettingsProvider` và màn cấu hình TTL trên UI.
- Thêm client và grant: Device Code cho CLI, Client Credentials cho integration (bảng `auth_oauth_clients` đã có).
- Scoped RBAC v0.2 trên `auth_user_roles`.
- Nhiều IdP, mapping nhóm từ IdP sang role.
- Mailer, quên mật khẩu, MFA, màn xem audit.
