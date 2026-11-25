// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_storeframe01',
  name: 'StoreFrame',
  label: { 'en-US': 'Store frame', 'vi-VN': 'Khung cửa hàng' },
  category: 'layout',
  icon: 'layout-template',
  version: 1,
  fields: {},
  tree: {
    el: 'Stack',
    props: { direction: 'vertical', gap: '0' },
    children: [
      {
        el: 'Region',
        props: { name: 'header', label: { 'en-US': 'Header', 'vi-VN': 'Đầu trang' } },
      },
      {
        el: 'Box',
        children: [
          { el: 'PageContent' },
        ],
        style: { minHeight: '50vh' },
      },
      {
        el: 'Region',
        props: { name: 'footer', label: { 'en-US': 'Footer', 'vi-VN': 'Chân trang' } },
      },
    ],
  },
});
