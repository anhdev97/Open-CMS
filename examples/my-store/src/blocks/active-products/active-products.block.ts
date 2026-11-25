// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_activeprods01',
  name: 'ActiveProducts',
  label: { 'en-US': 'Products on sale', 'vi-VN': 'Sản phẩm đang bán' },
  category: 'commerce',
  icon: 'layout-grid',
  version: 1,
  binding: {
    apiId: 'product',
    mode: 'collection',
    filter: [
      { field: 'active', value: true },
    ],
    sort: { field: 'createdAt', direction: 'desc' },
    limit: 8,
    layout: { kind: 'grid', columns: 4 },
    options: {
      emptyText: { 'en-US': 'No products on sale yet.', 'vi-VN': 'Chưa có sản phẩm đang bán.' },
    },
  },
  fields: {},
  tree: {
    el: 'Card',
    props: { padding: '4' },
    children: [
      {
        el: 'Stack',
        props: { gap: '2' },
        children: [
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
