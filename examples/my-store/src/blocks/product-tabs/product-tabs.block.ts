// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_prodtabs01',
  name: 'ProductTabs',
  label: { 'en-US': 'Product details with tabs', 'vi-VN': 'Chi tiết sản phẩm dạng thẻ' },
  category: 'commerce',
  icon: 'panels-top-left',
  version: 1,
  binding: { apiId: 'product', mode: 'single' },
  fields: {
    badge: { kind: 'text', label: { 'en-US': 'Badge', 'vi-VN': 'Nhãn' }, default: 'Free delivery' },
    badgeTip: {
      kind: 'text',
      label: { 'en-US': 'Badge tooltip', 'vi-VN': 'Chú thích nhãn' },
      default: 'Free delivery anywhere in Vietnam on orders over 500,000 ₫.',
    },
    descriptionTab: {
      kind: 'text',
      label: { 'en-US': 'Tab 1 label', 'vi-VN': 'Nhãn thẻ 1' },
      default: 'Description',
    },
    descriptionFallback: {
      kind: 'longText',
      label: {
        'en-US': 'Description when the product has none',
        'vi-VN': 'Mô tả khi sản phẩm chưa có',
      },
      default: 'A simple piece made to be worn every day. The full description is coming soon.',
    },
    specsTab: {
      kind: 'text',
      label: { 'en-US': 'Tab 2 label', 'vi-VN': 'Nhãn thẻ 2' },
      default: 'Specs',
    },
    specs: {
      kind: 'longText',
      label: { 'en-US': 'Specs', 'vi-VN': 'Thông số' },
      default: 'Material: 100% washed linen. Fit: relaxed. Sizes: S to XL. Care: machine wash at 30 °C.',
    },
    shippingTab: {
      kind: 'text',
      label: { 'en-US': 'Tab 3 label', 'vi-VN': 'Nhãn thẻ 3' },
      default: 'Shipping',
    },
    shipping: {
      kind: 'longText',
      label: { 'en-US': 'Shipping and returns', 'vi-VN': 'Giao hàng và đổi trả' },
      default: 'Delivered in 1 to 5 working days. Free returns within 30 days.',
    },
  },
  tree: {
    el: 'Columns',
    props: { count: 2, gap: '8', tracks: { base: ['1fr'], md: ['1fr', '1fr'] } },
    children: [
      {
        el: 'Image',
        props: { fit: 'cover', aspect: '4/3' },
        bind: { src: { from: 'entry', path: 'images' } },
      },
      {
        el: 'Stack',
        props: { direction: 'vertical', gap: '4', align: 'stretch' },
        children: [
          { el: 'Heading', props: { level: 1 }, bind: { text: { from: 'entry', path: 'name' } } },
          {
            el: 'Stack',
            props: { direction: 'horizontal', gap: '3', align: 'center', wrap: true },
            children: [
              { el: 'Price', bind: { value: { from: 'entry', path: 'price' } } },
              {
                el: 'Tooltip',
                props: { side: 'top' },
                bind: { text: { from: 'field', name: 'badgeTip' } },
                showIf: { from: 'field', name: 'badge', is: 'present' },
                children: [
                  {
                    el: 'Badge',
                    props: { variant: 'secondary' },
                    bind: { text: { from: 'field', name: 'badge' } },
                  },
                ],
              },
            ],
          },
          {
            el: 'Tabs',
            props: { variant: 'underline', align: 'start' },
            children: [
              {
                el: 'TabPanel',
                bind: { label: { from: 'field', name: 'descriptionTab' } },
                children: [
                  {
                    el: 'Text',
                    bind: { html: { from: 'entry', path: 'description' } },
                    showIf: { from: 'entry', path: 'description', is: 'present' },
                  },
                  {
                    el: 'Text',
                    bind: { text: { from: 'field', name: 'descriptionFallback' } },
                    showIf: { from: 'entry', path: 'description', is: 'absent' },
                  },
                ],
              },
              {
                el: 'TabPanel',
                bind: { label: { from: 'field', name: 'specsTab' } },
                children: [
                  { el: 'Text', bind: { text: { from: 'field', name: 'specs' } } },
                ],
              },
              {
                el: 'TabPanel',
                bind: { label: { from: 'field', name: 'shippingTab' } },
                children: [
                  { el: 'Text', bind: { text: { from: 'field', name: 'shipping' } } },
                ],
              },
            ],
          },
        ],
      },
    ],
    style: {
      padding: { t: '40px', r: '5%', b: '40px', l: '5%' },
      background: 'brand:surface',
      color: 'brand:ink',
    },
  },
});
