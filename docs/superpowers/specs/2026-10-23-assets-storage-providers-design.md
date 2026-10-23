# opencms: Asset upload & storage providers — Design Spec

**Ngày:** 2026-10-23 · **Trạng thái:** Draft chờ review · **Package:** `@opencms/assets`  
**Thay thế / mở rộng:** `POST /api/admin/assets` chỉ đăng ký URL (v0); roadmap v0.2 “asset upload with storage adapters (local/S3)”

## 1. Mục tiêu và phạm vi

### Mục tiêu
- Upload file/ảnh qua Nest (multipart proxy), lưu qua **một** storage provider active: `local` | `s3` | `gcs`.
- Chuẩn SEO ảnh hướng Google: filename slug, URL HTTPS ổn định, `width`/`height`, WebP, biến thể `thumb` / `medium` / `large` cho `srcset`.
- `alt` không bắt buộc khi upload; admin **cảnh báo trên UI** khi gắn ảnh thiếu alt vào content field.
- Tách package `@opencms/assets` (giống hướng `@opencms/oauth2`); core chỉ config + wire.

### Trong phạm vi (v1)
- `StorageProvider` + `localServerProvider`, `s3Provider`, `gcsProvider`.
- Sync pipeline trên request upload: slug → (ảnh) sharp WebP + sizes → `put` → insert `opencms_assets`.
- Ảnh + file khác; chỉ `image/*` mới transform / variants.
- API: upload, list, patch `alt`, delete (DB + storage keys); giữ register-by-URL.
- Local: serve file dưới `publicBaseUrl` map `local.root`.
- Admin: upload qua endpoint mới; cảnh báo thiếu alt khi gắn vào field `asset`.

### Ngoài phạm vi
- Signed URL / direct-to-cloud upload.
- Async job queue cho variants.
- Image sitemap, `ImageObject` structured data, AVIF.
- Multi-provider đồng thời / migrate storage giữa providers.
- CDN invalidation, virus scan, video transcoding.

## 2. Quyết định chính

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Package `@opencms/assets`; core import module | Tránh kéo AWS/GCS SDK vào mọi consumer core; ranh giới rõ |
| D2 | Một provider active qua `OpenCmsModuleOptions.assets` | Đơn giản; đổi provider = config + deploy, không dual-write |
| D3 | Proxy multipart qua Nest cho cả 3 provider | Một API; v1 không cần signed-URL flow |
| D4 | Variants JSONB trên `opencms_assets` (Approach 1) | Đủ `srcset` ngay; không bảng variants / queue |
| D5 | Ảnh → WebP; non-image giữ nguyên | SEO/PageSpeed cho ảnh; file khác chỉ slug + URL |
| D6 | `alt` optional + `seo.missingAlt`; UI warn khi gắn content | Không chặn upload; vẫn nhắc SEO khi dùng |
| D7 | Giữ `POST /api/admin/assets` register-by-URL | Asset ngoài CMS / CDN sẵn có |
| D8 | Permission giữ R10: list `content.read`, mutate `content.update` | Khớp groups-permissions review |

## 3. Cấu trúc package `@opencms/assets`

| Khối | Trách nhiệm |
|---|---|
| `provider/` | `StorageProvider` (`put`, `delete`, `publicUrl`); `localServerProvider`, `s3Provider`, `gcsProvider` |
| `pipeline/` | Slug filename, detect image, sharp resize/WebP, assemble `variants` |
| `nest/` | `AssetsModule` (controllers + services); core `imports: [AssetsModule.forRoot(…)]` giống OAuth2 |
| `seo/` | Helpers: `missingAlt(asset)`, normalize slug |

**Peers / deps**
- `sharp` — pipeline ảnh (bắt buộc khi bật upload ảnh).
- `@aws-sdk/client-s3` — optional, chỉ khi `provider: 's3'`.
- `@google-cloud/storage` — optional, chỉ khi `provider: 'gcs'`.

**Ranh giới:** chỉ `provider/*` nói chuyện với disk/S3/GCS. Pipeline không biết Nest. Core không gọi SDK cloud trực tiếp.

## 4. Config

```ts
// OpenCmsModuleOptions
assets?: {
  provider: 'local' | 's3' | 'gcs';
  local?: { root: string; publicBaseUrl: string };
  s3?: {
    bucket: string;
    region: string;
    publicBaseUrl?: string; // CDN hoặc virtual-host URL
    // credentials: default AWS chain / env
  };
  gcs?: {
    bucket: string;
    publicBaseUrl?: string;
    // credentials: ADC / env
  };
  limits?: { maxBytes?: number; accept?: string[] }; // default hợp lý + field.accept khi từ content
  image?: {
    sizes?: { thumb?: number; medium?: number; large?: number }; // max edge px
    // defaults: 320 / 1280 / 1920
  };
};
```

Nếu `assets` omit: hành vi v0 — chỉ register-by-URL, không upload multipart (hoặc default `local` khi scaffold — quyết định khi implement plan; mặc định spec: **omit = không bật upload**, tránh ghi disk bất ngờ).

## 5. Dữ liệu

Migration core mới (vd. `000N_assets_storage`) trên `opencms_assets`:

| Cột | Type | Ý nghĩa |
|---|---|---|
| `storage_key` | text null | Key gốc trên provider; null nếu register-by-URL |
| `provider` | text null | `'local' \| 's3' \| 'gcs'`; null nếu external URL |
| `variants` | jsonb null | Xem shape bên dưới |

Giữ: `id`, `filename`, `url`, `mime_type`, `size`, `width`, `height`, `alt`, `metadata`, `created_at`.

**`variants` (ảnh):**
```ts
{
  original: { url, width, height, bytes, mimeType }; // WebP optimized
  thumb?:   { url, width, height, bytes, mimeType };
  medium?:  { url, width, height, bytes, mimeType };
  large?:   { url, width, height, bytes, mimeType };
}
```
Bỏ size nếu ảnh nguồn nhỏ hơn threshold (không upscale).  
`url` top-level = `variants.original.url`. `width`/`height`/`size`/`mime_type` mirror original.

**Non-image:** một object; `variants` = `{ original: { url, bytes, mimeType } }` (không width/height) hoặc chỉ dùng cột top-level + `variants: null` — **chốt implement: luôn có `variants.original`** để client đọc một shape.

**Object key:** `{yyyy}/{mm}/{slug}-{shortId}[_{variant}].{ext}`  
Ví dụ: `2026/10/anh-san-pham-a1b2.webp`, `…-a1b2_thumb.webp`.

## 6. API & luồng

| Method | Path | Permission | Hành vi |
|---|---|---|---|
| `POST` | `/api/admin/assets/upload` | `content.update` | multipart `file` + optional `alt` → pipeline → put(s) → insert → `{ data, seo: { missingAlt } }` |
| `GET` | `/api/admin/assets` | `content.read` | list; mỗi item kèm `variants`, `seo.missingAlt` |
| `PATCH` | `/api/admin/assets/:id` | `content.update` | cập nhật `alt` (và field an toàn khác nếu cần) |
| `DELETE` | `/api/admin/assets/:id` | `content.update` | xóa row; best-effort `delete` mọi storage key trong variants |
| `POST` | `/api/admin/assets` | `content.update` | register-by-URL (giữ); không pipeline; `storage_key`/`provider` null |

**Local serve:** static/ Nest route map `publicBaseUrl` → `local.root` (vd. `/media/*`).

**Lỗi**

| Case | HTTP |
|---|---|
| Thiếu file / mime không accept / vượt `maxBytes` | 400 / 413 |
| Provider lỗi | 502 (message an toàn, không lộ credentials) |
| Không tìm thấy | 404 |

## 7. Admin UI

- Asset/media picker dùng `POST …/upload`.
- Khi gắn ảnh vào field `asset`: nếu `seo.missingAlt` → cảnh báo visible (không block save/publish).
- Cho sửa `alt` nhanh (PATCH) từ picker hoặc asset detail.

## 8. Testing

- Unit: slug (unicode → kebab ASCII), skip variant khi nhỏ hơn size, `missingAlt`.
- Integration: upload + list + patch + delete với **local** provider; mock `StorageProvider` cho S3/GCS contract.
- Permission: khớp R10 (assets follow content read/update).

## 9. Rủi ro / ghi chú

- Sync sharp trên request: ảnh rất lớn có thể chậm / OOM — mitigations v1: `maxBytes`, giới hạn megapixel trong pipeline; async để sau.
- Optional cloud SDK: document rõ peerDependency; fail fast lúc boot nếu `provider: 's3'` mà thiếu package.
- Delete best-effort: nếu storage xóa fail, log + vẫn xóa DB hoặc ngược lại — **chốt: xóa storage trước, rồi DB**; nếu storage fail → 502, giữ row (tránh orphan URL trong content mà file còn). Nếu DB fail sau storage delete → log orphan key (ops). Chi tiết trong plan.

## 10. Tóm tắt quyết định đã chốt với product

| Chủ đề | Chốt |
|---|---|
| SEO | A+B: slug, alt soft, dimensions, WebP, thumb/medium/large |
| Upload path | Nest multipart proxy |
| File types | Ảnh + file khác |
| Alt | Optional; UI warn khi gắn content |
| Package | `@opencms/assets` |
| Architecture | Approach 1 — sync + variants JSONB |
