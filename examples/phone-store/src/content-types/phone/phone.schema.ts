import { defineContentType, f } from '@opencms/schema';

// Image is a site path (`/phones/iphone-16.jpg`). v0 has no file storage, and `url` rejects relative paths.
// `pnpm seed` downloads a picture into public/phones and writes that path.
export default defineContentType({
  id: 'ct_phone',
  apiId: 'phone',
  displayName: { 'en-US': 'Phone', 'vi-VN': 'Điện thoại' },
  group: 'shop',
  fields: {
    name: f.text({ id: 'fld_ph_name', required: true, localizable: true, indexed: true }),
    slug: f.slug({ id: 'fld_ph_slug', required: true, unique: true, from: 'name' }),
    description: f.longText({ id: 'fld_ph_desc', localizable: true }),
    price: f.money({ id: 'fld_ph_price', required: true, currencyMode: 'fixed', currency: 'VND' }),
    featured: f.boolean({ id: 'fld_ph_featured', indexed: true }),
    image: f.text({ id: 'fld_ph_image', required: true }),
    brand: f.reference({ id: 'fld_ph_brand', required: true, target: 'brand', indexed: true }),
    category: f.reference({ id: 'fld_ph_cat', required: true, target: 'category', indexed: true }),
    storageGb: f.number({ id: 'fld_ph_storage' }),
    ramGb: f.number({ id: 'fld_ph_ram' }),
    color: f.text({ id: 'fld_ph_color', localizable: true }),
    screen: f.text({ id: 'fld_ph_screen' }),
  },
});
