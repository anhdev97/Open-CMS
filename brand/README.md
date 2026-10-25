# Bộ logo OpenCloudCMS

Dựa trên đúng mẫu đã chốt: đám mây xanh dương / xanh ngọc, các lớp nội dung, chữ OpenCloudCMS xanh navy.
SVG được vector hóa từ ảnh tham chiếu, gồm đường nét thực, không nhúng bitmap và không phụ thuộc font. Màu được chuẩn hóa thành màu phẳng; đường nét có thể khác nhẹ so với ảnh AI gốc.

## Chọn file

- `svg/logo-horizontal-color.svg`: logo chính cho header nền sáng.
- `svg/logo-horizontal-dark.svg`: giữ màu biểu tượng, chữ trắng cho nền tối.
- `svg/logo-horizontal-white.svg`: toàn bộ màu trắng.
- `svg/logo-horizontal-navy.svg`: đơn sắc navy.
- `svg/logo-stacked-color.svg`: biểu tượng trên, tên bên dưới.
- `svg/icon-*.svg`: biểu tượng riêng cho sidebar và avatar.
- `png/`: logo ngang / dọc rộng 400, 800, 1600 px; icon 64, 128, 256, 512, 1024 px. Các file logo và icon có nền trong suốt.
- `png/social-card-1200x630.png`: ảnh chia sẻ liên kết nền trắng.
- `favicon/`: favicon ICO nhiều cỡ, SVG, PNG 16/32/48, Apple Touch Icon 180 px, icon 192/512 và maskable 512 px.
- `source/approved-reference.png`: mẫu gốc để đối chiếu.

## Màu sắc và khoảng trống

Xanh dương `#2085FF`, xanh ngọc `#10BFAE`, navy `#09296B`, trắng `#FFFFFF`.
Để khoảng trống tối thiểu bằng chiều cao một lớp nội dung quanh logo. Logo ngang nên hiển thị từ 180 px trở lên. Ở kích thước nhỏ dùng biểu tượng riêng; icon 16 px chỉ mang tính nhận diện tổng thể, chi tiết lớp nội dung sẽ nhỏ.
Giữ đúng tỉ lệ, không kéo giãn, thêm bóng hoặc đặt bản navy trên nền tối.

## Gắn vào website

Copy thư mục `svg`, `png`, `favicon` vào `public/brand/`, sau đó thêm vào `<head>`:

```html
<link rel="icon" href="/brand/favicon/favicon.ico" sizes="any">
<link rel="icon" href="/brand/favicon/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/favicon/apple-touch-icon.png">
<link rel="manifest" href="/brand/favicon/site.webmanifest">
<meta name="theme-color" content="#09296B">
<meta property="og:image" content="https://YOUR-DOMAIN/brand/png/social-card-1200x630.png">
```

```html
<img src="/brand/svg/logo-horizontal-color.svg" alt="OpenCloudCMS" width="240">
```

Manifest chỉ cung cấp tên, màu và icon; khi làm PWA cần bổ sung start_url, scope và display theo website thực tế.

## Nguồn

`source/build.py` vector hóa ảnh đã chốt; `source/export.cjs` xuất PNG và ICO bằng Sharp. Đường dẫn runtime và nguồn ảnh trong script là của máy tạo bộ logo, cần điều chỉnh khi chạy trên máy khác.

## Trong repository

Admin nhúng SVG để package hoạt động mà không cần copy vào public của ứng dụng. Sau khi thay SVG, chạy `node scripts/generate-brand.mjs` để cập nhật `packages/core/admin/src/brand.ts`.
