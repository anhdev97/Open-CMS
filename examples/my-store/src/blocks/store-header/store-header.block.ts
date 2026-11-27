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
      label: {
        'en-US': 'Store name (logo text alternative)',
        'vi-VN': 'Tên cửa hàng (văn bản thay thế logo)',
      },
      default: 'my-store',
    },
    logo: {
      kind: 'image',
      label: { 'en-US': 'Logo', 'vi-VN': 'Logo' },
      default: { src: '/files/store-logo.svg', alt: 'my-store' },
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
    contactLabel: {
      kind: 'text',
      label: { 'en-US': 'Contact button', 'vi-VN': 'Nút liên hệ' },
      default: 'Contact',
    },
    menuLabel: {
      kind: 'text',
      label: { 'en-US': 'Menu button (mobile)', 'vi-VN': 'Nút menu (di động)' },
      default: '☰ Menu',
    },
  },
  tree: {
    el: 'Stack',
    props: { direction: 'horizontal', gap: '4', align: 'center', justify: 'between' },
    children: [
      {
        el: 'Image',
        props: { fit: 'contain' },
        bind: {
          src: { from: 'field', name: 'logo' },
          alt: { from: 'field', name: 'brand' },
          href: { from: 'const', value: '/' },
        },
        style: { width: '132px' },
      },
      {
        el: 'Stack',
        props: { direction: 'horizontal', gap: '6', align: 'center' },
        children: [
          {
            el: 'Stack',
            props: { direction: 'horizontal', gap: '6', align: 'center', wrap: true },
            children: [
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm' },
                bind: { label: { from: 'field', name: 'nav1Label' }, href: { from: 'field', name: 'nav1Link' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
              },
              {
                el: 'Dropdown',
                props: {
                  openOn: 'hover',
                  placement: 'bottom-start',
                  display: { base: 'popover' },
                  triggerVariant: 'ghost',
                  chevron: true,
                },
                bind: { label: { from: 'field', name: 'nav2Label' }, href: { from: 'field', name: 'nav2Link' } },
                children: [
                  {
                    el: 'Stack',
                    props: { direction: 'vertical', gap: '1', align: 'start' },
                    children: [
                      {
                        el: 'Button',
                        props: { variant: 'link', size: 'sm' },
                        bind: {
                          label: { from: 'field', name: 'shop1Label' },
                          href: { from: 'field', name: 'shop1Link' },
                        },
                        style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
                      },
                      {
                        el: 'Button',
                        props: { variant: 'link', size: 'sm' },
                        bind: {
                          label: { from: 'field', name: 'shop2Label' },
                          href: { from: 'field', name: 'shop2Link' },
                        },
                        style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
                      },
                      {
                        el: 'Button',
                        props: { variant: 'link', size: 'sm' },
                        bind: {
                          label: { from: 'field', name: 'shop3Label' },
                          href: { from: 'field', name: 'shop3Link' },
                        },
                        style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
                      },
                    ],
                    style: {
                      padding: { t: '2', r: '4', b: '2', l: '4' },
                      background: 'brand:surface',
                      color: 'brand:ink',
                    },
                  },
                ],
                style: { color: 'brand:ink' },
              },
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm' },
                bind: { label: { from: 'field', name: 'nav3Label' }, href: { from: 'field', name: 'nav3Link' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:ink', hover: { color: 'brand:accent' } },
              },
            ],
            style: { hidden: { base: true } },
          },
          {
            el: 'Button',
            props: {
              variant: 'outline',
              size: 'sm',
              action: { type: 'overlay', op: 'open', target: 'lien-he' },
            },
            bind: { label: { from: 'field', name: 'contactLabel' } },
            style: {
              hover: { background: 'brand:accent', color: 'brand:accent-ink', borderColor: 'brand:accent' },
            },
          },
          {
            el: 'Button',
            props: {
              variant: 'ghost',
              size: 'sm',
              action: { type: 'overlay', op: 'toggle', target: 'menu-mobile' },
            },
            bind: { label: { from: 'field', name: 'menuLabel' } },
            style: { color: 'brand:ink', hidden: { md: true, lg: true } },
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
