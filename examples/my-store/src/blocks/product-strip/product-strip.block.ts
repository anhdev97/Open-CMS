// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_prodstrip01',
  name: 'ProductStrip',
  label: { 'en-US': 'Product strip', 'vi-VN': 'Dải sản phẩm' },
  category: 'commerce',
  icon: 'gallery-horizontal',
  version: 1,
  binding: {
    apiId: 'product',
    mode: 'collection',
    filter: [
      { field: 'active', value: true },
    ],
    sort: { field: 'createdAt', direction: 'asc' },
    limit: 8,
    layout: { kind: 'carousel', columns: 3 },
    options: {
      emptyText: { 'en-US': 'No products on sale yet.', 'vi-VN': 'Chưa có sản phẩm đang bán.' },
    },
  },
  fields: {},
  tree: {
    el: 'Card',
    props: { padding: '4' },
    bind: { href: { from: 'entryUrl' } },
    children: [
      {
        el: 'Stack',
        props: { gap: '2' },
        children: [
          {
            el: 'Image',
            props: { aspect: '4/3', fit: 'cover' },
            bind: { src: { from: 'entry', path: 'images' } },
          },
          { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } },
          { el: 'Price', bind: { value: { from: 'entry', path: 'price' } } },
        ],
      },
    ],
    style: {
      background: 'brand:surface',
      borderColor: 'brand:line',
      hover: { background: 'brand:feature', borderColor: 'brand:accent' },
    },
  },
});
