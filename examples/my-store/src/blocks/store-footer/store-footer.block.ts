// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_storefooter01',
  name: 'StoreFooter',
  label: { 'en-US': 'Store footer', 'vi-VN': 'Chân trang cửa hàng' },
  category: 'layout',
  icon: 'panel-bottom',
  version: 1,
  fields: {
    brand: {
      kind: 'text',
      label: { 'en-US': 'Wordmark', 'vi-VN': 'Tên thương hiệu' },
      default: 'my-store',
    },
    tagline: {
      kind: 'text',
      label: { 'en-US': 'Tagline', 'vi-VN': 'Khẩu hiệu' },
      default: 'Clothing and accessories for every day.',
    },
    exploreTitle: {
      kind: 'text',
      label: { 'en-US': 'Menu title', 'vi-VN': 'Tiêu đề menu' },
      default: 'Explore',
    },
    link1Label: {
      kind: 'text',
      label: { 'en-US': 'Link 1 label', 'vi-VN': 'Nhãn liên kết 1' },
      default: 'Shop',
    },
    link1: {
      kind: 'link',
      label: { 'en-US': 'Link 1', 'vi-VN': 'Liên kết 1' },
      default: { kind: 'url', href: '/shop' },
    },
    link2Label: {
      kind: 'text',
      label: { 'en-US': 'Link 2 label', 'vi-VN': 'Nhãn liên kết 2' },
      default: 'About',
    },
    link2: {
      kind: 'link',
      label: { 'en-US': 'Link 2', 'vi-VN': 'Liên kết 2' },
      default: { kind: 'url', href: '/about' },
    },
    contactTitle: {
      kind: 'text',
      label: { 'en-US': 'Contact title', 'vi-VN': 'Tiêu đề liên hệ' },
      default: 'Contact',
    },
    email: {
      kind: 'text',
      label: { 'en-US': 'Email', 'vi-VN': 'Email' },
      default: 'hello@example.com',
    },
    emailLink: {
      kind: 'link',
      label: { 'en-US': 'Email link', 'vi-VN': 'Liên kết email' },
      default: { kind: 'url', href: 'mailto:hello@example.com' },
    },
  },
  tree: {
    el: 'Box',
    children: [
      {
        el: 'Columns',
        props: {
          count: 3,
          tracks: { base: ['1fr', '1fr'], md: ['2fr', '1fr', '1fr'] },
          gapX: '42px',
          gapY: '24px',
        },
        children: [
          {
            el: 'Stack',
            props: { direction: 'vertical', gap: '2' },
            children: [
              { el: 'Text', props: { size: 'lg' }, bind: { text: { from: 'field', name: 'brand' } } },
              { el: 'Text', bind: { text: { from: 'field', name: 'tagline' } } },
            ],
            style: { span: { base: 'full', md: 1 } },
          },
          {
            el: 'Stack',
            props: { direction: 'vertical', gap: '2', align: 'start' },
            children: [
              {
                el: 'Heading',
                props: { level: 3 },
                bind: { text: { from: 'field', name: 'exploreTitle' } },
              },
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm' },
                bind: { label: { from: 'field', name: 'link1Label' }, href: { from: 'field', name: 'link1' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:accent-ink' },
              },
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm' },
                bind: { label: { from: 'field', name: 'link2Label' }, href: { from: 'field', name: 'link2' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:accent-ink' },
              },
            ],
          },
          {
            el: 'Stack',
            props: { direction: 'vertical', gap: '2', align: 'start' },
            children: [
              {
                el: 'Heading',
                props: { level: 3 },
                bind: { text: { from: 'field', name: 'contactTitle' } },
              },
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm' },
                bind: { label: { from: 'field', name: 'email' }, href: { from: 'field', name: 'emailLink' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:accent-ink' },
              },
            ],
          },
        ],
      },
    ],
    style: {
      padding: {
        base: { t: '30px', r: '5%', b: '30px', l: '5%' },
        md: { t: '72px', r: '5%', b: '72px', l: '5%' },
      },
      background: 'brand:accent',
      color: 'brand:accent-ink',
    },
  },
});
