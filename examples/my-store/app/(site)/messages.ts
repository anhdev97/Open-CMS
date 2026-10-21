// Strings of the website. Server components import the helpers from '@opencms/core';
// client components ('use client') must import them from '@opencms/core/admin' instead.
import { defineMessages } from '@opencms/core';

export const messages = defineMessages({
  'en-US': {
    home: {
      tagline: 'A website and its OpenCMS admin, served by one Next.js app.',
      openAdmin: 'Open admin',
    },
  },
  'vi-VN': {
    home: {
      tagline: 'Một website và trang quản trị OpenCMS, chạy trong cùng một ứng dụng Next.js.',
      openAdmin: 'Mở trang quản trị',
    },
  },
});
