// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_prodcard01',
  name: 'ProductCard',
  label: { 'en-US': 'Product card', 'vi-VN': 'Thẻ sản phẩm' },
  category: 'commerce',
  icon: 'package',
  version: 1,
  binding: { apiId: 'product', mode: 'single' },
  fields: {
    badge: { kind: 'text', label: { 'en-US': 'Badge', 'vi-VN': 'Nhãn' }, default: 'Staff pick' },
  },
  tree: {
    el: 'Card',
    props: { padding: '6' },
    children: [
      {
        el: 'Stack',
        props: { gap: '2' },
        children: [
          {
            el: 'Badge',
            props: { variant: 'secondary' },
            bind: { text: { from: 'field', name: 'badge' } },
            showIf: { from: 'field', name: 'badge', is: 'present' },
          },
          { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } },
          {
            el: 'Price',
            props: { showCurrency: false },
            bind: { value: { from: 'entry', path: 'price' } },
          },
        ],
      },
    ],
  },
});
