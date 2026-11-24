// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_featprods01',
  name: 'FeaturedProducts',
  label: { 'en-US': 'Featured products', 'vi-VN': 'Sản phẩm nổi bật' },
  category: 'commerce',
  icon: 'layout-grid',
  version: 1,
  binding: {
    apiId: 'product',
    mode: 'collection',
    sort: { field: 'createdAt', direction: 'asc' },
    limit: 3,
    layout: { kind: 'grid', columns: 3 },
  },
  fields: {},
  tree: {
    el: 'Stack',
    props: { gap: '2' },
    children: [
      {
        el: 'Image',
        props: { aspect: '4/3', fit: 'cover' },
        bind: { src: { from: 'entry', path: 'images' } },
        style: { margin: { b: '6px' } },
      },
      { el: 'Heading', props: { level: 3 }, bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Price', bind: { value: { from: 'entry', path: 'price' } } },
    ],
  },
});
