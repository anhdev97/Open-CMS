# opencms: Realm roles (Keycloak-lite) + storefront init — Design Spec

**Ngày:** 2026-10-16 · **Trạng thái:** Approved  
**Cách tiếp cận:** Approach 1 — mở rộng package hiện có; **không** tạo package mới `@opencms/storefront`  
**Phụ thuộc:**  
- `docs/superpowers/specs/2026-10-14-auth-oauth2-design.md` (`@opencms/oauth2`)  
- `docs/superpowers/specs/2026-10-15-embedded-admin-init-design.md` (admin nhúng + `opencms init`)

Sprint này làm **cả hai track** trong cùng một đợt thiết kế/triển khai: (A) quản lý realm roles, (B) scaffold storefront Next.js trong `opencms init` kèm reverse-proxy Nest → Next.

## 1. Mục tiêu và phạm vi

### Mục tiêu
- Admin có thể **CRUD realm roles** và **gán/gỡ role cho user** trong cùng origin `/admin`, với toàn bộ domain logic nằm trong `@opencms/oauth2`.
- `opencms init` tạo project vừa có **backend Nest + `@opencms/core`** (`src/`) vừa có **storefront Next.js App Router** (`app/`), chạy **một origin**: `/` = storefront, `/admin` = admin (không đổi).
- Nest reverse-proxy tới **Next runtime thật** (SSR), không phục vụ static-only thay Next.

### Trong phạm vi

**Track A — Roles (Keycloak-lite)**
- Realm roles: tạo / đọc / cập nhật / xoá; gán / gỡ user ↔ role.
- Seed **chỉ** `super_admin` với `is_system = true`. Không seed `editor` / `viewer` / role khác.
- Bảo vệ role hệ thống: không xoá, không đổi `name` của role có `is_system`.
- Xoá role còn user → `409` kèm số user (không cascade).
- Tên trùng → `409`. Caller không có `super_admin` → `403` trên mọi API role.
- Sau assign/unassign: **làm mới danh sách roles trong session** đang hoạt động của user đó (ưu tiên hơn bắt đăng nhập lại).
- Admin UI mỏng: trang `/admin/roles` và multi-select role trên form user; chỉ gọi API oauth2 — **không** nhúng business logic role vào `@opencms/core`.
- Giữ decorator `@RequireRole` theo **tên role** (chuỗi `name`).

**Track B — Storefront init**
- `opencms init` scaffold `app/` (Next.js App Router) + `src/` (Nest + `@opencms/core`).
- Homepage hybrid: template tĩnh mặc định + helper sẵn `lib/cms.ts` gọi content API (trang mặc định **không bắt buộc** gọi helper).
- Nest reverse-proxy → Next SSR; một origin.
- Proxy loại trừ `/admin`, `/api`, và các path oauth (`/oauth2`, …).
- Cấu hình `storefront.enabled` + target (port/URL). `enabled=false` → không đăng ký proxy. Next down → `502` kèm thông báo rõ.
- Scripts: `dev` chạy Nest + Next; `prod`/`start` chạy Nest + `next start`.

### Ngoài phạm vi
- Page builder / visual editor cho storefront.
- Homepage **bắt buộc** lấy nội dung từ CMS (trang mặc định được phép tĩnh).
- Keycloak B/C: groups, composite roles, client scopes, Authorization Services (policies/permissions/resources).
- Storefront chỉ do Nest phục vụ file tĩnh (không có Next runtime).
- Role-based content permissions / scoped RBAC trên content types (vẫn là hướng mở rộng sau).
- Device Code, Client Credentials, MFA, quên mật khẩu — giữ nguyên ngoài phạm vi spec auth gốc.

---

## 2. Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| R1 | Toàn bộ domain roles nằm trong `@opencms/oauth2` | Một nguồn sự thật với `auth_roles` / `auth_user_roles`; core/admin chỉ là client HTTP |
| R2 | Chỉ seed `super_admin` (`is_system`); không seed editor/viewer | Admin tự tạo role cần thiết; tránh khoá model RBAC sớm |
| R3 | Xoá role còn assignee → `409` + `userCount`, không cascade | Tránh mất quyền thầm lặng; admin phải gỡ user trước |
| R4 | Assign/unassign làm mới roles trên session BFF, không bắt re-login | UX admin; session đã có `user_id` — đọc lại join `auth_user_roles` là đủ |
| R5 | Admin UI chỉ gọi API; không có `RoleService` trong `@opencms/core` | Ranh giới package rõ; core không nhân bản rule |
| R6 | Giữ `@RequireRole('…')` theo **name** (string) | Không đổi contract controller hiện có (`super_admin`) |
| S1 | Approach 1: mở rộng CLI template + middleware/proxy trong `@opencms/core` — **không** tạo `@opencms/storefront` | Ít package, init đã là điểm scaffold; proxy là trách nhiệm server Nest của project |
| S2 | Nest reverse-proxy tới Next thật (dev: `next dev`, prod: `next start`) | SSR/RSC đúng; một origin; SEO thuộc storefront |
| S3 | URL cố định: `/` storefront, `/admin` admin, `/api` + `/oauth2` backend | Khớp spec admin nhúng; người dùng không cấu hình nhiều path |
| S4 | Homepage hybrid (static + `lib/cms.ts` sẵn) | Chạy được ngay sau init; đường dẫn lấy content có sẵn khi cần |

---

## 3. Track A — Realm roles

### 3.1 Mô hình dữ liệu

Migration core stream mới trong `@opencms/oauth2`: `oauth2_0002_roles`.

Bảng `auth_roles` hiện có (`oauth2_0001`): `id`, `key` (unique), `name` (display). Sprint này chuẩn hoá theo Keycloak-lite **name = định danh**:

| Cột sau migration | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid pk | Giữ |
| `name` | text unique not null | Định danh dùng trong `@RequireRole` và API (= cột `key` cũ) |
| `description` | text not null default `''` | CRUD |
| `is_system` | boolean not null default `false` | `true` ⇒ không xoá, không đổi `name` |
| `created_at` | timestamptz not null | Backfill `now()` |
| `updated_at` | timestamptz not null | Backfill `now()` |

Thứ tự `oauth2_0002_roles` (tránh đụng tên cột `name`):
1. `ADD` `description`, `is_system`, `created_at`, `updated_at`.
2. `UPDATE auth_roles SET description = name, is_system = true WHERE key = 'super_admin'` (cột `name` lúc này vẫn là display cũ, ví dụ `Super Admin`).
3. `DROP COLUMN name` (display cũ).
4. `RENAME COLUMN key TO name`.
5. Không `INSERT` role mới: không seed `editor` / `viewer` / role khác.

`auth_user_roles` không đổi schema (`user_id`, `role_id`, PK kép; `on delete restrict` trên role). Join dùng `auth_roles.name`.

`RequestUser.roles` và mọi chỗ trả `roles: string[]` tiếp tục là **danh sách `name`**, không phải uuid.

### 3.2 Quy tắc nghiệp vụ

| Hành động | Rule |
|---|---|
| Create | Body `{ name, description? }`. `name`: trim, non-empty, max 64, pattern `^[a-z][a-z0-9_]*$` (snake_case ASCII). Trùng `name` (unique) → `409 role_name_taken`. `is_system` luôn `false` khi tạo qua API |
| Update | Body `{ name?, description? }`. Role `is_system`: **cấm** đổi `name` → `403 system_role_immutable`. Được phép cập nhật `description` của system role |
| Delete | `is_system` → `403 system_role_immutable`. Còn ≥1 dòng `auth_user_roles` → `409 role_in_use` kèm `userCount`. Không cascade |
| List / Get | Mọi `super_admin` đọc được toàn bộ role |
| Assign | Gắn theo `roleId` (uuid) qua `POST …/roles/:roleId` hoặc `PUT …/roles` với `roleIds`. Idempotent nếu đã có. User/role không tồn tại → `404` |
| Unassign | Gỡ cặp theo `roleId`. Gỡ `super_admin` khỏi user active cuối cùng mang role đó → `409 last_super_admin` (cùng invariant spec auth §6.7) |
| Authz | Mọi endpoint §3.3 yêu cầu `@RequireRole('super_admin')`. Thiếu → `403 forbidden` |

Không có: groups, composite roles, client scopes, Authorization Services.

### 3.3 API (`@opencms/oauth2`)

Prefix `/api/admin/roles` và gắn role trên user. Định dạng lỗi giữ `{ error: { code, message, issues? } }` (spec auth §8 + admin-init §4.4). Response list bọc `{ data: [...] }`, camelCase.

| Method | Path | Body / ghi chú | Success |
|---|---|---|---|
| `GET` | `/api/admin/roles` | — | `200 { data: Role[] }` |
| `GET` | `/api/admin/roles/:id` | uuid | `200` Role; không thấy → `404` |
| `POST` | `/api/admin/roles` | `{ name, description? }` | `201` Role |
| `PATCH` | `/api/admin/roles/:id` | `{ name?, description? }` | `200` Role |
| `DELETE` | `/api/admin/roles/:id` | — | `204`; khi `409 role_in_use`: `{ error: { code: 'role_in_use', message: string, userCount: number } }` |
| `GET` | `/api/admin/users/:id/roles` | — | `200 { data: Role[] }` |
| `PUT` | `/api/admin/users/:id/roles` | `{ roleIds: string[] }` **replace** toàn bộ (giữ invariant last super_admin). Thao tác chính từ multi-select UI | `200 { data: Role[] }` |
| `POST` | `/api/admin/users/:id/roles/:roleId` | Gán từng role | `204` idempotent |
| `DELETE` | `/api/admin/users/:id/roles/:roleId` | Gỡ từng role | `204`; `409 last_super_admin` nếu vi phạm |

`Role` JSON:
```ts
{
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string; // ISO
  updatedAt: string;
}
```

`GET /api/admin/users` (đã có) tiếp tục trả `roles: string[]` (names). Không bắt buộc đổi shape list user trong sprint này.

Mã lỗi mới (bổ sung bảng §8 auth):

| code | HTTP | Khi nào |
|---|---|---|
| `role_name_taken` | 409 | Trùng `name` |
| `role_in_use` | 409 | Xoá khi còn user; kèm `userCount` |
| `system_role_immutable` | 403 | Xoá hoặc rename role `is_system` |
| `forbidden` | 403 | Không phải `super_admin` (đã có) |
| `last_super_admin` | 409 | Gỡ/đổi set roles làm mất super_admin active cuối (đã có) |
| `not_found` | 404 | Role/user không tồn tại (đã có) |
| `validation_failed` | 422 | `name` sai pattern / rỗng (đã có) |

### 3.4 Làm mới roles trong session (R4)

Khi assign / unassign / `PUT …/roles` thành công cho `userId`:
1. Cập nhật `auth_user_roles` trong transaction (kèm check `last_super_admin` nếu đụng `super_admin`).
2. Roles trên session được coi là đã refresh vì `AuthGuard` **không cache** roles trên `auth_sessions`: mỗi request được bảo vệ join lại `auth_user_roles` → `auth_roles.name` khi gắn `request.user` (và khi phục vụ `GET /api/auth/me`). Không đụng token OIDC; không bắt re-login; không revoke session chỉ vì đổi role.
3. Vẫn revoke session khi disable user / đổi mật khẩu / force reset — giữ nguyên spec auth.

### 3.5 Package layout (`@opencms/oauth2`)

```
packages/oauth2/src/
  roles/
    roles.controller.ts      # /api/admin/roles
    user-roles.controller.ts # /api/admin/users/:id/roles*
    role.service.ts          # CRUD + assign + invariants
  db/migrations/oauth2_0002_roles.ts
  guard/                     # RequireRole giữ nguyên contract theo name
```

`OAuth2Module` đăng ký controllers mới. Export công khai (nếu chưa): `RequireRole`, types `Role` nếu admin cần — admin dùng fetch JSON, không import service.

### 3.6 Admin UI (mỏng, trong `@opencms/core` admin SPA)

| UI | Hành vi |
|---|---|
| Route `/roles` (basename `/admin` ⇒ URL `/admin/roles`) | Bảng roles: name, description, badge System. Dialog tạo/sửa. Xoá có `AlertDialog`; hiện lỗi `role_in_use` kèm số user. Ẩn/disable xoá + khoá field name khi `isSystem` |
| Users — multi-select roles | Form tạo/sửa user: multi-select từ `GET /api/admin/roles`; submit qua `PUT /api/admin/users/:id/roles` (sau create user). Không tính toán `is_system` / last-super-admin phía client ngoài disable UX; server là nguồn quyết định |
| Sidebar | Thêm mục Roles (chỉ hiện khi user hiện tại có `super_admin` — cùng điều kiện Users) |

`lib/api.ts` + `i18n/en.ts` thêm chuỗi lỗi mới. **Không** thêm module Nest role trong core. Controllers content vẫn `@RequireRole('super_admin')` như hiện tại.

---

## 4. Track B — Storefront init + reverse proxy

### 4.1 Cấu trúc project sau `opencms init`

```
<project>/
  app/                      # Next.js App Router (storefront)
    layout.tsx
    page.tsx                # homepage hybrid (static default)
    lib/cms.ts              # helper sẵn gọi /api/content…
  src/                      # Nest + OpenCMS (như hiện tại)
    main.ts
    app.module.ts
    content-types/
    extensions/
    generated/
  opencms.config.ts
  next.config.ts
  package.json              # scripts §4.5
  …
```

- Giữ toàn bộ file Nest/admin/env mà spec 2026-10-15 §7 đã định; **bổ sung** `app/` + Next deps + cấu hình storefront.
- Không tạo package workspace `@opencms/storefront`. Helper `app/lib/cms.ts` là code template trong CLI (đúng “`lib/cms.ts`” trong phạm vi App Router), không publish riêng.

### 4.2 Homepage hybrid (S4)

- `app/page.tsx`: nội dung tĩnh chào mừng (brand/project name, link tới `/admin`, hướng dẫn ngắn). **Không** bắt buộc `fetch` CMS trên trang mặc định.
- `app/lib/cms.ts`: hàm sẵn, ví dụ `getEntries(apiId, opts?)` gọi cùng-origin `/api/content/:apiId` (public GET). Comment trong file chỉ cách dùng trên một page/route khác.
- Không page builder. Không khóa homepage vào một content type cụ thể.

### 4.3 Reverse proxy Nest → Next (S2, S3)

Đặt middleware/proxy trong **`@opencms/core`** (cùng chỗ `AdminSpaMiddleware`), đăng ký từ `OpenCmsModule` khi `storefront.enabled === true`.

| Hạng mục | Chi tiết |
|---|---|
| Target | `storefront.targetUrl` (mặc định `http://127.0.0.1:${storefront.port ?? 3000}`) |
| Enabled | `storefront.enabled` — mặc định **`true`** trong template init; project có thể tắt |
| Exclude (không proxy) | Mọi path bắt đầu bằng `/admin`, `/api`, `/oauth2` (và các path auth public đã cố định nếu có ngoài các prefix này — hiện login BFF nằm dưới `/api/auth`, đã cover bởi `/api`) |
| Proxy | Các method và path còn lại (gồm `/`, `/_next/*`, assets Next) → HTTP proxy tới target, giữ method/headers/body phù hợp. Dev: cố gắng proxy WebSocket cho HMR; nếu HMR qua proxy không ổn định, README template ghi rõ có thể mở `targetUrl` trực tiếp khi sửa UI storefront — không chặn ship proxy HTTP |
| Next down | Upstream connection error / ECONNREFUSED → **502** HTML/text ngắn: *"Storefront is unavailable (Next.js did not respond at \<target\>). Is \`next dev\` / \`next start\` running?"* |
| `enabled: false` | Không đăng ký proxy. Path không thuộc Nest/`/admin`/`/api`/`/oauth2` (gồm `/`) → **404** |

Thứ tự middleware (khái niệm): body parser / oauth / admin SPA / API routes xử lý trước; proxy storefront là **fallback** cho path không bị exclude và chưa được Nest handler nhận.

### 4.4 Cấu hình

`OpenCmsModuleOptions` / `opencms.config.ts` (qua options Nest của project template):

```ts
storefront?: {
  enabled?: boolean;     // default true trong template; false = tắt proxy
  port?: number;         // default 3000 — dùng khi không set targetUrl
  targetUrl?: string;    // default http://127.0.0.1:${port}
};
```

Env (optional overrides, document trong README template); env thắng file config:
- `OPENCMS_STOREFRONT_ENABLED=true|false`
- `OPENCMS_STOREFRONT_URL` — nếu set, dùng làm `targetUrl`
- `OPENCMS_STOREFRONT_PORT` — chỉ dùng khi không có `OPENCMS_STOREFRONT_URL`; dựng `http://127.0.0.1:${PORT}`

### 4.5 Scripts (`package.json` template)

| Script | Lệnh (ý) |
|---|---|
| `dev` | `opencms migrate:up` rồi `concurrently` chạy Nest (`tsx src/main.ts`) và Next (`next dev -p <storefront.port>`) |
| `build` | `tsc -p tsconfig.json` **và** `next build` |
| `start` | `opencms migrate:up` rồi `concurrently` chạy `node dist/src/main.js` và `next start -p <storefront.port>` (production: Nest + `next start`) |

Ports: Nest = `PORT` (mặc định 4000, public URL). Next = storefront port (3000) chỉ listen localhost; trình duyệt chỉ nói chuyện với Nest origin.

Log boot Nest (bổ sung): `OpenCMS ready at <publicUrl>/admin` và `Storefront proxied from <publicUrl>/ → <target>` khi enabled.

### 4.6 Dependencies template

Thêm vào project sinh bởi init (versions khớp ecosystem hiện tại / pin trong CLI):
- `next`, `react`, `react-dom` (+ types dev)
- `concurrently` (dev) cho script song song
- Giữ `@opencms/core`, Nest, … như §7 spec admin-init

`tsconfig`: Nest `include` chỉ `src` + `opencms.config.ts` (giữ như template hiện tại). Next dùng `tsconfig.json` riêng của App Router do `create-next-app`-style scaffold trong CLI (ví dụ `app/` + `next-env.d.ts`); không đưa `app/` vào `tsc` Nest.

### 4.7 Cập nhật smoke / example

- Smoke init (§8 admin-init): assert có `app/`, `app/page.tsx`, `app/lib/cms.ts` và scripts §4.5. Boot Next đầy đủ trong CI là tuỳ chọn; proxy exclude và 502 được cover bằng test Nest + upstream mock (§5.3).
- `examples/my-store`: cập nhật theo template mới trong cùng sprint implementation (không redesign nội dung cửa hàng mẫu).

---

## 5. Kiểm thử

### 5.1 `@opencms/oauth2` (bắt buộc)

**Integration / API**
- CRUD role: create → list → get → patch description → patch name → delete.
- System protect: không xoá `super_admin`; không rename `super_admin`; vẫn PATCH được `description`.
- Duplicate `name` → `409 role_name_taken`.
- Assign / `PUT` roles; unassign; idempotent assign.
- Delete role còn user → `409 role_in_use` + `userCount` đúng.
- Unassign/replace làm mất `super_admin` active cuối → `409 last_super_admin`.
- Caller không có `super_admin` (user chỉ mang role custom) → `403` trên mọi `/api/admin/roles*` và `/api/admin/users/:id/roles*`.
- Sau gán role: `GET /api/auth/me` (session user đó) phản ánh roles mới **không** cần login lại.

**Unit**
- Validate `name` pattern.
- Mapping migration `key` → `name`, seed `is_system`.

### 5.2 Init template smoke

- Sau `opencms init <tmp> …`: tồn tại `app/` (layout + page), `app/lib/cms.ts`, `src/main.ts`, `src/app.module.ts`.
- `package.json` có scripts `dev` / `build` / `start` gọi Nest và Next như §4.5.

### 5.3 Proxy exclude paths

- Với storefront enabled và upstream mock:
  - `/admin`, `/admin/…` **không** forward tới Next (vẫn SPA/503 admin như cũ).
  - `/api/…`, `/oauth2/…` **không** forward tới Next.
  - `/` và path khác (ví dụ `/_next/static/…` khi mock) **có** forward.
- `storefront.enabled: false` → không proxy; `/` → 404 (theo §4.3).
- Upstream down → 502 với message rõ (substring ổn định để assert).

---

## 6. Ranh giới package (Approach 1)

| Việc | Package |
|---|---|
| Schema roles, service, API, guard `@RequireRole` | `@opencms/oauth2` |
| Trang `/admin/roles`, multi-select user roles | `@opencms/core` / `admin/` (UI only) |
| Middleware reverse-proxy storefront | `@opencms/core` |
| Template `app/`, scripts, deps Next | `opencms-cli` (`packages/cli` init) |
| Package `@opencms/storefront` | **Không tạo** |

---

## 7. Rủi ro và giới hạn

1. **Đổi cột `auth_roles.key` → `name`:** migration một chiều trong stream core; project đã deploy `oauth2_0001` cần chạy `oauth2_0002` trước boot (cơ chế pending migration sẵn có).
2. **HMR Next qua proxy:** có thể kém hơn gọi thẳng `:3000`; chấp nhận; production không HMR.
3. **Hai process:** `dev`/`start` phụ thuộc process manager nhỏ (`concurrently`); chết một bên → 502 storefront hoặc API chết — message 502 giúp chẩn đoán.
4. **Custom roles chưa bảo vệ content API:** sprint chỉ có realm roles + `@RequireRole` theo name; gán quyền content chi tiết ngoài phạm vi.
5. **Homepage tĩnh:** đúng quyết định hybrid; khách hàng muốn CMS-driven home tự sửa `app/page.tsx` dùng `lib/cms.ts`.

---

## 8. Hướng mở rộng (không làm trong sprint)

- Seed/template role `editor` / `viewer` khi có mô hình permission ổn định.
- Groups, composite roles, scopes, Authorization Services.
- Page builder / CMS-driven homepage bắt buộc.
- Package `@opencms/storefront` tách nếu template phình to.
- Role gắn permission trên content type / entry.
- Playwright E2E cho `/admin/roles` (smoke HTTP đủ cho sprint này).
