// Source of truth for this content type. Edit by hand or from the admin
// Content Type Builder (which rewrites this file), then run `opencms migrate:create`.
import { defineContentType, f } from '@opencms/schema';

export default defineContentType({
  id: 'ct_product01',
  apiId: 'product',
  displayName: { 'en-US': 'Product', 'vi-VN': 'Sản phẩm' },
  group: 'shop',
  fields: {
    name: f.text({ id: 'fld_prod_name', required: true, localizable: true, indexed: true }),
    slug: f.slug({ id: 'fld_prod_slug', required: true, unique: true, from: 'name' }),
    description: f.richText({ id: 'fld_prod_desc', localizable: true }),
    price: f.money({ id: 'fld_prod_price', currencyMode: 'market' }),
    featured: f.boolean({ id: 'fld_prod_featured', indexed: true }),
    images: f.asset({ id: 'fld_prod_images', multiple: true, accept: ['image/*'] }),
    brand: f.reference({ id: 'fld_prod_brand', target: 'brand', indexed: true }),
    categories: f.taxonomy({ id: 'fld_prod_cats', taxonomy: 'product-category', multiple: true }),
    specs: f.json({ id: 'fld_prod_specs' }),
  },
});
