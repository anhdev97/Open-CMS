# OpenCloudCMS: Trình dựng block kéo thả, lưu block trong code — Design Spec

**Ngày:** 2026-11-23 · **Trạng thái:** Approved
**Nhánh nền:** `main` sau PR #12 (page builder: `@opencloudcms/core/blocks`, `defineBlock` + `b.*`, Puck 0.24.1, `resolvePage`, `/admin/pages`, website renderer + draft preview).
**Liên quan:** `2026-11-23-page-builder-preview-design.md` (gọi tắt "spec page builder", § ở dạng PB§n).

## 1. Mục đích

Dựng **block mới bằng kéo thả** trong admin, thay vì viết TSX `defineBlock` bằng tay, và **lưu block thành code trong project** (commit git, review, deploy như schema). Block dựng xong xuất hiện trong page builder như mọi block khác. Mục tiêu chung giữ nguyên từ page builder: dựng website nhanh, người kéo thả chủ yếu là lập trình viên nhưng đủ dễ cho người ít biết kỹ thuật.

Block có thể **gắn với một content type (tuỳ chọn)**:
- **Theo id:** người dựng trang chọn một entry; block hiển thị entry đó (thẻ sản phẩm).
- **Theo tệp:** block hiển thị danh sách entry theo **điều kiện lọc cố định** (ví dụ sản phẩm `active = true`), sắp xếp và số lượng; canvas dựng mẫu cho một phần tử và cách xếp (lưới/danh sách).
- **Không gắn:** block chỉ có field nhập tay.

Owner: các lựa chọn hay dùng nên là **tuỳ chọn có sẵn** (công tắc, ô chọn) để dễ chọn.

## 2. Mục tiêu, không làm, phản mục tiêu

### Mục tiêu
- Admin có **Cài đặt → Block** (`/admin/settings/blocks`): danh sách block của project (block dựng bằng builder + block viết tay, chỉ xem), tạo/sửa/xoá block dựng bằng builder.
- Builder kéo thả các **phần tử design system** lồng nhau trên canvas Puck; mỗi thuộc tính hiển thị của phần tử lấy giá trị từ một trong ba nguồn: **field content type**, **field nhập tay** (người dựng trang điền), **cố định**.
- Lưu thành file `src/blocks/<kebab>/<kebab>.block.ts` chứa `defineComposedBlock({...})` (dữ liệu, không JSX) — cùng cách Content Type Builder ghi `*.schema.ts`. Mở lại sửa được mãi.
- Một renderer chung biến mô tả thành `BlockDefinition` ⇒ page builder, preview, website, `blockManifest`, kiểm tra block lạ chạy không đổi.
- **Xuất ra TSX** (eject): sinh file `defineBlock` viết tay tương đương; từ đó builder không quản lý block đó nữa.
- Chỉ ghi được ở dev (`schemaEditable`), production chỉ xem — như Content Type Builder.

### Không làm (lần này)
- Toán tử lọc khác `=` (lớn hơn, trong khoảng, chứa…): list API hiện chỉ hỗ trợ bằng (`filter[field]=v`) và `documentId[in]`. Ghi việc sau.
- Nhúng block khác (core hoặc project) làm phần tử bên trong block dựng bằng builder. Thay vào đó có phần tử **Slot** (vùng thả block khi dựng trang).
- Populate sâu reference (`product.brand.name`): chỉ field trực tiếp của entry (như PB§6.3).
- Sửa block viết tay (TSX) trong builder; đọc ngược TSX.
- Sinh hàm `migrate` tự động khi đổi field.
- Tương tác phía client trong block dựng bằng builder (carousel, tab…).

### Phản mục tiêu
- Block dựng bằng builder trông/chạy **khác** nhau giữa canvas builder, canvas page builder và website.
- Người dựng trang **gỡ được điều kiện lọc cố định** (ví dụ thấy sản phẩm ngừng bán trong block "Sản phẩm đang bán").
- Lưu block làm hỏng trang đang dùng nó mà không cảnh báo (đổi tên, xoá, bỏ field).
- File sinh ra không đọc/diff được trong git, hoặc ghi đè code viết tay.
- Builder ghi file ở production.

## 3. Ràng buộc từ hệ thống hiện có

- `src/blocks/index.ts` của project (do `init` sinh) export `defineBlocks([...coreBlocks, ...])`; được import bởi admin (`AdminWithBlocks.tsx`), website (`[[...path]]/page.tsx`) và Nest (`app.module.ts` → `blockManifest(blocks)` qua build CJS `dist/blocks-cjs`).
- Nest tính `blockManifest` **một lần lúc boot**; publish trang kiểm tra block lạ theo manifest (PB§6.5).
- Dev: Next tự nạp lại khi file trong `src/blocks` đổi. Production: phải build lại.
- Block phải isomorphic, không import CSS, class Tailwind viết nguyên chuỗi (lookup table) để `@source` quét được.
- Lọc/sắp xếp chỉ trên field `indexed`/`unique`; lọc chỉ có `=`.
- `b.entry(apiId)`, `b.entries(apiId, { limit, sortable, filterable, apiIdFrom })`, `resolvePage` (gộp request, nuốt lỗi fetch), `writePageContent` (bỏ prop không khai báo), `_v`/`version`/`migrate` đã có.
- Content Type Builder: `SchemaBuilderService` (dev-only `assertEditable`, `SchemaWriteQueue`, `captureProjectFiles`/`restoreProjectFiles`, printer của `@opencloudcms/codegen`, loader `jiti`).
- Quyền (Spec B): mục Cài đặt cần quyền `settings.*`.

## 4. Cách tiếp cận

| | Cách | Đánh đổi | Kết luận |
|---|---|---|---|
| **A** | Lưu **mô tả** `defineComposedBlock({...})` trong `*.block.ts`; renderer chung; nút "Xuất ra TSX" | Mở lại mãi, file đọc/diff được, một nguồn sự thật, giống `*.schema.ts`. Dev không chỉnh JSX trực tiếp (trừ khi xuất TSX) | **Owner chọn** |
| B | Sinh thẳng TSX `defineBlock` + file `.json` mô tả để mở lại | Dev thấy JSX thật; hai file phải khớp, dễ ghi đè code sửa tay | Loại |
| — | Chỉ sinh TSX rồi phân tích ngược | Code tuỳ ý không đọc ngược ổn định | Loại |

## 5. File block và mô tả

### 5.1 File

```ts
// src/blocks/product-card/product-card.block.ts — OpenCloudCMS ghi file này từ Cài đặt → Block. Sửa ở đây hoặc trong builder.
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_7f3a2c',                       // ổn định, không đổi khi đổi nhãn
  name: 'ProductCard',                    // khoá lưu trong dữ liệu trang; KHÔNG đổi sau lần lưu đầu
  label: { 'en-US': 'Product card', 'vi-VN': 'Thẻ sản phẩm' },
  category: 'commerce',
  icon: 'shopping-bag',
  version: 1,
  binding: {                              // tuỳ chọn; bỏ đi = không gắn content type
    apiId: 'product',
    mode: 'single',                       // 'single' (theo id) | 'collection' (theo tệp)
  },
  fields: {                               // field nhập tay cho người dựng trang
    ctaLabel: { kind: 'text', label: { 'en-US': 'Button label' }, default: 'Buy now' },
  },
  tree: {
    el: 'Card', props: { padding: '4' }, children: [
      { el: 'Image', bind: { src: { from: 'entry', path: 'image' }, alt: { from: 'entry', path: 'name' } } },
      { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Price', bind: { value: { from: 'entry', path: 'price' } } },
      { el: 'Button', props: { variant: 'default' }, bind: { label: { from: 'field', name: 'ctaLabel' }, href: { from: 'entryUrl' } } },
    ],
  },
});
```

Chế độ theo tệp:

```ts
binding: {
  apiId: 'product',
  mode: 'collection',
  filter: [{ field: 'active', value: true }],     // cố định, luôn áp dụng (AND), người dựng trang không gỡ được
  sort: { field: 'createdAt', direction: 'desc' },
  limit: 8,
  layout: { kind: 'grid', columns: 4 },           // 'grid' (2–6 cột) | 'list'
  options: {
    editorFilter: false,     // người dựng trang được thêm điều kiện lọc (AND với filter cố định)
    editorSort: true,        // người dựng trang được đổi sắp xếp
    editorLimit: true,       // người dựng trang được đổi số lượng (1–100)
    editorLayout: false,     // người dựng trang được đổi lưới/danh sách và số cột
    emptyText: { 'en-US': 'No products yet' },  // hiện khi danh sách rỗng
  },
},
tree: { /* mẫu cho MỘT phần tử, nguồn { from: 'entry', ... } là phần tử đang lặp */ }
```

- File do printer của `@opencloudcms/codegen` in (header "managed by OpenCloudCMS", định dạng ổn định, khoá theo thứ tự cố định) ⇒ diff gọn.
- Dev được sửa tay file này; builder đọc lại bằng loader (`jiti`) như schema. Nếu file không còn hợp lệ, builder báo lỗi (không ghi đè).

### 5.2 Index của project

- Builder **không sửa** `src/blocks/index.ts` viết tay. Thay vào đó sinh `src/blocks/composed.ts` (managed): `export const composedBlocks = [ProductCard, ...]` (import mọi file `*.block.ts` có `defineComposedBlock`, sắp theo `name`).
- `init` (template mới) và `examples/my-store`: `defineBlocks([...coreBlocks, ...composedBlocks, ProductGrid])`. Project cũ: CHANGELOG + README hướng dẫn thêm một dòng; builder phát hiện `index.ts` chưa import `composedBlocks` → hiện cảnh báo kèm dòng cần thêm (không tự sửa).

### 5.3 Phần tử (`el`)

Hiện `library/ui.tsx` chỉ có `LinkButton`, `BadgePill`, `CardBox` và các bảng tra class. Việc này **tạo bộ primitive công khai** `packages/core/blocks/src/ui/` (export `@opencloudcms/core/blocks` dưới tên `ui`, ví dụ `ui.Heading`), dựng lại từ các bảng tra hiện có; `coreBlocks` chuyển sang dùng chúng khi tiện, renderer §6 và file "Xuất ra TSX" dùng chung bộ này ⇒ render giống hệt. *(Quyết định của người viết spec.)*

| Nhóm | Phần tử | Thuộc tính gắn được (`bind`) | Thuộc tính cố định chính (`props`) |
|---|---|---|---|
| Bố cục | `Box`, `Stack` (dọc/ngang), `Columns` (2–4), `Grid` (2–6) | — | padding, gap, nền (token), căn |
| Bố cục | `Card` | — | padding, viền, nền |
| Bố cục | `Slot` | — | allow, max (vùng thả block trong page builder) |
| Nội dung | `Heading` | text | level 1–4, căn |
| Nội dung | `Text` | text (chuỗi) hoặc html (rich text) | cỡ chữ, màu (token) |
| Nội dung | `Image` | src, alt | tỉ lệ, bo góc |
| Nội dung | `Button` | label, href | biến thể, cỡ |
| Nội dung | `Badge` | text | biến thể |
| Nội dung | `Price` | value (money/number) | `Intl.NumberFormat` theo locale đang render; field `money` có `currencyMode: 'fixed'` → hiện tiền tệ đó, `market` → số thuần |
| Nội dung | `Date` | value (date/datetime) | `Intl.DateTimeFormat` theo locale đang render, kiểu ngắn/dài |
| Nội dung | `Divider`, `Spacer` | — | kích thước |

- Mọi `props` chỉ nhận **token** (màu, khoảng cách, cỡ) như `b.color`/`b.spacing` (PB§5.2) ⇒ block luôn theo design system.
- Mỗi phần tử có thể có điều kiện hiển thị đơn giản: `showIf: { from, path|name, is: 'present' | 'absent' }` (ví dụ chỉ hiện Badge "Sale" khi `salePrice` có giá trị). *(Quyết định của người viết spec: phổ biến, rẻ.)*

### 5.4 Nguồn giá trị (`bind`)

| Nguồn | Ý nghĩa | Chỉ khi |
|---|---|---|
| `{ from: 'entry', path }` | field trực tiếp của entry (theo id: entry đã chọn; theo tệp: phần tử đang lặp) | block gắn content type |
| `{ from: 'entryUrl' }` | URL chi tiết của entry, dựng từ `binding.urlPattern` (ví dụ `/products/{slug}`; placeholder là tên field trực tiếp, giá trị theo locale đang render, không tiền tố locale vì website chưa định tuyến theo locale). Thiếu giá trị placeholder → không có link (phần tử Button render dạng không link). Chưa khai báo `urlPattern` → nguồn này không chọn được. Không kiểm tra trang đích có tồn tại (v1 chưa có template content type). *(Quyết định của người viết spec.)* | block gắn content type |
| `{ from: 'field', name }` | field nhập tay của block | luôn |
| `{ from: 'const', value }` | giá trị cố định (cũng có thể đặt trực tiếp trong `props`) | luôn |

- Kiểu phải khớp: builder chỉ cho chọn field content type có kind phù hợp với thuộc tính (text ← text/longText/slug/email; html ← richText; src ← asset/url; value ← number/money cho Price, date/datetime cho Date; href ← url). Field `multiple`/reference không chọn được (không populate).
- Field nhập tay hỗ trợ kind: `text`, `longText`, `richText`, `number`, `boolean`, `select`, `image`, `link` — dịch thẳng sang `b.*` tương ứng.

## 6. Renderer: `defineComposedBlock(spec) → BlockDefinition`

- **Locale lúc render:** block hiện không nhận locale. `resolvePage` gắn prop dành riêng `_locale` (cùng nhóm với `_v`, không lưu vào dữ liệu trang, bị `writePageContent` bỏ) cho item của block composed; canvas editor/builder gắn cùng giá trị. *(Quyết định của người viết spec; React context không dùng được trong server component.)*
- **Hình dạng giá trị entry:** builder (người làm plan) kiểm tra API content trả về gì cho `asset` (id / URL / object), `money`, `date`, `boolean` và viết bộ đọc giá trị tương ứng trong renderer; `Image.alt` mặc định lấy `alt` của asset rồi rỗng.

Trong `@opencloudcms/core/blocks` (cả ESM lẫn CJS):

- `fields` của `BlockDefinition`:
  - field nhập tay → `b.*` tương ứng;
  - `mode: 'single'` → field `entry: b.entry(apiId)`;
  - `mode: 'collection'` → field `entries: b.entries(apiId, { limit, sortable: editorSort, filterable: editorFilter, baseFilter, defaultSort })` và, nếu `editorLayout`, field `layout`;
  - có phần tử `Slot` → `b.slot(...)`.
- **Điều kiện lọc cố định** được thực thi lúc resolve, không lưu trong dữ liệu trang: thêm tuỳ chọn `baseFilter` cho `b.entries`; `resolvePage` ghép `baseFilter` (AND) với filter người dựng trang, **`baseFilter` thắng khi trùng field**. Vì vậy dữ liệu trang cũ/sửa tay không gỡ được điều kiện. `editorLimit: false` ⇒ dùng `limit` của block bất kể giá trị lưu.
- Điều kiện lọc gửi qua `ContentFetcher.query` dạng chuỗi (`true`/`false`, số); builder (người làm plan) kiểm tra list API ép kiểu đúng cho cột boolean/number và thêm test.
- `render` duyệt `tree`, lấy giá trị theo `bind`, render primitive. Theo tệp: render `layout` (grid/list, class từ lookup table) với mẫu cho từng entry; rỗng → `emptyText` (hoặc không gì). Theo id mà chưa chọn entry → khung placeholder trong editor, không gì trên website.
- `Slot` không được nằm trong mẫu lặp của chế độ theo tệp (lỗi validate). `editorFilter`/`editorSort`/`editorLimit`/`editorLayout` chỉ có nghĩa ở chế độ theo tệp.
- `version`: builder tự tăng khi lưu thay đổi làm **mất tương thích** (bỏ/đổi tên field nhập tay, đổi `binding.apiId` hoặc `mode`). So sánh với file đang có trên đĩa. Không sinh `migrate`; prop cũ bị `writePageContent` bỏ khi lưu lại trang (đã có).
- Đường dẫn `bind`/`filter`/`sort` trỏ tới field không còn tồn tại lúc render → giá trị rỗng (không lỗi), cảnh báo một lần.
- `name` validate như `defineBlock` (PascalCase, duy nhất trong `defineBlocks`, không trùng block core/viết tay).

## 7. Backend (Nest)

### 7.1 API (`/api/admin/blocks`, quyền `settings.content-types` — cùng nhóm "schema của project")

- `GET /api/admin/blocks` → `{ editable, composedIndexWired: boolean, data: [{ name, label, category, source: 'core' | 'code' | 'composed', file?, version, usage: number /* số trang (draft+published) dùng block */ }] }`. Nguồn dữ liệu: manifest hiện tại + file `*.block.ts` có `defineComposedBlock`.
- `GET /api/admin/blocks/:name` → spec của block composed (đọc file qua loader). Block `code`/`core` → 409 `not_composed`.
- `PUT /api/admin/blocks/:name` body `{ spec }`:
  - không editable → cùng `ForbiddenException` như Builder;
  - spec sai (schema zod) → 422 kèm `issues`;
  - `name` trùng block core/code → 409 `block_name_taken`; đổi `name` của block đã có → 422 `name_immutable`;
  - thay đổi mất tương thích mà block đang được dùng và request không có `confirmBreaking: true` → 409 `block_in_use` `{ issues: [{ path: [name], message: '<số trang>' }] }`;
  - hợp lệ → (trong `SchemaWriteQueue`, snapshot + restore khi lỗi) ghi file block, sinh lại `src/blocks/composed.ts`, **cập nhật manifest trong bộ nhớ** (manifest tính được trực tiếp từ spec, không cần nạp lại block TSX) ⇒ publish trang dùng block mới không bị `unknown_block` khi chưa restart.
- `DELETE /api/admin/blocks/:name` → đang dùng và không có `?force=1` → 409 `block_in_use`; ngược lại xoá thư mục block, sinh lại `composed.ts`, bỏ khỏi manifest.
- `POST /api/admin/blocks/:name/eject` → (sinh code render giống hệt ở mọi locale vì dùng cùng primitive và `_locale`) sinh `src/blocks/<kebab>/<kebab>.block.tsx` (`defineBlock` + JSX tương đương, import primitive từ `@opencloudcms/core/blocks`), xoá file `.block.ts`, sinh lại `composed.ts`; trả về đường dẫn file và dòng import cần thêm vào `src/blocks/index.ts` (không tự sửa index viết tay). Dev-only.
- Mọi file ghi ra trả về danh sách "Commit these files" như Builder.

### 7.2 Manifest
- Lúc boot: block composed nằm trong `defineBlocks` của project (qua `composedBlocks`) ⇒ `blockManifest(blocks)` đã gồm chúng, không cần đường nạp riêng.
- Thay manifest giá trị cố định bằng một service giữ manifest có thể cập nhật (`PageBlocksManifest`), dùng chung cho hook publish, chuẩn hoá rich text và `blocks-check`. `PUT`/`DELETE`/eject cập nhật mục của block đó (kể cả danh sách đường dẫn rich text, tính trực tiếp từ spec).
- `usage` trong `GET /api/admin/blocks`: quét toàn bộ `content` của trang (draft + published, mọi locale) bằng `collectBlockNames` như `blocks-check`; chấp nhận cho trang admin.

### 7.3 Đổi content type làm hỏng block
- Lưu block: kiểm tra mọi `bind`/`filter`/`sort` trỏ tới field có thật, đúng kind, filter/sort chỉ field `indexed`/`unique` → 422 nếu sai.
- Content Type Builder: `preview`/`apply` thêm **cảnh báo** (không chặn) liệt kê block composed tham chiếu field bị xoá/đổi tên/bỏ index hoặc content type bị xoá. `GET /api/admin/blocks` trả thêm `problems: string[]` mỗi block để danh sách hiện cảnh báo.

### 7.4 Sample data cho canvas
Không cần API mới: builder dùng `/api/admin/content/:apiId` (draft) với cùng `baseFilter`/sort/limit để lấy entry mẫu (theo id: entry đầu tiên hoặc entry dev chọn).

## 8. Admin

### 8.1 Danh sách (`/admin/settings/blocks`)
- Mục mới trong `settingsItems`, quyền `settings.content-types`.
- Bảng: nhãn, `name`, category, nguồn (Core / Code / Builder), số trang đang dùng. Hành động cho block Builder: Sửa, Xuất TSX, Xoá (`ConfirmDialog` nêu số trang). Production: chỉ xem + thông báo như Builder.
- Banner khi `composedIndexWired === false`: dòng cần thêm vào `src/blocks/index.ts`.

### 8.2 Builder (`/admin/settings/blocks/:name` hoặc `new`, toàn màn hình)

```
┌ ← Block | Thẻ sản phẩm  ProductCard  [Content type: product ▾] [Theo id | Theo tệp]   ↶ ↷  📱💻🖥   Lưu ┐
├──────────────┬────────────────────────────────────────────┬──────────────────────────────────────────┤
│ Phần tử      │ canvas (Puck iframe, dữ liệu mẫu)          │ [Phần tử] Tiêu đề                         │
│ ▸ Bố cục     │  ┌───────────┐ ┌───────────┐               │  Nguồn text: ◉ product.name ▾             │
│   Box Stack  │  │ [ảnh]     │ │ [ảnh]     │  (theo tệp:  │              ○ Field nhập tay ▾ (+ tạo)   │
│   Columns …  │  │ Tên SP    │ │ Tên SP    │   lặp mẫu)   │              ○ Cố định: [        ]        │
│ ▸ Nội dung   │  │ 1.200.000 │ │ 990.000   │               │  Cấp: H3 ▾  Căn: trái ▾  Màu: token ▾     │
│   Heading …  │  └───────────┘ └───────────┘               │  Hiện khi: luôn ▾                         │
│ ▸ Cây        │                                            │ [Block] nhãn 4 ngôn ngữ, category, icon,  │
│              │                                            │  field nhập tay, lọc cố định, tuỳ chọn    │
└──────────────┴────────────────────────────────────────────┴──────────────────────────────────────────┘
```

- Canvas: Puck (`@puckeditor/core` 0.24.1) với config sinh từ danh sách phần tử §5.3; cây Puck ⇄ `tree` của spec (chuyển đổi hai chiều thuần, có test). Preview dùng renderer §6 với entry mẫu ⇒ giống hệt page builder và website.
- Panel phải, khi chọn **block** (không chọn phần tử nào): nhãn (4 locale, en-US bắt buộc), `name` (chỉ sửa được khi chưa lưu lần nào; gợi ý từ nhãn en-US), category, icon; danh sách field nhập tay (thêm/sửa/xoá, kind, nhãn, mặc định); khi gắn content type: chế độ, **điều kiện lọc cố định** (chỉ field `indexed`/`unique`, giá trị theo kind: boolean → công tắc, select → ô chọn, text/number → ô nhập; field chưa index hiện mờ kèm gợi ý "bật Indexed trong Content type"), sắp xếp mặc định, số lượng, layout, các công tắc `options`, `urlPattern`.
- Panel phải, khi chọn **phần tử**: thuộc tính cố định (token) + mỗi thuộc tính gắn được có ô chọn nguồn (field content type phù hợp kind / field nhập tay / cố định) + `showIf`.
- Lưu: hiện tóm tắt thay đổi; nếu 409 `block_in_use` → hộp xác nhận nêu số trang và các field bị bỏ → gửi lại với `confirmBreaking`. Sau khi lưu: danh sách file cần commit; ở dev, page builder nhận block mới sau khi Next nạp lại (không cần restart Nest nhờ manifest cập nhật trong bộ nhớ).
- Nhãn UI vào 4 bộ dịch admin.

## 9. `init`, example, tài liệu

- `init`: `src/blocks/composed.ts` rỗng (`export const composedBlocks = []`), `src/blocks/index.ts` ghép `composedBlocks`.
- `examples/my-store`: block Builder mẫu `ProductCard` (theo id) và `ActiveProducts` (theo tệp, `active = true` — thêm field `active` boolean indexed vào `product` nếu chưa có), dùng trong trang seed.
- README/packages/core README: `defineComposedBlock`, phần tử, nguồn, lọc cố định, giới hạn; CHANGELOG.

## 10. Kiểm thử

- **Unit (blocks):** validate spec (name, phần tử lạ, bind sai kind, field nhập tay trùng, filter trên field không index — kiểm ở API vì cần registry); `defineComposedBlock` → fields đúng cho 3 chế độ; render theo id/tệp/không gắn bằng `renderToString` (giá trị đúng chỗ, token → class, `showIf`, rỗng → `emptyText`); `baseFilter` thắng filter người dựng trang trong `resolvePage`; `editorLimit: false` bỏ qua limit lưu; chuyển đổi Puck ⇄ `tree` hai chiều; eject sinh TSX biên dịch được và render giống hệt (so `renderToString`).
- **Codegen:** printer in file ổn định (in → nạp → in lại giống hệt); `composed.ts` sắp theo name.
- **Integration (Postgres):** `PUT` tạo file + `composed.ts` + manifest cập nhật (publish trang dùng block mới không 422 khi chưa restart); 403 khi không editable; 422 spec sai / `name_immutable`; 409 `block_name_taken`; 409 `block_in_use` rồi thành công với `confirmBreaking`; `DELETE` 409 khi đang dùng, `force`; lỗi giữa chừng → mọi file trả về như cũ; eject.
- **Admin:** route mới, quyền, form điều kiện lọc chỉ field indexed, tăng `version` khi mất tương thích (hàm thuần).
- **Smoke:** dev-mode không chạy được trong smoke prod ⇒ smoke dùng block composed có sẵn trong project sinh ra (ghi file spec trước khi build): trang dùng block theo tệp chỉ hiện entry `active = true`; sửa giá trị lọc trong dữ liệu trang bằng API không làm hiện entry ngừng bán.

## 11. Quyết định

**Owner chốt:** kéo thả dựng block, lưu trong code; gắn content type là tuỳ chọn; chế độ theo id hoặc theo tệp có điều kiện lọc (ví dụ active); nhiều tuỳ chọn có sẵn; cách A (mô tả + renderer chung + xuất TSX).

**Người viết spec tự quyết (owner kiểm tra khi đọc):**
- Điều kiện lọc của block là cố định; người dựng trang mặc định không được thêm lọc (`editorFilter: false`), bật được bằng tuỳ chọn.
- Chỉ toán tử `=` ở v1.
- Không nhúng block khác; có phần tử `Slot`.
- `name` không đổi sau lần lưu đầu.
- `composed.ts` sinh riêng, không sửa `index.ts` viết tay.
- Manifest cập nhật trong bộ nhớ khi lưu/xoá.
- `showIf` đơn giản (có/không có giá trị).
- `entryUrl` chỉ khi khai báo `urlPattern`.
- Quyền dùng `settings.content-types`.
- Bộ primitive công khai `ui` trong `@opencloudcms/core/blocks` (§5.3).
- Prop dành riêng `_locale` để block biết locale (§6); Price/Date dùng `Intl`.
- Manifest có thể cập nhật trong bộ nhớ (§7.2); quét toàn bộ trang để đếm `usage`.
- `entryUrl` theo `urlPattern`, không tiền tố locale, không kiểm tra trang đích (§5.4).
- Đổi content type: lưu block bị chặn nếu sai; đổi schema chỉ cảnh báo; lúc render field thiếu → rỗng (§7.3).
- `Slot` không được trong mẫu lặp; các tuỳ chọn `editor*` chỉ ở chế độ theo tệp (§6).
- Tự tăng `version` khi mất tương thích, không sinh `migrate`.

## 12. Rủi ro và giới hạn

1. Production cần build lại để thấy block mới (như schema).
2. Printer phải in lại ổn định để diff gọn; dev sửa tay sai định dạng ⇒ builder báo lỗi thay vì ghi đè.
3. Renderer chung giới hạn biểu đạt (không logic tuỳ ý) — có "Xuất ra TSX" khi cần.
4. Lọc chỉ `=` trên field indexed — nhiều trường hợp thực tế (giá > X, tồn kho > 0) phải chờ mở rộng list API.
