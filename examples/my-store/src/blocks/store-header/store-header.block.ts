// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_storeheader01',
  name: 'StoreHeader',
  label: { 'en-US': 'Store header', 'vi-VN': 'Đầu trang cửa hàng' },
  category: 'layout',
  icon: 'panel-top',
  version: 1,
  fields: {
    brand: {
      kind: 'text',
      label: { 'en-US': 'Wordmark', 'vi-VN': 'Tên thương hiệu' },
      default: 'my-store',
    },
    nav1Label: {
      kind: 'text',
      label: { 'en-US': 'Menu 1 label', 'vi-VN': 'Nhãn menu 1' },
      default: 'Home',
    },
    nav1Link: {
      kind: 'link',
      label: { 'en-US': 'Menu 1 link', 'vi-VN': 'Liên kết menu 1' },
      default: { kind: 'url', href: '/' },
    },
    nav2Label: {
      kind: 'text',
      label: { 'en-US': 'Menu 2 label', 'vi-VN': 'Nhãn menu 2' },
      default: 'Shop',
    },
    nav2Link: {
      kind: 'link',
      label: { 'en-US': 'Menu 2 link', 'vi-VN': 'Liên kết menu 2' },
      default: { kind: 'url', href: '/shop' },
    },
    nav3Label: {
      kind: 'text',
      label: { 'en-US': 'Menu 3 label', 'vi-VN': 'Nhãn menu 3' },
      default: 'About',
    },
    nav3Link: {
      kind: 'link',
      label: { 'en-US': 'Menu 3 link', 'vi-VN': 'Liên kết menu 3' },
      default: { kind: 'url', href: '/about' },
    },
  },
  tree: {
    el: 'Stack',
    props: {
      direction: { base: 'vertical', md: 'horizontal' },
      gap: '4',
      align: { base: 'start', md: 'center' },
      justify: 'between',
    },
    children: [
      { el: 'Text', props: { size: 'lg' }, bind: { text: { from: 'field', name: 'brand' } } },
      {
        el: 'Stack',
        props: { direction: 'horizontal', gap: '6', align: 'center', wrap: true },
        children: [
          {
            el: 'Button',
            props: { variant: 'link', size: 'sm' },
            bind: { label: { from: 'field', name: 'nav1Label' }, href: { from: 'field', name: 'nav1Link' } },
            style: { padding: { l: '0', r: '0' }, color: 'brand:ink' },
          },
          {
            el: 'Button',
            props: { variant: 'link', size: 'sm' },
            bind: { label: { from: 'field', name: 'nav2Label' }, href: { from: 'field', name: 'nav2Link' } },
            style: { padding: { l: '0', r: '0' }, color: 'brand:ink' },
          },
          {
            el: 'Button',
            props: { variant: 'link', size: 'sm' },
            bind: { label: { from: 'field', name: 'nav3Label' }, href: { from: 'field', name: 'nav3Link' } },
            style: { padding: { l: '0', r: '0' }, color: 'brand:ink' },
          },
        ],
      },
    ],
    style: {
      padding: { t: '14px', r: '5%', b: '14px', l: '5%' },
      minHeight: '76px',
      background: 'brand:surface',
      borderWidth: '1',
      borderColor: 'brand:line',
      borderSides: ['b'],
    },
  },
});
