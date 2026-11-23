# OpenCloudCMS: Page builder kéo thả, gắn dữ liệu và preview — Design Spec

**Ngày:** 2026-11-23 · **Trạng thái:** Approved
**Nhánh nền:** `main` sau `feat/admin-nextjs` (Next chạy trong Nest, một app cho admin `/admin` và website `/`), Spec A (`2026-10-21-settings-i18n-design.md`: mã locale có vùng, `src/locales.ts`, i18n helpers) và Spec B (`2026-10-21-groups-permissions-review-design.md`: `@RequirePermission`, `content.*`). Nếu Spec B chưa merge khi bắt đầu plan, dùng guard admin hiện có và để TODO ánh xạ quyền ở §7.
**Thương hiệu:** theo spec rebrand 2026-10-25 — gói `@opencloudcms/*`, env `OPENCLOUDCMS_*`, CLI `opencloudcms`; tên SQL cũ `opencms_*` giữ nguyên, định danh mới dùng `opencloudcms`.
**Roadmap:** đây là mục v0.3 trong `architecture-decisions-v0.1.md` ("widgets + page builder, Next.js preview, SDK and React renderer").

## 1. Mục đích

Dựng website nhanh bằng cách **kéo thả các component có sẵn theo design system của OpenCloudCMS** (token + component shadcn mà admin và website đang dùng chung). Người kéo thả chủ yếu là **lập trình viên**, nhưng công cụ phải đủ đơn giản để **người ít biết kỹ thuật cũng dựng được trang**. Ba phần:

1. **Kéo thả UI** — trình dựng trang trong admin.
2. **Dữ liệu** — prop của component có thể gắn với nội dung CMS (một entry, hoặc danh sách entry có lọc).
3. **Preview** — thấy trang như thật, bằng dữ liệu nháp, ngay khi sửa; và mở bản nháp trên website thật trước khi publish.

## 2. Mục tiêu, không làm, phản mục tiêu

### Mục tiêu
- Dev khai báo **block** (component kéo thả được) bằng API của OpenCloudCMS (`defineBlock` + `b.*`), cùng phong cách với `defineContentType` + `f.*`.
- Core có sẵn **thư viện block** dựng từ design system (§5.3) để project mới dùng được ngay không cần viết block.
- **Trang là dữ liệu**: lưu trong database, có draft / published / version như entry, sửa được cả ở production. Định nghĩa block nằm trong code (dev thêm block mới, deploy).
- Website render trang theo URL qua route catch-all trong `app/(site)`.
- Preview trong editor cập nhật tức thì; nút "Xem trên website" mở URL thật ở Next draft mode.

### Không làm (lần này)
- Canvas đặt tự do theo toạ độ (chỉ luồng section/cột/lưới mà Puck hỗ trợ).
- **Template cho content type** (trang chi tiết `/products/[slug]` dựng bằng kéo thả và gắn vào "entry hiện tại") — để đợt sau (§11).
- Định tuyến website theo ngôn ngữ (`/vi-VN/...`), như Spec A. Website render `defaultLocale`.
- Cache / ISR / `revalidateTag` (như spec admin-nextjs X9).
- Header/footer/menu dùng chung kéo thả được (layout toàn site). Header/footer vẫn là code trong `app/(site)/layout.tsx`.
- Quy trình review (Spec B) cho trang: trang publish thẳng theo quyền (§7). Ghi việc sau.
- Người dùng tự viết block trong admin (block luôn là code).
- Sửa inline trên website thật (on-page editing).

### Phản mục tiêu (làm xong mà dính những điều này là hỏng)
- Website thật trông **khác** preview trong editor.
- Người không biết kỹ thuật phải đụng JSON, code hay ID để dựng một trang thông thường.
- Dữ liệu trang **bị khoá vào Puck** đến mức đổi bản Puck lớn là mất trang (phải có đường migrate, §6.4).
- Trang publish lộ dữ liệu nháp, hoặc URL preview dùng được bởi người không có quyền.
- Nới CSP của admin xuống dưới mức spec admin-nextjs §4.4 mà không ghi rõ lý do.

## 3. Ràng buộc từ hệ thống hiện có

- Next 16 App Router chạy **trong process Nest**, cùng cổng. Path `/api/**`, `/oauth2/**` là của Nest; mọi path khác là Next. ⇒ route handler của Next **không** được nằm dưới `/api`.
- Admin là client component (`ssr: false`), CSP nonce + `'strict-dynamic'`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`.
- `app/globals.css` dùng chung cho admin và website (Tailwind v4 + `theme.css` của core) ⇒ block render cùng token ở cả hai nơi.
- Entry: draft và published là hai dòng riêng; publish copy draft → published + snapshot version; `required` kiểm tra lúc publish; field localizable nằm ở bảng `_l10n`. Chưa có populate/expand cho reference.
- Lọc/sắp xếp chỉ trên field `indexed`/`unique`.
- Locale: `en-US | vi-VN | fr-FR | id-ID`, `src/locales.ts` (Spec A).
- `@opencloudcms/core` dùng được trong server component nhờ `serverExternalPackages`; client component chỉ import `@opencloudcms/core/admin` (Spec A §5).

## 4. Cách tiếp cận

| | Cách | Đánh đổi | Kết luận |
|---|---|---|---|
| **A** | **Nhúng Puck (MIT) vào admin**, bọc bằng API block của OpenCloudCMS; preview trong iframe của Puck; dữ liệu trang lưu trong DB | Nhanh, có sẵn kéo thả lồng nhau, undo/redo, chọn/khung, responsive viewport. Phụ thuộc định dạng dữ liệu và lịch phát hành của Puck (0.x, còn breaking); giao diện editor chỉnh theo design system qua overrides | **Owner chọn** |
| B | Tự viết editor bằng dnd-kit, iframe là website thật ở draft mode, đồng bộ postMessage | Toàn quyền giao diện và định dạng; vài tháng công để làm lại thứ Puck có | Loại |
| C | Render block thẳng trong cây React của admin, không iframe | CSS/CSP admin khác website ⇒ preview không giống thật (vi phạm phản mục tiêu) | Loại |
| — | Lưu trang thành code (`page.tsx` sinh ra, chỉ dev) | Nhất quán schema-as-code nhưng người không biết kỹ thuật không sửa được trên production | Owner chọn lưu thành **dữ liệu** |

## 5. Block

### 5.1 Khai báo

```tsx
// src/blocks/product-grid/product-grid.block.tsx   (project)
import { defineBlock, b } from '@opencloudcms/core/blocks';

export default defineBlock({
  name: 'ProductGrid',                 // khoá ổn định, lưu trong dữ liệu trang; PascalCase, duy nhất
  label: { 'en-US': 'Product grid', 'vi-VN': 'Lưới sản phẩm' },
  category: 'commerce',                // nhóm trong thanh component
  icon: 'layout-grid',                 // tên icon lucide
  fields: {
    heading: b.text({ label: 'Heading', default: 'Featured' }),
    columns: b.select({ options: [2, 3, 4], default: 3 }),
    products: b.entries('product', { limit: 12, sortable: true, filterable: true }),
  },
  render: ({ heading, columns, products }) => (
    <section className="py-12">
      <h2 className="text-2xl font-semibold">{heading}</h2>
      <div className={`grid gap-6 grid-cols-${columns}`}>
        {products.map((p) => <ProductCard key={p.documentId} product={p} />)}
      </div>
    </section>
  ),
});
```

```ts
// src/blocks/index.ts   (project; init sinh ra)
import { defineBlocks, coreBlocks } from '@opencloudcms/core/blocks';
import ProductGrid from './product-grid/product-grid.block';
export default defineBlocks([...coreBlocks, ProductGrid]);
```

- **`render` phải chạy được ở cả client (editor) và server (website)**: không dùng API chỉ-server, không tự fetch dữ liệu. Dữ liệu đến qua prop đã resolve (§6.3). Block cần tương tác (carousel…) tự đánh dấu component con `'use client'`.
- `defineBlocks` validate: `name` duy nhất, PascalCase; field hợp lệ; `default` đúng kiểu. Lỗi → lỗi rõ ràng lúc build/khởi động editor.
- Subpath mới **`@opencloudcms/core/blocks`** (isomorphic: không import Nest, không `'use client'` ở entry). Đây là ngoại lệ có chủ ý với Spec A A9 ("không thêm subpath" — quyết định đó áp cho i18n); lý do: block phải import được ở cả server component lẫn client mà không kéo Nest theo. *(Quyết định của người viết spec.)*

### 5.2 Kiểu field (`b.*`)

| Builder | Lưu trong trang | Prop nhận khi render | Ô nhập trong editor |
|---|---|---|---|
| `b.text`, `b.longText` | string | string | input / textarea |
| `b.richText` | rich text (cùng định dạng field `richText` của content) | node đã render | editor rich text hiện có của admin |
| `b.number`, `b.boolean`, `b.select`, `b.radio` | giá trị | giá trị | input tương ứng |
| `b.link` | `{ kind: 'url', href } \| { kind: 'page', documentId }` | `{ href }` (đã resolve path trang) | chọn URL hoặc chọn trang |
| `b.image` | `{ assetId?, src, alt }` (chọn/tải asset qua `@opencloudcms/assets`, hoặc dán URL) | `{ src, alt, width?, height? }` | chọn asset / dán URL |
| `b.color`, `b.spacing` | **token** của design system (`primary`, `muted`, `4`, `8`…), không phải mã hex tự do | tên class/token | danh sách token |
| `b.entry(apiId)` | `{ documentId }` | entry đã resolve (hoặc `null`) | ô tìm và chọn entry (tìm theo field `indexed` đầu tiên kiểu text, mặc định `displayField` nếu khai báo) |
| `b.entries(apiId, opts)` | `{ mode: 'pick', ids: [] } \| { mode: 'query', filter, sort, limit }` | mảng entry | chọn tay, hoặc dựng bộ lọc trên field `indexed`/`unique` |
| `b.list({ ...fields })` | mảng object | mảng object | danh sách lặp (thêm/xoá/kéo sắp xếp) |
| `b.slot({ allow?, max? })` | vùng con chứa block khác | `ReactNode` | vùng thả trong canvas |

- Chỉ những field khai báo trong `fields` mới lưu vào trang; prop lạ bị bỏ khi lưu.
- `b.color`/`b.spacing` chỉ cho token ⇒ trang luôn theo design system, người không biết kỹ thuật không "phá" được giao diện.

### 5.3 Thư viện block của core (`coreBlocks`)

Dựng từ component shadcn/token hiện có, nhóm theo category:

- **layout:** `Section` (nền theo token, padding, container width; có `slot`), `Columns` (2–4 cột, tỉ lệ; mỗi cột là `slot`), `Grid` (lưới responsive; `slot`), `Spacer`, `Divider`.
- **basic:** `Heading`, `Text` (rich text), `Image`, `Button` (biến thể theo design system), `ButtonGroup`, `Card` (`slot`), `Badge`.
- **marketing:** `Hero`, `FeatureList` (`b.list`), `CallToAction`, `FAQ` (accordion), `Testimonials`… *(danh sách chi tiết do builder chốt theo component đang có trong admin; tối thiểu là layout + basic + `Hero`)*
- **data:** `EntryList` — khối chung cho mọi content type: chọn `apiId`, chế độ pick/query, kiểu hiển thị (list/grid/table) và các field cần hiện; dùng được ngay cho content type bất kỳ mà không viết block riêng.

## 6. Trang (dữ liệu)

### 6.1 Mô hình

Trang là một **content type do core sở hữu**, `apiId = 'opencloudcmsPage'`, bảng `ct_opencloudcms_page` + `ct_opencloudcms_page_l10n`, tạo bằng **migration stream của core** (không có file schema trong project, không sửa được trong Builder, ẩn khỏi sidebar nội dung). Nhờ vậy dùng lại nguyên cơ chế draft/published, version, l10n, hooks của `EntriesService`.

| Field | Kind | Localizable | Ghi chú |
|---|---|---|---|
| `title` | text | ✓ | required |
| `path` | text | ✓ | required, `unique`, `indexed`. Dạng `/`, `/about`, `/a/b`; chữ thường, số, `-`, `/`; không kết thúc bằng `/` (trừ `/`); không bắt đầu bằng `/_next`, `/admin`, `/api`, `/oauth2`, `/__opencloudcms` |
| `seo` | json | ✓ | `{ title?, description?, image?, noindex? }` |
| `content` | json | ✓ | dữ liệu Puck (§6.4) |

- Mỗi locale có **cây block riêng**. Tạo bản dịch mới: editor đề nghị "Sao chép từ `<defaultLocale>`" rồi sửa.
- `required`/path hợp lệ kiểm tra lúc lưu (path) và lúc publish (title, path), theo luật hiện có.
- Hook `beforePublish` của core cho `opencloudcmsPage`: validate `content` theo `blocks` hiện tại (§6.5).

### 6.2 API

Dùng lại `/api/admin/content/opencloudcmsPage/**` (CRUD, publish, unpublish, versions) — không thêm controller CRUD riêng. Thêm:

- `GET /api/content/opencloudcmsPage/by-path?path=/about&locale=` → trang published (công khai, không bao giờ trả draft). Không có → 404 JSON.
- `GET /api/admin/content/opencloudcmsPage/by-path?path=&locale=` → trang **draft**, cần phiên admin + `content.read`, `Cache-Control: no-store`. Dùng cho preview trên website (§8.2).
- `GET /api/admin/pages/blocks-check` → danh sách trang có block không còn trong `blocks` (để admin cảnh báo sau khi dev xoá/đổi tên block).

### 6.3 Resolve dữ liệu

Một hàm thuần isomorphic trong `@opencloudcms/core/blocks`:

```ts
resolvePage(content, blocks, fetcher, { locale, status }) → Promise<ResolvedContent>
```

- Duyệt cây, gom mọi field `b.entry` / `b.entries` / `b.link(page)`, **gộp theo apiId** thành ít request nhất (pick → lấy theo danh sách id; query → mỗi query một request), rồi thay vào prop.
- `fetcher` là interface: ở editor gọi `/api/admin/content/**` (status `draft`, theo phiên admin); ở website gọi `/api/content/**` (published) hoặc `/api/admin/content/**` chuyển tiếp cookie phiên admin khi đang preview (draft, §8.2).
- Entry không tìm thấy / chưa publish → `null` (với `entry`) hoặc bị bỏ khỏi mảng (với `entries`); không làm hỏng trang.
- Cần một cách lấy nhiều entry theo danh sách `documentId` trong một request: thêm filter `documentId[in]=a,b,c` vào list API (chỉ cho `documentId`, không mở rộng luật filter-on-indexed). *(Quyết định của người viết spec; builder chọn cú pháp phù hợp với query parser hiện có.)*
- Không populate sâu: entry trả về như API list hiện tại (reference bên trong vẫn là id). Populate là việc sau.

### 6.4 Định dạng lưu và migrate

- `content` lưu **nguyên định dạng `Data` của Puck**, bọc thêm: `{ format: 'puck', formatVersion: <major Puck>, data: <Puck Data> }`.
- Khi nâng Puck có breaking change về dữ liệu: core cung cấp migration dữ liệu (data migration của core stream, dùng công cụ migrate của Puck nếu có) chuyển mọi dòng `ct_opencloudcms_page*` sang `formatVersion` mới.
- Khi dev đổi block (đổi tên field, đổi `name`): `defineBlock` nhận `migrate?: { from: number; up(props) }[]` và `version`; editor và renderer chạy `up` khi đọc prop cũ; lưu lại sẽ ghi bản mới. *(Builder có thể hoãn `migrate` sang việc sau nếu plan quá lớn, nhưng phải giữ trường `version` trong dữ liệu từ đầu.)*

### 6.5 Block không còn tồn tại

- Renderer website: block lạ → không render gì, log WARN một lần mỗi `name`.
- Editor: block lạ hiện thành khung "Block `<name>` không còn trong project" (xoá được, không sửa được).
- Publish: có block lạ → 422 `unknown_block` kèm danh sách — trừ khi request có `force: true`.

## 7. Quyền

Trang đi theo quyền nội dung của Spec B, áp cho `opencloudcmsPage` như một content type `review: false`: `content.read` (xem, xem nháp trên website), `content.create`, `content.update` (sửa), `content.delete`. Publish/unpublish: **`content.update` hoặc `content.publish`** (đúng luật B8 của Spec B cho type `review: false`). Role của Spec B áp cho mọi content type, nên không cấp quyền riêng cho trang được; không thêm role mới. Review cho trang là việc sau.

### Locale (quyết định của người viết spec)
- Website công khai chỉ phục vụ bản `defaultLocale` (theo `path` của locale đó). Bản ở locale khác sửa và publish được nhưng chưa có URL công khai cho tới khi có định tuyến theo locale.
- Preview trên website **ép locale của link preview**: redirect tới `path` của locale đó, render bản draft locale đó.
- `b.link({ kind: 'page' })` resolve theo locale đang render; trang đích không có bản ở locale đó → dùng `path` của `defaultLocale`; không có nữa → link bị bỏ (`href` null, block tự xử lý).
- Một trang không bắt buộc phải có bản `defaultLocale` để publish; chỉ là không truy cập công khai được.

## 8. Preview

### 8.1 Trong editor (tức thì)
- Canvas của Puck ở **chế độ iframe**, render `blocks[].render` với dữ liệu draft đã resolve qua fetcher admin. Mỗi thay đổi prop → resolve lại phần bị ảnh hưởng (debounce ~300ms cho field dữ liệu).
- Iframe nạp `app/globals.css` (cùng file với website) ⇒ cùng token, cùng class. Header/footer của website **không** có trong canvas (xem phản mục tiêu: chấp nhận vì layout là code; nút "Xem trên website" cho bản đầy đủ).
- Chuyển viewport (mobile / tablet / desktop) dùng tính năng sẵn có của Puck.

### 8.2 Trên website thật (draft mode) — **chỉ người đăng nhập admin** (owner chốt)

Không có token dùng được ngoài phiên: link preview chuyển tiếp cho người khác thì người đó chỉ thấy bản published. Muốn khách duyệt → tạo tài khoản admin cho họ.

1. "Xem trên website" mở tab mới `/__opencloudcms/preview?page=<documentId>&locale=<locale>` — **route handler của Next** trong `app/(site)/__opencloudcms/preview/route.ts` (re-export từ core; builder chọn cách export phù hợp quy ước re-export của spec admin-nextjs §5.1).
2. Route handler gọi loopback `GET /api/admin/content/opencloudcmsPage/<documentId>?status=draft&locale=` **chuyển tiếp cookie phiên** của request. 401/403/404 → redirect tới `/admin/login?next=<url preview>` (401) hoặc trả trang lỗi ngắn (403/404). Thành công → bật `draftMode()`, đặt cookie `opencloudcms_preview_locale=<locale>` (`HttpOnly`, `SameSite=Lax`, `Path=/`, cookie phiên trình duyệt), redirect tới `path` của bản draft ở locale đó.
3. Catch-all `app/(site)/[[...path]]/page.tsx`: nếu `draftMode().isEnabled` → gọi `GET /api/admin/content/opencloudcmsPage/by-path` chuyển tiếp cookie phiên, và `resolvePage` dùng **fetcher admin chuyển tiếp cookie** ⇒ block dữ liệu lấy **draft** của entry (sản phẩm, bài viết…), trang giống hệt editor. Hiện **thanh "Đang xem bản nháp · Thoát"** cố định (thoát = `/__opencloudcms/preview/exit`: tắt draft mode, xoá cookie, về bản published).
4. Đang ở draft mode mà phiên admin hết/không có quyền (API trả 401/403) → render bản published + thanh "Phiên xem nháp đã hết, đăng nhập lại" (link login). Không bao giờ trả draft khi không có phiên hợp lệ.
5. Draft mode áp cho cả site: trong lúc bật, mọi trang đi qua catch-all đều hiện draft (vẫn kiểm tra phiên mỗi request). Route `(site)` khác do dev tự viết không bị ảnh hưởng trừ khi dev tự đọc `draftMode()`.

- **Ràng buộc kiểm chứng sớm trong plan:** cookie phiên admin của BFF phải được trình duyệt gửi kèm request tới path website (`Path=/`, `SameSite` cho phép điều hướng cùng origin). Đã kiểm tra: cookie phiên hiện là `Path=/` — không cần đổi.
- Mọi phản hồi khi draft mode bật: `Cache-Control: private, no-store`.

## 9. Admin

### 9.1 Điều hướng
- Sidebar thêm nhóm cấp 1 **"Trang"** (trên nhóm content type), cần `content.read`: `/admin/pages`.
- `/admin/pages`: bảng trang (tiêu đề, path, trạng thái Draft/Published/Có thay đổi chưa publish, cập nhật lần cuối, locale đang xem), tạo trang (tiêu đề → path tự sinh, sửa được), nhân bản, xoá.
- `/admin/pages/:documentId?locale=`: **editor toàn màn hình** (ẩn sidebar admin; nút quay lại).

### 9.2 Editor
```
┌ ← Trang  |  Giới thiệu  /about  [vi-VN ▾]   ↶ ↷   📱 💻 🖥   Xem trên website   Lưu nháp   Publish ┐
├───────────────┬──────────────────────────────────────────────┬──────────────────────────┤
│ Component     │                                              │ Thuộc tính               │
│ ▸ Layout      │            canvas (iframe Puck)              │ (field của block đang    │
│   Section     │                                              │  chọn, hoặc của trang:   │
│   Columns     │                                              │  title, path, SEO)       │
│ ▸ Cơ bản      │                                              │                          │
│ ▸ Dữ liệu     │                                              │                          │
│ ▸ Cây trang   │                                              │                          │
└───────────────┴──────────────────────────────────────────────┴──────────────────────────┘
```
- Thanh trái: danh sách block theo `category`, nhãn theo locale admin; tab "Cây" (outline) của Puck.
- Thanh phải: field của block chọn. Field dữ liệu dùng **ô chọn riêng của OpenCloudCMS** (custom field của Puck): tìm entry, dựng bộ lọc, chọn trang cho link, chọn asset.
- **Lưu nháp** tự động (debounce, và khi rời trang) + nút Lưu; **Publish** theo quyền §7; xung đột khi hai người sửa cùng trang → dùng `updated_at` so sánh lạc quan, lưu sau báo 409 `stale_draft` và đề nghị tải lại.
- Giao diện Puck chỉnh qua `overrides` để dùng Button/Input/Select của design system; CSS mặc định của Puck chỉ giữ cho phần canvas/khung kéo thả. Nhãn UI của editor vào bộ dịch 4 ngôn ngữ của admin.
- Production: editor dùng được đầy đủ (trang là dữ liệu). Chỉ việc **thêm/sửa block** cần code.

### 9.3 CSP
- Iframe của Puck là iframe cùng origin không có `src` riêng; script chạy trong cửa sổ cha nên vẫn chịu nonce + `'strict-dynamic'`. Style nằm trong `'unsafe-inline'` đã cho phép. `frame-ancestors 'none'`/`X-Frame-Options: DENY` không ảnh hưởng iframe con.
- Nếu Puck cần nới CSP (ví dụ `frame-src`/`child-src`), chỉ thêm đúng giá trị cần (`'self'`/`about:`) và **chỉ cho `/admin/pages/*`**; ghi lý do trong code và CHANGELOG. Plan kiểm chứng sớm bằng smoke trên build prod.

## 10. Website, `init`, example

- `init` sinh:
  - `src/blocks/index.ts` (`defineBlocks([...coreBlocks])`), thư mục `src/blocks/` có một block ví dụ có comment.
  - `app/(site)/[[...path]]/page.tsx` (re-export renderer của core; `generateMetadata` từ `seo`), `app/(site)/__opencloudcms/preview/route.ts` và `.../exit/route.ts`.
  - Xoá `app/(site)/page.tsx` tĩnh; khi chưa có trang published ở `/`, renderer hiện **trang chào mừng** (nội dung trang chủ mẫu hiện tại + link "Dựng trang đầu tiên" tới `/admin/pages`).
- Renderer: path không có trang → `notFound()` của Next (dùng `not-found.tsx` của website).
- Renderer cần `blocks` của project ở cả admin lẫn website: admin nạp `src/blocks/index.ts` qua một file re-export trong `app/(admin)` do `init` sinh (ví dụ `app/(admin)/admin/blocks.ts`), truyền vào `AdminApp`. *(Cơ chế cụ thể để admin bundle block của project do builder chốt; ràng buộc: không bắt người dùng sửa route table của core.)*
- `examples/my-store`: block `ProductGrid`, trang `/` (Hero + ProductGrid query `product` mới nhất) và `/about`, seed bằng script dev.
- README: khai báo block, kiểu field, quy tắc `render` isomorphic, preview, giới hạn.

## 11. Quyết định của owner và quyết định của người viết spec

**Owner chốt:**
- Trang là **dữ liệu** (không sinh code); định nghĩa block là code.
- Dùng **Puck** (cách A).
- Preview trên website **chỉ cho người đăng nhập admin**, dữ liệu block là draft (§8.2).
- Người kéo thả: lập trình viên, nhưng đủ đơn giản cho người ít biết kỹ thuật.

**Người viết spec tự quyết (owner kiểm tra khi đọc):**
- Template trang cho content type (`/products/<slug>`) **để đợt sau** (owner chưa trả lời; chọn phương án nhỏ hơn).
- Trang là content type do core sở hữu `opencloudcmsPage` (§6.1) để dùng lại draft/publish/version.
- Subpath mới `@opencloudcms/core/blocks` (§5.1).
- `b.color`/`b.spacing` chỉ nhận token design system (§5.2).
- Mỗi locale một cây block riêng; website chỉ phục vụ `defaultLocale` (§7).
- Publish trang: `content.update` hoặc `content.publish` (§7).
- Lọc `documentId[in]` cho list API (§6.3).
- Lưu `formatVersion` của Puck và `version` của block từ đầu (§6.4).

## 12. Kiểm thử

- **Unit `@opencloudcms/core/blocks`:** `defineBlock`/`defineBlocks` (name trùng, PascalCase, default sai kiểu); chuyển định nghĩa → config Puck (field map đúng); `resolvePage` với fetcher giả (gộp theo apiId, pick/query, entry thiếu → null/bỏ, link trang → href, block lạ bị bỏ qua); validate `path`.
- **Integration (Postgres):** migration core tạo `ct_opencloudcms_page*`; CRUD + publish `opencloudcmsPage` qua API hiện có; `by-path` công khai chỉ trả published; `by-path` admin trả draft, 401 không phiên, 403 thiếu `content.read`; 404 path lạ; `path` trùng trong cùng locale → 409/422 theo luật unique hiện có; publish có block lạ → 422 `unknown_block`; `documentId[in]`.
- **Admin:** `matchRoute` cho `pages`, `pages/:documentId`; custom field dữ liệu (chọn entry, bộ lọc chỉ cho field indexed).
- **Smoke (build prod):** `init --link` → seed một trang `/` có `Heading` → `GET /` chứa text của heading, không có CSP admin; tạo draft sửa heading → `GET /` vẫn bản cũ; đăng nhập → `/__opencloudcms/preview?page=<id>&locale=en-US` → redirect `/` (draft mode) → `GET /` chứa heading mới + thanh "Đang xem bản nháp"; cùng URL preview **không có cookie phiên** → redirect login, và `GET /` với cookie draft mode nhưng không phiên → bản published; một entry `product` sửa nháp hiện bản nháp trong preview, bản cũ ở trang công khai; `GET /admin/pages/<id>` có CSP với nonce như cũ.

## 13. Rủi ro và giới hạn

1. **Puck 0.x**: breaking change thường xuyên. Pin phiên bản chính xác; nâng cấp có data migration (§6.4).
2. **Block phải isomorphic**: dev quen server component có thể viết block fetch dữ liệu → hỏng trong editor. `defineBlock` ghi rõ trong type/README; lint rule là việc sau.
3. **Canvas không có header/footer**: preview trong editor chỉ là phần thân trang.
4. **Content type do core sở hữu** (`opencloudcmsPage`): registry và codegen hiện chỉ biết type của project; cần cơ chế đăng ký type core (và loại khỏi snapshot/diff của project). Đây là việc lớn nhất về backend.
5. **Một locale mỗi lần render** và không định tuyến theo locale (như Spec A).
6. Không cache ⇒ mỗi request website gọi API (loopback) và resolve dữ liệu. Chấp nhận cho bản đầu, như spec admin-nextjs.
