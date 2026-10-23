import { defineMessages } from '@opencms/core';

export const messages = defineMessages({
  'en-US': {
    brand: 'Phone store',
    nav: { phones: 'Phones', admin: 'Admin' },
    home: {
      lead: 'Published phones from the OpenCMS admin. Vietnamese by default.',
      featured: 'Featured',
      empty: 'No phones published yet.',
      emptyHint: 'Run pnpm seed, or add a phone in the admin and publish it.',
    },
    catalog: {
      title: 'All phones',
      brands: 'Brand',
      categories: 'Category',
      all: 'All',
      empty: 'No phones match these filters.',
      clear: 'Clear filters',
    },
    detail: {
      back: 'All phones',
      brand: 'Brand',
      category: 'Category',
      storage: 'Storage',
      ram: 'RAM',
      color: 'Color',
      screen: 'Screen',
    },
  },
  'vi-VN': {
    brand: 'Cửa hàng điện thoại',
    nav: { phones: 'Điện thoại', admin: 'Quản trị' },
    home: {
      lead: 'Điện thoại đã xuất bản từ trang quản trị OpenCMS. Mặc định tiếng Việt.',
      featured: 'Nổi bật',
      empty: 'Chưa có điện thoại nào được xuất bản.',
      emptyHint: 'Chạy pnpm seed, hoặc thêm máy trong trang quản trị rồi xuất bản.',
    },
    catalog: {
      title: 'Tất cả điện thoại',
      brands: 'Hãng',
      categories: 'Danh mục',
      all: 'Tất cả',
      empty: 'Không có máy nào khớp bộ lọc.',
      clear: 'Xóa bộ lọc',
    },
    detail: {
      back: 'Tất cả điện thoại',
      brand: 'Hãng',
      category: 'Danh mục',
      storage: 'Bộ nhớ',
      ram: 'RAM',
      color: 'Màu',
      screen: 'Màn hình',
    },
  },
});
