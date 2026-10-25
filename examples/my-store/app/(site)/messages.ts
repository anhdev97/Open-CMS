// Strings of the website. Server components import the helpers from '@opencloudcms/core';
// client components ('use client') must import them from '@opencloudcms/core/admin' instead.
import { defineMessages } from '@opencloudcms/core';

export const messages = defineMessages({
  'en-US': {
    home: {
      tagline: 'A website and its OpenCloudCMS admin, served by one Next.js app.',
      openAdmin: 'Open admin',
    },
  },
  'vi-VN': {
    home: {
      tagline: 'Một website và trang quản trị OpenCloudCMS, chạy trong cùng một ứng dụng Next.js.',
      openAdmin: 'Mở trang quản trị',
    },
  },
});
