// Source of truth for this content type. Edit by hand or from the admin
// Content Type Builder (which rewrites this file), then run `opencms migrate:create`.
import { defineContentType, f } from '@opencms/schema';

export default defineContentType({
  id: 'ct_brand0001',
  apiId: 'brand',
  displayName: { 'en-US': 'Brand', 'vi-VN': 'Thương hiệu' },
  group: 'shop',
  fields: {
    name: f.text({ id: 'fld_brand_name', required: true, indexed: true }),
    slug: f.slug({ id: 'fld_brand_slug', required: true, unique: true, from: 'name' }),
    logo: f.asset({ id: 'fld_brand_logo', accept: ['image/*'] }),
  },
});
