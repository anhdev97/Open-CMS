import { defineContentType, f } from '@opencms/schema';

export default defineContentType({
  id: 'ct_phonecat',
  apiId: 'category',
  displayName: { 'en-US': 'Category', 'vi-VN': 'Danh mục' },
  group: 'shop',
  fields: {
    name: f.text({ id: 'fld_cat_name', required: true, localizable: true, indexed: true }),
    slug: f.slug({ id: 'fld_cat_slug', required: true, unique: true, from: 'name' }),
  },
});
