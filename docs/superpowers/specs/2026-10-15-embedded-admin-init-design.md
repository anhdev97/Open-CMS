# opencms: Admin nhúng trong `@opencms/core`, nối auth, design system và `opencms init` — Design Spec

**Ngày:** 2026-10-15 · **Trạng thái:** Draft chờ review
**Nhánh nền:** `feat/oauth2` (spec này phụ thuộc vào `@opencms/oauth2`)
**Liên quan:** `docs/superpowers/specs/2026-10-14-auth-oauth2-design.md` (spec auth). Spec này là phần "Phụ thuộc" mà spec auth §1 đã nêu.

## 1. Mục tiêu và phạm vi

### Mục tiêu
- Người dùng chạy `opencms init`, rồi `pnpm dev`, rồi mở **một URL duy nhất** (`http://localhost:4000/admin` khi chạy local, `https://<domain>/admin` khi deploy) là có ngay UI. Màn đầu tiên là setup admin hoặc đăng nhập, sau đó là toàn bộ admin.
- Admin không còn là app riêng (`apps/admin`). Nó là một SPA build sẵn, nằm trong `@opencms/core` và được server NestJS của project phục vụ ở `/admin`.
- Auth (`@opencms/oauth2`) được nối thẳng vào `OpenCmsModule`, thay cho bearer token cũ.
- Admin có design system thống nhất (shadcn/ui + Tailwind v4) với bộ token màu được định nghĩa ở §6.

### Trong phạm vi
- Chuyển admin sang Vite + React + React Router, đặt trong `packages/core/admin/`. Middleware phục vụ ở `/admin`.
- Nối `OAuth2Module` vào `OpenCmsModule`. Bỏ `AdminGuard` và `adminToken`. Thêm CORS riêng cho `/api/content`.
- Làm các màn: setup, đăng nhập, đăng xuất, tài khoản (đổi mật khẩu), quản lý user. Chuyển các màn hiện có (trang chủ, content, builder) sang hệ mới.
- Design system: token, bộ component shadcn, vài component riêng của OpenCMS, trang `/admin/_ui`, file `DESIGN.md`.
- Lệnh `opencms init`.
- Sửa các lỗi còn tồn từ nhánh auth mà spec này cần đến (§4.4).
- Cập nhật `examples/my-store` theo cách lắp mới.

### Ngoài phạm vi
- Website FE (Next.js, có SEO). Đây là app riêng, làm sau. Spec này chỉ giữ `/api/content/**` công khai và có CORS cho website gọi.
- E2E test bằng trình duyệt (Playwright). Thay bằng smoke test qua HTTP (§8).
- Đa ngôn ngữ cho UI. Giao diện tiếng Anh, chuỗi hiển thị gom một chỗ để sau thêm tiếng Việt.
- Export component cho plugin (để v0.4).
- `opencms init` hỏi tương tác hoặc sinh project có website mẫu.

## 2. Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| E1 | Admin nằm trong `@opencms/core`, build vào `dist/admin` | Một package, một module. UI và API luôn cùng phiên bản |
| E2 | Admin dùng Vite + React + React Router. Website FE sẽ dùng Next.js (riêng) | Admin chỉ chạy phía client, không cần SSR hay SEO. SEO là việc của website |
| E3 | Chỉ một URL do người dùng định nghĩa. Các đường dẫn `/admin`, `/api`, `/oauth2` cố định | Người dùng không phải cấu hình nhiều URL hay nhiều cổng |
| E4 | `OPENCMS_PUBLIC_URL` là tuỳ chọn khi dev (mặc định `http://localhost:${PORT}`), bắt buộc khi production. Bỏ `OPENCMS_INTERNAL_URL` | Bớt biến cấu hình. BFF và provider chạy chung tiến trình nên địa chỉ nội bộ luôn là `127.0.0.1:${PORT}` |
| E5 | Khi phát triển core, Vite chạy ở middleware mode bên trong NestJS (`OPENCMS_ADMIN_DEV=1`) | Người phát triển core cũng chỉ dùng một URL, có hot reload |
| E6 | Design system dùng shadcn/ui + Tailwind v4, token theo chuẩn biến của shadcn | Quyết định của owner: dựng nhanh, có sẵn component chất lượng và accessibility của Radix |
| E7 | Mọi thư viện frontend là devDependencies của core | Đã bundle vào `dist/admin`. Người dùng cài core không phải cài thêm |
| E8 | `opencms init` không hỏi tương tác, mọi tuỳ chọn có mặc định | Chạy được trong CI và smoke test |

## 3. Admin là SPA trong `@opencms/core`

### 3.1 Cấu trúc source
```
packages/core/
  admin/
    index.html
    vite.config.ts            # base '/admin/', alias '@' → admin/src, outDir ../dist/admin
    components.json           # cấu hình shadcn
    DESIGN.md
    src/
      main.tsx                # RouterProvider, ThemeProvider, Toaster
      routes.tsx              # bảng route §5.1
      styles/globals.css      # Tailwind v4 + @theme + token §6
      i18n/en.ts              # toàn bộ chuỗi hiển thị
      lib/api.ts              # client API §5.4
      lib/utils.ts            # cn()
      lib/theme.ts            # Sáng / Tối / Hệ thống
      auth/AuthGate.tsx       # §5.2
      components/ui/*         # component shadcn §6.3
      components/*            # component riêng của OpenCMS §6.4
      pages/*                 # Setup, Login, Home, Content, Builder, Users, Account, UiKit
  src/http/                   # phía server: middleware phục vụ SPA (§3.3), body parser, CORS
```
- Code của `apps/admin` (trang chủ, content, builder, `FieldInput`) được chuyển sang:
  - `next/link` thành `<Link>` của React Router;
  - `next/navigation` thành `useNavigate`, `useParams`, `useSearchParams`.
  - Phần giao diện viết lại bằng component của §6.
- Xoá thư mục `apps/admin`.
- Xoá `apps/*` khỏi `pnpm-workspace.yaml` nếu không còn app nào.
- CI: bỏ bước `pnpm --filter @opencms/admin build`. `pnpm build` của core đã bao gồm việc build UI.

### 3.2 Build
- Script trong `packages/core/package.json`:
  - `build` = `tsc -p tsconfig.json && vite build --config admin/vite.config.ts`;
  - `typecheck` kiểm tra cả `admin/` (thêm `admin/tsconfig.json` dùng `moduleResolution: bundler`, `jsx: react-jsx`).
- Kết quả build: `packages/core/dist/admin/index.html` và `dist/admin/assets/*` (tên file có hash).
- Field `files` của core đã gồm `dist`, nên `dist/admin` được publish theo.

### 3.3 Phục vụ ở `/admin`
`OpenCmsModule` đăng ký middleware `AdminSpaMiddleware`. Không dùng `@nestjs/serve-static`.

| Request | Phản hồi |
|---|---|
| `GET /admin` | 308 sang `/admin/` |
| `GET /admin/assets/<file>` (file có tồn tại) | File tĩnh, `Cache-Control: public, max-age=31536000, immutable` |
| `GET /admin/assets/<file>` (không tồn tại) | 404 |
| `GET` hoặc `HEAD` mọi đường dẫn khác dưới `/admin/` | `index.html`, `Cache-Control: no-store`, `Content-Type: text/html; charset=utf-8` |
| Method khác dưới `/admin/` | 405 |

- Thư mục được phục vụ là `path.join(__dirname, '../admin')`, tính từ `dist/http/admin-spa.middleware.js`. Nhờ vậy `dist/admin` chỉ chứa bản build của Vite, không có code server.
- Không cho thoát ra ngoài thư mục này: chặn `..`, cả dạng đã encode, và symlink trỏ ra ngoài.
- `OpenCmsModuleOptions.admin?: { enabled?: boolean }`, mặc định `true`.
  - Khi `false`, middleware không được đăng ký và `/admin/*` trả 404.
  - Phía auth vẫn redirect về `/admin/login`. Ai tắt admin là đã chấp nhận dùng auth với UI riêng của họ (ghi trong README).
- Nếu admin đang bật mà thiếu `dist/admin/index.html`:
  - log WARN một lần khi khởi động;
  - `/admin/*` trả 503 với một trang HTML ngắn: "Admin UI chưa được build. Chạy `pnpm build` trong `@opencms/core`."
- Header bảo mật cho `index.html`:
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`;
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`. `style-src` cần `unsafe-inline` vì Radix set style inline.

### 3.4 Khi phát triển chính core (E5)
- Khi `OPENCMS_ADMIN_DEV=1`, `AdminSpaMiddleware` thay phần phục vụ file tĩnh bằng `vite.createServer({ root: <core>/admin, base: '/admin/', server: { middlewareMode: true, hmr: { server: <http server của Nest> } }, appType: 'spa' })` và chuyển các request `/admin/*` cho `vite.middlewares`.
- `vite` được nạp bằng `import()` động chỉ trong chế độ này, nên production không bao giờ nạp nó.
- Trang `/admin/_ui` (§6.5) chỉ có khi bật chế độ này.

## 4. Nối auth vào core

### 4.1 Lắp module
- `OpenCmsModule.forRoot(input)` thêm vào `imports`: `OAuth2Module.forRoot({ dbToken: OPENCMS_DB, publicPathPrefixes: ['/api/content/'], auth: input.auth })`.
- `OpenCmsModuleOptions` thêm:
  - `auth?: Partial<AuthFileConfig>` (TTL, chính sách mật khẩu, IdP). Env vẫn được ưu tiên hơn như spec auth §5;
  - `admin?: { enabled?: boolean }` (§3.3);
  - `cors?: { origins: string[] }` (§4.2).
- `AuthGuard` toàn cục của `@opencms/oauth2` bảo vệ mọi `/api/**`, trừ:
  - các route public của auth;
  - `/api/content/**`.
- Các controller admin của core (`AdminContentController`, `SchemaController`, `SystemController`) yêu cầu `@RequireRole('super_admin')`.

### 4.2 Bỏ cơ chế cũ (thay đổi phá vỡ, ghi vào README và CHANGELOG)
- Xoá `AdminGuard`, option `adminToken` và biến `OPENCMS_ADMIN_TOKEN`.
- Xoá `app.enableCors(...)` trong project mẫu. Admin giờ chung origin với API.
- `cors.origins` (danh sách origin chính xác, không dùng wildcard):
  - Chỉ áp dụng cho `/api/content/**`.
  - Chỉ cho `GET`, `HEAD`, `OPTIONS`, không gửi kèm credentials.
  - Request preflight đến các đường dẫn khác không được trả header CORS.

### 4.3 Cấu hình URL (E3, E4)
- `OPENCMS_PUBLIC_URL`:
  - Nếu không đặt và `NODE_ENV !== 'production'`: dùng `http://localhost:${PORT ?? 4000}`.
  - Nếu không đặt và production: từ chối khởi động với thông báo hướng dẫn.
- Bỏ khoá config `internalUrl` và biến `OPENCMS_INTERNAL_URL` khỏi `@opencms/oauth2`. BFF luôn gọi `http://127.0.0.1:${PORT ?? 4000}`.
- Cập nhật spec auth §5 và README của `@opencms/oauth2` cho khớp.

### 4.4 Sửa các lỗi còn tồn từ nhánh auth
- **Định dạng lỗi.** `ApiExceptionFilter` phải giữ thông tin chi tiết. Định dạng lỗi của `/api/**` là `{ "error": { "code": string, "message": string, "issues"?: unknown[] } }`.
  - Nếu `HttpException` có body dạng object chứa `issues`, chép sang `error.issues`.
  - `message` dạng mảng (từ ValidationPipe) được nối lại thành chuỗi và đồng thời đưa vào `issues`.
  - Cập nhật spec auth §8 cho khớp.
- **Phạm vi của filter.** Filter chỉ xử lý request HTTP có đường dẫn bắt đầu bằng `/api`. Mọi lỗi khác (đường dẫn khác, context khác HTTP) được ném lại nguyên vẹn để handler mặc định hoặc filter của ứng dụng (ví dụ Sentry) xử lý.
- **Body parser ở `/oauth2`.** Nest không parse body cho `/oauth2/*`. `OpenCmsModule` tự cấu hình việc này, người dùng không phải làm gì, để hết cảnh báo "already parsed request body" của `oidc-provider`.
- **Thứ tự khởi động.** Provider token `CORE_READY` là một promise. `OpenCmsModule.onModuleInit` resolve nó sau khi kiểm tra migration (hoặc chạy `autoMigrate`), và reject kèm thông báo "chạy `opencms migrate:up`" nếu còn migration đang chờ. `ProviderService.onModuleInit` của oauth2 phải `await` nó trước khi chạm vào bảng `auth_*`.
  - Nếu oauth2 được dùng mà không có core, `CORE_READY` mặc định là đã resolve.

## 5. Màn hình và luồng đăng nhập trong SPA

### 5.1 Routes (React Router, `basename: '/admin'`)

| Route | Màn hình | Điều kiện |
|---|---|---|
| `/setup` | Tạo admin đầu tiên: email, tên, mật khẩu, nhập lại mật khẩu. Kiểm tra phía client: độ dài 12–256, khác email, hai lần nhập khớp nhau | Chỉ khi `GET /api/auth/setup` trả `required: true`. Nếu không, chuyển về `/` |
| `/login` | Đăng nhập: email, mật khẩu, nút SSO (nếu có), thông báo lỗi theo `?error=` | Cần `?uid=`. Nếu thiếu, chuyển cả trang tới `/api/auth/login` |
| `/` | Danh sách content type | Đã đăng nhập |
| `/content/:apiId` | Quản lý nội dung (như hiện tại) | Đã đăng nhập |
| `/builder` | Content Type Builder (như hiện tại, có `?type=`) | Đã đăng nhập |
| `/users` | Danh sách, tạo, khoá/mở, reset mật khẩu hộ, xoá, gỡ liên kết SSO | Đã đăng nhập |
| `/account` | Thông tin của tôi, đổi mật khẩu, chọn giao diện Sáng / Tối / Hệ thống | Đã đăng nhập |
| `/_ui` | Bảng trình bày design system (§6.5) | Chỉ khi `OPENCMS_ADMIN_DEV=1` |
| `*` | 404 trong app, có link về `/` | Đã đăng nhập |

### 5.2 `AuthGate`
Bọc mọi route trừ `/setup` và `/login`. Khi mount, gọi `GET /api/auth/me`:
- `200`: lưu `user` vào context và hiện layout gồm sidebar (Content, Builder, Users) cùng menu tài khoản (tên, Account, Log out).
- `409 setup_required`: `navigate('/setup', { replace: true })`.
- `401`: `window.location.assign('/api/auth/login?returnTo=' + encodeURIComponent('/admin' + pathname + search))`.
- Lỗi mạng hoặc lỗi 5xx: hiện màn lỗi có nút "Thử lại".
- Trong lúc chờ: hiện `Skeleton` của layout.

### 5.3 Luồng chi tiết
- **Setup:**
  - `POST /api/auth/setup`. Nhận `201` thì chuyển cả trang tới `/api/auth/login?login_hint=<email>`.
  - Nhận `409 setup_already_completed` thì chuyển về `/`.
  - Lỗi `422` hiện ngay tại field tương ứng.
- **Đăng nhập:**
  - `GET /oauth2/interaction/:uid` trả về `loginHint` và `idps`. Điền sẵn email, hiện mỗi IdP một nút, nút này dẫn tới `/oauth2/interaction/:uid/idp/<id>`.
  - Submit gửi `POST /oauth2/interaction/:uid/login` và nhận `{ redirectTo }`, rồi `window.location.assign(redirectTo)`.
  - `401 invalid_credentials` / `403 account_disabled` / `429` hiện lỗi ngay trên form. Với `429`, hiện thời gian chờ lấy từ `Retry-After`.
  - Bảng ánh xạ `?error=<code>` sang thông báo nằm trong `i18n/en.ts`: `login_expired`, `login_failed`, `invalid_state`, `idp_account_not_found`, `idp_email_unverified`, `account_disabled`, cùng một thông báo chung cho mã lạ. Kèm nút "Try again" dẫn tới `/api/auth/login`.
- **Đăng xuất:** `POST /api/auth/logout`, rồi `window.location.assign(redirectTo)`.
- **Đổi mật khẩu:**
  - `POST /api/auth/password`. Nhận `204` thì hiện toast "Password changed. Other sessions were signed out."
  - `401 invalid_credentials` hiện lỗi tại ô mật khẩu hiện tại.
- **Quản lý user:**
  - Bảng các cột: tên, email, trạng thái, `lastLoginAt`, nhà cung cấp SSO đã liên kết.
  - Thao tác qua `Dialog` / `AlertDialog`:
    - tạo user (mật khẩu không bắt buộc, kèm ghi chú "chỉ đăng nhập qua SSO");
    - reset mật khẩu hộ;
    - khoá / mở;
    - xoá;
    - gỡ liên kết SSO.
  - Hiển thị đúng các lỗi `409 last_super_admin`, `409 email_taken`, `403 forbidden`, `404 not_found`.
  - Ẩn nút xoá ở dòng của chính mình.

### 5.4 `lib/api.ts`
- `api<T>(path, init)` gọi đường dẫn tương đối, `credentials: 'same-origin'`, `Content-Type: application/json` khi có body. Không dùng bearer token, không cần biến môi trường.
- Lỗi được ném ra dưới dạng `ApiError { status, code, message, issues }`, đọc từ `{ error: {...} }`.
- Nếu gặp `401 unauthenticated` khi đang ở trong `AuthGate`, chuyển cả trang tới `/api/auth/login?returnTo=…`, giống §5.2.
- Các chỗ trong UI cũ đang đọc `body.message` / `body.issues` chuyển sang đọc `ApiError`.

### 5.5 Chuỗi hiển thị
Mọi chuỗi trên UI nằm trong `i18n/en.ts` (object lồng nhau và hàm `t(key, vars)`). Không viết chuỗi cứng trong component, trừ tên riêng.

## 6. Design system

### 6.1 Nền tảng
- Tailwind CSS v4 qua `@tailwindcss/vite`. Token khai báo CSS-first trong `admin/src/styles/globals.css`, gồm `@import "tailwindcss"`, `@theme inline { ... }` ánh xạ biến sang tiện ích, và các khối `:root` / `.dark`.
- shadcn/ui có `components.json`:
  - `style: "new-york"`, `tailwind.css: "src/styles/globals.css"`, `baseColor: "neutral"`, `cssVariables: true`;
  - alias `components: "@/components"`, `ui: "@/components/ui"`, `utils: "@/lib/utils"`;
  - `iconLibrary: "lucide"`.
- Thư viện (devDependencies của core): `tailwindcss`, `@tailwindcss/vite`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, `@radix-ui/*` (theo component), `sonner`, `react-hook-form`, `@hookform/resolvers`, `zod`.
- Font: system font stack `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Font mono: `ui-monospace, SFMono-Regular, Menlo, monospace`. Không tải font từ ngoài.

### 6.2 Token màu
Tất cả các cặp chữ trên nền dưới đây đạt WCAG AA (≥ 4.5:1). Tỉ lệ ghi trong ngoặc, theo thứ tự sáng / tối.

| Token | Sáng | Tối | Ghi chú |
|---|---|---|---|
| `--background` | `#f7f7f5` | `#161615` | Nền trang |
| `--foreground` | `#1d1d1b` | `#ecebe7` | trên background: 15.7 / 15.2 |
| `--card`, `--popover` | `#ffffff` | `#1f1f1d` | Panel, dialog, menu |
| `--card-foreground`, `--popover-foreground` | `#1d1d1b` | `#ecebe7` | |
| `--primary` | `#2f5bea` | `#7b9cff` | Nút chính, link (trên background: 5.1 / 6.9) |
| `--primary-foreground` | `#ffffff` | `#10172e` | trên primary: 5.5 / 6.8 |
| `--secondary`, `--muted` | `#efeeea` | `#2a2a27` | Nền phụ, nút phụ |
| `--secondary-foreground` | `#1d1d1b` | `#ecebe7` | |
| `--muted-foreground` | `#6b6a66` | `#a09e97` | Chữ phụ (trên card: 5.4 / 6.2) |
| `--accent` | `#eaf0ff` | `#232c47` | Hover, mục sidebar đang chọn |
| `--accent-foreground` | `#1e3fb8` | `#c7d4ff` | trên accent: 7.5 / 9.4 |
| `--destructive` | `#c73a2e` | `#ff7b6e` | Xoá, lỗi |
| `--destructive-foreground` | `#ffffff` | `#2a0f0c` | trên destructive: 5.2 / 7.1 |
| `--destructive-soft` | `#fdecea` | `#3a1f1c` | Nền Alert lỗi (chữ destructive trên nền này: 4.5 / 6.0) |
| `--success` | `#1f7a4a` | `#6fd39c` | Published, thành công |
| `--success-soft` | `#e8f6ee` | `#173024` | Nền badge/alert (chữ success trên nền này: 4.8 / 7.7) |
| `--warning` | `#8a5a00` | `#f0c060` | Cảnh báo migration, "changed" |
| `--warning-soft` | `#fff5e0` | `#3a2f16` | Nền badge/alert (chữ warning trên nền này: 5.5 / 7.8) |
| `--border` | `#e3e2de` | `#34332f` | Viền |
| `--input` | `#d6d5d0` | `#3d3c38` | Viền ô nhập |
| `--ring` | `#2f5bea` | `#7b9cff` | Vòng focus (2px, offset 2px) |
| `--sidebar` | `#ffffff` | `#1f1f1d` | Nền sidebar |
| `--sidebar-foreground` | `#1d1d1b` | `#ecebe7` | |
| `--sidebar-accent` | `#eaf0ff` | `#232c47` | Mục đang chọn |
| `--sidebar-accent-foreground` | `#1e3fb8` | `#c7d4ff` | |
| `--sidebar-border` | `#e3e2de` | `#34332f` | |
| `--chart-1`…`--chart-5` | `#2f5bea`, `#1f7a4a`, `#c77d00`, `#8e44ad`, `#c73a2e` | `#7b9cff`, `#6fd39c`, `#f0c060`, `#c39bd3`, `#ff7b6e` | Để dành cho biểu đồ sau này |

Token khác:
- `--radius: 0.5rem`. Các mức suy ra theo chuẩn shadcn: `sm = radius-4px`, `md = radius-2px`, `lg = radius`, `xl = radius+4px`.
- Shadow dùng mặc định của Tailwind. Card dùng `shadow-xs`, dialog dùng `shadow-lg`.

### 6.3 Bộ component shadcn ban đầu (`admin/src/components/ui/`)
- **Form:** `button`, `input`, `textarea`, `label`, `select`, `checkbox`, `switch`, `form`.
- **Hiển thị:** `card`, `table`, `badge`, `alert`, `separator`, `skeleton`, `tooltip`.
- **Tương tác:** `dialog`, `alert-dialog`, `dropdown-menu`, `tabs`, `sonner`.
- **Bố cục:** `sidebar`.

Được thêm bằng `pnpm dlx shadcn add` rồi commit nguyên bản. Chỉ sửa ở hai chỗ:
- `badge` và `alert` có thêm variant `success` / `warning` dùng token §6.2;
- `button` có thêm variant `destructive` theo token.

### 6.4 Component riêng của OpenCMS (`admin/src/components/`)
| Component | Việc |
|---|---|
| `AppLayout` | Sidebar, header và vùng nội dung. Responsive: dưới 768px thì sidebar thành sheet |
| `PageHeader` | Tiêu đề, mô tả, khu vực nút thao tác |
| `EmptyState` | Icon, tiêu đề, mô tả, nút hành động |
| `ErrorAlert` | Hiển thị một `ApiError`: `message` và danh sách `issues` (path: message) |
| `ConfirmDialog` | Bọc `alert-dialog` cho các thao tác phá huỷ |
| `FieldInput` | Ô nhập theo từng loại field của CMS (chuyển từ admin cũ, dựng lại bằng component ui) |
| `StatusBadge` | `draft` / `published` / `changed` / `active` / `disabled`, ánh xạ sang variant |
| `ThemeToggle` | Sáng / Tối / Hệ thống |

### 6.5 Dark mode, trang `/_ui`, quy tắc
- **Dark mode:** mặc định theo `prefers-color-scheme`. `ThemeToggle` lưu lựa chọn vào `localStorage['opencms-theme']`, đọc và ghi trong try/catch, và đặt class `.dark` trên `<html>`. Một script nhỏ inline trong `index.html` đặt class trước khi trang vẽ ra, để không bị nháy màu.
- **`/_ui`:** chỉ có khi `OPENCMS_ADMIN_DEV=1`. Trang này trình bày mọi component ở §6.3 và §6.4 với mọi variant, có nút chuyển sáng/tối.
- **Quy tắc** (ghi trong `admin/DESIGN.md`):
  - Trang chỉ ghép từ `components/ui` và `components/*`.
  - Không viết mã màu hex hay `rgb()` trong TSX/CSS ngoài `globals.css`, chỉ dùng class tiện ích ánh xạ từ token (`bg-primary`, `text-muted-foreground`…).
  - Không dùng giá trị Tailwind tuỳ ý (`[13px]`) trừ khi có lý do ghi bằng comment.
  - Icon chỉ lấy từ `lucide-react`.
  - Mọi phần tử tương tác đều có focus ring và có thể dùng bằng bàn phím.
- **Lưu ý cho plugin (v0.4):** component dùng Tailwind, nên UI của plugin muốn đồng bộ thì cũng phải dùng Tailwind với cùng token. Spec này chưa export component.

## 7. `opencms init`

### 7.1 Cách dùng
`opencms init <thư-mục> [--pm pnpm|npm|yarn] [--no-install] [--db-url <url>] [--port <n>] [--link <đường-dẫn-monorepo>]`
- `<thư-mục>`: nếu đã tồn tại và không rỗng thì báo lỗi, thoát với mã 1, không ghi gì.
- `--pm`: mặc định lấy từ `npm_config_user_agent`, không nhận ra thì dùng `pnpm`.
- `--db-url`: mặc định `postgres://postgres:postgres@localhost:5432/<tên-thư-mục-đã-chuẩn-hoá>`. Tên chuẩn hoá là chữ thường, ký tự không phải chữ hoặc số đổi thành `_`.
- `--port`: mặc định 4000.
- `--link`: ghi dependency nội bộ dạng `link:<monorepo>/packages/<pkg>`, dùng cho người phát triển core và smoke test. Khi không có cờ này, phiên bản là `^<phiên bản của opencms-cli đang chạy>`.

### 7.2 Các file sinh ra
| File | Nội dung |
|---|---|
| `package.json` | `name` là tên thư mục. `dependencies`: `@opencms/core`, `@opencms/schema`, `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs`, `kysely` (cùng khoảng phiên bản với `examples/my-store`). `devDependencies`: `opencms-cli`, `tsx`, `typescript`. `scripts`: `dev` = `opencms migrate:up && tsx src/main.ts`, `build` = `tsc -p tsconfig.json`, `start` = `opencms migrate:up && node dist/src/main.js`, `opencms` = `opencms` |
| `tsconfig.json` | Độc lập (không extends monorepo): CommonJS, ES2022, `experimentalDecorators`, `emitDecoratorMetadata`, `strict`, `outDir: dist`, `rootDir: .` |
| `opencms.config.ts` | `defineConfig({ database: { url: process.env.DATABASE_URL }, defaultLocale: 'en', locales: ['en'] })` |
| `src/main.ts` | Nạp `.env` (dùng `process.loadEnvFile` của Node ≥ 20.12 nếu có file), tạo Nest app, `enableShutdownHooks`, `listen(PORT)`, rồi log `OpenCMS ready at <publicUrl>/admin` |
| `src/app.module.ts` | `OpenCmsModule.forRoot({ root, config, contentTypes, hooks })` |
| `src/content-types/.gitkeep` | |
| `src/extensions/index.ts` | `export const hooks = [];` |
| `src/generated/*` | Sinh bằng `generateCode([], …)` của `@opencms/codegen` (registry rỗng) |
| `migrations/_snapshot.json` | Snapshot rỗng (`writeSnapshot`) |
| `.env` | `DATABASE_URL=…`, `PORT=…`, `OPENCMS_SECRET=<32 byte ngẫu nhiên, base64url>`. Thêm các dòng comment: `# OPENCMS_PUBLIC_URL=https://cms.example.com  (bắt buộc khi NODE_ENV=production)`, `# OPENCMS_ADMIN_EMAIL=` / `# OPENCMS_ADMIN_PASSWORD=  (tạo admin không qua wizard)` |
| `.env.example` | Giống `.env` nhưng `OPENCMS_SECRET=` để trống |
| `.gitignore` | `node_modules`, `dist`, `.env`, `*.log` |
| `docker-compose.yml` | Postgres 16, DB khớp với `--db-url` mặc định, volume có tên |
| `README.md` | Các bước chạy, cách deploy (đặt `OPENCMS_PUBLIC_URL`, `NODE_ENV=production`), và cảnh báo của spec auth §9.1 |

### 7.3 Sau khi sinh
- Trừ khi có `--no-install`, chạy `<pm> install` trong thư mục mới. Nếu bước này lỗi, giữ nguyên các file, in lỗi và cách chạy lại, rồi thoát với mã 1.
- In ra hướng dẫn tiếp theo:
  ```
  cd <thư-mục>
  docker compose up -d
  <pm> run dev
  → open http://localhost:<port>/admin
  ```
- **CLI nạp `.env`:** mọi lệnh `opencms` (sau khi tìm được thư mục gốc của project) nạp `<root>/.env` nếu file tồn tại, bằng `process.loadEnvFile`. Biến đã có sẵn trong môi trường thì không bị ghi đè. Nhờ vậy `migrate:up` đọc được `DATABASE_URL` mà người dùng không phải export.
- **Không sinh thêm migration nào.** `migrate:up` lần đầu chỉ chạy các migration core (system và auth). Content type đầu tiên được tạo trong Content Type Builder.

### 7.4 `examples/my-store`
- Cập nhật theo cách lắp mới: bỏ `adminToken`, bỏ `enableCors`.
- `main.ts` theo khuôn mà `init` sinh ra.
- Giữ hai content type mẫu.

## 8. Kiểm thử

**Unit (vitest)**
- `init`:
  - đúng danh sách file và nội dung chính;
  - `OPENCMS_SECRET` giải mã ra đủ 32 byte và khác nhau giữa hai lần chạy;
  - từ chối thư mục không rỗng;
  - `--link` ghi đúng `link:`;
  - suy đúng `--pm`;
  - chuẩn hoá đúng tên DB.
- Chọn URL mặc định:

  | Điều kiện | Kết quả |
  |---|---|
  | Dev, không đặt biến | `http://localhost:4000` |
  | Dev, `PORT=5000` | `:5000` |
  | Production, không đặt biến | Lỗi, không khởi động |

- `api.ts`: đọc lỗi thành `ApiError`, và gặp `401` thì chuyển hướng (giả lập `fetch` và `location`).

**Integration (vitest, NestJS thật, Postgres local, mỗi file một DB tạm)**
- `AdminSpaMiddleware`, với một thư mục `dist/admin` giả lập:
  - 308 cho `/admin`;
  - asset trả kèm `immutable`;
  - asset không tồn tại trả 404;
  - fallback về `index.html` kèm `no-store` và đủ header bảo mật;
  - chặn `..`, cả dạng encode;
  - method khác trả 405;
  - thiếu bản build trả 503;
  - `admin.enabled: false` trả 404.
- Auth đã nối vào core:
  - `/api/admin/content-types` không có session trả `401 unauthenticated`;
  - có session `super_admin` thì trả 200;
  - `/api/content/<type>` công khai.
- CORS:
  - origin nằm trong `cors.origins` gọi `/api/content` có header CORS;
  - `/api/admin` không có;
  - origin lạ không có.
- Lỗi của Content Type Builder (schema không hợp lệ) trả `{ error: { code, message, issues: [...] } }`, và `issues` không rỗng.
- Thứ tự khởi động: DB trắng, không bật `autoMigrate`, thì khởi động thất bại với thông báo chứa `opencms migrate:up` và không chứa `relation`.
- Filter lỗi: một route không thuộc `/api` ném lỗi thì đi đến filter của ứng dụng đăng ký sau.

**Smoke test** (script `scripts/smoke-init.mjs`, chạy trong CI sau `pnpm build`):
1. `opencms init <tmp> --link <repo> --no-install --db-url <DB tạm>`, rồi `pnpm install`, rồi `opencms migrate:up`. Khởi động `node` với `tsx src/main.ts` trên một cổng trống.
2. `GET /admin/` trả `200 text/html` chứa `<div id="root">`. `GET /api/auth/me` trả `409 setup_required`.
3. `POST /api/auth/setup` (có `Origin`) trả `201`.
4. Đi hết chuỗi đăng nhập qua HTTP, giữ cookie: `/api/auth/login`, rồi `/oauth2/auth`, rồi `POST /oauth2/interaction/:uid/login`, rồi `redirectTo`, rồi `/api/auth/callback`. Sau đó `GET /api/auth/me` trả `200`.
5. `POST /api/auth/logout`. `GET /api/auth/login` lần nữa phải dẫn tới `/admin/login?uid=…`.
6. Dừng server, drop DB tạm, xoá thư mục tạm.

**Kiểm tra build:** `pnpm build` tạo được `packages/core/dist/admin/index.html`. `pnpm --filter @opencms/core typecheck` kiểm tra cả `admin/`.

## 9. Rủi ro và giới hạn
1. **Thay đổi phá vỡ:** bỏ `adminToken`, bỏ CORS của admin, đổi định dạng lỗi `/api/**`, bỏ `OPENCMS_INTERNAL_URL`. Ghi trong README và CHANGELOG.
2. **Kích thước package:** core mang theo bản build admin (ước tính vài trăm KB nén) và kéo theo dependency của oauth2 (gồm `argon2` là module native).
3. **Đường dẫn cố định ở `/admin`:** không đổi được đường dẫn. Nếu cần đặt admin dưới một prefix khác sau proxy thì để sau.
4. **CSP có `style-src 'unsafe-inline'`**, vì Radix và sonner dùng style inline.
5. **Plugin muốn đồng bộ UI cần Tailwind** (§6.5).
6. **Smoke test không kiểm tra hiển thị.** UI chỉ được kiểm chứng qua typecheck, build và trang `/_ui` khi soát bằng tay.
