# opencms: Settings, nhóm content type, i18n admin và ngôn ngữ website — Design Spec (Spec A)

**Ngày:** 2026-10-21 · **Trạng thái:** Approved
**Nhánh nền:** `feat/admin-nextjs` (admin đã là Next.js App Router chạy trong Nest — spec `2026-10-21-admin-nextjs-design.md`).
**Liên quan:** Spec B (nhóm quyền + role) viết riêng, làm sau; spec này chừa chỗ cho mục "Nhóm quyền" trong Settings (§3.1).

## 1. Mục tiêu và phạm vi

### Mục tiêu
- Admin có mục **Cài đặt** gom: Người dùng, Content type, Ngôn ngữ (và Nhóm quyền ở spec B). Sidebar **hai cấp**: cấp 1 là nhóm, cấp 2 là mục.
- Content type được gom vào **nhóm content type** (có tiêu đề đa ngôn ngữ, thứ tự), mỗi nhóm là một mục cấp 1 trên sidebar.
- Giao diện admin có sẵn **4 ngôn ngữ cố định**: `en-US` (mặc định), `vi-VN`, `fr-FR`, `id-ID`. Mỗi user chọn ngôn ngữ của mình. Không cho tuỳ biến bản dịch của core.
- Ngôn ngữ **của website/nội dung** quản lý trong Cài đặt → Ngôn ngữ, chọn trong 4 mã trên, project mới chỉ có `en-US`; cấu hình được **ghi vào code của project** (chỉ ở dev).
- Project của người dùng có **hàm i18n dùng sẵn** từ core cho code tự viết (website, component admin tuỳ biến).

### Trong phạm vi
- §3 Settings + sidebar hai cấp + nhóm content type (code là nguồn sự thật).
- §4 i18n admin: bộ dịch 4 ngôn ngữ, chọn ngôn ngữ theo user, `auth_users.locale`, `PATCH /api/auth/me`.
- §5 API i18n công khai qua hai entry hiện có `@opencms/core` và `@opencms/core/admin`.
- §6 Ngôn ngữ website: `src/locales.ts`, API `/api/admin/locales`, kiểm tra config, API content từ chối locale chưa bật, migration dữ liệu mã ngắn → mã có vùng.
- Cập nhật `opencms init`, `examples/my-store`, README, CHANGELOG.
- Hai việc còn treo từ nhánh nền: bỏ `examples/my-store/tsconfig.tsbuildinfo` khỏi repo + ignore `*.tsbuildinfo`; xoá request header `content-security-policy-report-only` do client gửi trên path không phải admin (cùng chỗ đang xoá `content-security-policy`).

### Ngoài phạm vi
- Nhóm quyền, role, guard theo role (spec B).
- Nhãn đa ngôn ngữ cho từng field (chỉ tên nhóm và tên content type ở spec này).
- Người dùng tự thêm/sửa bản dịch của core; thêm ngôn ngữ ngoài 4 mã.
- Dịch thông báo lỗi do server sinh ra (server vẫn tiếng Anh).
- Đổi ngôn ngữ website ở production (P1: production chỉ xem).
- Định tuyến website theo ngôn ngữ (`/vi-VN/...`), cache.

## 2. Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| A1 | Sidebar hai cấp; Cài đặt là một nhóm cấp 1 | Yêu cầu của owner |
| A2 | Nhóm content type là thực thể tạo được, lưu trong code (`src/content-groups.ts`), sửa ở dev, production chỉ xem | Đồng nhất với content type (code là nguồn sự thật) |
| A3 | Tên nhóm và `displayName` của content type đa ngôn ngữ (map theo locale; chuỗi đơn = `en-US`) | T1 |
| A4 | Admin có 4 ngôn ngữ cố định trong core, không tuỳ biến | Owner chốt |
| A5 | Ngôn ngữ admin lưu theo user (`auth_users.locale`), fallback trình duyệt → `en-US` | U1 |
| A6 | Ngôn ngữ website lưu trong code (`src/locales.ts`), sửa ở dev, production chỉ xem | P1 |
| A7 | Ngôn ngữ mặc định website đổi được trong số ngôn ngữ đang bật; không tắt được ngôn ngữ mặc định | D1 |
| A8 | Mã ngôn ngữ dạng có vùng: `en-US`, `vi-VN`, `fr-FR`, `id-ID`, dùng chung cho admin và website | Owner chốt |
| A9 | API i18n công khai qua `@opencms/core` (hàm thuần, server) và `@opencms/core/admin` (hàm thuần + hook, client); không thêm subpath | Owner chốt: không thêm path |

## 3. Settings, sidebar và nhóm content type

### 3.1 Sidebar và route

```
Trang chủ                         /admin
<Nhóm content type> ▾             (theo order, rồi theo tiêu đề đã dịch)
  └─ <content type>               /admin/content/<apiId>
Nội dung ▾                        (type không có nhóm; chỉ hiện khi có)
Cài đặt ▾
  ├─ Người dùng                   /admin/settings/users
  ├─ (Nhóm quyền — spec B)        /admin/settings/groups
  ├─ Content type                 /admin/settings/content-types   (tab: Type | Nhóm; ?type=<apiId>, ?tab=groups)
  └─ Ngôn ngữ                     /admin/settings/languages
Chân sidebar: Tài khoản (/admin/account), Đăng xuất
```

- Nhóm cấp 1 mở/thu gọn được; nhóm chứa trang hiện tại tự mở. Trạng thái mở/thu gọn khác nhớ trong `localStorage` (bọc try/catch). Mobile: drawer hiện tại, cùng cấu trúc.
- Cấu hình điều hướng tách thành `admin/src/navigation.ts`: danh sách mục Cài đặt là dữ liệu (`{ to, label, icon }[]`) để spec B thêm một dòng.
- Route table (`router/match.ts`) thêm `settings/users`, `settings/content-types`, `settings/languages`. Route cũ `users` → chuyển hướng `/admin/settings/users`; `builder` → `/admin/settings/content-types` (giữ query string).
- Trang chủ: link "sửa schema" trỏ `/admin/settings/content-types?type=<apiId>`.

### 3.2 Nhóm content type

```ts
// src/content-groups.ts — OpenCMS ghi file này từ Cài đặt → Content type → Nhóm
import { defineContentGroups } from '@opencms/schema';
export default defineContentGroups([
  { key: 'shop', title: { 'en-US': 'Shop', 'vi-VN': 'Cửa hàng' }, order: 10 },
]);
```

- `@opencms/schema`:
  - `ContentGroupDefinition = { key: string; title: LocalizedText; order?: number }`, `LocalizedText = Partial<Record<Locale, string>> & { 'en-US': string }`.
  - `defineContentGroups(groups)` validate: `key` là slug (`^[a-z][a-z0-9-]{0,63}$`), không trùng; `title['en-US']` không rỗng; key của `title` chỉ thuộc `SUPPORTED_LOCALES`; `order` là số nguyên nếu có.
  - `ContentTypeDefinition` thêm `group?: string`; `displayName: string | LocalizedText` (chuỗi đơn được coi là `{ 'en-US': … }`).
- Loader/registry: `group` trỏ tới key không tồn tại → lỗi lúc load schema (cùng cơ chế lỗi validate hiện có). Thiếu file `src/content-groups.ts` = không có nhóm.
- API (cùng controller schema-builder, `api/admin`):
  - `GET /api/admin/content-groups` → `{ groups: ContentGroupDefinition[], editable: boolean }`.
  - `PUT /api/admin/content-groups` body `{ groups }` — chỉ khi `schemaEditable`, ngược lại cùng `ForbiddenException` như Builder. Validate như `defineContentGroups` → 422. Xoá nhóm còn content type tham chiếu → 409 `{ error: { code: 'group_in_use', message, issues: [{ path: [key], message: 'apiId1, apiId2' }] } }`. Hợp lệ → ghi lại file bằng codegen printer và cập nhật registry trong bộ nhớ.
- Builder (Cài đặt → Content type): ô chọn nhóm (có "không nhóm") và 4 ô `displayName` (en-US bắt buộc). Tab "Nhóm": bảng nhóm (key, tiêu đề theo ngôn ngữ đang xem, order, số type), thêm/sửa (4 ô tiêu đề + order)/xoá. Production: chỉ xem, cùng thông báo của Builder.
- Hiển thị tiêu đề (`localizedText(value, locale)`): bản của locale admin → `en-US` → key/apiId.
- `init`: sinh `src/content-groups.ts` với `defineContentGroups([])`. my-store: nhóm `shop` chứa `product`, `brand`.

## 4. i18n giao diện admin

### 4.1 Bộ dịch
- `admin/src/i18n/en.ts` → `admin/src/i18n/messages/en-US.ts` (bản gốc, `as const`); thêm `vi-VN.ts`, `fr-FR.ts`, `id-ID.ts` có type `Messages` (cùng cây key, giá trị string) ⇒ thiếu key là lỗi `tsc`.
- `en-US` nằm trong bundle; 3 bản còn lại nạp bằng `import()` khi chọn.
- Bản vi/fr/id dịch bằng máy; README ghi cần người bản xứ duyệt.

### 4.2 Runtime
- `I18nProvider` (client, bọc trong `Providers`) giữ `locale` + bộ dịch hiện tại; khi đổi: nạp bộ dịch rồi render lại cây admin; đặt `document.documentElement.lang`.
- `t(key, vars)` giữ nguyên chữ ký, đọc từ bộ dịch đang dùng; thiếu key → `en-US` → trả key.
- Ngày/số: thay mọi `toLocaleString()` trong admin bằng `formatDateTime` / `formatNumber` (§5) với locale hiện tại.

### 4.3 Chọn ngôn ngữ
1. Đã đăng nhập: `user.locale` từ `/api/auth/me` (nếu khác null).
2. Ngược lại: `localStorage['opencms-locale']` nếu hợp lệ, rồi `matchLocale(navigator.languages)`.
3. Không khớp: `en-US`.
- Ngôn ngữ đang dùng được ghi vào `localStorage['opencms-locale']` (try/catch) để Login/Setup hiện đúng ngay.
- Setup và Login có menu chọn ngôn ngữ (chỉ đổi localStorage + giao diện). Account có ô "Ngôn ngữ giao diện" (gọi `PATCH /api/auth/me`, có lựa chọn "Theo trình duyệt" = `null`).

### 4.4 Server (`@opencms/oauth2`)
- Migration mới: `auth_users.locale text NULL`.
- `GET /api/auth/me` trả thêm `locale: Locale | null`.
- `PATCH /api/auth/me` body `{ locale: Locale | null }` (cần phiên đăng nhập): giá trị khác 4 mã/null → 422 theo format lỗi hiện có; thành công → 200 trả user như `/me`. Ghi audit như các thao tác user khác.

## 5. API i18n công khai

Một module nguồn duy nhất trong core, xuất qua hai entry hiện có:

| Entry | Dùng ở | Xuất |
|---|---|---|
| `@opencms/core` | Code Nest, server component của website | `SUPPORTED_LOCALES`, `Locale`, `isLocale`, `matchLocale`, `defineMessages`, `createTranslator`, `formatDateTime`, `formatNumber`, `localizedText` |
| `@opencms/core/admin` | Client component (`'use client'`) — admin tuỳ biến, component tương tác của website | Các hàm trên + `useLocale()`, `useTranslator(messages)`, `useFormat()` |

- `SUPPORTED_LOCALES: readonly { code: Locale; name: string /* tên bản địa: English, Tiếng Việt, Français, Bahasa Indonesia */ }[]`; `Locale = 'en-US' | 'vi-VN' | 'fr-FR' | 'id-ID'` (định nghĩa gốc ở `@opencms/schema`, core re-export).
- `matchLocale(input: string | readonly string[] | null | undefined): Locale` — khớp đúng mã, rồi theo phần ngôn ngữ (`vi` → `vi-VN`), không phân biệt hoa thường; không khớp → `en-US`. Chuỗi kiểu `Accept-Language` (có `q=`) được tách theo thứ tự q.
- `defineMessages<M>(m: { 'en-US': M } & Partial<Record<Locale, DeepPartial<M>>>)` — trả lại đúng object, chỉ để có type.
- `createTranslator(messages, locale) → t(key, vars?)`: tra theo `locale` → `en-US` → key; thay `{name}`.
- `formatDateTime(value: Date | string | number, locale, opts?)`, `formatNumber(value, locale, opts?)` — bọc `Intl`.
- `useLocale()` trả locale admin hiện tại; `useTranslator(messages)` = `createTranslator` gắn locale hiện tại, render lại khi đổi; `useFormat()` trả hai hàm format đã gắn locale.
- Project **thêm** bộ chuỗi riêng; **không ghi đè** chuỗi của core. Admin core dùng chính các hàm này.
- (ruling R6) Không dùng `serverExternalPackages` (làm hỏng bản cài từ tarball và không chạy với package link). `@opencms/core` có export condition `react-server` → `dist/i18n.js` (chỉ API i18n ở trên, không thêm subpath): mọi code dưới `app/` chạy trên server (server component, route handler, server action, middleware) chỉ thấy API i18n — các tên khác của core là `undefined` ở đó — và cần Node runtime (không Edge). `app/(site)/messages.ts` sinh ra là server-only. Quy tắc ghi trong README + comment template: client component không import `@opencms/core`, dùng `@opencms/core/admin` (kể cả `defineMessages`).
- `init`: sinh `app/(site)/messages.ts` (`defineMessages` có en-US + vi-VN); trang chủ mẫu dùng `createTranslator(messages, defaultLocale)` với `defaultLocale` lấy từ `src/locales.ts`.

## 6. Ngôn ngữ của website

### 6.1 Lưu trữ và kiểm tra
```ts
// src/locales.ts — OpenCMS ghi file này từ Cài đặt → Ngôn ngữ
import { defineLocales } from '@opencms/schema';
export default defineLocales({ defaultLocale: 'en-US', locales: ['en-US'] });

// opencms.config.ts
import locales from './src/locales';
export default defineConfig({ database: { url: process.env.DATABASE_URL! }, ...locales });
```
- Kiểm tra lúc resolve config (lỗi rõ ràng, chặn khởi động): `locales` không rỗng, không trùng, mọi mã thuộc `SUPPORTED_LOCALES`; `defaultLocale ∈ locales`. Mã ngắn cũ (`en`) báo lỗi kèm gợi ý mã mới.
- Project không có `src/locales.ts` (khai báo trong config) vẫn chạy; trang Ngôn ngữ chỉ xem kèm hướng dẫn chuyển sang file quản lý.

### 6.2 API
- `GET /api/admin/locales` → `{ supported: SUPPORTED_LOCALES, locales, defaultLocale, editable, entryCounts: Record<Locale, number> }`. `editable` = `schemaEditable` và có `src/locales.ts`. `entryCounts` đếm số dòng theo `locale` trên mọi bảng l10n của content type đã đăng ký.
- `PUT /api/admin/locales` body `{ locales: Locale[]; defaultLocale: Locale; confirmDisable?: Locale[] }`:
  - Không editable → cùng `ForbiddenException` như Builder.
  - Vi phạm §6.1 → 422.
  - Bỏ một locale có `entryCounts > 0` mà không nằm trong `confirmDisable` → 409 `{ error: { code: 'locale_has_entries', message, issues: [{ path: [locale], message: '<count>' }] } }`.
  - Hợp lệ → ghi `src/locales.ts` (codegen printer) và cập nhật config trong bộ nhớ (có hiệu lực ngay). Dữ liệu của locale bị tắt **không xoá**.
- API content (`/api/content/**`, `/api/admin/content/**`): `locale` hoặc phần tử `fallback` không thuộc `locales` → 400 `{ error: { code: 'locale_not_enabled', … } }`. Không truyền `locale` → `defaultLocale` (như hiện tại).

### 6.3 Giao diện Cài đặt → Ngôn ngữ
- Bảng 4 ngôn ngữ: tên bản địa + mã, công tắc Bật, nút chọn Mặc định, số entry. Không tắt được ngôn ngữ mặc định; chỉ chọn làm mặc định ngôn ngữ đang bật. Tắt ngôn ngữ còn entry → hộp xác nhận nêu số entry → gửi lại với `confirmDisable`. Nút Lưu.
- Production / không editable: chỉ xem + thông báo.
- Ô chọn locale ở trang nội dung và trang chủ dùng `locales` đang bật (đã vậy, giữ nguyên nguồn dữ liệu).

### 6.4 Chuyển đổi dữ liệu cũ
- Migration dữ liệu trong stream của core: với mọi bảng có tên kết thúc `_l10n` và có cột `locale`, đổi `en→en-US`, `vi→vi-VN`, `fr→fr-FR`, `id→id-ID`; dòng nào đổi sẽ trùng khoá `(entry_id, locale)` thì giữ nguyên và log cảnh báo; log tổng số dòng đã đổi.
- `init`: `en-US`. my-store: `['en-US', 'vi-VN', 'id-ID']`, default `en-US`.
- CHANGELOG: breaking — mã ngắn không còn hợp lệ, cách sửa config, migration tự đổi dữ liệu.

## 7. Kiểm thử

- **Unit `@opencms/schema`:** `defineContentGroups` (slug, trùng key, thiếu en-US, locale lạ, order không nguyên), `defineLocales`/resolve config (rỗng, trùng, mã lạ, mã ngắn có gợi ý, default ngoài danh sách), `displayName` chuỗi đơn ↔ map.
- **Unit i18n (core):** `matchLocale` (`vi`, `VI-vn`, `fr-CA` → `fr-FR`, Accept-Language có q, rỗng → en-US), `createTranslator` (fallback en-US, thiếu key → key, placeholder), `localizedText`, format theo locale. Test bộ dịch: 4 bản cùng tập key và cùng tập placeholder mỗi key.
- **Admin:** `matchRoute` cho route mới + chuyển hướng cũ; dựng cây sidebar từ nhóm/type (sắp theo order rồi tiêu đề, type không nhóm vào "Nội dung", nhóm rỗng không hiện).
- **Integration (Postgres):** `PATCH /api/auth/me` (hợp lệ, null, mã lạ 422, chưa đăng nhập 401); `/api/admin/content-groups` (GET, PUT ghi file + registry, 409 group_in_use, 403 khi không editable); `/api/admin/locales` (GET counts, PUT ghi `src/locales.ts`, 409 locale_has_entries rồi thành công với confirmDisable, 422, 403); API content 400 `locale_not_enabled`; migration đổi `en`→`en-US` và bỏ qua dòng trùng.
- **Smoke:** project `init` có `src/locales.ts` (`en-US`), `src/content-groups.ts`, `app/(site)/messages.ts`; build prod chạy; `GET /api/admin/locales` sau đăng nhập trả `locales: ['en-US']`; trang chủ website chứa chuỗi en-US của `messages.ts`.

## 8. Rủi ro và giới hạn

1. Bản dịch máy cho vi/fr/id có thể chưa tự nhiên — cần duyệt trước phát hành.
2. (ruling R6) Code dưới `app/` không với tới export Nest của core (`@opencms/core` → `dist/i18n.js` theo condition `react-server`); không phải use case được hỗ trợ — dữ liệu website lấy qua API/HTTP hoặc service Nest phía server. Middleware/route chạy Edge không được hỗ trợ.
3. Ghi file (`src/locales.ts`, `src/content-groups.ts`) chỉ an toàn ở dev, một tiến trình; giống Builder.
4. Migration §6.4 bỏ qua dòng trùng khoá — nếu project đã có cả `en` và `en-US` cho cùng entry, dòng `en` ở lại (log cảnh báo), API không phục vụ nó.
