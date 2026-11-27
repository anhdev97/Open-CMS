// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_mobilemenu01',
  name: 'MobileMenu',
  label: { 'en-US': 'Mobile menu', 'vi-VN': 'Menu di động' },
  category: 'overlay',
  icon: 'menu',
  version: 1,
  fields: {
    title: { kind: 'text', label: { 'en-US': 'Title', 'vi-VN': 'Tiêu đề' }, default: 'Menu' },
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
      label: { 'en-US': 'Menu 2 label (Shop menu)', 'vi-VN': 'Nhãn menu 2 (menu Cửa hàng)' },
      default: 'Shop',
    },
    nav2Link: {
      kind: 'link',
      label: { 'en-US': 'Menu 2 link', 'vi-VN': 'Liên kết menu 2' },
      default: { kind: 'url', href: '/shop' },
    },
    shop1Label: {
      kind: 'text',
      label: { 'en-US': 'Shop menu: item 1', 'vi-VN': 'Menu Cửa hàng: mục 1' },
      default: 'Tops',
    },
    shop1Link: {
      kind: 'link',
      label: { 'en-US': 'Shop menu: link 1', 'vi-VN': 'Menu Cửa hàng: liên kết 1' },
      default: { kind: 'url', href: '/shop/ao' },
    },
    shop2Label: {
      kind: 'text',
      label: { 'en-US': 'Shop menu: item 2', 'vi-VN': 'Menu Cửa hàng: mục 2' },
      default: 'Trousers',
    },
    shop2Link: {
      kind: 'link',
      label: { 'en-US': 'Shop menu: link 2', 'vi-VN': 'Menu Cửa hàng: liên kết 2' },
      default: { kind: 'url', href: '/shop/quan' },
    },
    shop3Label: {
      kind: 'text',
      label: { 'en-US': 'Shop menu: item 3', 'vi-VN': 'Menu Cửa hàng: mục 3' },
      default: 'Accessories',
    },
    shop3Link: {
      kind: 'link',
      label: { 'en-US': 'Shop menu: link 3', 'vi-VN': 'Menu Cửa hàng: liên kết 3' },
      default: { kind: 'url', href: '/shop/phu-kien' },
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
    el: 'Overlay',
    props: { variant: 'drawer', side: 'left', size: 'sm' },
    children: [
      {
        el: 'Stack',
        props: { direction: 'vertical', gap: '6', align: 'start' },
        children: [
          { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'title' } } },
          {
            el: 'Stack',
            props: { direction: 'vertical', gap: '3', align: 'start' },
            children: [
              {
                el: 'Button',
                props: { variant: 'link', size: 'default' },
                bind: { label: { from: 'field', name: 'nav1Label' }, href: { from: 'field', name: 'nav1Link' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
              },
              {
                el: 'Dropdown',
                props: {
                  openOn: 'click',
                  placement: 'bottom-start',
                  display: { base: 'inline' },
                  triggerVariant: 'ghost',
                  chevron: true,
                },
                bind: { label: { from: 'field', name: 'nav2Label' }, href: { from: 'field', name: 'nav2Link' } },
                children: [
                  {
                    el: 'Stack',
                    props: { direction: 'vertical', gap: '2', align: 'start' },
                    children: [
                      {
                        el: 'Button',
                        props: { variant: 'link', size: 'default' },
                        bind: {
                          label: { from: 'field', name: 'shop1Label' },
                          href: { from: 'field', name: 'shop1Link' },
                        },
                        style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
                      },
                      {
                        el: 'Button',
                        props: { variant: 'link', size: 'default' },
                        bind: {
                          label: { from: 'field', name: 'shop2Label' },
                          href: { from: 'field', name: 'shop2Link' },
                        },
                        style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
                      },
                      {
                        el: 'Button',
                        props: { variant: 'link', size: 'default' },
                        bind: {
                          label: { from: 'field', name: 'shop3Label' },
                          href: { from: 'field', name: 'shop3Link' },
                        },
                        style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
                      },
                    ],
                  },
                ],
                style: { color: 'brand:ink' },
              },
              {
                el: 'Button',
                props: { variant: 'link', size: 'default' },
                bind: { label: { from: 'field', name: 'nav3Label' }, href: { from: 'field', name: 'nav3Link' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
              },
            ],
          },
        ],
      },
    ],
    style: {
      padding: { t: '6', r: '6', b: '6', l: '6' },
      background: 'brand:surface',
      color: 'brand:ink',
    },
  },
});
