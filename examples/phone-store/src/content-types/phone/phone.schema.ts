// Source of truth for this content type. Edit by hand or from the admin
// Content Type Builder (which rewrites this file), then run `opencms migrate:create`.
import { defineContentType, f } from '@opencms/schema';

export default defineContentType({
  id: 'ct_phone',
  apiId: 'phone',
  displayName: { 'en-US': 'Phone', 'vi-VN': 'Điện thoại' },
  group: 'shop',
  review: true,
  fields: {
    name: f.text({ id: 'fld_ph_name', required: true, localizable: true, indexed: true }),
    slug: f.slug({ id: 'fld_ph_slug', required: true, unique: true, from: 'name' }),
    description: f.longText({ id: 'fld_ph_desc', localizable: true }),
    price: f.money({ id: 'fld_ph_price', required: true, currencyMode: 'fixed', currency: 'VND' }),
    featured: f.boolean({ id: 'fld_ph_featured', indexed: true }),
    image: f.text({ id: 'fld_ph_image', required: true }),
    brand: f.reference({ id: 'fld_ph_brand', required: true, indexed: true, target: 'brand' }),
    category: f.reference({ id: 'fld_ph_cat', required: true, indexed: true, target: 'category' }),
    storageGb: f.number({ id: 'fld_ph_storage' }),
    ramGb: f.number({ id: 'fld_ph_ram' }),
    color: f.text({ id: 'fld_ph_color', localizable: true }),
    screen: f.text({ id: 'fld_ph_screen' }),
    assets: f.asset({ id: 'fld_ikf7na' }),
  },
});
