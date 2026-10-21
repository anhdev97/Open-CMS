# opencms: Nhóm quyền, role và quy trình review — Design Spec (Spec B)

**Ngày:** 2026-10-21 · **Trạng thái:** Approved
**Nhánh nền:** `feat/admin-nextjs`, sau Spec A (`2026-10-21-settings-i18n-design.md`: Settings, i18n admin, nhóm content type).
**Thay đổi so với spec auth (`2026-10-14-auth-oauth2-design.md`):** bỏ mô hình "mọi user đều `super_admin`"; `@RequireRole` → `@RequirePermission`.

## 1. Mục tiêu và phạm vi

### Mục tiêu
- **Role** = quyền cụ thể do framework định nghĩa (danh mục cố định). **Nhóm quyền** = tập role, quản lý trong admin. User thuộc một hay nhiều nhóm; quyền = hợp role của các nhóm.
- Seed 3 nhóm: **Super Admin**, **Contenter**, **Reviewer**.
- Quy trình nội dung có trạng thái **In review** cho các content type bật `review: true`.

### Trong phạm vi
- Mô hình dữ liệu nhóm/role trong `@opencms/oauth2` (đổi tên bảng hiện có), seed, chuyển đổi user hiện có.
- `@RequirePermission`, `/api/auth/me` trả `groups` + `permissions`, API quản lý nhóm, gán nhóm cho user.
- Quy trình review: bảng `opencms_workflow`, API submit/withdraw/reject, luật publish theo `review`.
- Giao diện: Cài đặt → Nhóm quyền, nhóm trong trang Người dùng, nút theo quyền/trạng thái, trang "không có quyền", bộ lọc chờ duyệt.
- `review?: boolean` trong `ContentTypeDefinition` + công tắc trong Builder.

### Ngoài phạm vi
- Role theo từng content type (R2) — thiết kế không chặn việc thêm sau (role là chuỗi).
- Duyệt riêng từng ngôn ngữ; nhiều cấp duyệt; lịch publish.
- Thông báo (email/real-time) khi có mục chờ duyệt.
- Tên nhóm tự tạo đa ngôn ngữ (chỉ nhóm seed hiển thị tên đã dịch).

## 2. Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| B1 | Role theo chức năng, áp cho mọi content type | R1 |
| B2 | Nhóm lưu trong database, sửa được cả ở production | Nhóm/người dùng là dữ liệu chạy, không phải schema |
| B3 | User thuộc nhiều nhóm; quyền là hợp | Linh hoạt, không cần nhóm tổ hợp |
| B4 | Super Admin là nhóm `system`, luôn có mọi role (kể cả role thêm sau), không sửa/xoá | Không bao giờ khoá chính mình |
| B5 | Không gỡ được Super Admin cuối cùng | Như trên |
| B6 | Review theo cả document (mọi ngôn ngữ) | Đơn giản |
| B7 | In review: khoá với người gửi, người có `content.publish` vẫn sửa được | W1 |
| B8 | Type `review: false`: ai có `content.update` publish thẳng được; `review: true`: chỉ `content.publish` | V1 |
| B9 | Trạng thái review ở bảng riêng của core | Không phải đổi DDL từng content type |
| B10 | Quyền tính lại mỗi request | Sửa nhóm có hiệu lực ngay |

## 3. Mô hình dữ liệu (`@opencms/oauth2`)

### 3.1 Danh mục role (cố định trong code)

`export const PERMISSIONS = [...] as const; export type Permission = typeof PERMISSIONS[number];`

| Role | Cho phép |
|---|---|
| `content.read` | Xem danh sách/chi tiết entry (draft + published), versions |
| `content.create` | Tạo entry |
| `content.update` | Sửa draft; publish/unpublish thẳng type `review: false` |
| `content.delete` | Xoá entry |
| `content.submit` | Gửi duyệt / rút lại (type `review: true`) |
| `content.publish` | Duyệt & publish, từ chối, unpublish, sửa khi In review (mọi type) |
| `settings.users` | Quản lý người dùng |
| `settings.groups` | Quản lý nhóm quyền |
| `settings.content-types` | Content type + nhóm content type (vẫn chỉ ghi ở dev) |
| `settings.languages` | Ngôn ngữ website (vẫn chỉ ghi ở dev) |

Nhãn + mô tả mỗi role có trong bộ dịch 4 ngôn ngữ của admin (`permissions.<role>.label|description`).

### 3.2 Bảng (migration `oauth2_0002_groups`)
- Đổi tên `auth_roles` → `auth_groups`, `auth_user_roles` → `auth_user_groups` (cột `role_id` → `group_id`, đổi tên constraint/PK tương ứng).
- `auth_groups` thêm: `roles text[] NOT NULL DEFAULT '{}'`, `system boolean NOT NULL DEFAULT false`, `updated_at timestamptz`. `key` duy nhất, slug `^[a-z][a-z0-9-]{0,63}$`; `name text NOT NULL` (1–100 ký tự).
- Nhóm hiện có `key = 'super_admin'` → `key = 'super-admin'`, `system = true`, `roles = '{}'` (bỏ qua; Super Admin luôn được tính là mọi role).
- Seed `contenter` (name `Contenter`, roles `content.read, content.create, content.update, content.delete, content.submit`) và `reviewer` (name `Reviewer`, roles `content.read, content.update, content.publish`), `system = false`.
- User hiện có giữ liên kết với nhóm (sau đổi tên) — tức mọi user cũ là Super Admin.
- `down` đảo ngược (xoá 2 nhóm seed, đổi tên lại).

### 3.3 Luật
- Quyền hiệu lực của user = nếu thuộc nhóm `system` → toàn bộ `PERMISSIONS`; ngược lại hợp `roles` của các nhóm. User bị vô hiệu hoá → không có phiên (như hiện tại).
- Setup wizard và tạo admin từ env → thêm vào `super-admin`.
- **Super Admin cuối cùng:** thao tác làm số user đang hoạt động thuộc `super-admin` về 0 (gỡ nhóm, vô hiệu hoá, xoá user) → 409 `last_super_admin`. Thực hiện trong transaction với khoá (`SELECT … FOR UPDATE` trên các dòng liên quan) để hai request đồng thời không cùng lọt.
- `roles` chỉ nhận phần tử của `PERMISSIONS` (lạ → 422); lưu đã sắp xếp, không trùng.

## 4. Thực thi quyền

### 4.1 Guard
- `@RequirePermission(...perms: Permission[])` (cần **tất cả**), thay `@RequireRole`. Thiếu → 403 `{ error: { code: 'forbidden', message: 'Missing permission: <perm>' } }`. Chưa đăng nhập → 401 như hiện tại.
- Phiên (`SessionAuthService`) nạp nhóm + tính `permissions` mỗi request (một query join); `CurrentUser` có thêm `groups: { key, name }[]`, `permissions: Permission[]`, `isSuperAdmin: boolean`.
- `GET /api/auth/me` trả thêm `groups`, `permissions`.
- `/api/content/**` không đổi (công khai, chỉ published).

### 4.2 Ánh xạ API

| API | Quyền |
|---|---|
| `GET /api/admin/content/:apiId`, `GET …/:documentId`, versions | `content.read` |
| `POST /api/admin/content/:apiId` | `content.create` |
| `PUT …/:documentId` | `content.update`; nếu đang In review và không có `content.publish` → 409 `in_review_locked` |
| `DELETE …/:documentId` | `content.delete` |
| `POST …/publish`, `…/unpublish` | `review: true` → `content.publish`; `review: false` → `content.update` hoặc `content.publish` (kiểm tra trong service, vì phụ thuộc type) |
| `POST …/submit` | `content.submit`; type `review: true` và đang Draft, ngược lại 409 `invalid_transition` |
| `POST …/withdraw` | người đã gửi (`submitted_by`) hoặc có `content.publish`; đang In review, ngược lại 409 `invalid_transition` |
| `POST …/reject` body `{ note: string }` | `content.publish`; đang In review; `note` 1–1000 ký tự (422) |
| Schema builder, `/api/admin/content-groups` | `settings.content-types` |
| `/api/admin/locales` | `settings.languages` |
| `/api/admin/users/**` | `settings.users` |
| `/api/admin/groups/**` | `settings.groups` |
| `/api/admin/system/**` (system controller hiện có) | `settings.content-types` |

### 4.3 API nhóm (`/api/admin/groups`)
- `GET` → `[{ id, key, name, roles, system, userCount }]` (Super Admin trả `roles = PERMISSIONS`).
- `POST` `{ key, name, roles }` → 201; key trùng → 409 `group_key_taken`.
- `PATCH /:id` `{ name?, roles? }` → nhóm `system` → 409 `system_group`.
- `DELETE /:id` → nhóm `system` → 409 `system_group`; xoá liên kết user (user có thể còn 0 nhóm).
- `GET /api/admin/permissions` → `PERMISSIONS`.
- Users API: tạo user nhận `groupIds: string[]` (≥ 1, 422 nếu rỗng/không tồn tại); `PATCH /api/admin/users/:id` nhận `groupIds?`; danh sách user trả `groups`. Luật Super Admin cuối cùng áp cho cả ba đường.
- Audit (`AuditService` hiện có): `group.create|update|delete`, `user.groups.update`.

## 5. Quy trình review

### 5.1 Định nghĩa
- `ContentTypeDefinition.review?: boolean` (mặc định `false`). Builder có công tắc; ghi vào file schema như các thuộc tính khác (chỉ ở dev).

### 5.2 Bảng `opencms_workflow` (migration stream của core)
`api_id text, document_id uuid, state text CHECK (state IN ('in_review','draft')), submitted_by uuid, submitted_at timestamptz, reviewed_by uuid NULL, reviewed_at timestamptz NULL, note text NULL, PRIMARY KEY (api_id, document_id)`.
- Không có dòng = Draft sạch. `state='draft'` + `note` = bị từ chối (Contenter thấy ghi chú).
- Submit: upsert `state='in_review', submitted_by, submitted_at=now(), note=NULL, reviewed_*=NULL`.
- Withdraw: `state='draft'` (giữ `note` NULL).
- Reject: `state='draft', reviewed_by, reviewed_at=now(), note`.
- Publish thành công (bất kỳ đường nào): xoá dòng.
- Xoá entry: xoá dòng.
- Mọi chuyển trạng thái chạy trong transaction, khoá dòng (`SELECT … FOR UPDATE`, tạo dòng nếu chưa có trong cùng transaction); kiểm tra trạng thái sau khi khoá → hai thao tác đồng thời: một thành công, một 409 `invalid_transition`.
- Type đổi `review` true → false: dòng `in_review` coi như Draft (bỏ qua khi đọc; xoá ở lần ghi kế tiếp của document).

### 5.3 API
- Draft trả thêm `workflow: { state: 'draft' | 'in_review', submittedBy: { id, name } | null, submittedAt, note } | null`.
- `GET /api/admin/content/:apiId?workflow=in_review` lọc mục chờ duyệt.
- `GET /api/admin/workflow/pending-count` → `{ count, byType: Record<apiId, number> }` (cần `content.publish`).
- Lifecycle hooks hiện có không đổi; publish qua duyệt gọi cùng hook publish.

## 6. Giao diện

### 6.1 Cài đặt → Nhóm quyền (`/admin/settings/groups`, cần `settings.groups`)
- Bảng nhóm: tên (nhóm seed dịch theo `key` qua `groups.<key>`), số role, số user, nhãn "Hệ thống".
- Tạo/sửa: key (chỉ khi tạo), tên, ô tick role nhóm theo Nội dung / Cài đặt, mỗi role có nhãn + mô tả dịch. Super Admin: chỉ xem, mọi ô tick và khoá.
- Xoá: xác nhận kèm số user.
- Thêm dòng "Nhóm quyền" vào `navigation.ts` (Spec A §3.1).

### 6.2 Người dùng
- Cột Nhóm; form tạo/sửa có chọn nhiều nhóm (bắt buộc ≥ 1 khi tạo); lỗi `last_super_admin`, `group_*` hiển thị bản dịch.

### 6.3 Theo quyền
- Sidebar: mục Cài đặt cần quyền tương ứng; không còn mục nào → ẩn nhóm Cài đặt. Nhóm content type và "Nội dung" cần `content.read`.
- Route không có quyền → trang "Bạn không có quyền xem trang này" (route `forbidden` hiển thị trong layout). User 0 quyền sau đăng nhập → trang chủ chỉ hiện thông báo này.
- Hàm `can(permission)` / `useCan()` trong admin, dựa trên `permissions` của `/me`.

### 6.4 Trình soạn entry và danh sách

| Type | Trạng thái | Có | Nút |
|---|---|---|---|
| `review: false` | Draft | `content.update` | Lưu · Publish |
| `review: true` | Draft | `content.submit` | Lưu · Gửi duyệt |
| `review: true` | In review | người gửi (không có `content.publish`) | Rút lại (form khoá) |
| `review: true` | In review | `content.publish` | Lưu · Duyệt & publish · Từ chối (hộp ghi chú) |
| mọi | đã Published | quyền publish tương ứng | Unpublish |

- Ghi chú từ chối hiện thành banner đầu form cho tới lần gửi duyệt kế tiếp.
- Danh sách entry: cột Trạng thái (Draft / In review / Published / Có thay đổi chưa publish), bộ lọc "Chờ duyệt".
- Trang chủ: ô "N mục chờ duyệt" cho người có `content.publish`.
- Builder: công tắc "Cần duyệt trước khi publish".

## 7. Kiểm thử

- **Unit:** tính quyền hiệu lực (system → mọi role, hợp nhiều nhóm, 0 nhóm); validate `roles`/`key`; bảng chuyển trạng thái workflow (mọi cặp trạng thái × thao tác hợp lệ/không hợp lệ); luật publish theo `review` × quyền.
- **Integration (Postgres):**
  - Migration `oauth2_0002`: user cũ thuộc `super-admin`; 3 nhóm tồn tại; `down` chạy.
  - Guard: 403 đúng quyền trên từng nhóm route của §4.2 (một test đại diện mỗi dòng); `/me` trả `permissions`.
  - Groups API: CRUD, `system_group`, `group_key_taken`, roles lạ 422.
  - `last_super_admin`: gỡ nhóm / vô hiệu hoá / xoá user cuối; hai request đồng thời không cùng thành công.
  - Workflow: Contenter tạo → submit → sửa bị 409 `in_review_locked` → Reviewer sửa được → reject (note) → Contenter thấy note → submit → Reviewer approve → published, dòng workflow bị xoá; Contenter publish type `review: true` → 403; Contenter publish type `review: false` → 200; hai approve đồng thời → một 409.
- **Admin:** `useCan`/lọc navigation theo quyền; bảng nút §6.4 (hàm thuần `entryActions(type, workflow, permissions, userId)`).
- **Smoke:** tạo user Contenter qua API, chạy luồng submit → reject → approve; Contenter publish thẳng type review → 403.

## 8. Rủi ro và giới hạn
1. Đổi tên bảng `auth_roles` là breaking cho ai truy vấn trực tiếp — ghi CHANGELOG.
2. Tính quyền mỗi request thêm một query join; chấp nhận (admin ít request).
3. User 0 nhóm vẫn đăng nhập được nhưng không làm gì — chủ ý, để admin gán lại nhóm.
4. Nhóm tự tạo chỉ có một tên (không đa ngôn ngữ).
