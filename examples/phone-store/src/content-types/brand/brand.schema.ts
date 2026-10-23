import { defineContentType, f } from '@opencms/schema';

export default defineContentType({
  id: 'ct_phonebrand',
  apiId: 'brand',
  displayName: { 'en-US': 'Brand', 'vi-VN': 'Thương hiệu' },
  group: 'shop',
  fields: {
    name: f.text({ id: 'fld_br_name', required: true, indexed: true }),
    slug: f.slug({ id: 'fld_br_slug', required: true, unique: true, from: 'name' }),
  },
});
