# opencms: Admin chuyển sang Next.js, một Next app chung cho admin và website, nhúng trong NestJS — Design Spec

**Ngày:** 2026-10-21 · **Trạng thái:** Approved
**Nhánh nền:** `main` (38061de, đã gồm `feat/oauth2` + admin nhúng). Các nhánh `feat/storefront-init`, `feat/realm-roles`, `cursor/*` **không** dùng làm nền và không thuộc spec này.
**Thay thế một phần:** `docs/superpowers/specs/2026-10-15-embedded-admin-init-design.md` — quyết định E2 (Vite + React Router) và E5 (`OPENCMS_ADMIN_DEV`), mục §3 (SPA và middleware phục vụ), §5.1 (React Router), §7.2 (file sinh ra) và §8 (smoke). Các phần còn lại của spec đó (auth wiring, URL E3/E4, màn hình và luồng §5.2–5.5, design system §6) **giữ nguyên**.

## 1. Mục tiêu và phạm vi

### Mục tiêu
- Chỉ còn **một stack frontend**: Next.js (App Router). Admin và website SEO sau này dùng chung một Next app, chung React, Tailwind, token màu và component shadcn.
- Backend vẫn là NestJS với base `/api` (và `/oauth2` cho endpoint giao thức OIDC).
- Vẫn **một process, một cổng, một URL**. Next chạy bên trong process Nest; người dùng không phải chạy thêm gì.
- `opencms init` → `pnpm dev` → mở `<publicUrl>/admin` là có admin như hiện tại; `<publicUrl>/` là trang chủ website mẫu.

### Trong phạm vi
- Chuyển mã admin (`packages/core/admin`) từ Vite + React Router sang các module dùng trong Next App Router, xuất qua `@opencms/core/admin`.
- Lớp gắn Next vào Nest trong `@opencms/core` (§4): định tuyến backend/Next, dev (HMR) và prod, CSP nonce cho `/admin`, 503 khi chưa build.
- `opencms init` sinh thư mục `app/` (admin + website mẫu tĩnh) và cấu hình Next (§6).
- Cập nhật `examples/my-store`, README, CHANGELOG, CI smoke.
- Gỡ Vite, React Router, `AdminSpaMiddleware`, `OPENCMS_ADMIN_DEV`, option `admin.*`.

### Ngoài phạm vi
- **Cơ chế cache** dưới mọi dạng: ISR/tag cho website, `revalidateTag` khi content đổi, HTTP cache/ETag cho `/api/content`, `cacheHandler` dùng chung nhiều instance. Kể cả việc thêm `Cache-Control: no-store` cho các `/api/**` hiện đang thiếu (`/api/admin/**`, `/api/auth/me`, …) — ghi nhận là việc sau (§9).
- Website lấy nội dung từ CMS (`lib/cms.ts`), page builder, storefront mẫu đầy đủ. Trang chủ mẫu là trang tĩnh.
- Kiểm tra phiên phía server (server component đọc session). Admin vẫn kiểm tra phiên phía client như hiện tại.
- Chuyển `/oauth2` vào dưới `/api`.
- Playwright / E2E trình duyệt.
- Nội dung của các nhánh `feat/storefront-init` (proxy Nest → Next process riêng) và `feat/realm-roles`.

## 2. Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| X1 | Next.js 16 App Router thay Vite cho admin | Một stack frontend; cùng cơ chế sẽ dùng cho website SEO |
| X2 | Next chạy **trong process Nest**, cùng cổng, qua `next({ dir, dev }).getRequestHandler()` | Giữ một URL, một process; không cần proxy, không cần `concurrently` |
| X3 | **Một Next app duy nhất** nằm trong project do `init` sinh ra, chứa cả admin (`/admin`) và website (`/`) | "Cùng một bộ": chung build, chung token và component; website dùng được component admin |
| X4 | Admin được "cắm" vào project bằng vài file re-export; route bên trong admin do một route table trong core khớp qua catch-all `[[...slug]]` | Nâng cấp `@opencms/core` thêm trang admin mà người dùng không phải thêm file |
| X5 | Trang admin là client component, nạp bằng `next/dynamic` với `ssr: false`; layout là server component | Admin không cần SSR; tránh lệch hydration giữa theme và session; layout vẫn render khung ngay |
| X6 | `next`, `react`, `react-dom` là **peerDependency** của core; project cài làm dependency; core nạp `next` từ thư mục project | Đảm bảo một bản React/Next duy nhất |
| X7 | CSP nonce **chỉ cho `/admin/**`**, do Nest sinh; website không bị core áp CSP | Admin giữ mức bảo vệ hiện tại; website giữ được SSG/ISR |
| X8 | Dev/prod theo `NODE_ENV` (`web.dev` mặc định `NODE_ENV !== 'production'`) | Cùng quy ước với `OPENCMS_PUBLIC_URL` (E4) và với Next |
| X9 | Chưa làm cache | Quyết định của owner: chưa cần thì chưa làm |

## 3. Cấu trúc

### 3.1 Project do `opencms init` sinh ra

```
my-site/
├── src/                          # Nest (main.ts, app.module.ts) — như hiện tại
├── app/                          # Next App Router — một app cho admin + website
│   ├── (admin)/
│   │   ├── layout.tsx            # root layout của admin (re-export từ core, §5.1)
│   │   └── admin/[[...slug]]/page.tsx
│   ├── (site)/
│   │   ├── layout.tsx            # root layout của website
│   │   └── page.tsx              # trang chủ mẫu, tĩnh
│   └── globals.css               # Tailwind v4 + theme.css của core
├── next.config.ts
├── next-env.d.ts
├── postcss.config.mjs
├── tsconfig.json                 # cho Next
├── tsconfig.server.json          # cho Nest (CommonJS, include src + opencms.config.ts)
├── opencms.config.ts
└── .env
```

- **Không có `app/layout.tsx` gốc.** Hai route group `(admin)` và `(site)` mỗi bên có root layout riêng với `<html>`/`<body>` riêng (cách "multiple root layouts" có trong tài liệu Next). Admin làm chủ class theme trên `<html>` và metadata `noindex`; website hoàn toàn độc lập.
- URL không đổi: route group không xuất hiện trong URL, nên admin vẫn ở `/admin/**`.

### 3.2 `@opencms/core`

```
packages/core/
├── src/                          # Nest (CommonJS) — như hiện tại, + src/web/ (§4)
├── admin/
│   ├── tsconfig.json             # ESM, jsx react-jsx, outDir ../dist/admin
│   ├── DESIGN.md                 # giữ nguyên
│   └── src/
│       ├── index.ts              # 'use client' — default export AdminApp (§5.2)
│       ├── layout.tsx            # server component — default export AdminLayout, export metadata (§5.1)
│       ├── router/               # route table + bộ khớp slug (§5.2)
│       ├── lib/nav.ts            # lớp thay react-router (§5.3)
│       ├── styles/theme.css      # token §6.2 spec 10-15, @theme, base
│       └── auth/, components/, hooks/, i18n/, lib/, pages/   # giữ, chỉ sửa import điều hướng
└── dist/
    ├── index.js …                # Nest
    └── admin/                    # ESM + .d.ts + theme.css
```

- `package.json` thêm `exports`:
  - `"."` → `dist/index.js` (types `dist/index.d.ts`), giữ `main`/`types` cho công cụ cũ.
  - `"./admin"` → `dist/admin/index.js`
  - `"./admin/layout"` → `dist/admin/layout.js`
  - `"./admin/theme.css"` → `dist/admin/styles/theme.css`
- `dist/admin` là ESM (cú pháp `import`/`export`, import không có đuôi file) nhưng **không** đặt `type: module`: chỉ bundler của Next đọc các file này, và webpack/Turbopack bắt buộc import có đuôi file trong package `type: module`. Alias `@/` của admin đổi thành import tương đối vì `tsc` không viết lại alias khi emit.
- `peerDependencies` thêm `next ^16`, `react ^19`, `react-dom ^19`, đánh dấu `optional` trong `peerDependenciesMeta` (project chỉ dùng API thì không cần).
- `devDependencies` thêm `next` (để typecheck/build admin). Bỏ `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `react-router`.
- Script: `build` = `tsc -p tsconfig.json && tsc -p admin/tsconfig.json && <copy theme.css>`; `dev:admin` = `tsc -w -p admin/tsconfig.json`. `dev:admin` không copy `theme.css`, nên checkout mới phải chạy `pnpm --filter @opencms/core build` một lần trước `dev:admin`.
- Các thư viện UI admin dùng lúc chạy (`radix-ui`, `lucide-react`, `sonner`, `react-hook-form`, `@hookform/resolvers`, `class-variance-authority`, `clsx`, `tailwind-merge`) chuyển từ devDependencies sang **dependencies** của core, vì giờ project bundle mã admin từ `dist/admin` và cần resolve được chúng. `tw-animate-css` cũng vào dependencies (được `theme.css` import).

## 4. Nest gắn Next (`packages/core/src/web/`)

### 4.1 Cấu hình

```ts
// OpenCmsModuleOptions
web?: {
  enabled?: boolean;   // mặc định true. false = không nạp next; path không phải backend → 404 của Nest
  dir?: string;        // thư mục Next app (chứa app/, next.config.ts). Mặc định process.cwd()
  dev?: boolean;       // mặc định process.env.NODE_ENV !== 'production'
};
```

- Bỏ `admin?: { enabled, distDir }` và biến `OPENCMS_ADMIN_DEV`.
- Template `main.ts` truyền `web: { dir: projectRoot }` (dùng `findProjectRoot` đã có), để chạy được cả từ `src/` (tsx) và `dist/src/`.

### 4.2 Định tuyến

- **Path backend:** `/api`, `/api/*`, `/oauth2`, `/oauth2/*`, so khớp không phân biệt hoa thường (Express routing cũng vậy). `/apix`, `/oauth2x` **không** phải backend.
- Middleware `webHandler` gắn bằng `adapter.getInstance().use(...)` trong `onModuleInit` (cùng thời điểm `mountAdmin` hiện tại, trước khi Nest đăng ký route và 404 handler):
  - Path backend → `next()`; Nest xử lý như hiện tại (route không tồn tại vẫn 404 JSON của `ApiExceptionFilter`).
  - Path khác → `nextHandler(req, res)` (handler của Next, tự parse URL).
- `JsonBodyParserMiddleware` chỉ chạy cho path backend (thêm điều kiện; giữ ngoại lệ `/oauth2/*` trừ `/oauth2/interaction/*`). Next tự đọc body của route handler/server action.
- `loopbackForwardedHost` và cấu hình URL (E3/E4) giữ nguyên.

### 4.3 Nạp Next

- `web.enabled === false` → không gọi `require('next')` ở bất cứ đâu (core vẫn chạy được khi project không cài `next`).
- Nạp `next` bằng `require(require.resolve('next', { paths: [web.dir] }))`, tức bản Next của project.
- `const app = next({ dev, dir })`, `await app.prepare()` trong `onModuleInit`, trước khi server listen; `app.close()` khi Nest shutdown (`onApplicationShutdown`).
- **Dev:** `next({ dev: true })` (Turbopack, mặc định của Next 16). HMR: nghe sự kiện `upgrade` của HTTP server Nest; request có path bắt đầu `/_next/` chuyển cho `app.getUpgradeHandler()`; các upgrade khác để nguyên.
- **Prod, chưa build** (không có `<dir>/.next/BUILD_ID`): không khởi tạo Next; path không phải backend trả **503** `text/html`, `Cache-Control: no-store`, nội dung: "Web UI chưa được build. Chạy `pnpm build` rồi khởi động lại."; log WARN một lần lúc boot. `/api` và `/oauth2` chạy bình thường.
- **`require('next')` hoặc `prepare()` lỗi:** log error kèm message gốc, trả 503 như trên. Server không sập.

### 4.4 Bảo mật cho `/admin/**`

Với mỗi request có path `/admin` hoặc `/admin/*` (không phân biệt hoa thường), trước khi chuyển cho Next:

- Sinh nonce: 16 byte ngẫu nhiên, base64.
- Đặt **request header** `content-security-policy` = policy dưới đây. Next đọc nonce từ header này và tự gắn vào các `<script>` nó sinh ra.
- Đặt **response header**:
  - `Content-Security-Policy`:
    `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'`
    Chỉ khi dev: thêm `'unsafe-eval'` vào `script-src` và `connect-src 'self' ws: wss:` cho HMR.
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex`.
- Admin layout đặt `dynamic = 'force-dynamic'` (trong file template, §5.1), nên mỗi request có nonce riêng và trang admin không bị Next cache.
- Website (`/`, …) và `/_next/*`: core không thêm CSP hay header nào; `/_next/static/*` dùng header của Next (immutable).

## 5. Admin trong Next

### 5.1 Layout (`@opencms/core/admin/layout`)

File trong project (sinh bởi `init`). Config segment (`dynamic`) viết thẳng trong file vì Next đọc nó tĩnh; `metadata` và layout được import rồi export lại tường minh thay vì `export … from`, để không phụ thuộc cách Next phân tích re-export:

```tsx
// app/(admin)/layout.tsx
import '../globals.css';
import AdminLayout, { metadata as adminMetadata } from '@opencms/core/admin/layout';

export const dynamic = 'force-dynamic';
export const metadata = adminMetadata;
export default AdminLayout;

// app/(admin)/admin/[[...slug]]/page.tsx
export { default } from '@opencms/core/admin';
```

`AdminLayout` (server component):
- Render `<html lang="en" suppressHydrationWarning>` và `<body>`.
- Đọc nonce: `(await headers()).get('content-security-policy')`, tách `'nonce-…'`. Gắn nonce vào script theme chạy trước khi vẽ (cùng nội dung script hiện ở `admin/index.html`).
- Bọc provider client hiện có (Toaster, theme listener).
- `metadata = { title: 'OpenCMS Admin', robots: { index: false, follow: false } }`.

### 5.2 `AdminApp` và route table

- `@opencms/core/admin` (`'use client'`) export default `AdminApp({ params })`; lấy `slug` bằng `useParams()` từ `next/navigation` (không dùng `React.use(params)`).
- Route table trong `admin/src/router/routes.ts`, giữ đúng các route của `routes.tsx` hiện tại:

| Pattern | Trang | Ghi chú |
|---|---|---|
| `_ui` | UiKit | chỉ khi `process.env.NODE_ENV !== 'production'` (bị loại khi build prod) |
| `setup` | Setup | ngoài AuthGate |
| `login` | Login | ngoài AuthGate |
| `` (rỗng) | Home | trong AuthGate |
| `content/:apiId` | Content | trong AuthGate |
| `builder` | Builder | trong AuthGate |
| `users` | Users | trong AuthGate |
| `account` | Account | trong AuthGate |
| còn lại | NotFound | trong AuthGate |

- Bộ khớp `matchRoute(slug: string[]) → { route, params }` là hàm thuần (test được, §8).
- Mỗi trang nạp bằng `next/dynamic(() => import('../pages/X'), { ssr: false })`, nên vẫn tách chunk theo trang.
- `AuthGate` và `AppLayout` giữ nguyên logic (spec 10-15 §5.2): gọi `/api/auth/me`, chưa đăng nhập thì chuyển `/admin/login?next=…`, `setup_required` thì chuyển `/admin/setup`. Luồng BFF/OIDC và mọi URL callback không đổi.

### 5.3 Thay React Router (`admin/src/lib/nav.ts`)

| Hiện tại | Thay bằng |
|---|---|
| `<Link to="/x">` | `<Link href="/admin/x">` (`next/link`), qua helper `adminHref('/x')` |
| `useNavigate()` | `useRouter().push/replace` (`next/navigation`) qua `useAdminNavigate()` |
| `useParams()` | `useAdminParams()` — context do `AdminApp` cấp từ `matchRoute` |
| `useSearchParams()` | `useSearchParams()` của `next/navigation` |
| `useLocation()` | `usePathname()` + `useSearchParams()` |
| `<Navigate to>` | `<Redirect to>` nhỏ: `router.replace` trong effect |
| `<Outlet>` / nested route | `AuthGate`/`AppLayout` nhận `children` |
| `import.meta.env.DEV` | `process.env.NODE_ENV !== 'production'` |

Mục tiêu: các trang chỉ đổi import, không đổi logic.

### 5.4 Styles

- `admin/src/styles/globals.css` hiện tại tách thành `theme.css`: token §6.2, khối `@theme`, base layer, import `tw-animate-css`. Không chứa `@import "tailwindcss"` (project import).
- `app/globals.css` trong project:
  ```css
  @import "tailwindcss";
  @import "@opencms/core/admin/theme.css";
  @source "../node_modules/@opencms/core/dist/admin";
  ```
- Website mẫu dùng chung file này, nên dùng được token và class giống admin.
- Component shadcn, `DESIGN.md`, i18n (`en.ts`) giữ nguyên.

### 5.5 Phát triển core

- `examples/my-store` có `app/` giống template và là môi trường dev của admin.
- Checkout mới chạy `pnpm --filter @opencms/core build` một lần trước (`dev:admin` không copy `theme.css`).
- Người phát triển chạy `pnpm --filter @opencms/core dev:admin` (tsc -w) song song `pnpm --filter my-store dev`; Next dev trong my-store nhận thay đổi ở `dist/admin` qua symlink workspace.

## 6. `opencms init`

### 6.1 File sinh thêm / thay đổi

- `app/(admin)/layout.tsx`, `app/(admin)/admin/[[...slug]]/page.tsx` như §5.1.
- `app/(site)/layout.tsx`: root layout website, `<html lang="en">`, import `../globals.css`, `metadata` với `title` = tên project.
- `app/(site)/page.tsx`: trang chủ tĩnh tối giản dùng token (tên project, một dòng mô tả, link "Open admin" tới `/admin`). Không gọi API.
- `app/globals.css` như §5.4.
- `next.config.ts`: `export default {}` (có type `NextConfig`).
- `postcss.config.mjs`: plugin `@tailwindcss/postcss`.
- `next-env.d.ts`.
- `tsconfig.json` (Next): `jsx: react-jsx` (Next 16 tự ghi giá trị này, không phải `preserve`), `module: esnext`, `moduleResolution: bundler`, `plugins: [{ name: 'next' }]`, `include: ['next-env.d.ts', 'app/**/*', '.next/types/**/*.ts']`.
- `tsconfig.server.json`: nội dung tsconfig Nest hiện tại (CommonJS, `include: ['src', 'opencms.config.ts']`).
- `.gitignore` thêm `.next/`.

### 6.2 `package.json`

- Dependencies thêm: `next`, `react`, `react-dom`, `cross-env`. DevDependencies thêm: `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `@types/react`, `@types/react-dom`.
- Scripts:
  - `dev`: `opencms migrate:up && tsx --tsconfig tsconfig.server.json src/main.ts` (tsx đọc `experimentalDecorators` từ tsconfig, nên phải trỏ vào tsconfig của Nest chứ không phải của Next)
  - `build`: `tsc -p tsconfig.server.json && next build`
  - `start`: `cross-env NODE_ENV=production opencms migrate:up && cross-env NODE_ENV=production node dist/src/main.js`
- `--link`: link thêm `next`, `react`, `react-dom` từ `node_modules` của core (cùng cơ chế R5 hiện tại) để chỉ có một bản.
- Chỉ khi `--link`: `next.config.ts` đặt `turbopack.root` và `outputFileTracingRoot` là thư mục cha chung gần nhất của project và repo, vì Turbopack từ chối file (symlink tới core) nằm ngoài root.

### 6.3 Log và README

- Log boot: `OpenCMS ready at <publicUrl>` và `Admin: <publicUrl>/admin`.
- README template cập nhật: cấu trúc thư mục (§3.1), dev/build/start, deploy cần `NODE_ENV=production` và chạy `build` trước, tắt website bằng `web: { enabled: false }`, giới hạn: `.next/cache` nằm trên đĩa nên chỉ đúng khi chạy một instance.

## 7. Gỡ bỏ và chuyển đổi (breaking, ghi vào CHANGELOG)

- Gỡ: `admin/vite.config.mts`, `admin/index.html`, `admin/src/main.tsx`, `admin/src/routes.tsx`, `src/http/admin-spa.middleware.ts`, `OPENCMS_ADMIN_DEV`, option `admin.enabled`/`admin.distDir`, fixture `test/fixtures/admin-dist`, test `integration/admin-spa.test.ts`, `integration/admin-dev.test.ts`; dependency `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `react-router`.
- Hướng dẫn chuyển cho project đã `init` trước đó: chạy lại `opencms init` vào thư mục mới và chép `app/`, `next.config.ts`, `postcss.config.mjs`, `tsconfig*.json`, scripts; hoặc làm theo danh sách file ở §6.1. `admin.enabled: false` → `web.enabled: false`.

## 8. Kiểm thử

**Unit (`packages/core/test/unit/`), handler Next giả:**
- `isBackendPath`: `/api`, `/api/x`, `/API/x`, `/oauth2`, `/oauth2/auth` là backend; `/apix`, `/oauth2x`, `/`, `/admin`, `/_next/x` không.
- `webHandler`: path backend gọi `next()`; path khác gọi handler Next.
- CSP: chỉ `/admin`, `/admin/x`, `/ADMIN` có header; request header và response header cùng một nonce; hai request liên tiếp có nonce khác nhau; dev có `'unsafe-eval'` và `ws:`, prod không; `/` không có CSP.
- Prod chưa có `BUILD_ID` → 503 + WARN đúng một lần; `prepare()` reject → 503 + log error.
- `web.enabled: false` → loader Next không được gọi.
- Body parser: path không phải backend không bị parse (body stream còn nguyên).

**Integration (Postgres thật):**
- `createCoreTestApp` đặt `web: { enabled: false }`; các test auth wiring/HTTP hiện có giữ nguyên.
- Thêm một test mount với loader Next giả: `/api/không-có` vẫn 404 JSON của Nest, `/` và `/admin/x` tới handler giả, `/oauth2/...` tới provider.

**Admin (`packages/core/test/admin/`):**
- Giữ `api`, `auth-flow`, `error-format`, `types`, `users`.
- Thêm `router.test.ts`: `matchRoute` cho từng dòng bảng §5.2, `content/:apiId` ra params, slug lạ ra NotFound, `_ui` chỉ có khi không phải production.
- `build.test.ts` đổi thành: sau build, `dist/admin/index.js` và `layout.js` tồn tại, `index.js` bắt đầu bằng `'use client'`, `layout.js` thì không, có `styles/theme.css` và `package.json` `type: module`, không còn chuỗi `react-router`.

**Smoke (`scripts/smoke-init.mjs`, chạy trong CI):** `init --link` → install → `build` (gồm `next build`) → `start` với `NODE_ENV=production`, rồi kiểm tra:
- `GET /` 200 `text/html`, chứa marker trang chủ mẫu; không có header `Content-Security-Policy`.
- `GET /admin/` 200 `text/html`, có CSP chứa `'nonce-<n>'` và mọi `<script>` trong HTML mang `nonce="<n>"` trùng giá trị đó, có `X-Robots-Tag: noindex`, chứa marker của admin layout (thay cho `<div id="root">`).
- Một URL `/_next/static/...` lấy từ HTML admin trả 200 với `Cache-Control` có `immutable`.
- Toàn bộ flow setup → login → `/api/auth/me` → logout như hiện tại.
- Typecheck project sinh ra: `tsc -p tsconfig.server.json --noEmit --preserveSymlinks` (như hiện tại); phần Next đã được `next build` typecheck.

## 9. Rủi ro, giới hạn và việc sau

1. **Thời gian boot dev** lâu hơn (Next `prepare()` + compile lần đầu). Chấp nhận; log rõ khi Next sẵn sàng.
2. **Project bundle mã admin** nên `next build` lâu hơn và Tailwind quét thêm `dist/admin`. Đổi lại là một bộ chung (X3).
3. **Re-export từ package**: đã chọn import rồi export tường minh cho layout (§5.1); page chỉ re-export `default`, cách Next hỗ trợ. Plan vẫn kiểm chứng bằng `next build` ở task đầu tiên đụng Next.
4. **Nonce khi Next chạy trong Nest**: Next lấy nonce từ request header `content-security-policy` lúc render — chính là cơ chế mà cách làm trong tài liệu Next (middleware/`proxy.ts` sinh nonce rồi ghi vào request header) dựa vào. Spec chọn sinh nonce ở Nest (§4.4) vì: một chỗ duy nhất trong core, test được bằng unit test, không đặt logic bảo mật vào file template người dùng có thể sửa, và không thêm middleware runtime của Next. Plan kiểm chứng sớm bằng smoke (`'nonce-…'` trong CSP phải trùng thuộc tính `nonce` trên các `<script>` của trang admin).
5. **Một instance**: `.next/cache` trên đĩa. Nhiều instance cần `cacheHandler` dùng chung — thuộc spec cache sau này.
6. **Việc sau (ngoài phạm vi):** `Cache-Control: no-store` cho mọi `/api/**` trừ `/api/content/**`; ISR/tag + `revalidateTag` khi content đổi; HTTP cache cho `/api/content`; website lấy nội dung CMS; kiểm tra phiên phía server cho admin.
